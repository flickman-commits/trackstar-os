/**
 * GET /api/sales/gmail-callback
 *
 * Where Google returns the browser after the consent screen. Its own path and
 * its own file, because Google rejects a registered redirect URI that carries
 * a query string, so this could not live at /api/sales/gmail?action=callback.
 *
 * The request arrives as a top-level navigation, so the session cookie
 * (SameSite=Lax) comes with it and requireAdmin works normally. On both
 * success and failure the browser ends up back on /sales with a flag the page
 * turns into a toast. A failure carries a fixed reason code, never the
 * error's own text.
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep } from '../../_lib/users.js'
import { completeConnection, redirectUriFor, originFor } from '../../../server/domain/sales/gmail.js'
import { checkOAuthState } from '../../../server/domain/support/oauthState.js'

/** Fixed reason codes the Sales page maps to words; never an error's own text. */
const REASONS = new Set(['wrong_account', 'no_refresh_token', 'no_user'])

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  const base = originFor(req)
  const back = (query) => {
    res.setHeader('Location', `${base}/sales?${query}`)
    return res.status(302).end()
  }

  // The state has to be the one this browser was handed on Connect, or the
  // code could be someone else's account.
  const stateOk = await checkOAuthState(req, res, { purpose: 'sales_gmail', userId: actor.id, state: req.query?.state })
  // Google reports a refusal with ?error=access_denied rather than a code.
  if (req.query?.error) return back('gmail=denied')
  if (!stateOk) return back('gmail=error&reason=state')
  const code = String(req.query?.code || '')
  if (!code) return back('gmail=denied')

  try {
    const { email } = await completeConnection(code, redirectUriFor(req), actor.id)
    return back(`gmail=connected&account=${encodeURIComponent(email)}`)
  } catch (err) {
    console.error('[API /sales/gmail-callback] failed', err)
    return back(`gmail=error&reason=${REASONS.has(err?.reason) ? err.reason : 'failed'}`)
  }
}
