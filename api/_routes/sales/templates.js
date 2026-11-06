/**
 * /api/sales/templates
 *
 *   GET                        the library as stored, plus what the browser needs to fill one in
 *   POST { action:'save', id?, name, motion, useFor?, subject?, body, assetIds? }   any sales rep: add or change one
 *   POST { action:'delete', id }                                          admin: remove one
 *   POST { action:'add-note', id, text, from? }                           any sales rep: a note beside a template
 *   POST { action:'delete-note', id, noteId }                             any sales rep: remove one
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep, requireAdminRole, recordAudit } from '../../_lib/users.js'
import { getSenderFor, getSettings } from '../../../server/domain/sales/settings.js'
import { saveTemplate, deleteTemplate, addTemplateNote, deleteTemplateNote, MOTIONS } from '../../../server/domain/sales/templateLibrary.js'
import { loadWorkspace, usedBy } from '../../../server/domain/sales/sequences.js'
import { DEFAULT_SOCIAL_PROOF, NEEDS_OPENER } from '../../../server/domain/sales/angles.js'
import { publicMessage, publicStatus } from '../../../server/domain/sales/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') {
      // Everything the composer needs to fill a template in the browser, in
      // one small read with no Attio call: the person is already on screen.
      const [{ templates, variables }, settings, sender] = await Promise.all([loadWorkspace(), getSettings(), getSenderFor(actor.id, actor)])
      const socialProof = variables.find(v => v.name.toLowerCase() === 'social proof')?.value || settings.socialProof || DEFAULT_SOCIAL_PROOF
      return res.status(200).json({
        templates, motions: MOTIONS,
        fill: { senderName: sender.name || '', socialProof, needsOpener: NEEDS_OPENER, variables },
      })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (body.action === 'save') {
      try {
        const templates = await saveTemplate(body, actor)
        await recordAudit({ actor, action: 'sales.template_library', summary: `${body.id ? 'Edited' : 'Added'} the template "${String(body.name || '').slice(0, 80)}"` })
        return res.status(200).json({ templates })
      } catch (e) {
        return res.status(publicStatus(e)).json({ error: publicMessage(e, 'Could not save the template') })
      }
    }
    if (body.action === 'add-note' || body.action === 'delete-note') {
      try {
        const id = String(body.id || '')
        const templates = body.action === 'add-note'
          ? await addTemplateNote(id, { text: body.text, from: body.from }, actor)
          : await deleteTemplateNote(id, String(body.noteId || ''))
        const name = templates.find(t => t.id === id)?.name || id
        await recordAudit({ actor, action: 'sales.template_note', summary: `${body.action === 'add-note' ? 'Added a note to' : 'Removed a note from'} the template "${String(name).slice(0, 80)}"` })
        return res.status(200).json({ templates })
      } catch (e) {
        return res.status(publicStatus(e)).json({ error: publicMessage(e, 'Could not save the template') })
      }
    }
    if (body.action === 'delete') {
      if (!(await requireAdminRole(req, res, actor))) return
      const { sequences } = await loadWorkspace({ force: true })
      const used = usedBy(sequences, String(body.id || ''))
      if (used.length) return res.status(400).json({ error: `Used in ${used.join(', ')}. Pick another template for that step first.` })
      const templates = await deleteTemplate(String(body.id || ''))
      await recordAudit({ actor, action: 'sales.template_library', summary: `Deleted a template (${String(body.id || '').slice(0, 40)})` })
      return res.status(200).json({ templates })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /sales/templates]', error)
    return res.status(500).json({ error: 'Could not load the templates' })
  }
}
