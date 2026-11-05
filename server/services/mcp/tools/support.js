/**
 * Support: the conversations still open with an order's customer, and a
 * draft reply left on one for a person to read, edit and send from Support,
 * and the triage pass that stars the urgent ones. Nothing here sends. Gated on the support capability, like the Support page.
 */
import { z } from 'zod'
import prisma from '../../../../api/_lib/prisma.js'
import { ToolError } from '../server.js'
import { conversationsForOrder } from '../../../domain/support/compose.js'
import { storeDraft } from '../../../domain/support/draft.js'
import { findOrdersByNumber, displayNumber } from './orders.js'
import { triagePending } from '../../../domain/support/triage.js'

export const supportTools = [
  {
    name: 'order_conversations',
    title: 'Order conversations',
    description: 'Support conversations still open with an order\'s customer: subject, status, a preview, who has it. The thread id is what draft_reply takes.',
    scope: 'read',
    cap: 'support',
    readOnly: true,
    input: { orderNumber: z.string().max(40) },
    async handler({ orderNumber }) {
      const rows = await findOrdersByNumber(orderNumber)
      if (!rows.length) throw new ToolError(`No order matching "${orderNumber}".`)
      const list = await conversationsForOrder(rows[0].id)
      return {
        orderNumber: displayNumber(rows[0]),
        open: list.length,
        conversations: list.map(t => ({ threadId: t.id, subject: t.subject, status: t.status, channel: t.channel, preview: t.snippet.slice(0, 200), lastMessageAt: t.lastMessageAt, snoozed: t.snoozed || undefined, assignee: t.assignee })),
      }
    },
  },
  {
    name: 'draft_reply',
    title: 'Draft a reply',
    description: 'Leave a draft reply on a Support conversation for a person to review and send. Never sends anything.',
    scope: 'write',
    cap: 'support',
    readOnly: false,
    input: {
      threadId: z.string().min(1).max(40).describe('From order_conversations.'),
      body: z.string().trim().min(1).max(10000).describe('The reply as it would go to the customer.'),
      summary: z.string().max(240).optional().describe('One line for the team on what the reply does.'),
    },
    async handler({ threadId, body, summary }, { principal }) {
      const t = await prisma.supportThread.findUnique({ where: { id: threadId }, select: { id: true, subject: true, mergedIntoId: true } })
      if (!t) throw new ToolError(`No Support conversation with id "${threadId}".`)
      if (t.mergedIntoId) throw new ToolError(`That conversation was merged into ${t.mergedIntoId}. Draft there.`)
      const lastIn = await prisma.supportMessage.findFirst({ where: { threadId: t.id, direction: 'in' }, orderBy: { sentAt: 'desc' }, select: { id: true } })
      const note = await storeDraft({
        threadId: t.id,
        body,
        data: { summary: summary || null, forMessageId: lastIn?.id || null, source: `mcp:${principal.name}` },
        actor: principal.user,
        // The draft is the key holder's, not the model's: it is their name a teammate sees.
        authorName: `${principal.user.firstName || ''} ${principal.user.lastName || ''}`.trim() || principal.user.email,
      })
      return { summary: `Drafted a reply on "${t.subject || '(no subject)'}"`, threadId: t.id, draftId: note.id, sent: false, next: 'A person reviews and sends it from Support.' }
    },
  },
  {
    name: 'triage_support',
    title: 'Triage Support',
    description: 'Run the support triage pass now: read the open conversations the customer wrote last (and nothing new since the last pass) and star the urgent ones in Support. dryRun returns the decisions without starring anything. It runs on its own twice a day.',
    scope: 'write',
    cap: 'support',
    readOnly: false,
    input: { dryRun: z.boolean().default(true).describe('true: decide and report, change nothing.') },
    async handler({ dryRun }) {
      const out = await triagePending({ dryRun })
      if (out.status === 'skipped') throw new ToolError(out.reason)
      if (out.status === 'down') throw new ToolError(`Could not reach the model, so nothing was read (${out.failed} tries failed). Try again shortly.`)
      return {
        summary: dryRun ? `Triage dry run: ${out.urgent.length} of ${out.read} urgent` : `Triaged ${out.read} Support conversations, starred ${out.starred}`,
        dryRun, read: out.read, failed: out.failed, left: out.left, starred: dryRun ? 0 : out.starred, costUsd: out.cost,
        urgent: out.urgent.slice(0, 60).map(u => ({ threadId: u.id, who: u.who, subject: u.subject.slice(0, 120), category: u.category, reason: u.reason, alreadyStarred: u.alreadyStarred })),
      }
    },
  },
]
