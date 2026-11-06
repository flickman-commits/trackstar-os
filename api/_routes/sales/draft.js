/**
 * /api/sales/draft
 *
 *   GET                                                  what is wired up: model, Gmail, Attio
 *   POST { action:'variants', dealId, personId?, useTemplate? }   drafts for the next touch
 *   POST { action:'check', dealId, subject, body }         guardrail reasons, no side effects
 *   POST { action:'revise', dealId, subject, body, instruction }   the model rewrites to an instruction
 *   POST { action:'send', dealId, personId, subject, body, assetIds?, adhoc? }   sends through your Gmail. Final.
 *   POST { action:'send-to', to, subject, body, assetIds? }        a one-off to any address, no deal
 *
 * send and send-to carry an idempotencyKey the page makes per send; a repeat
 * of the same key within ten minutes is refused instead of sending twice.
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep } from '../../_lib/users.js'
import { draftVariants, sendDraft, sendFree, checkDraft, reviseDraft } from '../../../server/domain/sales/drafting.js'
import { llmInfo } from '../../../server/lib/llm.js'
import { gmailStatus } from '../../../server/domain/sales/gmail.js'
import { isAttioConfigured, memberForEmail, stageTitles } from '../../../server/domain/sales/attio.js'
import { isAssetStorageConfigured } from '../../../server/domain/sales/assets.js'
import { getSenderFor } from '../../../server/domain/sales/settings.js'
import { claimOnce } from '../../../server/domain/support/idempotency.js'
import { publicMessage, publicStatus } from '../../../server/domain/sales/errors.js'

const REPEATED = 'That email was already sent a moment ago. Check your Gmail Sent folder before sending again.'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') {
      let member = null
      let stages = null
      if (isAttioConfigured()) { try { member = await memberForEmail(actor.email); stages = await stageTitles() } catch { member = null } }
      return res.status(200).json({
        llm: llmInfo(),
        gmail: await gmailStatus(actor.id),
        attio: { configured: isAttioConfigured(), member: member ? { id: member.id, email: member.email, name: `${member.firstName} ${member.lastName}`.trim() } : null, stages },
        library: { configured: isAssetStorageConfigured() },
        me: { id: actor.id, email: actor.email, firstName: actor.firstName || null, role: actor.role },
        // Shown under the body in the composer, where it will sit when sent.
        signature: (await getSenderFor(actor.id, actor)).signature,
      })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (body.action === 'send-to') {
      await claimOnce('sales.send', body.idempotencyKey, { repeated: REPEATED })
      return res.status(200).json(await sendFree({ to: String(body.to || ''), subject: String(body.subject || ''), body: String(body.body || ''), assetIds: Array.isArray(body.assetIds) ? body.assetIds.map(String) : [], actor }))
    }
    const dealId = String(body.dealId || '')
    if (!dealId) return res.status(400).json({ error: 'dealId is required' })

    if (body.action === 'variants') {
      return res.status(200).json(await draftVariants({
        dealId,
        personId: body.personId ? String(body.personId) : undefined,
        useTemplate: Boolean(body.useTemplate),
        actor,
      }))
    }
    if (body.action === 'check') {
      return res.status(200).json(await checkDraft({ dealId, subject: String(body.subject || ''), body: String(body.body || '') }))
    }
    if (body.action === 'revise') {
      const instruction = String(body.instruction || '').trim()
      if (!instruction) return res.status(400).json({ error: 'Say what to change' })
      return res.status(200).json(await reviseDraft({ dealId, subject: String(body.subject || ''), body: String(body.body || ''), instruction, actor }))
    }
    if (body.action === 'send') {
      await claimOnce('sales.send', body.idempotencyKey, { repeated: REPEATED })
      return res.status(200).json(await sendDraft({
        dealId,
        personId: body.personId ? String(body.personId) : undefined,
        subject: String(body.subject || ''),
        body: String(body.body || ''),
        assetIds: Array.isArray(body.assetIds) ? body.assetIds.map(String) : [],
        actor,
        adhoc: Boolean(body.adhoc),
      }))
    }
    return res.status(400).json({ error: `Unknown action: ${body.action}` })
  } catch (error) {
    if (error.problems) return res.status(400).json({ error: error.message, problems: error.problems })
    console.error('[API /sales/draft]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'That did not go through. Check your Gmail Sent folder before trying again.') })
  }
}
