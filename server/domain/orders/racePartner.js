/**
 * A race_partner Order row: the parent for the proof and approval of a design
 * we make for a race organization (the Partners tab). Not a customer order; it
 * reuses the Order table so Proof + ApprovalToken work unchanged:
 *   raceName      -> the partner or race name
 *   customerName  -> the partner's contact
 *   customerEmail -> the partner's contact email
 * A bulk order for a race with no design yet links to one (BulkOrder.partnerOrderId),
 * and waits on its approval before prints go.
 */
import prisma from '../../db.js'
import { defaultAssigneeFor } from './assignment.js'

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'partner'

export async function createRacePartnerOrder({ partnerName, raceYear, contactName, contactEmail }) {
  const name = String(partnerName || '').trim()
  if (!name) throw new Error('partnerName is required')
  const year = parseInt(raceYear, 10) || new Date().getFullYear()
  const base = `RP-${slug(name)}-${year}`
  // Unique against the (parentOrderNumber, lineItemIndex) constraint.
  let orderNumber = base
  for (let n = 1; await prisma.order.findFirst({ where: { parentOrderNumber: orderNumber }, select: { id: true } }); n++) orderNumber = `${base}-${n}`
  return prisma.order.create({
    data: {
      orderNumber, parentOrderNumber: orderNumber, lineItemIndex: 0,
      source: 'race_partner', arteloOrderData: {},
      raceName: name, raceYear: year, runnerName: '-', productSize: '-', frameType: '-',
      trackstarOrderType: 'race_partner', designStatus: 'not_started', status: 'pending',
      customerEmail: contactEmail ? String(contactEmail).trim() : null,
      customerName: contactName ? String(contactName).trim() : null,
      assigneeId: await defaultAssigneeFor('race_partner'),
    },
  })
}

/** Open partner design orders, to link a new bulk order to one already started. */
export async function openRacePartnerOrders() {
  return prisma.order.findMany({
    where: { trackstarOrderType: 'race_partner', designStatus: { notIn: ['sent_to_production'] }, status: { not: 'completed' } },
    orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, orderNumber: true, raceName: true, raceYear: true, designStatus: true },
  })
}
