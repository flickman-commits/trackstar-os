/**
 * GET /api/orders/same-runner?orderId=<id>
 *
 * Other orders for the same runner, race and year, placed as different
 * orders: a runner buying their own print while a partner or parent buys it
 * for them. The order view shows them so the team can check with the
 * customers before two of the same print go out. Standard prints only,
 * matched on the printed name (override first), the effective race and the
 * effective year, any status. Anyone signed in.
 */
import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const id = String(req.query?.orderId || '')
    const o = await prisma.order.findUnique({
      where: { id },
      select: { id: true, parentOrderNumber: true, trackstarOrderType: true, customerEmail: true, runnerName: true, runnerNameOverride: true, raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true },
    })
    if (!o) return res.status(404).json({ error: 'Order not found' })
    if (o.trackstarOrderType !== 'standard') return res.status(200).json({ others: [] })
    const runner = norm(o.runnerNameOverride || o.runnerName)
    const race = norm(o.raceNameOverride || o.raceName)
    const year = o.yearOverride ?? o.raceYear
    // Placeholders ('Unknown Runner' on an order with no details yet) are not a runner.
    if (!runner || !race || !year || /^unknown\b/.test(runner) || /^unknown\b/.test(race)) return res.status(200).json({ others: [] })

    // The year and race narrow it in the database; the name is compared here
    // so "Jane Smith" and "jane smith" match (the override wins, as printed).
    const rows = await prisma.order.findMany({
      where: {
        trackstarOrderType: 'standard', parentOrderNumber: { not: o.parentOrderNumber },
        OR: [{ yearOverride: year }, { yearOverride: null, raceYear: year }],
      },
      select: {
        id: true, parentOrderNumber: true, lineItemIndex: true, status: true, createdAt: true, source: true,
        runnerName: true, runnerNameOverride: true, raceName: true, raceNameOverride: true, customerName: true, customerEmail: true, productSize: true, shopifyOrderData: true,
      },
    })
    const others = rows
      .filter(r => norm(r.runnerNameOverride || r.runnerName) === runner && norm(r.raceNameOverride || r.raceName) === race)
      .map(r => ({
        id: r.id, parentOrderNumber: r.parentOrderNumber, lineItemIndex: r.lineItemIndex,
        displayOrderNumber: String(r.shopifyOrderData?.name || r.parentOrderNumber).replace(/^#/, ''),
        status: r.status, source: r.source, createdAt: r.createdAt, size: r.productSize,
        customerName: r.customerName || null, customerEmail: r.customerEmail || null,
        // The same buyer twice is a double order, not a surprise gift.
        sameBuyer: Boolean(o.customerEmail && r.customerEmail && o.customerEmail.toLowerCase() === r.customerEmail.toLowerCase()),
      }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    return res.status(200).json({ others })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
