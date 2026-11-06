/**
 * GET /api/etsy/auth
 *
 * One-time OAuth 2.0 + PKCE setup endpoint for Etsy API.
 *
 * Flow:
 *   1. GET /api/etsy/auth → generates PKCE code_verifier/challenge,
 *      stores verifier in a cookie, redirects to Etsy consent page
 *   2. Etsy redirects back with ?code=XXX
 *   3. GET /api/etsy/auth?code=XXX → exchanges code for tokens,
 *      stores refresh token in SystemConfig DB
 *
 * Scope: transactions_r
 */

import prisma from '../../_lib/prisma.js'
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { fetchWithTimeout } from '../../../server/lib/fetchWithTimeout.js'
import crypto from 'crypto'

function base64urlEncode(buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export default async function handler(req, res) {
  // Admin only, on both legs. This used to be public on the theory that only
  // Matt's Etsy login could complete it; any Etsy account can consent to the
  // app, so a stranger could replace our refresh token with their own shop's.
  // Both legs are top-level navigations, so the session cookie (SameSite=Lax)
  // is present. The token is also checked against ETSY_SHOP_ID before saving.
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const admin = await requireAdminOnly(req, res)
  if (!admin) return

  const apiKey = process.env.ETSY_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ETSY_API_KEY not configured' })
  }

  try {
    // Check if this is a callback with an authorization code
    const { code, state } = req.query

    if (code) {
      // --- Step 2: Exchange code for tokens ---
      console.log('[etsy/auth] Exchanging authorization code for tokens...')

      // Get the code_verifier and state from cookies
      const cookies = parseCookies(req.headers.cookie || '')
      const codeVerifier = cookies.etsy_code_verifier
      const savedState = cookies.etsy_oauth_state

      if (!codeVerifier) {
        return res.status(400).json({
          error: 'Missing code_verifier cookie. Please restart the OAuth flow.'
        })
      }

      // Validate the OAuth state parameter to prevent CSRF attacks
      if (!savedState || !state || savedState !== state) {
        return res.status(403).json({
          error: 'OAuth state mismatch - possible CSRF attack. Please restart the OAuth flow.'
        })
      }

      // Determine the redirect URI (must match what was used in step 1)
      const protocol = req.headers['x-forwarded-proto'] || 'https'
      const host = req.headers['x-forwarded-host'] || req.headers.host
      const redirectUri = `${protocol}://${host}/api/etsy/auth`

      const tokenResponse = await fetch('https://api.etsy.com/v3/public/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: apiKey,
          redirect_uri: redirectUri,
          code,
          code_verifier: codeVerifier
        })
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('[etsy/auth] Token exchange failed:', errorText)
        return res.status(400).json({ error: 'Etsy did not accept the connection. Start again from Settings.' })
      }

      const tokenData = await tokenResponse.json()

      // Whose shop is this? Refuse anything but ours.
      const expectedShop = String(process.env.ETSY_SHOP_ID || '')
      const me = await fetchWithTimeout('https://api.etsy.com/v3/application/users/me', {
        headers: {
          'x-api-key': `${apiKey}:${process.env.ETSY_SHARED_SECRET || ''}`,
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }).then(r => (r.ok ? r.json() : null)).catch(() => null)
      if (!expectedShop || !me || String(me.shop_id || '') !== expectedShop) {
        console.warn(`[etsy/auth] refused a connection for shop ${me?.shop_id ?? 'unknown'} (expected ${expectedShop || 'ETSY_SHOP_ID unset'})`)
        return res.status(403).json({ error: 'That Etsy account is not the Trackstar shop. Sign in to Etsy as the shop owner and try again.' })
      }

      // Store the refresh token in the DB
      if (tokenData.refresh_token) {
        await prisma.systemConfig.upsert({
          where: { key: 'etsy_refresh_token' },
          update: { value: tokenData.refresh_token },
          create: { key: 'etsy_refresh_token', value: tokenData.refresh_token }
        })
        console.log('[etsy/auth] Refresh token stored in DB')
        await recordAudit({ action: 'connection.etsy', summary: 'Reconnected Etsy', actor: admin })
      }

      // Clear the cookies
      res.setHeader('Set-Cookie', [
        'etsy_code_verifier=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        'etsy_oauth_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
      ])

      return res.status(200).json({
        success: true,
        message: 'Etsy OAuth setup complete! Refresh token stored in DB.',
        access_token_expires_in: tokenData.expires_in,
        token_type: tokenData.token_type
      })

    } else {
      // --- Step 1: Redirect to Etsy consent page ---
      console.log('[etsy/auth] Starting OAuth PKCE flow...')

      // Generate PKCE code_verifier (43-128 chars)
      const codeVerifier = base64urlEncode(crypto.randomBytes(64))

      // SHA-256 + base64url → code_challenge
      const hash = crypto.createHash('sha256').update(codeVerifier).digest()
      const codeChallenge = base64urlEncode(hash)

      // Generate state for CSRF protection
      const oauthState = base64urlEncode(crypto.randomBytes(16))

      // Build the redirect URI
      const protocol = req.headers['x-forwarded-proto'] || 'https'
      const host = req.headers['x-forwarded-host'] || req.headers.host
      const redirectUri = `${protocol}://${host}/api/etsy/auth`

      // Store code_verifier and state in cookies (survive the redirect)
      res.setHeader('Set-Cookie', [
        `etsy_code_verifier=${codeVerifier}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`,
        `etsy_oauth_state=${oauthState}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax`
      ])

      const authUrl = new URL('https://www.etsy.com/oauth/connect')
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', apiKey)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('scope', 'transactions_r')
      authUrl.searchParams.set('state', oauthState)
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')

      console.log('[etsy/auth] Redirecting to Etsy consent page...')
      return res.redirect(302, authUrl.toString())
    }

  } catch (error) {
    console.error('[etsy/auth] Error:', error)
    return res.status(500).json({ error: 'The Etsy connection failed. Start again from Settings.' })
  }
}

function parseCookies(cookieHeader) {
  const cookies = {}
  if (!cookieHeader) return cookies
  for (const pair of cookieHeader.split(';')) {
    const [key, ...vals] = pair.split('=')
    if (key) {
      cookies[key.trim()] = vals.join('=').trim()
    }
  }
  return cookies
}
