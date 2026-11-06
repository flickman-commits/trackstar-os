/**
 * GET /api/support/gmail-callback
 *
 * Where Google returns the browser after the consent screen for the support
 * mailbox. Its own path because Google rejects a redirect URI that carries a
 * query string. The session cookie rides along on the top-level navigation,
 * so the admin check works as usual. Either way the browser ends up on
 * /support with a flag the page turns into a toast. The one-time `state`
 * set on Connect must come back, and a failure carries a fixed reason code.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole } from '../../_lib/users.js'
import { originFor } from '../../../server/domain/sales/gmail.js'
import { completeConnection, redirectUriFor } from '../../../server/domain/support/mailbox.js'
import { checkOAuthState } from '../../../server/domain/support/oauthState.js'

/** Fixed reason codes the Support page maps to words; never an error's own text. */
const REASONS = new Set(['wrong_account', 'no_refresh_token'])

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  const admin = await requireAdminRole(req, res, actor)
  if (!admin) return

  const base = originFor(req)
  const back = (query) => {
    res.setHeader('Location', `${base}/support?${query}`)
    return res.status(302).end()
  }

  // The state has to be the one this admin's browser was handed on Connect.
  const stateOk = await checkOAuthState(req, res, { purpose: 'support_gmail', userId: admin.id, state: req.query?.state })
  if (req.query?.error) return back('gmail=denied')
  if (!stateOk) return back('gmail=error&reason=state')
  const code = String(req.query?.code || '')
  if (!code) return back('gmail=denied')

  try {
    const { email } = await completeConnection(code, redirectUriFor(req))
    return back(`gmail=connected&account=${encodeURIComponent(email)}`)
  } catch (err) {
    console.error('[API /support/gmail-callback] failed', err)
    return back(`gmail=error&reason=${REASONS.has(err?.reason) ? err.reason : 'failed'}`)
  }
}
