/**
 * /api/orders/excluded-products - Settings > Skipped Products.
 *
 *   GET                               { excluded: [{ id, title }], products: [{ id, title, status }] }
 *   POST { products: [{ id, title }] } saves the list; completes open orders for those products
 *                                      -> { excluded, cleared: [orderNumber], problems: [string] }
 *
 * A skipped product never enters the fulfillment tool (the import passes its
 * lines by): prints with nothing to personalize, like Catch Me If You Can.
 */
import { setCors } from '../_lib/auth.js'
import { requireAdminOnly } from '../_lib/users.js'
import { listExcluded, saveExcluded, productNumber } from '../../server/domain/orders/excludedProducts.js'
import { fetchVariantCatalog } from '../../server/services/shopifyProducts.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'GET') {
      const [excluded, variants] = await Promise.all([listExcluded(), fetchVariantCatalog()])
      const products = new Map()
      for (const v of variants) {
        const id = productNumber(v.productId)
        if (id && !products.has(id)) products.set(id, { id, title: v.productTitle, status: v.productStatus })
      }
      return res.status(200).json({ excluded, products: [...products.values()].sort((a, b) => a.title.localeCompare(b.title)) })
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    return res.status(200).json(await saveExcluded(body.products, actor))
  } catch (error) {
    return sendPublicError(res, error)
  }
}
