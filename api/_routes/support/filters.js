/**
 * /api/support/filters - senders kept out of the inbox.
 *
 *   GET                                   { filters: [{ pattern, addedBy, addedAt }] }
 *   POST { action:'add', pattern }        an address or a domain; files existing conversations from it
 *   POST { action:'remove', pattern }     and brings them back
 *
 * Anyone on Support can filter one address: it hides, never deletes, and is
 * undone from the same list. A whole domain is an admin's, and never a
 * consumer provider like gmail.com. Audited. See server/domain/support/filters.js.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { listFilters, addFilter, removeFilter } from '../../../server/domain/support/filters.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    if (req.method === 'GET') return res.status(200).json({ filters: await listFilters() })
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (body.action === 'add') {
      const out = await addFilter(body.pattern, user)
      await recordAudit({ action: 'support.filter', summary: `Filtered mail from ${out.pattern} (${out.filed} conversations filed)`, detail: out, actor: user })
      return res.status(200).json(out)
    }
    if (body.action === 'remove') {
      const out = await removeFilter(body.pattern)
      await recordAudit({ action: 'support.unfilter', summary: `Stopped filtering ${out.pattern} (${out.restored} back in the inbox)`, detail: out, actor: user })
      return res.status(200).json(out)
    }
    return res.status(400).json({ error: `Unknown action: ${body.action}` })
  } catch (error) {
    console.error('[API /support/filters]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Could not change the filters') })
  }
}
