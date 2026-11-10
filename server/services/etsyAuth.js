// Etsy OAuth 2.0 Token Management
// Access tokens expire in 1 hour — we cache with a 55-minute safety margin
// Refresh tokens may rotate on each refresh — we persist the latest in the DB

import sharedPrisma from '../db.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'
import { requireConnection } from '../lib/connections.js'
import { alertCronFailure } from '../../api/_lib/alerts.js'

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
 * Persist the newest refresh token, but only over the one this refresh used.
 * Every warm server instance refreshes on its own; when two do at once, the
 * one that saves second must not put back a token the first has already
 * replaced (last writer wins stored a dead token, and Etsy orders then
 * imported without their personalization until someone reconnected).
 * Returns false when another instance had already saved a newer one.
 */
async function storeRefreshToken(token, usedToken) {
  const prisma = getPrisma()
  const { count } = await prisma.systemConfig.updateMany({ where: { key: 'etsy_refresh_token', value: usedToken }, data: { value: token } })
  if (count) return true
  const row = await prisma.systemConfig.findUnique({ where: { key: 'etsy_refresh_token' } })
  if (row) return false
  await prisma.systemConfig.create({ data: { key: 'etsy_refresh_token', value: token } }).catch(() => {})
  return true
}

/**
 * Refresh the Etsy access token. A refresh token that Etsy refuses is
 * re-read once (another instance may have rotated it a moment ago) before
 * giving up, and a failure is posted to #admin-alerts at most hourly.
 */
async function refreshAccessToken() {
  try {
    return await refreshOnce()
  } catch (err) {
    if (err.refused) {
      try { return await refreshOnce({ unless: err.used }) } catch (again) { err = again }
    }
    await alertCronFailure('etsy-token-refresh', err, { fix: 'If it keeps failing, reconnect Etsy in Settings > Connections.' })
    throw err
  }
}

async function refreshOnce({ unless = null } = {}) {
  const apiKey = process.env.ETSY_API_KEY
  const sharedSecret = process.env.ETSY_SHARED_SECRET

  if (!apiKey || !sharedSecret) {
    throw new Error('Missing ETSY_API_KEY or ETSY_SHARED_SECRET in environment variables')
  }

  const refreshToken = await getStoredRefreshToken()
  if (!refreshToken) {
    throw new Error('No Etsy refresh token available. Run the OAuth setup flow first.')
  }
  // The retry after a refusal: only worth it if another instance has saved a different token since.
  if (unless && refreshToken === unless) throw Object.assign(new Error('Etsy refused the stored refresh token, and no newer one has been saved'), { refused: true })

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
    // 400/401 with invalid_grant: this token is no longer good (used, rotated, or revoked).
    const refused = (response.status === 400 || response.status === 401) && /invalid_grant|invalid|expired/i.test(errorText)
    throw Object.assign(new Error(`Etsy token refresh failed (${response.status}): ${errorText.slice(0, 300)}`), { refused, used: refreshToken })
  }

  const data = await response.json()

  if (!data.access_token) {
    throw new Error('No access_token in Etsy refresh response')
  }

  // Etsy may issue a new refresh token — persist it over the one we used (storeRefreshToken)
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    const saved = await storeRefreshToken(data.refresh_token, refreshToken)
    console.log(saved ? '[etsyAuth] New refresh token persisted to DB' : '[etsyAuth] Another instance saved a newer refresh token first; kept theirs')
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
