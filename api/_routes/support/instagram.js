/**
 * /api/support/instagram - the @trackstar_art connection.
 *
 *   GET  ?action=status                 { configured, connected, username, expectedHandle, tokenExpiresAt, humanAgent, webhookConfigured, lastImportedAt }
 *   GET  ?action=connect                redirects to Instagram's login as the account      (admin)
 *   POST { action:'token', accessToken } a long-lived token pasted from the Meta dashboard (admin)
 *   POST { action:'backfill' }           pull the recent conversations once                 (admin)
 *   POST { action:'disconnect' }                                                            (admin)
 *
 * Same shape as /api/support/gmail: anyone on Support may ask whether it is
 * connected; only an admin connects, imports or disconnects, because the
 * grant is the whole team's. Instagram returns the browser to
 * /api/support/instagram-callback.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireCapability, requireAdminRole, recordAudit } from '../../_lib/users.js'
import { getAuthUrl, redirectUriFor, status, disconnect, connectWithToken, backfill, isConfigured } from '../../../server/domain/support/instagram.js'
import { issueOAuthState } from '../../../server/domain/support/oauthState.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'support')
  if (!user) return

  try {
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}) : {}
    const action = req.method === 'GET' ? String(req.query?.action || 'status') : String(body.action || '')

    if (action === 'status') return res.status(200).json(await status())

    // Everything below changes the team's connection: admin, re-read from the database.
    const admin = await requireAdminRole(req, res, (await requireAdmin(req, res)))
    if (!admin) return

    if (action === 'connect' && req.method === 'GET') {
      if (!isConfigured()) return res.status(400).json({ error: 'Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET first' })
      // The callback only accepts a code that comes back with this state, in this admin's browser.
      const state = await issueOAuthState(req, res, { purpose: 'support_instagram', userId: admin.id })
      res.setHeader('Location', getAuthUrl(redirectUriFor(req), state))
      return res.status(302).end()
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    if (action === 'token') {
      const out = await connectWithToken(body.accessToken)
      await recordAudit({ action: 'support.instagram', summary: `Connected Instagram as @${out.username}`, detail: out, actor: admin })
      return res.status(200).json({ success: true, ...out })
    }
    if (action === 'backfill') {
      const out = await backfill({ conversations: Math.min(Number(body.conversations) || 20, 50) })
      console.log(`[support.instagram.backfill] ${out.conversations} conversations, ${out.imported} imported, ${out.failed} failed`)
      await recordAudit({ action: 'support.instagram', summary: `Imported ${out.imported} Instagram DMs from ${out.conversations} conversations`, detail: out, actor: admin })
      return res.status(200).json(out)
    }
    if (action === 'disconnect') {
      await disconnect()
      await recordAudit({ action: 'support.instagram', summary: 'Disconnected Instagram', detail: null, actor: admin })
      return res.status(200).json({ success: true })
    }
    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (error) {
    console.error('[API /support/instagram]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Something went wrong with the Instagram connection') })
  }
}
