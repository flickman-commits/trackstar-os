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
import { recordAudit } from '../../_lib/users.js'
import prisma from '../../_lib/prisma.js'
import { finalPdfUploadUrl, recordFinalPdf, finalPdfStatus, retryFinalPdf } from '../../../server/domain/orders/customFinal.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') {
      if (!req.query.orderId) return res.status(400).json({ error: 'orderId is required' })
      return res.status(200).json(await finalPdfStatus(String(req.query.orderId)))
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
      return res.status(200).json(out)
    }

    if (body.action === 'retry') return res.status(200).json(await retryFinalPdf({ orderId: body.orderId }))

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /orders/final-pdf]', error)
    return sendPublicError(res, error)
  }
}
