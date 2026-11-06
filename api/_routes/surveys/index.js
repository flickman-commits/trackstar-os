/**
 * /api/surveys - Design Survey, the team side.
 *
 *   GET                       every survey, newest first
 *   GET  ?id=                 one survey with tallies and comments
 *   POST { action: 'create', title, question? }
 *   POST { action: 'update', id, title?, question?, status? }
 *   POST { action: 'delete', id }                       (admin role)
 *   POST { action: 'upload-url', id, filename }         signed upload slot
 *   POST { action: 'add-option', id, path, label? }     after the upload lands
 *   POST { action: 'update-option', optionId, label?, sortOrder? }
 *   POST { action: 'remove-option', optionId }
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminRole, requireCapability } from '../../_lib/users.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import {
  listSurveys, createSurvey, updateSurvey, deleteSurvey, startUpload,
  addOption, updateOption, removeOption, surveyResults,
} from '../../../server/domain/surveys/surveys.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  // Anyone whose role includes Design Survey; deleting a survey needs admin.
  const actor = await requireCapability(req, res, 'tools.surveys')
  if (!actor) return

  try {
    if (req.method === 'GET') {
      if (req.query?.id) {
        const s = await surveyResults(String(req.query.id))
        return s ? res.status(200).json({ survey: s }) : res.status(404).json({ error: 'Survey not found' })
      }
      return res.status(200).json({ surveys: await listSurveys() })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    switch (body.action) {
      case 'create':
        return res.status(200).json({ survey: await createSurvey({ title: body.title, question: body.question, createdById: actor.id || null }) })
      case 'update':
        return res.status(200).json({ survey: await updateSurvey(String(body.id), body) })
      case 'delete':
        if (!(await requireAdminRole(req, res, actor))) return
        await deleteSurvey(String(body.id))
        return res.status(200).json({ ok: true })
      case 'upload-url':
        return res.status(200).json(await startUpload(String(body.id), body.filename))
      case 'add-option':
        return res.status(200).json({ option: await addOption(String(body.id), String(body.path || ''), body.label) })
      case 'update-option':
        return res.status(200).json({ option: await updateOption(String(body.optionId), body) })
      case 'remove-option':
        await removeOption(String(body.optionId))
        return res.status(200).json({ ok: true })
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[API /surveys]', error)
    return sendPublicError(res, error)
  }
}
