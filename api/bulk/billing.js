/**
 * /api/bulk/billing - a bulk order's organization, terms and Shopify invoice
 * (server/domain/bulk/billing.js). Everything lives on the bulk order itself.
 *
 *   GET ?options=1          events, sizes, frames, print kinds
 *   GET ?past=1             earlier orders' details, to start a new one from
 *   GET ?catalog=1          the store's prints for the race picker
 *   GET ?id=                the order's terms and invoice
 *   GET ?id=&quote=1        the invoice as it would read: Shopify price, discount, total (admin)
 *   POST { action, ... }
 *     create        { partnerName, contact..., billingAddress, printKind, discount..., shipping, shipToAddress?, raceName, raceYear, quantity, productSize, frameType, eventNote?, fulfillmentDate }
 *     update        { id, ...terms }
 *     template-upload / template-saved { id, fileName | path }   a co-branded order's production file
 *     invoice       { id }               admin: build or rebuild the Shopify draft order
 *     send-invoice  { id, message? }     admin: Shopify emails it to the contact
 */
import { setCors, requireAdmin } from '../_lib/auth.js'
import { seesMoney, withoutBulkMoney } from '../_lib/money.js'
import { requireAdminRole, recordAudit } from '../_lib/users.js'
import { publicPrintCatalog } from '../../server/domain/catalog/printCatalog.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { FRAME_OPTIONS, SIZE_OPTIONS } from '../../server/domain/bulk/bulkOrders.js'
import { EVENT_OPTIONS, PRINT_KINDS, createBulkOrder, updateBulkOrder, loadBilling, quote, buildInvoice, sendInvoice, productionFileUpload, productionFileSaved, pastDetails } from '../../server/domain/bulk/billing.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdmin(req, res)
  if (!actor) return
  // Prices, the discount and the invoice are admins' (api/_lib/money.js): another
  // role can set up an order but never sees or sets the money.
  const money = seesMoney(actor)
  const shown = o => (money ? o : withoutBulkMoney(o))
  try {
    if (req.method === 'GET') {
      // Start a new order from an earlier one's details (the discount only for admins).
      if (req.query?.past) return res.status(200).json({ past: (await pastDetails()).map(shown) })
      // The store's prints for the race picker: names and pictures, no prices.
      if (req.query?.catalog) return res.status(200).json({ products: await publicPrintCatalog() })
      if (req.query?.options) return res.status(200).json({ events: EVENT_OPTIONS, sizes: SIZE_OPTIONS, frames: FRAME_OPTIONS, printKinds: PRINT_KINDS })
      if (req.query?.quote) {
        if (!money) return res.status(403).json({ error: 'Prices are for admins.' })
        return res.status(200).json(await quote(req.query.id))
      }
      return res.status(200).json({ order: shown(await loadBilling(req.query?.id)) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const input = money ? body : withoutBulkMoney(body)
    switch (body.action) {
      case 'create': {
        const order = await createBulkOrder(input, actor)
        await recordAudit({ action: 'bulk.create', summary: `Created bulk order ${order.number} for ${order.partnerName} (${order.raceName} ${order.raceYear}, ${order.quantity} prints)`, detail: { bulkOrderId: order.id }, actor })
        return res.status(200).json({ order: shown(order) })
      }
      case 'update': {
        const order = await updateBulkOrder(body.id, input)
        await recordAudit({ action: 'bulk.update', summary: `Edited bulk order ${order.number}`, detail: { bulkOrderId: order.id }, actor })
        return res.status(200).json({ order: shown(order) })
      }
      // A co-branded order's production file, for the render worker (render/templates.js).
      case 'template-upload':
        return res.status(200).json(await productionFileUpload(body.id, body.fileName))
      case 'template-saved': {
        const t = await productionFileSaved(body.id, body.path)
        await recordAudit({ action: 'bulk.template_upload', summary: `Uploaded the co-branded production file for ${t.edition}`, detail: { key: t.key }, actor })
        return res.status(200).json({ ok: true, key: t.key })
      }
      case 'invoice': {
        const admin = await requireAdminRole(req, res, actor)
        if (!admin) return
        const out = await buildInvoice(body.id)
        await recordAudit({ action: 'bulk.invoice', summary: `Built Shopify invoice ${out.draftName} for bulk order ${out.quote.order.number} ($${(out.quote.totalCents / 100).toFixed(2)})`, detail: { bulkOrderId: out.quote.order.id, draft: out.draftName }, actor: admin })
        return res.status(200).json({ draftName: out.draftName, invoiceUrl: out.invoiceUrl, totalShopify: out.totalShopify, quote: out.quote, order: await loadBilling(body.id) })
      }
      case 'send-invoice': {
        const admin = await requireAdminRole(req, res, actor)
        if (!admin) return
        const out = await sendInvoice(body.id, { message: body.message })
        await recordAudit({ action: 'bulk.invoice_send', summary: `Sent the bulk order invoice to ${out.sentTo}`, detail: { bulkOrderId: body.id }, actor: admin })
        return res.status(200).json({ ...out, order: await loadBilling(body.id) })
      }
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
  } catch (error) {
    return sendPublicError(res, error)
  }
}
