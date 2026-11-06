/**
 * /api/sales/settings
 *
 *   GET                       { settings, defaults, sender }   workspace settings (admin), and your own sender block
 *   GET ?action=check          can we reach Attio, and does the deals object have what the tool expects
 *   POST { ...patch }          admin: override workspace settings (cap, timezone, undo, social proof)
 *   POST { action:'sender', name?, role?, story?, signature? }   anyone: your own name and signature
 *   POST { action:'template', pipeline, angle, subject?, body? }   any sales rep: edit one touch's copy; empty resets it
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep, recordAudit } from '../../_lib/users.js'
import { getSettings, setSettings, DEFAULTS, getSenderFor, setSenderFor } from '../../../server/domain/sales/settings.js'
import { checkAttio } from '../../../server/domain/sales/attio.js'
import { getTemplates, setTemplate, templateSteps, DEFAULT_TEMPLATES } from '../../../server/domain/sales/templates.js'
import { TEMPLATE_PLACEHOLDERS } from '../../../server/domain/sales/angles.js'
import { publicMessage, publicStatus } from '../../../server/domain/sales/errors.js'

const EDITABLE = ['dailyCap', 'sender', 'socialProof', 'signature', 'timezone', 'undoSeconds']

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') {
      if (req.query?.action === 'check') return res.status(200).json({ attio: await checkAttio() })
      return res.status(200).json({
        settings: await getSettings({ force: true }), defaults: DEFAULTS, sender: await getSenderFor(actor.id, actor),
        templates: await getTemplates({ force: true }), templateDefaults: DEFAULT_TEMPLATES, templateSteps: templateSteps(), placeholders: TEMPLATE_PLACEHOLDERS,
      })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (body.action === 'sender') {
      const sender = await setSenderFor(actor.id, body)
      return res.status(200).json({ sender })
    }
    if (body.action === 'template') {
      const templates = await setTemplate({ pipeline: String(body.pipeline || ''), angle: String(body.angle || ''), subject: body.subject, body: body.body })
      await recordAudit({ actor, action: 'sales.template', summary: `Edited the ${body.pipeline} ${body.angle} template` })
      return res.status(200).json({ templates })
    }
    if (actor.role !== 'admin' && !actor.isSystem) return res.status(403).json({ error: 'Workspace settings are for admins. Your own name and signature are under Me.' })
    const patch = {}
    for (const k of EDITABLE) if (body[k] !== undefined) patch[k] = body[k]
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' })
    const settings = await setSettings(patch)
    await recordAudit({ actor, action: 'sales.settings', summary: `Changed sales settings: ${Object.keys(patch).join(', ')}`, detail: patch })
    return res.status(200).json({ settings })
  } catch (error) {
    console.error('[API /sales/settings]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Could not save the Sales settings') })
  }
}
