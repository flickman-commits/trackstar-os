/**
 * /api/orders/final-pdf - the final PDF of a custom order, once the customer
 * has approved (server/domain/orders/customFinal.js).
 *
 *   GET  ?orderId=                          the newest final PDF and where it went
 *   POST { action: 'upload-url', orderId }  a signed URL the browser puts the PDF to
 *   POST { action: 'record', orderId, path, fileName }
 *                                           save it: Drive Orders folder + Artelo library,
 *                                           and the order reads Final PDF uploaded
 *   POST { action: 'retry', orderId }       Drive and Artelo again, for one that failed
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { recordAudit, loadActiveUser, withSupportScope } from '../../_lib/users.js'
import { threadForViewer } from '../../../server/domain/support/access.js'
import prisma from '../../_lib/prisma.js'
import { finalPdfUploadUrl, recordFinalPdf, finalPdfStatus, retryFinalPdf } from '../../../server/domain/orders/customFinal.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

/** A print held by a conversation: whether this person may open it, and who has it. */
async function forViewer(out, actor) {
  const threadId = out?.finalPdf?.send?.threadId
  if (!threadId) return out
  const user = await loadActiveUser(actor)
  const thread = user ? await threadForViewer(await withSupportScope(user), threadId) : { canOpen: false, with: null }
  return { ...out, finalPdf: { ...out.finalPdf, send: { ...out.finalPdf.send, canOpenThread: thread.canOpen, threadWith: thread.with } } }
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') {
      if (!req.query.orderId) return res.status(400).json({ error: 'orderId is required' })
      return res.status(200).json(await forViewer(await finalPdfStatus(String(req.query.orderId)), actor))
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (!body.orderId) return res.status(400).json({ error: 'orderId is required' })

    if (body.action === 'upload-url') return res.status(200).json(await finalPdfUploadUrl({ orderId: body.orderId }))

    if (body.action === 'record') {
      const out = await recordFinalPdf({ orderId: body.orderId, path: body.path, fileName: body.fileName, actor, send: body.send !== false })
      const order = await prisma.order.findUnique({ where: { id: String(body.orderId) }, select: { orderNumber: true } })
      await recordAudit({
        action: 'order.final-pdf',
        summary: `Uploaded the final PDF for custom order ${order?.orderNumber || body.orderId}`,
        detail: { orderId: body.orderId, fileName: out.finalPdf?.fileName, drive: Boolean(out.finalPdf?.driveUrl), artelo: Boolean(out.finalPdf?.inArtelo) },
        actor,
      })
      return res.status(200).json(await forViewer(out, actor))
    }

    if (body.action === 'retry') return res.status(200).json(await forViewer(await retryFinalPdf({ orderId: body.orderId }), actor))

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /orders/final-pdf]', error)
    return sendPublicError(res, error)
  }
}
