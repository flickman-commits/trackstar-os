/**
 * GET /api/products/pricing
 *
 * Landed cost, price and margin for every size/frame, at a given order size.
 *
 *   ?quantity=1            units in ONE shipment (see below)
 *   ?shippingDestination=US
 *
 * Quantity means units per SHIPMENT, not units sold, and that distinction is
 * the whole reason the bulk view exists:
 *
 *   Retail DTC — every order ships on its own, so quantity is 1 no matter how
 *                many prints we sell in a month.
 *   Bulk       — wholesale and charity orders go out as one consignment, so
 *                shipping, package branding and the flat 30c payment fee are
 *                all divided across the run.
 *
 * Production cost does not move with quantity (Artelo gives no volume break),
 * so quoting bulk off the qty-1 numbers overstates cost, sometimes badly.
 *
 * Channel pricing (wholesale discount, charity terms) is applied client-side
 * on top of `retailPrice`, so changing terms costs no round trip and nothing
 * about a negotiation gets baked into the server.
 */

import { setCors } from '../../_lib/auth.js'
import {
  buildPricingGrid,
  SIZES,
  COLUMNS,
  SHOPIFY_FEE_PERCENT,
  SHOPIFY_FEE_FIXED,
  STRIPE_FEE_PERCENT,
  STRIPE_FEE_FIXED,
  PHOTO_ADDON_PRICE,
  PHOTO_ADDON_COST,
  RETAIL_SHIPPING_CHARGE,
  FREE_SHIPPING_OVER,
  WHOLESALE_TIERS,
  WHOLESALE_EXCLUDED_SIZES,
} from '../../../server/services/pricing.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const shippingDestination = req.query.shippingDestination || 'US'
    // Guard the upper end: each unit of quantity is one Artelo pricing call
    // away from nothing, but a silly number would just waste their API.
    const quantity = Math.min(1000, Math.max(1, Number(req.query.quantity) || 1))

    const rows = await buildPricingGrid({ quantity, shippingDestination })

    return res.status(200).json({
      quantity,
      shippingDestination,
      fetchedAt: new Date().toISOString(),
      sizes: SIZES,
      columns: COLUMNS,
      assumptions: {
        shopifyFeePercent: SHOPIFY_FEE_PERCENT,
        shopifyFeeFixed: SHOPIFY_FEE_FIXED,
        stripeFeePercent: STRIPE_FEE_PERCENT,
        stripeFeeFixed: STRIPE_FEE_FIXED,
        photoAddOnPrice: PHOTO_ADDON_PRICE,
        photoAddOnCost: PHOTO_ADDON_COST,
        retailShippingCharge: RETAIL_SHIPPING_CHARGE,
        freeShippingOver: FREE_SHIPPING_OVER,
        wholesaleTiers: WHOLESALE_TIERS,
        wholesaleExcludedSizes: WHOLESALE_EXCLUDED_SIZES,
      },
      rows,
    })
  } catch (error) {
    console.error('[API /products/pricing] Error:', error)
    return sendPublicError(res, error)
  }
}
