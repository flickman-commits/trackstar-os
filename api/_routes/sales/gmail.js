/**
 * /api/sales/gmail - connect a rep's own Gmail so the tool can send as them.
 *
 *   GET  ?action=status     { configured, connected, email }
 *   GET  ?action=connect    redirects to Google's consent screen
 *   POST { action:'disconnect' }
 *
 * Google returns the browser to /api/sales/gmail-callback, which is its own
 * file because Google rejects a redirect URI containing a query string.
 * Connect sets a one-time `state` (cookie plus SystemConfig) the callback checks.
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep } from '../../_lib/users.js'
import { getAuthUrl, disconnectGmail, gmailStatus, redirectUriFor, isGmailConfigured } from '../../../server/domain/sales/gmail.js'
import { issueOAuthState } from '../../../server/domain/support/oauthState.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  // Any rep: this connects their own mailbox, and sends go as that account.
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  try {
    const action = req.method === 'GET'
      ? String(req.query?.action || 'status')
      : String((typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}).action || '')

    if (action === 'status') return res.status(200).json(await gmailStatus(actor.id))

    if (action === 'connect') {
      if (!isGmailConfigured()) return res.status(400).json({ error: 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first' })
      // The callback only accepts a code that comes back with this state.
      const state = await issueOAuthState(req, res, { purpose: 'sales_gmail', userId: actor.id })
      res.setHeader('Location', getAuthUrl(redirectUriFor(req), state))
      return res.status(302).end()
    }

    if (action === 'disconnect' && req.method === 'POST') {
      await disconnectGmail(actor.id)
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (error) {
    console.error('[API /sales/gmail]', error)
    return res.status(500).json({ error: 'Something went wrong with the Gmail connection' })
  }
}
