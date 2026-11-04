/**
 * Send later.
 *
 * A rep finishes an email and picks a time ("Monday 9:15 AM"). The email is
 * checked now against the same rules as Send, kept in SalesScheduled, and
 * sent by the every-5-minutes cron through that rep's own Gmail, with the
 * same Attio write-back as pressing Send. Times are kept on 5-minute marks
 * so the time shown is the time it goes.
 *
 * The world can move between Friday night and Monday morning, so at send
 * time the email is held instead of sent when:
 *   - the deal left the sequence (a stage past Reached Out),
 *   - Attio's touch count moved (someone emailed them from Gmail), or
 *   - there has been email with them since it was scheduled (often a reply).
 * A held email stays in the queue with the reason; the rep reads it and
 * sends or cancels. Nothing is ever sent twice: a row is claimed before the
 * send, and one that dies mid-send is held, not retried.
 */
import prisma from '../../db.js'
import { dealForWork, nextStepFor, pipelineOf } from './queue.js'
import { sendDraft, sendFree, requiresImage, libraryIds } from './drafting.js'
import { draftProblems } from './guardrails.js'
import { listAssets, isAssetStorageConfigured } from './assets.js'
import { gmailStatus } from './gmail.js'
import { can } from '../../../api/_lib/roles.js'
import { UserError, publicMessage } from './errors.js'

const MAX_AHEAD_MS = 60 * 86400000
// Two cron runs past its time with the row still "sending" means a run died.
const STUCK_MS = 12 * 60_000
const OPEN = ['scheduled', 'sending', 'held']

function view(row) {
  return {
    id: row.id, dealId: row.attioDealId, personId: row.attioPersonId, toEmail: row.toEmail,
    adhoc: row.adhoc, touchNumber: row.touchNumber, subject: row.subject, body: row.body,
    assetIds: row.assetIds, sendAt: row.sendAt, status: row.status, error: row.error,
    createdByEmail: row.createdByEmail, createdAt: row.createdAt,
  }
}

/**
 * Check and keep one email for later. The same checks Send makes up front, so
 * a problem shows now, not on Monday morning.
 */
export async function scheduleSend({ dealId, personId, to, subject, body, assetIds = [], adhoc = false, sendAt, actor }) {
  if (!actor?.id) throw new UserError('Scheduling needs a signed-in person')
  if (!subject?.trim() || !body?.trim()) throw new UserError('Subject and body are required')
  const when = new Date(sendAt)
  if (Number.isNaN(when.getTime())) throw new UserError('Pick a time to send it')
  // Up to the next 5-minute mark: the cron runs at :00, :05, :10...
  when.setUTCSeconds(0, 0)
  if (when.getUTCMinutes() % 5) when.setUTCMinutes(when.getUTCMinutes() + (5 - (when.getUTCMinutes() % 5)))
  if (when.getTime() < Date.now() + 60_000) throw new UserError('Pick a time at least a minute from now')
  if (when.getTime() > Date.now() + MAX_AHEAD_MS) throw new UserError('Pick a time within the next 60 days')
  if (!(await gmailStatus(actor.id)).connected) throw new UserError('Gmail is not connected. Open Settings and press Connect Gmail.')

  const ids = libraryIds(assetIds)
  const free = !dealId || String(dealId).startsWith('adhoc:')
  let row

  if (free) {
    const address = String(to || '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new UserError('That is not an email address')
    row = { attioDealId: null, attioPersonId: null, toEmail: address, adhoc: true, touchNumber: null }
  } else {
    const deal = await dealForWork(String(dealId), { fresh: true })
    const person = (personId && deal.people.find(p => p.id === personId)) || deal.person
    if (!person?.email) throw new UserError('This deal has nobody with an email address in Attio')
    if (!adhoc && !['Not Contacted', 'Needs Enrichment', 'Reached Out'].includes(deal.stage)) {
      throw new UserError(`${deal.name} is at ${deal.stage}. The sequence only runs up to Reached Out; use New email to write to them.`)
    }
    const { touchNumber: next, exhausted } = nextStepFor(deal)
    if (exhausted && !adhoc) throw new UserError(`${deal.name} has finished its sequence. Change its stage in Attio instead.`)
    const touchNumber = exhausted ? deal.touchCount + 1 : next
    const pipeline = pipelineOf(deal)
    const problems = draftProblems({ subject, body }, { pipeline, touchNumber, companyName: deal.name })
    if (problems.length) throw new UserError(problems[0], { problems })
    if (requiresImage(pipeline, touchNumber)) {
      const images = isAssetStorageConfigured() ? (await listAssets()).filter(a => a.kind === 'image').map(a => a.id) : []
      if (!ids.some(id => images.includes(id))) throw new UserError('A charity first touch has to carry a co-branded example. Drag one in from the library first.')
    }
    const already = await prisma.salesScheduled.findFirst({ where: { attioDealId: deal.id, status: { in: ['scheduled', 'sending'] } } })
    if (already) throw new UserError(`${deal.name} already has an email scheduled. Cancel that one first.`)
    row = { attioDealId: deal.id, attioPersonId: person.id, toEmail: person.email, adhoc: Boolean(adhoc), touchNumber }
  }

  const saved = await prisma.salesScheduled.create({
    data: { ...row, subject: subject.trim(), body: body.trim(), assetIds: ids, sendAt: when, createdById: actor.id, createdByEmail: actor.email || null },
  })
  return view(saved)
}

/** Open scheduled and held emails: yours, or everyone's. */
export async function listScheduled(actor, { all = false } = {}) {
  const rows = await prisma.salesScheduled.findMany({
    where: { status: { in: OPEN }, ...(all ? {} : { createdById: actor.id }) },
    orderBy: { sendAt: 'asc' },
  })
  return rows.map(view)
}

/** Deal ids with an email waiting to go, so the queue does not offer them twice. */
export async function scheduledDealIds() {
  const rows = await prisma.salesScheduled.findMany({ where: { status: { in: OPEN }, attioDealId: { not: null } }, select: { attioDealId: true } })
  return new Set(rows.map(r => r.attioDealId))
}

/**
 * Take one back, before it goes. Returns it so the composer can reopen the
 * email for editing. Your own, or anyone's for an admin.
 */
export async function cancelScheduled(id, actor) {
  const row = await prisma.salesScheduled.findUnique({ where: { id: String(id) } })
  if (!row || !OPEN.includes(row.status)) throw new UserError('That email is not waiting any more')
  if (row.createdById !== actor.id && actor.role !== 'admin') throw new UserError('That is someone else\'s scheduled email')
  const done = await prisma.salesScheduled.updateMany({ where: { id: row.id, status: { in: ['scheduled', 'held'] } }, data: { status: 'cancelled' } })
  if (!done.count) throw new UserError('It is sending right now')
  return view(row)
}

/** Why a deal's email should wait for a person, or null when it is fine to go. */
async function holdReason(row) {
  const deal = await dealForWork(row.attioDealId, { fresh: true })
  if (!row.adhoc && !['Not Contacted', 'Needs Enrichment', 'Reached Out'].includes(deal.stage)) {
    return `${deal.name} moved to ${deal.stage}.`
  }
  const { touchNumber: next, exhausted } = nextStepFor(deal)
  const now = exhausted ? deal.touchCount + 1 : next
  if (!row.adhoc && row.touchNumber && now !== row.touchNumber) {
    return `Attio's touch count moved since this was scheduled (this was touch ${row.touchNumber}, the next is now ${now}).`
  }
  if (deal.lastSentAt && new Date(deal.lastSentAt) > row.createdAt) {
    return `There has been email with them since you scheduled this (${new Date(deal.lastSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}). Check for a reply before sending.`
  }
  return null
}

/**
 * The cron's job: send everything that is due. Each row is claimed first
 * (scheduled -> sending) so two overlapping runs can never both send it.
 */
export async function sendDue({ limit = 20 } = {}) {
  const now = new Date()
  // A row left at "sending" means a run died mid-send. Whether Gmail got it
  // is unknown, so a person looks rather than the tool guessing.
  await prisma.salesScheduled.updateMany({
    where: { status: 'sending', sendAt: { lt: new Date(now.getTime() - STUCK_MS) } },
    data: { status: 'held', error: 'The send was interrupted. Check your Gmail Sent folder before sending again.' },
  })

  const due = await prisma.salesScheduled.findMany({ where: { status: 'scheduled', sendAt: { lte: now } }, orderBy: { sendAt: 'asc' }, take: limit })
  const out = { due: due.length, sent: 0, held: 0 }
  for (const row of due) {
    const claimed = await prisma.salesScheduled.updateMany({ where: { id: row.id, status: 'scheduled' }, data: { status: 'sending' } })
    if (!claimed.count) continue
    try {
      const user = await prisma.user.findUnique({ where: { id: row.createdById }, select: { id: true, email: true, firstName: true, lastName: true, role: true, extraRoles: true, isActive: true } })
      if (!user?.isActive) throw new UserError('The person who scheduled this is no longer active')
      // Their role may have changed since they scheduled it; Sales has to still be theirs.
      if (!(await can(user, 'sales'))) throw new UserError('Sales is no longer part of the role of the person who scheduled this')
      const actor = { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }

      if (row.attioDealId) {
        const reason = await holdReason(row)
        if (reason) {
          await prisma.salesScheduled.update({ where: { id: row.id }, data: { status: 'held', error: reason } })
          out.held++
          continue
        }
      }
      const r = row.attioDealId
        ? await sendDraft({ dealId: row.attioDealId, personId: row.attioPersonId, subject: row.subject, body: row.body, assetIds: row.assetIds, actor, adhoc: row.adhoc })
        : await sendFree({ to: row.toEmail, subject: row.subject, body: row.body, assetIds: row.assetIds, actor })
      await prisma.salesScheduled.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), salesSendId: r.send?.id || null, error: r.sync && !r.sync.ok ? `Sent, but Attio was not updated: ${r.sync.error || r.sync.skipped}` : null } })
      out.sent++
    } catch (err) {
      console.error(`[sales.scheduled] ${row.id}: ${err.message}`)
      await prisma.salesScheduled.update({ where: { id: row.id }, data: { status: 'held', error: `Not sent: ${publicMessage(err, 'something went wrong. Check your Gmail Sent folder before sending again.')}` } })
      out.held++
    }
  }
  return out
}

/**
 * Send a held email now, as it is, after the rep has looked. The hold checks
 * are skipped (the person decided); Send's own checks still run.
 */
export async function sendHeldNow(id, actor) {
  const row = await prisma.salesScheduled.findUnique({ where: { id: String(id) } })
  if (!row || row.status !== 'held') throw new UserError('That email is not being held')
  if (row.createdById !== actor.id) throw new UserError('Only the person who scheduled it can send it')
  const claimed = await prisma.salesScheduled.updateMany({ where: { id: row.id, status: 'held' }, data: { status: 'sending' } })
  if (!claimed.count) throw new UserError('It is already sending')
  try {
    const r = row.attioDealId
      ? await sendDraft({ dealId: row.attioDealId, personId: row.attioPersonId, subject: row.subject, body: row.body, assetIds: row.assetIds, actor, adhoc: row.adhoc })
      : await sendFree({ to: row.toEmail, subject: row.subject, body: row.body, assetIds: row.assetIds, actor })
    await prisma.salesScheduled.update({ where: { id: row.id }, data: { status: 'sent', sentAt: new Date(), salesSendId: r.send?.id || null, error: null } })
    return r
  } catch (err) {
    await prisma.salesScheduled.update({ where: { id: row.id }, data: { status: 'held', error: `Not sent: ${publicMessage(err, 'something went wrong. Check your Gmail Sent folder before sending again.')}` } })
    throw err
  }
}
