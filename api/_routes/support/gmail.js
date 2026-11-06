/**
 * /api/support/gmail - the shared support mailbox's connection.
 *
 *   GET  ?action=status     { configured, connected, email, expectedEmail, backfill, lastImportedAt }
 *   GET  ?action=connect    redirects to Google's consent screen (admin)
 *   POST { action:'disconnect' }                                       (admin)
 *
 * Anyone on Support may ask whether it is connected; only an admin connects
 * or disconnects it, because the grant is the whole team's, not theirs.
 * Google returns the browser to /api/support/gmail-callback, which checks
 * the one-time `state` set here.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireCapability, requireAdminRole } from '../../_lib/users.js'
import { getAuthUrl, redirectUriFor, status, disconnect } from '../../../server/domain/support/mailbox.js'
import { issueOAuthState } from '../../../server/domain/support/oauthState.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'support')
  if (!user) return

  try {
    const action = req.method === 'GET'
      ? String(req.query?.action || 'status')
      : String((typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}).action || '')

    if (action === 'status') return res.status(200).json(await status())

    if (action === 'connect') {
      const admin = await requireAdminRole(req, res, (await requireAdmin(req, res)))
      if (!admin) return
      if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
        return res.status(400).json({ error: 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first' })
      }
      // The callback only accepts a code that comes back with this state, in this admin's browser.
      const state = await issueOAuthState(req, res, { purpose: 'support_gmail', userId: admin.id })
      res.setHeader('Location', getAuthUrl(redirectUriFor(req), state))
      return res.status(302).end()
    }

    if (action === 'disconnect' && req.method === 'POST') {
      if (!(await requireAdminRole(req, res, (await requireAdmin(req, res))))) return
      await disconnect()
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (error) {
    console.error('[API /support/gmail]', error)
    return res.status(500).json({ error: 'Something went wrong with the mailbox connection' })
  }
}
