/**
 * Bulk runs paid through Shopify.
 *
 * A bulk run is billed as a Shopify draft order, sent to the partner as an
 * invoice. Tag the draft "bulk"; the tag carries over to the real order once
 * it is paid, and the order gets an ordinary number (#4412), so the tag, not
 * the number, is what marks it. Two ways in:
 *
 *   - Made here first: the paid order links to the run for the same partner
 *     (company or customer name), when exactly one unpaid run without a
 *     Shopify order matches. Anything less certain makes a new run instead.
 *   - Made in Shopify first: a "bulk" order with no run number becomes a new
 *     bulk run, filled in from the order (partner, quantity, size and frame),
 *     to be completed here.
 *
 * A third way, now the usual one: an invoice built here (billing.js) is
 * tagged with the bulk order's number, which marks that order paid; no
 * guessing by name.
 *
 * Either way the run is marked paid when Shopify says paid. The order import
 * never turns a "bulk" order into a standard order (processOrders).
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { getCanonicalRaceName } from '../../scrapers/index.js'
import { nextNumber, dueDateFor, verifiedRaceDate, FRAME_OPTIONS, SIZE_OPTIONS } from './bulkOrders.js'
import { defaultAssigneeFor } from '../orders/assignment.js'
import { markPaid } from './billing.js'

const PAID = new Set(['PAID', 'PARTIALLY_REFUNDED'])

/** True for a Shopify REST or GraphQL order carrying the "bulk" tag. */
export function isBulkShopifyOrder(order) {
  const tags = Array.isArray(order?.tags) ? order.tags : String(order?.tags || '').split(',')
  return tags.some(t => String(t).trim().toLowerCase() === 'bulk')
}

/** "12x18 / Black Oak" -> size and the Artelo frame value. */
function parseVariant(v) {
  const [size, frame] = String(v || '').split('/').map(x => x.trim())
  const frameType = /unframed/i.test(frame || '') ? 'Unframed'
    : /black/i.test(frame || '') ? 'Black Premium Oak'
    : /natural|oak/i.test(frame || '') ? 'Natural Premium Oak' : null
  return { productSize: SIZE_OPTIONS.includes(size) ? size : null, frameType: FRAME_OPTIONS.includes(frameType) ? frameType : null }
}

/** Pull recent "bulk" orders from Shopify and link or create their runs. */
export async function syncShopifyBulkOrders({ days = 90 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const data = await shopifyGraphQL(`query($q: String!) {
    orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes {
        legacyResourceId name createdAt displayFinancialStatus tags note
        customer { firstName lastName }
        billingAddress { company name }
        lineItems(first: 20) { nodes { title variantTitle quantity } }
      }
    }
  }`, { q: `tag:bulk created_at:>=${since}` })

  const out = { linked: 0, created: 0, paid: 0, seen: 0 }
  for (const o of data.orders.nodes) {
    if (!isBulkShopifyOrder(o)) continue
    out.seen++
    const shopifyOrderId = String(o.legacyResourceId)
    const paid = PAID.has(o.displayFinancialStatus)

    // An invoice built here (billing.js) carries the bulk order's number as a
    // tag: that, not the partner's name, says which order it pays for.
    const numberTag = (Array.isArray(o.tags) ? o.tags : String(o.tags || '').split(',')).map(t => String(t).trim()).find(t => /^BULK-\d+$/i.test(t))
    if (numberTag) {
      if (paid) { const b = await markPaid(numberTag.toUpperCase(), { shopifyOrderId, shopifyOrderName: o.name }); if (b) out.paid++ }
      continue
    }

    let run = await prisma.bulkOrder.findUnique({ where: { shopifyOrderId } })
    const partner = o.billingAddress?.company || [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || o.billingAddress?.name || ''
    if (!run && partner) {
      const norm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      const open = await prisma.bulkOrder.findMany({ where: { shopifyOrderId: null, paidAt: null }, select: { id: true, partnerName: true } })
      const matches = open.filter(b => norm(b.partnerName) && (norm(b.partnerName).includes(norm(partner)) || norm(partner).includes(norm(b.partnerName))))
      if (matches.length === 1) {
        run = await prisma.bulkOrder.update({ where: { id: matches[0].id }, data: { shopifyOrderId, shopifyOrderName: o.name } })
        out.linked++
      }
    }
    if (!run) {
      const lines = o.lineItems.nodes
      const first = lines[0] || {}
      const { productSize, frameType } = parseVariant(first.variantTitle)
      const rawRace = String(first.title || '').replace(/personali[sz]ed|race print|race poster|bulk order|co-?branded|print[s]?/gi, '').trim()
      const raceName = getCanonicalRaceName(rawRace) || rawRace || 'Race to confirm'
      const raceYear = new Date(o.createdAt).getFullYear()
      const raceDate = verifiedRaceDate(raceName, raceYear)
      const last = await prisma.bulkOrder.findFirst({ orderBy: { createdAt: 'desc' }, select: { number: true } })
      run = await prisma.bulkOrder.create({
        data: {
          number: nextNumber(last?.number),
          partnerName: o.billingAddress?.company || [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(' ') || o.billingAddress?.name || 'Shopify customer',
          raceName, raceYear,
          quantity: lines.reduce((n, l) => n + (l.quantity || 0), 0),
          frameType: frameType || 'Natural Premium Oak',
          productSize: productSize || '12x18',
          raceDate, dueDate: dueDateFor(raceDate),
          shopifyOrderId, shopifyOrderName: o.name,
          notes: `Created from Shopify order ${o.name}. Check the race, size and frame.`,
          printKind: 'cobranded',
          assigneeId: await defaultAssigneeFor('bulk'),
        },
      })
      out.created++
    }
    if (paid && !run.paidAt) {
      await prisma.bulkOrder.update({ where: { id: run.id }, data: { paidAt: new Date() } })
      out.paid++
    }
  }
  return out
}
