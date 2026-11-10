/**
 * GET /api/orders/changes?type=standard&since=<ISO>
 *
 * The dashboard's one-a-minute check, instead of reloading the whole list:
 *   { now, lastImportedAt, full, ids }
 * `ids` are the orders of this type whose row, research, designs, comments,
 * proofs, messages or Support conversation changed since `since`; the page
 * reloads only those (/api/orders?ids=). `full` says reload everything: a
 * race or a production file changed (that moves many orders at once), too
 * many orders changed, or `since` is missing or too old. Pass `now` back as
 * the next `since`: it is set a little early so a write in flight is not missed.
 */
import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { getLastImport } from '../../../server/lib/importStamp.js'

const TYPES = new Set(['standard', 'custom', 'race_partner', 'bulk'])
const MAX_IDS = 150
const MAX_GAP_MS = 30 * 60_000
const OVERLAP_MS = 15_000

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (!(await requireAdmin(req, res))) return
  try {
    const now = new Date(Date.now() - OVERLAP_MS).toISOString()
    const type = TYPES.has(String(req.query?.type)) ? String(req.query.type) : 'standard'
    const since = new Date(String(req.query?.since || ''))
    const lastImportedAt = await getLastImport().catch(() => null)
    if (Number.isNaN(since.getTime()) || Date.now() - since.getTime() > MAX_GAP_MS) {
      return res.status(200).json({ now, lastImportedAt, full: true, ids: [] })
    }
    const after = { gt: since }
    // A race (date, weather) or a production file moves every order of it at once.
    const [race, template] = await Promise.all([
      prisma.race.findFirst({ where: { updatedAt: after }, select: { id: true } }),
      prisma.printTemplate.findFirst({ where: { updatedAt: after }, select: { id: true } }),
    ])
    if (race || template) return res.status(200).json({ now, lastImportedAt, full: true, ids: [] })

    const [orders, research, renders, comments, proofs, messages, threads] = await Promise.all([
      prisma.order.findMany({ where: { updatedAt: after }, select: { id: true } }),
      prisma.runnerResearch.findMany({ where: { updatedAt: after }, select: { orderId: true } }),
      prisma.renderJob.findMany({ where: { updatedAt: after }, select: { orderId: true } }),
      prisma.orderComment.findMany({ where: { createdAt: after }, select: { orderId: true } }),
      prisma.proof.findMany({ where: { updatedAt: after }, select: { orderId: true } }),
      prisma.orderMessage.findMany({ where: { createdAt: after }, select: { orderId: true } }),
      // A Support conversation holds a print and tags it Waiting on customer, by email.
      prisma.supportThread.findMany({ where: { updatedAt: after }, select: { customerEmail: true } }),
    ])
    const touched = new Set([
      ...orders.map(o => o.id),
      ...[...research, ...renders, ...comments, ...proofs, ...messages].map(r => r.orderId).filter(Boolean),
    ])
    const emails = [...new Set(threads.map(t => String(t.customerEmail || '').toLowerCase()).filter(Boolean))]
    const byEmail = emails.length
      ? await prisma.order.findMany({ where: { trackstarOrderType: type, status: { not: 'completed' }, customerEmail: { in: emails, mode: 'insensitive' } }, select: { id: true } })
      : []
    for (const o of byEmail) touched.add(o.id)
    if (!touched.size) return res.status(200).json({ now, lastImportedAt, full: false, ids: [] })
    if (touched.size > MAX_IDS * 3) return res.status(200).json({ now, lastImportedAt, full: true, ids: [] })
    // Only this view's orders.
    const ids = (await prisma.order.findMany({ where: { id: { in: [...touched] }, trackstarOrderType: type }, select: { id: true } })).map(o => o.id)
    if (ids.length > MAX_IDS) return res.status(200).json({ now, lastImportedAt, full: true, ids: [] })
    return res.status(200).json({ now, lastImportedAt, full: false, ids })
  } catch (error) {
    console.error('[API /orders/changes]', error)
    return sendPublicError(res, error)
  }
}
