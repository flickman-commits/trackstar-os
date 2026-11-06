/**
 * GET /api/support/instagram-callback
 *
 * Where Instagram returns the browser after the login as @trackstar_art.
 * Its own path because Meta wants an exact redirect URI with no query
 * string. The session cookie rides along on the top-level navigation, so
 * the admin check works as usual. Either way the browser ends up on
 * /support with a flag the page turns into a toast. The one-time `state`
 * set on Connect must come back, and a failure carries a fixed reason code.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import { originFor } from '../../../server/domain/sales/gmail.js'
import { completeConnection, redirectUriFor } from '../../../server/domain/support/instagram.js'
import { checkOAuthState } from '../../../server/domain/support/oauthState.js'

/** Fixed reason codes the Support page maps to words; never an error's own text. */
const REASONS = new Set(['wrong_account', 'no_token'])

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
  const stateOk = await checkOAuthState(req, res, { purpose: 'support_instagram', userId: admin.id, state: req.query?.state })
  if (req.query?.error) return back('instagram=denied')
  if (!stateOk) return back('instagram=error&reason=state')
  const code = String(req.query?.code || '').replace(/#_$/, '')
  if (!code) return back('instagram=denied')

  try {
    const { username } = await completeConnection(code, redirectUriFor(req))
    await recordAudit({ action: 'support.instagram', summary: `Connected Instagram as @${username}`, detail: { username }, actor: admin })
    return back(`instagram=connected&account=${encodeURIComponent('@' + username)}`)
  } catch (err) {
    console.error('[API /support/instagram-callback] failed', err)
    return back(`instagram=error&reason=${REASONS.has(err?.reason) ? err.reason : 'failed'}`)
  }
}
