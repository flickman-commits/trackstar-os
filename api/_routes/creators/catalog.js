/**
 * GET /api/creators/catalog - the store's race prints for a creator's sample:
 * the shared catalog (server/domain/catalog/printCatalog.js).
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability } from '../../_lib/users.js'
import { printCatalog } from '../../../server/domain/catalog/printCatalog.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const user = await requireCapability(req, res, 'creators')
  if (!user) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    return res.status(200).json({ products: await printCatalog() })
  } catch (error) {
    console.error('[API /creators/catalog]', error)
    return res.status(500).json({ error: 'Could not read the Shopify catalog' })
  }
}
