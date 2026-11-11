/**
 * POST /api/support/reply { id, text, close?, attachments?: ['render:<id>' | 'proof:<id>' | 'upload:<path>'] }
 *
 * Send a reply on a thread, from the support mailbox, as this person. The
 * only place support mail leaves the app, and only ever reached by a person
 * pressing Send on text they wrote or read. Plain text in; the same HTML
 * shape the Sales emails use goes out, so a reply reads as typed, not sent
 * by a system. The thread moves to waiting on the customer. An Instagram
 * thread goes out as a DM from @trackstar_art instead, inside Meta's
 * 24-hour window (server/domain/support/instagram.js says no otherwise).
 */
import { seesMoney } from '../../_lib/money.js'
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import prisma from '../../_lib/prisma.js'
import { replyToHtml, replyToPlain } from '../../../server/domain/support/format.js'
import { sendReply } from '../../../server/domain/support/mailbox.js'
import { sendReply as sendInstagramReply } from '../../../server/domain/support/instagram.js'
import { getThread, setStatus } from '../../../server/domain/support/threads.js'
import { resolveMockup } from '../../../server/domain/support/mockups.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'
import { claimOnce, releaseClaim } from '../../../server/domain/support/idempotency.js'
import { assertOrderInThread } from '../../../server/domain/support/threads.js'
import crypto from 'crypto'

/** The order a mockup reference belongs to: a render of ours, or a proof. Uploads have none. */
async function orderOfRef(ref) {
  const [kind, id] = String(ref).split(':')
  if (kind === 'render') return (await prisma.renderJob.findUnique({ where: { id: String(id) }, select: { orderId: true } }))?.orderId || 'missing'
  if (kind === 'proof') return (await prisma.proof.findUnique({ where: { id: String(id) }, select: { orderId: true } }))?.orderId || 'missing'
  return null
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  let claim = null
  let sentOk = false
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const id = String(body.id || '')
    const text = String(body.text || '').replace(/\r\n/g, '\n').trim()
    if (!id) return res.status(400).json({ error: 'id is required' })
    if (!text) return res.status(400).json({ error: 'Write something first' })
    if (/—/.test(text)) return res.status(400).json({ error: 'No em dashes in anything a customer sees. Use a comma, a period or parentheses.', code: 'em_dash' })

    const thread = await prisma.supportThread.findUnique({ where: { id } })
    if (!thread) return res.status(404).json({ error: 'No such thread' })

    const instagram = thread.channel === 'instagram'
    // Mockups the rep attached, by reference; resolved here, never sent as bytes from the page.
    const refs = (Array.isArray(body.attachments) ? body.attachments : []).map(String).slice(0, 6)
    // Each design attached has to be from an order this conversation is about,
    // the same rule the money actions follow, so one customer's print cannot
    // go to another.
    for (const ref of refs) {
      const orderId = await orderOfRef(ref)
      if (orderId === 'missing') return res.status(400).json({ error: 'One of the attached designs no longer exists. Remove it and attach it again.' })
      if (orderId) await assertOrderInThread(thread, { orderId })
    }
    // The same reply to the same conversation once: a double click, or a retry
    // after a slow answer, is refused instead of emailing the customer twice.
    // Keyed on the content, so the page needs no change. Given back if the send fails.
    claim = crypto.createHash('sha256').update(`${id}|${text}|${refs.join(',')}`).digest('hex').slice(0, 40)
    await claimOnce('support.reply', claim, { repeated: 'That reply was sent a moment ago. Check the conversation before sending it again.' })
    const files = []
    const mockups = refs.filter(r => !r.startsWith('upload:'))
    for (const ref of refs) {
      const n = mockups.indexOf(ref)
      files.push(await resolveMockup(ref, { filenameStem: mockups.length > 1 ? `Your Trackstar print ${n + 1}` : 'Your Trackstar print' }))
    }
    // A DM carries pictures only; Meta has no way to send a PDF from here.
    if (instagram && files.some(f => !String(f.contentType).startsWith('image/'))) return res.status(400).json({ error: 'Instagram can only send pictures. Remove the PDF.' })
    // **bold**, _italic_ and links: real formatting in email, plain text in a DM (format.js).
    const sent = instagram
      ? await sendInstagramReply({ userId: user.id, thread, text: replyToPlain(text), images: files.map(f => ({ url: f.url })) })
      : await sendReply({ userId: user.id, thread, html: replyToHtml(text), text: replyToPlain(text), attachments: files.map(f => ({ bytes: f.bytes, contentType: f.contentType, filename: f.filename })) })
    sentOk = true
    const who = instagram ? `@${thread.igUsername || thread.igUserId}` : thread.customerEmail
    await recordAudit({
      action: 'support.reply',
      summary: `Replied to ${who} on "${thread.subject}"`,
      detail: { threadId: id, channel: thread.channel, gmailMessageId: sent?.gmailMessageId || null, igMessageId: sent?.igMessageId || null, chars: text.length, attachments: refs },
      actor: user,
    })
    // Send and close: Intercom's one-click for a conversation that is done.
    if (body.close) await setStatus(id, 'closed', user)
    // Plain Send: the ball is in the customer's court now. The mailbox sync
    // would do this when the sent message comes back, minutes later; the
    // order page reads it right away.
    else if (thread.status === 'open') await setStatus(id, 'waiting', user)
    const fresh = await getThread(id, { userId: user.id, money: seesMoney(user) })
    return res.status(200).json(fresh)
  } catch (error) {
    // Not sent: a retry must be allowed. Sent and something after failed: keep the claim.
    if (claim && !sentOk && error?.status !== 409) await releaseClaim('support.reply', claim)
    console.error('[API /support/reply]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'The reply did not go out. Check the conversation before sending again.') })
  }
}
