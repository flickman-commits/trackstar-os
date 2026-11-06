/**
 * Settings > Admin > Designs: which production file renders which race,
 * whether each one is ready, which workers are on, and which races still
 * have no template. Admin only.
 *
 *   GET                                            the overview
 *   POST { action: 'save', key?, raceName, edition?, file, rules?, notes? }   add or edit a template
 *   POST { action: 'enable' | 'disable', key }
 *   POST { action: 'recheck', key }                 forget the last check so a worker runs it again
 *   POST { action: 'delete', key }
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { templatesOverview, upsertTemplate, setTemplateEnabled, deleteTemplate, recheckTemplate } from '../../../server/domain/render/templates.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireAdminOnly(req, res)
  if (!user) return
  try {
    if (req.method === 'GET') return res.status(200).json(await templatesOverview())
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    switch (body.action) {
      case 'save': {
        const t = await upsertTemplate(body)
        await recordAudit({ action: 'render.template', summary: `Set the ${t.key} template to ${t.file}`, detail: { key: t.key, file: t.file, rules: t.rules }, actor: user })
        return res.status(200).json({ template: t })
      }
      case 'enable':
      case 'disable': {
        const t = await setTemplateEnabled(body.key, body.action === 'enable')
        await recordAudit({ action: 'render.template', summary: `${t.enabled ? 'Enabled' : 'Disabled'} the ${t.key} template`, detail: { key: t.key }, actor: user })
        return res.status(200).json({ template: t })
      }
      case 'recheck': {
        const t = await recheckTemplate(body.key)
        return res.status(200).json({ template: t })
      }
      case 'delete': {
        const t = await deleteTemplate(body.key)
        await recordAudit({ action: 'render.template', summary: `Removed the ${t.key} template`, detail: { key: t.key, file: t.file }, actor: user })
        return res.status(200).json({ ok: true })
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[API /render/templates]', error)
    return res.status(400).json({ error: error.message })
  }
}
