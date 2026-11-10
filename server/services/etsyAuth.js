// Etsy OAuth 2.0 Token Management
// Access tokens expire in 1 hour — we cache with a 55-minute safety margin
// Refresh tokens may rotate on each refresh — we persist the latest in the DB

import sharedPrisma from '../db.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'
import { requireConnection } from '../lib/connections.js'

let cachedToken = null
let tokenExpiry = null
// The one shared client (server/db.js): a second pool per instance is what exhausts the database's connection limit.
function getPrisma() {
  return sharedPrisma
}

/**
 * Get the latest refresh token from DB (survives serverless cold starts)
 */
async function getStoredRefreshToken() {
  const prisma = getPrisma()
  const row = await prisma.systemConfig.findUnique({
    where: { key: 'etsy_refresh_token' }
  })
  return row?.value || process.env.ETSY_REFRESH_TOKEN || null
}

/**
 * Persist the latest refresh token to DB
 * Etsy may rotate the refresh token on each use — always save the newest one
 */
async function storeRefreshToken(token) {
  const prisma = getPrisma()
  await prisma.systemConfig.upsert({
    where: { key: 'etsy_refresh_token' },
    update: { value: token },
    create: { key: 'etsy_refresh_token', value: token }
  })
}

/**
 * Refresh the Etsy access token using the stored refresh token
 */
async function refreshAccessToken() {
  const apiKey = process.env.ETSY_API_KEY
  const sharedSecret = process.env.ETSY_SHARED_SECRET

  if (!apiKey || !sharedSecret) {
    throw new Error('Missing ETSY_API_KEY or ETSY_SHARED_SECRET in environment variables')
  }

  const refreshToken = await getStoredRefreshToken()
  if (!refreshToken) {
    throw new Error('No Etsy refresh token available. Run the OAuth setup flow first.')
  }

  console.log('[etsyAuth] Refreshing Etsy access token...')

  const response = await fetchWithTimeout('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: apiKey,
      refresh_token: refreshToken
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Etsy token refresh failed (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  if (!data.access_token) {
    throw new Error('No access_token in Etsy refresh response')
  }

  // Etsy may issue a new refresh token — always persist the latest
  if (data.refresh_token) {
    await storeRefreshToken(data.refresh_token)
    console.log('[etsyAuth] New refresh token persisted to DB')
  }

  cachedToken = data.access_token
  // Cache for 55 minutes (tokens expire at 60 minutes)
  tokenExpiry = Date.now() + (55 * 60 * 1000)

  console.log('[etsyAuth] Etsy access token cached successfully')
  return cachedToken
}

/**
 * Get a valid Etsy access token, refreshing if needed
 */
export async function getEtsyToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken
  }
  return refreshAccessToken()
}

/**
 * Make an authenticated request to Etsy API v3
 * @param {string} endpoint - API endpoint (e.g., '/shops/12345/receipts/67890')
 * @param {object} options - Additional fetch options
 */
export async function etsyFetch(endpoint, options = {}) {
  await requireConnection('etsy')
  const token = await getEtsyToken()
  const apiKey = process.env.ETSY_API_KEY
  const sharedSecret = process.env.ETSY_SHARED_SECRET

  // x-api-key must be keystring:sharedsecret (colon-separated) — returns 403 otherwise
  const xApiKey = `${apiKey}:${sharedSecret}`

  const url = `https://openapi.etsy.com/v3/application${endpoint}`

  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-api-key': xApiKey,
      ...options.headers
    }
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Etsy API error (${response.status}): ${errorText}`)
  }

  return response.json()
}

/**
 * Clear the cached token (useful for testing or forced refresh)
 */
export function clearTokenCache() {
  cachedToken = null
  tokenExpiry = null
}
