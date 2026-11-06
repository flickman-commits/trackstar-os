/**
 * /api/sales/workspace — the Sales workspace: templates, sequences, variables.
 *
 *   GET                                              everything the Templates, Sequences and Variables pages show
 *   POST { action:'save-sequence', pipeline, steps }  steps: [{ templateId, waitDays, replyInThread }]
 *   POST { action:'save-variables', variables }       the custom ones: [{ name, value }]
 *
 * Templates themselves are saved through /api/sales/templates.
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep, recordAudit } from '../../_lib/users.js'
import { loadWorkspace, saveSequence, saveVariables, BUILT_IN_VARIABLES, PIPELINES } from '../../../server/domain/sales/sequences.js'
import { getSenderFor } from '../../../server/domain/sales/settings.js'
import { publicMessage, publicStatus } from '../../../server/domain/sales/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return
  try {
    if (req.method === 'GET') {
      const [{ sequences, variables, templates }, sender] = await Promise.all([loadWorkspace({ force: true }), getSenderFor(actor.id, actor)])
      // The signature, so the template editor shows the email as it will go out.
      return res.status(200).json({ sequences, variables, templates, builtIn: BUILT_IN_VARIABLES, pipelines: PIPELINES, signature: sender.signature || '' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    try {
      if (body.action === 'save-sequence') {
        const sequences = await saveSequence(String(body.pipeline || ''), body.steps)
        await recordAudit({ actor, action: 'sales.sequence', summary: `Saved the ${body.pipeline} sequence (${body.steps?.length} steps)` })
        return res.status(200).json({ sequences })
      }
      if (body.action === 'save-variables') {
        const variables = await saveVariables(body.variables)
        await recordAudit({ actor, action: 'sales.variables', summary: `Saved ${variables.length} custom variables` })
        return res.status(200).json({ variables })
      }
    } catch (e) {
      return res.status(publicStatus(e)).json({ error: publicMessage(e, 'Could not save that') })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /sales/workspace]', error)
    return res.status(500).json({ error: 'Could not load the workspace' })
  }
}
