/**
 * GET /api/products/artelo-costs
 *
 * Live production + shipping costs from Artelo for every size / frame combo we
 * sell, so we can see our landed cost per variant without opening Artelo.
 *
 * The request shape is not guesswork: the defaults below were read back off
 * ~1,700 real order items in arteloOrderData, so this prices what we actually
 * order rather than what the API docs use as an example. Notably we send
 * ArchivalMatteFineArt paper (the docs example uses MattePoster), and framed
 * items go out WITH framing service and hanging pins, both of which cost money.
 *
 * Costs are quoted per unit at quantity 1, shipping to the US.
 */

import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { fetchArteloCostMatrix, SIZES, COLUMNS } from '../../../server/services/arteloCosts.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  // Landed cost per variant: the same audience as the Pricing Calculator.
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const shippingDestination = req.query.shippingDestination || 'US'
    const quantity = Math.max(1, Number(req.query.quantity) || 1)

    const cells = await fetchArteloCostMatrix({ shippingDestination, quantity })
    return res.status(200).json({
      sizes: SIZES,
      columns: COLUMNS,
      shippingDestination,
      quantity,
      fetchedAt: new Date().toISOString(),
      cells,
    })
  } catch (error) {
    console.error('[API /products/artelo-costs] Error:', error)
    return sendPublicError(res, error)
  }
}
