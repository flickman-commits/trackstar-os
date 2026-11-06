/**
 * POST /api/creators/sample - admin only. Send a creator a sample (their
 * first, or another: a second race, a reshoot, a replacement).
 *
 *   { creatorId, raceName, raceYear, productTitle?, bibNumber?, finishTime?, productSize?, frameType? }
 *
 * Goes out as a free Shopify order through the Samples flow
 * (server/domain/creators/creatorSample.js): Shopify emails the creator,
 * Artelo makes it like any order, the cost goes into the sample spend, and
 * the order links to the creator once it is imported. Audited.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import { sendCreatorSample } from '../../../server/domain/creators/creatorSample.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  const admin = await requireAdminRole(req, res, actor)
  if (!admin) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const raceYear = Number(b.raceYear)
    if (!String(b.raceName || '').trim() || !Number.isFinite(raceYear)) return res.status(400).json({ error: 'Race and year are required' })
    const out = await sendCreatorSample({ ...b, raceYear, actor: admin })
    await recordAudit({ action: 'creator.sample-added', summary: `Sent creator sample ${out.name}: ${out.print}`, detail: { creatorId: b.creatorId, order: out.name }, actor: admin })
    return res.status(200).json({ ok: true, orderNumber: out.name, shopifyUrl: out.adminUrl })
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message })
    console.error('[API /creators/sample]', error)
    return res.status(500).json({ error: `Could not create the sample: ${String(error.message || error).split('\n').filter(Boolean).pop().slice(0, 300)}` })
  }
}
