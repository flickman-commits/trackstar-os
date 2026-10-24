/**
 * /api/support/settings - how the inbox is run.
 *
 *   GET                                               { defaultAssigneeId, playbook }
 *   POST { defaultAssigneeId, applyToOpen? }          admin: who new conversations go to; applyToOpen hands over the open unassigned ones now
 *   POST { action:'playbook', text } / { action:'playbookReset' }   admin: what Claude drafts from
 *   POST { action:'routing', routing, applyToOpen? }   admin: who new conversations go to, per channel (routing.js)
 *   POST { action:'forwarders', emails }            admin: other inboxes whose forwards to fast@ become the customer's conversation
 *   POST { action:'draftModel', model }             admin: which Claude model drafts replies (draftModel.js)
 */
import { setCors } from '../_lib/auth.js'
import { requireCapability, requireAdminOnly, recordAudit } from '../_lib/users.js'
import { defaultAssigneeId, setDefaultAssignee, getRouting, saveRouting } from '../../server/domain/support/routing.js'
import { getPlaybook, savePlaybook, resetPlaybook } from '../../server/domain/support/playbook.js'
import { listForwarders, saveForwarders } from '../../server/domain/support/forwarders.js'
import { publicMessage, publicStatus } from '../../server/domain/support/errors.js'
import { DRAFT_MODELS, getDraftModel, setDraftModel } from '../../server/domain/support/draftModel.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  try {
    if (req.method === 'GET') {
      const user = await requireCapability(req, res, 'support')
      if (!user) return
      return res.status(200).json({ defaultAssigneeId: await defaultAssigneeId(), routing: await getRouting(), playbook: await getPlaybook(), forwarders: await listForwarders(), draftModel: await getDraftModel(), draftModels: DRAFT_MODELS, draftModelPinned: Boolean(process.env.SUPPORT_LLM_MODEL) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const user = await requireAdminOnly(req, res)
    if (!user) return
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (body.action === 'routing') {
      const out = await saveRouting(body.routing, { applyToOpen: Boolean(body.applyToOpen), actor: user })
      const say = r => r.mode === 'none' ? 'nobody' : r.mode === 'person' ? '1 person' : `split across ${r.people.length}`
      await recordAudit({ action: 'support.routing', summary: `Routing: email to ${say(out.routing.email)}, Instagram to ${say(out.routing.instagram)}${out.assigned ? ` (${out.assigned} open handed out)` : ''}`, detail: out, actor: user })
      return res.status(200).json(out)
    }
    if (body.action === 'forwarders') {
      const forwarders = await saveForwarders(body.emails)
      await recordAudit({ action: 'support.forwarders', summary: `Forwarding addresses: ${forwarders.join(', ') || 'none'}`, detail: { forwarders }, actor: user })
      return res.status(200).json({ forwarders })
    }
    if (body.action === 'draftModel') {
      const model = await setDraftModel(String(body.model || ''))
      await recordAudit({ action: 'support.draft_model', summary: `Support drafts now use ${DRAFT_MODELS.find(m => m.id === model)?.label || model}`, detail: { model }, actor: user })
      return res.status(200).json({ draftModel: model })
    }
    if (body.action === 'playbook' || body.action === 'playbookReset') {
      const pb = body.action === 'playbook' ? await savePlaybook(body.text) : await resetPlaybook()
      await recordAudit({ action: 'support.playbook', summary: body.action === 'playbook' ? 'Edited the support playbook' : 'Reset the support playbook to the default', detail: { chars: pb.text.length }, actor: user })
      return res.status(200).json({ playbook: pb })
    }
    const out = await setDefaultAssignee(body.defaultAssigneeId ? String(body.defaultAssigneeId) : null, { applyToOpen: Boolean(body.applyToOpen), actor: user })
    await recordAudit({ action: 'support.routing', summary: out.defaultAssigneeId ? `New support conversations go to ${out.defaultAssigneeId}${out.assigned ? ` (${out.assigned} open ones handed over)` : ''}` : 'New support conversations go to nobody', detail: out, actor: user })
    return res.status(200).json(out)
  } catch (error) {
    console.error('[API /support/settings]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Could not save the Support settings') })
  }
}
