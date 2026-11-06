/**
 * Merge conversations: when a customer writes again instead of replying,
 * each new email is its own Gmail thread and so its own conversation here.
 * Merging folds the others into the one a rep is working in, the way
 * Intercom does: their messages, notes and drafts move over and sort into
 * one timeline by time; tags join; priority sticks; the assignee is kept
 * (or taken from the other when the target has none).
 *
 * The merged rows stay, closed and pointing at the target (`mergedIntoId`),
 * so a reply the customer sends on their old email chain still lands in
 * the merged conversation (mailbox.js follows the pointer). They appear in
 * no view and no list. Email only, same customer only; there is no unmerge.
 * The drafts that come over each answered one email alone, so the merge
 * (api/_routes/support/thread.js) has Claude draft again for the whole conversation.
 */
import prisma from '../../db.js'
import { refreshThread, mailboxEmail } from './mailbox.js'
import { UserError } from './errors.js'

function actorName(actor) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || 'Someone'
}

export async function mergeThreads(targetId, sourceIds, actor) {
  const ids = [...new Set((sourceIds || []).map(String))].filter(id => id && id !== targetId)
  if (!ids.length) throw new UserError('Nothing to merge')
  const target = await prisma.supportThread.findUnique({ where: { id: targetId } })
  if (!target) throw new UserError('No such conversation')
  if (target.mergedIntoId) throw new UserError('This conversation was merged into another; open that one')
  const sources = await prisma.supportThread.findMany({ where: { id: { in: ids } }, include: { _count: { select: { messages: true } } } })
  if (sources.length !== ids.length) throw new UserError('One of those conversations is gone')
  for (const s of sources) {
    if (s.mergedIntoId) throw new UserError(`"${s.subject}" was already merged`)
    if (s.channel !== 'email' || target.channel !== 'email') throw new UserError('Only email conversations can be merged')
    if ((s.customerEmail || '').toLowerCase() !== (target.customerEmail || '').toLowerCase()) throw new UserError('Only conversations with the same customer can be merged')
  }

  const by = actorName(actor)
  const tags = [...new Set([...(target.tags || []), ...sources.flatMap(s => s.tags || [])])].slice(0, 12)
  const priority = target.priority || sources.some(s => s.priority)
  const assigneeId = target.assigneeId || sources.find(s => s.assigneeId)?.assigneeId || null

  await prisma.$transaction([
    prisma.supportMessage.updateMany({ where: { threadId: { in: ids } }, data: { threadId: target.id } }),
    prisma.supportNote.updateMany({ where: { threadId: { in: ids } }, data: { threadId: target.id } }),
    prisma.supportRead.deleteMany({ where: { threadId: { in: ids } } }),
    prisma.supportThread.updateMany({ where: { id: { in: ids } }, data: { mergedIntoId: target.id, status: 'closed', assigneeId: null, snoozedUntil: null } }),
    prisma.supportThread.update({ where: { id: target.id }, data: { tags, priority, assigneeId } }),
    prisma.supportNote.createMany({ data: sources.map(s => ({ threadId: target.id, kind: 'event', body: `${by} merged in "${s.subject || '(no subject)'}" (${s._count.messages} message${s._count.messages === 1 ? '' : 's'})`, authorId: actor?.id || null, authorName: by })) }),
  ])

  // Counts, snippet, last-from-them and status follow the combined timeline.
  const newest = await prisma.supportMessage.findFirst({ where: { threadId: target.id }, orderBy: { sentAt: 'desc' } })
  if (newest) await refreshThread({ ...target, lastMessageAt: new Date(0) }, newest, { mailbox: mailboxEmail() })
  return { merged: sources.length, messages: sources.reduce((a, s) => a + s._count.messages, 0), customerWroteLast: newest?.direction === 'in' }
}
