/**
 * Design jobs: custom orders and partner orders. Where each one is, the
 * approval links, and (write) moving one along or leaving a comment.
 */
import { z } from 'zod'
import prisma from '../../../../api/_lib/prisma.js'
import { ToolError } from '../server.js'
import { approvalUrl } from '../../../lib/links.js'
import { setDesignStatus, DESIGN_STATUSES } from '../../../domain/orders/designStatus.js'
import { CompleteError } from '../../../domain/orders/complete.js'
import { designDueDate } from '../../../domain/orders/designDue.js'
import { findOrdersByNumber, displayNumber, openWhere, shopifyNames, daysLate, mayHoldLinks, linkField } from './orders.js'

const LABEL = {
  not_started: 'Not started', in_progress: 'In progress', awaiting_review: 'Awaiting review', in_revision: 'In revision',
  approved_by_customer: 'Approved', final_pdf_uploaded: 'Final PDF uploaded, attach in Artelo', sent_to_production: 'Sent to production',
}

const SELECT = {
  id: true, parentOrderNumber: true, lineItemIndex: true, trackstarOrderType: true, designStatus: true, status: true,
  runnerName: true, runnerNameOverride: true, raceName: true, raceYear: true, customerName: true, dueDate: true, createdAt: true,
  proofSentAt: true, isRushOrder: true,
  assignee: { select: { firstName: true } },
  approvalToken: { select: { token: true } },
  proofs: { select: { status: true } },
}

function job(o, name, type, links) {
  const proofs = o.proofs || []
  return {
    orderNumber: name ? String(name).replace(/^#/, '') : String(o.parentOrderNumber),
    ...(type === 'race_partner'
      ? { partner: o.raceName, contact: o.customerName || null, year: o.raceYear }
      : { runner: o.runnerNameOverride || o.runnerName, race: `${o.raceName} ${o.raceYear}`, customer: o.customerName || null }),
    designStatus: o.designStatus,
    assignee: o.assignee?.firstName || null,
    orderedAt: o.createdAt,
    dueDate: o.dueDate || null, // the customer's date
    designDueDate: designDueDate(o.dueDate), // what designers work to, two days earlier (designDue.js)
    daysLate: o.dueDate ? daysLate(o.dueDate) : undefined,
    rush: o.isRushOrder || undefined,
    proofs: { total: proofs.length, awaiting: proofs.filter(p => p.status === 'pending').length, approved: proofs.filter(p => p.status === 'approved').length, lastSentAt: o.proofSentAt || null },
    ...linkField('approvalLink', approvalUrl(o.approvalToken?.token), links),
  }
}

async function statusTool(type, principal) {
  const links = await mayHoldLinks(principal)
  const rows = await prisma.order.findMany({ where: openWhere(type), orderBy: type === 'custom' ? [{ dueDate: 'asc' }, { createdAt: 'desc' }] : { createdAt: 'desc' }, take: 200, select: SELECT })
  const names = await shopifyNames(rows.map(r => r.id))
  const grouped = {}
  for (const s of DESIGN_STATUSES) grouped[LABEL[s]] = []
  for (const o of rows) grouped[LABEL[o.designStatus] || o.designStatus].push(job(o, names.get(o.id)?.name, type, links))
  for (const k of Object.keys(grouped)) if (!grouped[k].length) delete grouped[k]
  return { open: rows.length, pastDue: rows.filter(o => o.dueDate && daysLate(o.dueDate) > 0).length || undefined, byStatus: grouped }
}

export const designTools = [
  {
    name: 'custom_orders_status',
    title: 'Custom orders status',
    description: 'Every open custom order grouped by design status, with who has it, the due date, how many proofs are out, and the customer approval link (admins and people who approve designs; others see hasApprovalLink).',
    scope: 'read',
    readOnly: true,
    input: {},
    handler: (_args, { principal }) => statusTool('custom', principal),
  },
  {
    name: 'partner_orders_status',
    title: 'Partner orders status',
    description: 'Every open race-partner design order grouped by design status, with who has it, how many options are out, and the partner\'s approval link (admins and people who approve designs; others see hasApprovalLink).',
    scope: 'read',
    readOnly: true,
    input: {},
    handler: (_args, { principal }) => statusTool('race_partner', principal),
  },
  {
    name: 'approval_link',
    title: 'Approval link',
    description: 'The customer or partner approval portal link for a custom or partner order, by order number. The link itself only for admins and people who approve designs; anyone else learns whether there is one.',
    scope: 'read',
    readOnly: true,
    input: { orderNumber: z.string().max(40) },
    async handler({ orderNumber }, { principal }) {
      const rows = (await findOrdersByNumber(orderNumber)).filter(o => ['custom', 'race_partner'].includes(o.trackstarOrderType))
      if (!rows.length) throw new ToolError(`No custom or partner order matching "${orderNumber}".`)
      const o = rows[0]
      const link = approvalUrl(o.approvalToken?.token)
      const links = await mayHoldLinks(principal)
      return {
        orderNumber: displayNumber(o),
        designStatus: o.designStatus,
        ...linkField('approvalLink', link, links),
        note: !link ? 'No portal yet: it is created when design starts or the first proof is sent.' : (links ? undefined : 'The link is a credential, so this key does not get it. Ask an admin or whoever approves designs.'),
      }
    },
  },
  {
    name: 'set_design_status',
    title: 'Set design status',
    description: 'Move a custom or partner order to a design status. sent_to_production also completes it; in_revision after an approval un-approves the proof.',
    scope: 'write',
    readOnly: false,
    input: { orderNumber: z.string().max(40), status: z.enum(DESIGN_STATUSES) },
    async handler({ orderNumber, status }, { principal }) {
      const rows = (await findOrdersByNumber(orderNumber)).filter(o => ['custom', 'race_partner'].includes(o.trackstarOrderType))
      if (!rows.length) throw new ToolError(`No custom or partner order matching "${orderNumber}".`)
      for (const o of rows) {
        try {
          await setDesignStatus(o, status, principal?.user?.id || null, principal?.user || null)
        } catch (e) {
          if (e instanceof CompleteError) throw new ToolError(e.message)
          throw e
        }
      }
      const n = displayNumber(rows[0])
      return { summary: `${n} design status set to ${LABEL[status]}`, orderNumber: n, designStatus: status, items: rows.length }
    },
  },
  {
    name: 'add_comment',
    title: 'Add comment',
    description: 'Leave a team comment on an order, as the person this key acts as.',
    scope: 'write',
    readOnly: false,
    input: { orderNumber: z.string().max(40), text: z.string().min(1).max(2000), item: z.number().int().min(1).optional().describe('Which item on a multi-item order; the first by default.') },
    async handler({ orderNumber, text, item }, { principal }) {
      const rows = await findOrdersByNumber(orderNumber)
      if (!rows.length) throw new ToolError(`No order matching "${orderNumber}".`)
      const o = item ? rows.find(r => r.lineItemIndex === item - 1) : rows[0]
      if (!o) throw new ToolError(`${displayNumber(rows[0])} has no item ${item}.`)
      const u = principal.user
      await prisma.orderComment.create({
        data: { orderId: o.id, text: text.trim(), authorId: u.id, authorName: `${u.firstName} ${u.lastName || ''}`.trim() || u.email },
      })
      const n = displayNumber(o)
      return { summary: `Commented on ${n}`, orderNumber: n, item: o.lineItemIndex + 1 }
    },
  },
]
