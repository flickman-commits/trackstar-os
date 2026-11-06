/**
 * Settings > Design Needs: what the designer has to fix in production files
 * (server/domain/render/designNeeds.js). Anyone whose role has Design Needs
 * reads and checks off; removing a hand-written one is the same.
 *
 *   GET                                              the list (synced first when a couple of minutes old)
 *   POST { action: 'done' | 'undo', id }
 *   POST { action: 'add', title, template?, size?, detail? }
 *   POST { action: 'delete', id }                    a hand-written or rejected one
 *   POST { action: 'sync' }                          look again now
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { listDesignNeeds, syncIfStale, syncDesignNeeds, setDone, addDesignNeed, deleteDesignNeed } from '../../../server/domain/render/designNeeds.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'settings.design_needs')
  if (!user) return
  try {
    if (req.method === 'GET') {
      await syncIfStale().catch(err => console.warn('[design-needs] sync failed:', err.message))
      return res.status(200).json(await listDesignNeeds())
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    switch (body.action) {
      case 'done':
      case 'undo': {
        const need = await setDone({ id: body.id, done: body.action === 'done', actor: user })
        await recordAudit({ action: `design_need.${body.action}`, summary: `${body.action === 'done' ? 'Checked off' : 'Reopened'} the design need "${need.title}"`, detail: { id: need.id }, actor: user })
        return res.status(200).json({ need })
      }
      case 'add': {
        const need = await addDesignNeed({ ...body, actor: user })
        await recordAudit({ action: 'design_need.add', summary: `Added the design need "${need.title}"`, detail: { id: need.id }, actor: user })
        return res.status(200).json({ need })
      }
      case 'delete': {
        await deleteDesignNeed({ id: body.id })
        await recordAudit({ action: 'design_need.delete', summary: 'Removed a design need', detail: { id: body.id }, actor: user })
        return res.status(200).json({ ok: true })
      }
      case 'sync': {
        await syncDesignNeeds()
        return res.status(200).json(await listDesignNeeds())
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    return sendPublicError(res, error)
  }
}
