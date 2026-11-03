import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'
import { requireConnection } from '../lib/connections.js'
// Shopify Client Credentials OAuth - Token Management
// Tokens expire every 24 hours, so we cache with a 23-hour safety margin

let cachedToken = null
let tokenExpiry = null

/**
 * Get a valid Shopify access token, fetching a new one if needed
 * Uses Client Credentials Grant flow
 */
export async function getShopifyToken() {
  // Return cached token if still valid
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    console.log('Using cached Shopify token')
    return cachedToken
  }

  console.log('Fetching new Shopify access token...')

  const store = process.env.SHOPIFY_STORE
  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET

  if (!store || !clientId || !clientSecret) {
    throw new Error('Missing Shopify credentials in environment variables')
  }

  const response = await fetchWithTimeout(
    `https://${store}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      })
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Shopify OAuth error (${response.status}): ${errorText}`)
  }

  const data = await response.json()

  if (!data.access_token) {
    throw new Error('No access_token in Shopify response')
  }

  cachedToken = data.access_token
  // Cache for 23 hours (tokens expire at 24 hours)
  tokenExpiry = Date.now() + (23 * 60 * 60 * 1000)

  console.log('Shopify token cached successfully')
  return cachedToken
}

/**
 * Make an authenticated request to Shopify Admin API
 * @param {string} endpoint - API endpoint (e.g., '/orders/12345.json')
 * @param {object} options - Additional fetch options
 */
export async function shopifyFetch(endpoint, options = {}) {
  await requireConnection('shopify')
  const token = await getShopifyToken()
  const store = process.env.SHOPIFY_STORE

  const url = `https://${store}/admin/api/2024-01${endpoint}`

  // Retry what is temporary: a rate limit (429, Shopify's REST bucket refills
  // at 2 calls a second), a 5xx, or a timeout. Three tries, honoring
  // Retry-After. A one-off failure here used to drop an order's Shopify data
  // for that whole import run.
  let response
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetchWithTimeout(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
          ...options.headers
        }
      })
    } catch (error) {
      if (attempt >= 3) throw error
      console.warn(`[shopifyFetch] ${endpoint} attempt ${attempt} failed (${error.message}), retrying`)
      await new Promise(r => setTimeout(r, 1000 * attempt))
      continue
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const wait = Math.min(Number(response.headers.get('retry-after')) * 1000 || 1000 * attempt, 5000)
      console.warn(`[shopifyFetch] ${endpoint} got ${response.status}, retrying in ${wait}ms`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    break
  }

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Shopify API error (${response.status}): ${errorText}`)
  }

  // Cursor pagination: REST lists hand the next page back in the Link
  // header (since_id is not honored beside a created_at filter). With
  // `withLink` the caller gets the body and the next page's endpoint, or null.
  if (options.withLink) {
    const link = response.headers.get('link') || ''
    const m = /<([^>]+)>;\s*rel="next"/.exec(link)
    const next = m ? m[1].replace(/^https?:\/\/[^/]+\/admin\/api\/[^/]+/, '') : null
    return { data: await response.json(), next }
  }
  return response.json()
}

/**
 * Make an authenticated GraphQL request to the Shopify Admin API.
 * @param {string} query - GraphQL query/mutation
 * @param {object} variables - GraphQL variables
 * @param {{ version?: string }} [opts] - API version, default 2024-01
 * @returns {object} the `data` object from the response
 */
export async function shopifyGraphQL(query, variables = {}, { version = '2024-01' } = {}) {
  await requireConnection('shopify')
  const token = await getShopifyToken()
  const store = process.env.SHOPIFY_STORE

  // Pass a newer version only for a call that needs it (orderCreate is 2024-07+).
  const response = await fetchWithTimeout(
    `https://${store}/admin/api/${version}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Shopify GraphQL error (${response.status}): ${errorText}`)
  }

  const json = await response.json()
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`)
  }
  return json.data
}

/**
 * Clear the cached token (useful for testing or forced refresh)
 */
export function clearTokenCache() {
  cachedToken = null
  tokenExpiry = null
}
