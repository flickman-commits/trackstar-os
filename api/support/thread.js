/**
 * /api/support/thread - one conversation.
 *
 *   GET  ?id=                                   the thread, its messages, notes and events, the customer's orders and other threads; marks it read for you
 *   POST { id, action: 'assign', assigneeId }
 *   POST { id, action: 'status', status }       open | waiting | escalated | closed
 *   POST { id, action: 'snooze', until }        ISO time, or null to unsnooze
 *   POST { id, action: 'priority', priority }
 *   POST { id, action: 'tags', tags }
 *   POST { id, action: 'note', body, mentions }  an internal note; mentions are teammate ids
 *   POST { id, action: 'deleteNote', noteId }
 *   POST { id, action: 'unread' }               back to unread for you
 *   POST { id, action: 'redraft', instruction }  a fresh Claude draft, optionally steered
 *   POST { id, action: 'merge', sourceIds }     fold the customer's other conversations into this one
 *   POST { id, action: 'proposal', noteId, proposalId, status }   a suggested action on a draft: done | dismissed
 *   POST { id, action: 'linkOrder', number }    attach an order to this customer by its number, for when they
 *                                               wrote in from a different email than they ordered under
 *   POST { id, action: 'unlinkOrder', number }
 *   POST { id, action: 'mockups', orderIds }    the newest mockups for these order rows (Refresh beside Attach mockup)
 *
 * Every change leaves an event in the thread and a line in the audit log.
 */
import { seesMoney } from '../_lib/money.js'
import { setCors } from '../_lib/auth.js'
import { requireCapability, recordAudit } from '../_lib/users.js'
import { getThread, assign, setStatus, snooze, setPriority, setTags, addNote, deleteNote, markRead, markUnread, noteRow, setProposal, linkOrder, unlinkOrder } from '../../server/domain/support/threads.js'
import { draftThread } from '../../server/domain/support/draft.js'
import { listMockups } from '../../server/domain/support/mockups.js'
import { mergeThreads } from '../../server/domain/support/merge.js'
import { publicMessage, publicStatus, isUserError } from '../../server/domain/support/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '')
      if (!id) return res.status(400).json({ error: 'id is required' })
      const t = await getThread(id, { userId: user.id, money: seesMoney(user) })
      if (!t) return res.status(404).json({ error: 'No such thread' })
      await markRead(id, user.id)
      return res.status(200).json({ ...t, unread: false })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const id = String(body.id || '')
    if (!id) return res.status(400).json({ error: 'id is required' })
    const audit = (summary, detail) => recordAudit({ action: `support.${body.action}`, summary, detail: { threadId: id, ...detail }, actor: user })

    switch (body.action) {
      // Here, not its own function: the build packages every api/ file separately, and 128 ran it out of memory (2026-11-05).
      case 'mockups': {
        const ids = (Array.isArray(body.orderIds) ? body.orderIds : []).map(String).filter(Boolean).slice(0, 20)
        return res.status(200).json({ mockups: ids.length ? await listMockups(ids) : [] })
      }
      case 'assign': {
        const t = await assign(id, body.assigneeId ? String(body.assigneeId) : null, user)
        await audit(`Assigned "${t.subject}" to ${t.assignee ? t.assignee.firstName : 'nobody'}`, { assigneeId: t.assignee?.id || null })
        return res.status(200).json(t)
      }
      case 'status': {
        const t = await setStatus(id, String(body.status || ''), user)
        await audit(`Marked "${t.subject}" ${t.status}`, { status: t.status })
        return res.status(200).json(t)
      }
      case 'snooze': {
        const t = await snooze(id, body.until || null, user)
        await audit(body.until ? `Snoozed "${t.subject}"` : `Unsnoozed "${t.subject}"`, { until: body.until || null })
        return res.status(200).json(t)
      }
      case 'priority': {
        const t = await setPriority(id, Boolean(body.priority), user)
        return res.status(200).json(t)
      }
      case 'tags': {
        const t = await setTags(id, body.tags)
        return res.status(200).json(t)
      }
      case 'note': {
        const n = await addNote(id, { body: body.body, mentions: Array.isArray(body.mentions) ? body.mentions : [] }, user)
        return res.status(200).json(n)
      }
      case 'deleteNote': {
        return res.status(200).json(await deleteNote(String(body.noteId || ''), user))
      }
      case 'merge': {
        const out = await mergeThreads(id, Array.isArray(body.sourceIds) ? body.sourceIds : [], user)
        await audit(`Merged ${out.merged} conversation${out.merged === 1 ? '' : 's'} into one`, { sourceIds: body.sourceIds })
        // Each draft that came over answered one email on its own; write one for the whole conversation.
        if (out.customerWroteLast) await draftThread(id).catch(err => console.warn(`[support/merge] draft ${id}: ${err.message}`))
        return res.status(200).json(await getThread(id, { userId: user.id, money: seesMoney(user) }))
      }
      case 'redraft': {
        const out = await draftThread(id, { instruction: String(body.instruction || ''), actor: user })
        await audit('Asked Claude for a new draft', { instruction: body.instruction || null })
        return res.status(200).json(noteRow(out.note))
      }
      case 'proposal': {
        const n = await setProposal(id, String(body.noteId || ''), String(body.proposalId || ''), String(body.status || ''), user)
        await audit(`${body.status === 'done' ? 'Approved' : 'Dismissed'} a suggested action`, { noteId: body.noteId, proposalId: body.proposalId })
        return res.status(200).json(n)
      }
      case 'linkOrder': {
        const out = await linkOrder(id, body.number, user)
        await audit(`Linked order #${out.number} to a customer`, { number: out.number, orderEmail: out.orderEmail })
        return res.status(200).json(await getThread(id, { userId: user.id, money: seesMoney(user) }))
      }
      case 'unlinkOrder': {
        const out = await unlinkOrder(id, body.number, user)
        await audit(`Unlinked order #${out.number}`, { number: out.number })
        return res.status(200).json(await getThread(id, { userId: user.id, money: seesMoney(user) }))
      }
      case 'unread': {
        await markUnread(id, user.id)
        return res.status(200).json({ ok: true })
      }
      default:
        return res.status(400).json({ error: `Unknown action: ${body.action}` })
    }
  } catch (error) {
    // A UserError is the person's input ("We can't find order #1234"); say it as is.
    if (isUserError(error)) return res.status(publicStatus(error)).json({ error: error.message })
    console.error('[API /support/thread]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'That did not work. Reload the conversation and try again.') })
  }
}
