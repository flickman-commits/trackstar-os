/**
 * Feature requests (server/domain/featureRequests.js). Anyone signed in reads
 * and adds; marking done, reopening and deleting are an admin's.
 *
 *   GET                                         the list
 *   POST { action: 'add', title, detail?, source? }
 *   POST { action: 'done' | 'undo', id, note? }  admin
 *   POST { action: 'delete', id }                admin
 */
import { setCors, requireAdmin } from '../_lib/auth.js'
import { requireAdminOnly, loadActiveUser, recordAudit } from '../_lib/users.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { listFeatureRequests, addFeatureRequest, setFeatureDone, deleteFeatureRequest } from '../../server/domain/featureRequests.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  try {
    if (req.method === 'GET') {
      if (!(await requireAdmin(req, res))) return
      return res.status(200).json(await listFeatureRequests())
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (body.action === 'add') {
      const actor = await requireAdmin(req, res)
      if (!actor) return
      const user = await loadActiveUser(actor)
      if (!user) return res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
      const request = await addFeatureRequest({ ...body, actor: user })
      return res.status(200).json({ request })
    }
    const admin = await requireAdminOnly(req, res)
    if (!admin) return
    if (body.action === 'done' || body.action === 'undo') {
      const request = await setFeatureDone({ id: body.id, done: body.action === 'done', note: body.note, actor: admin })
      await recordAudit({ action: `feature_request.${body.action}`, summary: `${body.action === 'done' ? 'Resolved' : 'Reopened'} the feature request "${request.title}"`, detail: { id: request.id }, actor: admin })
      return res.status(200).json({ request })
    }
    if (body.action === 'delete') {
      await deleteFeatureRequest({ id: body.id })
      return res.status(200).json({ ok: true })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
