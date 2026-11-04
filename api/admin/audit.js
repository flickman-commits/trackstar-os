/**
 * /api/admin/audit - the "who did what" log.
 *
 *   GET ?q=4883&prefix=render&userId=...&from=YYYY-MM-DD&to=YYYY-MM-DD&before=<iso>&limit=100
 *       q        words in the summary, action, person or detail; an order
 *                number also finds that order's entries by its internal id
 *       prefix   the kind of action ("render", "artelo", "order", ...)
 *       before   paging: the nextBefore from the previous page
 *   GET ?action=price.apply    one exact action (kept for older callers)
 *   GET ?facets=1              the kinds of action and the people in the log
 *
 * Admin only, as part of the admin view. It is append-only regardless:
 * nothing in this file writes or deletes, so the log cannot be edited from
 * the application at all. Search lives in server/domain/audit/search.js.
 */
import { setCors, requireAdmin } from '../_lib/auth.js'
import { requireAdminRole } from '../_lib/users.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { searchAudit, auditFacets } from '../../server/domain/audit/search.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  if (!await requireAdminRole(req, res, actor)) return

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const q = req.query || {}
    if (q.facets) return res.status(200).json(await auditFacets())
    const out = await searchAudit({
      q: q.q ? String(q.q) : '',
      // ?action= was an exact match; a prefix with no dot matches the same row and its kin.
      prefix: q.prefix ? String(q.prefix) : q.action ? String(q.action) : '',
      userId: q.userId ? String(q.userId) : '',
      from: q.from ? String(q.from) : '',
      to: q.to ? String(q.to) : '',
      before: q.before ? String(q.before) : '',
      limit: q.limit,
    })
    return res.status(200).json(out)
  } catch (error) {
    console.error('[admin/audit] Error:', error)
    return sendPublicError(res, error)
  }
}
