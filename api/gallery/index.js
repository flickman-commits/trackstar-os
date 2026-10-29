/**
 * GET  /api/gallery?orderId=X                  one custom's star and the customer's answer (anyone signed in)
 * GET  /api/gallery?status=suggested|live|skipped   Settings > Site Gallery (admin)
 * POST /api/gallery { action: 'star', orderId, starred }        a designer's "put this on the site" (anyone signed in)
 * POST /api/gallery { action: 'add', orderId, segment? }        put it on the custom product page (admin)
 * POST /api/gallery { action: 'skip' | 'unskip' | 'remove', orderId }   (admin)
 * POST /api/gallery { action: 'segment', orderId, segment }     marathon | ultra | other (admin)
 *
 * See server/domain/gallery/siteGallery.js.
 */
import { requireAdmin, setCors } from '../_lib/auth.js'
import { loadActiveUser, requireAdminOnly, recordAudit } from '../_lib/users.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { listGallery, pickForOrder, setStar, addToSite, setSkipped, removeFromSite, setSegment } from '../../server/domain/gallery/siteGallery.js'

const ADMIN_ACTIONS = ['add', 'skip', 'unskip', 'remove', 'segment']

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}) : {}
  const adminCall = req.method === 'GET' ? !req.query?.orderId : ADMIN_ACTIONS.includes(body.action)

  let user
  if (adminCall) {
    user = await requireAdminOnly(req, res)
    if (!user) return
  } else {
    const actor = await requireAdmin(req, res)
    if (!actor) return
    user = await loadActiveUser(actor)
    if (!user) return res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
  }

  try {
    if (req.method === 'GET') {
      if (req.query?.orderId) {
        const pick = await pickForOrder(req.query.orderId)
        return pick ? res.status(200).json(pick) : res.status(404).json({ error: 'Order not found' })
      }
      const status = ['suggested', 'live', 'skipped'].includes(req.query?.status) ? req.query.status : 'suggested'
      return res.status(200).json(await listGallery({ status }))
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (!body.orderId) return res.status(400).json({ error: 'orderId is required' })
    const orderId = String(body.orderId)

    switch (body.action) {
      case 'star':
        return res.status(200).json(await setStar(orderId, user.id, Boolean(body.starred)))
      case 'add': {
        const out = await addToSite(orderId, user.id, { segment: body.segment })
        await recordAudit({ action: 'gallery.add', summary: `Added a custom design to the site gallery (${out.segment})`, detail: { orderId }, actor: user })
        return res.status(200).json(out)
      }
      case 'skip':
      case 'unskip':
        return res.status(200).json(await setSkipped(orderId, user.id, body.action === 'skip'))
      case 'remove': {
        const out = await removeFromSite(orderId)
        await recordAudit({ action: 'gallery.remove', summary: 'Took a custom design off the site gallery', detail: { orderId }, actor: user })
        return res.status(200).json(out)
      }
      case 'segment':
        return res.status(200).json(await setSegment(orderId, body.segment))
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    console.error('[API /gallery] Error:', error)
    return sendPublicError(res, error)
  }
}
