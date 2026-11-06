/**
 * GET /api/creators/samples?creatorId= - every sample print made for a
 * creator (CREATOR-XXXXXX, -2, -3...), newest first, with where each one is.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability } from '../../_lib/users.js'
import prisma from '../../_lib/prisma.js'
import { shopifyAdminUrl, arteloOrderUrl } from '../../../server/lib/links.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const user = await requireCapability(req, res, 'creators')
  if (!user) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const id = String(req.query.creatorId || '')
    if (!id) return res.status(400).json({ error: 'creatorId is required' })
    const base = `CREATOR-${id.slice(-6).toUpperCase()}`
    const creator = await prisma.creator.findUnique({ where: { id }, select: { sampleShopifyOrderIds: true } })
    const shopifyIds = creator?.sampleShopifyOrderIds || []
    const select = { orderNumber: true, parentOrderNumber: true, shopifyOrderData: true, arteloOrderData: true, source: true, status: true, raceName: true, raceYear: true, productSize: true, frameType: true, createdAt: true, trackingNumber: true, trackingCarrier: true, shippedAt: true }
    // Old samples were CREATOR-XXXXXX rows; new ones are Shopify orders.
    const rows = await prisma.order.findMany({
      where: { OR: [{ source: 'creator_sample', orderNumber: { startsWith: base } }, ...(shopifyIds.length ? [{ source: 'shopify', parentOrderNumber: { in: shopifyIds } }] : [])] },
      orderBy: { createdAt: 'desc' }, select,
    })
    // Each sample with where to open it: Shopify (new samples), Artelo, and the order in our tool.
    const samples = rows.map(({ shopifyOrderData, parentOrderNumber, arteloOrderData, source, ...r }) => {
      const number = shopifyOrderData?.name ? String(shopifyOrderData.name).replace('#', '') : r.orderNumber
      return {
        ...r, orderNumber: number,
        shopifyUrl: source === 'shopify' ? shopifyAdminUrl(parentOrderNumber) : null,
        arteloUrl: arteloOrderData?.id ? arteloOrderUrl(arteloOrderData.id) : null,
        fulfillmentPath: `/orders/${number}`,
      }
    })
    // Sent to Shopify but not imported yet: shown from what we recorded when it was sent.
    const sentCosts = await prisma.sampleCost.findMany({ where: { creatorId: id }, orderBy: { createdAt: 'desc' } })
    for (const sc of sentCosts) {
      // Shopify order names are stored without "#"; old CREATOR- rows are already listed above.
      const name = String(sc.orderName || '').replace(/^#/, '')
      if (!name || name.startsWith('CREATOR-') || samples.some(s => s.orderNumber === name)) continue
      const it = Array.isArray(sc.items) ? sc.items[0] || {} : {}
      // Not imported yet: Shopify's order search finds it by its number.
      const shopSearch = shopifyAdminUrl('x')?.replace(/\/orders\/x$/, `/orders?query=${encodeURIComponent(name)}`) || null
      samples.unshift({ orderNumber: name, shopifyUrl: shopSearch, arteloUrl: null, fulfillmentPath: null, status: 'sent', raceName: it.title || null, raceYear: null, productSize: it.size || null, frameType: it.frame || null, createdAt: sc.createdAt, trackingNumber: null, trackingCarrier: null, shippedAt: null, pending: true })
    }
    return res.status(200).json({ samples })
  } catch (error) {
    console.error('[API /creators/samples]', error)
    return res.status(500).json({ error: 'Could not load samples' })
  }
}
