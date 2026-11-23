/**
 * The Pricing Calculator (Settings > Pricing Calculator) for an MCP caller:
 * what a print costs us, from Artelo's live pricing API, what we charge, from
 * Shopify, and what is left, retail or wholesale. Same capability as the
 * screen (settings.pricing). Read only: nothing is ordered or priced in Shopify.
 */
import { z } from 'zod'
import { ToolError } from '../server.js'
import { buildPricingGrid, quoteRows, wholesaleTierFor, WHOLESALE_TIERS } from '../../pricing.js'

const usd = n => (n == null ? null : `$${Number(n).toFixed(2)}`)
const pct = n => (n == null ? null : `${n.toFixed(1)}%`)
const SIZE = /^(8x10|12x18|16x24|24x36)$/

export const pricingTools = [
  {
    name: 'pricing_quote', title: 'Pricing quote', scope: 'read', cap: 'settings.pricing', readOnly: true,
    description: 'Our real cost, price and margin per print, live from Artelo\'s pricing API and Shopify: the Pricing Calculator. channel "retail" is one print per order (DTC). "wholesale" is a charity or race-partner run of `quantity` prints: the discount defaults to the published tier (10-24 15%, 25-74 20%, 75+ 25%), shipping is one consignment unless shipping is "individual" (a parcel to each runner). Give size and frame for order totals on one variant.',
    input: {
      channel: z.enum(['retail', 'wholesale']).default('retail'),
      quantity: z.number().int().min(1).max(1000).default(1).describe('Prints in the run (wholesale); retail is always 1'),
      size: z.string().regex(SIZE).optional().describe('8x10, 12x18 or 16x24; leave out for every size'),
      frame: z.enum(['framed', 'unframed']).optional(),
      discountPct: z.number().min(0).max(90).optional().describe('Wholesale discount to model; leave out for the published tier'),
      includePhoto: z.boolean().default(false).describe('With the $20 Photo Add-On'),
      shipping: z.enum(['consignment', 'individual']).default('consignment'),
      shippingTotal: z.number().min(0).max(100000).optional().describe('A consignment freight quote in dollars, in place of Artelo\'s rate'),
    },
    handler: async ({ channel, quantity, size, frame, discountPct, includePhoto, shipping, shippingTotal }) => {
      const qty = channel === 'retail' ? 1 : quantity
      const tier = channel === 'wholesale' ? wholesaleTierFor(qty) : null
      const discount = channel === 'wholesale' ? (discountPct ?? Math.round((tier?.discount ?? 0) * 100)) : 0
      const individual = channel === 'wholesale' && shipping === 'individual'
      let rows, single = null
      try {
        rows = await buildPricingGrid({ quantity: qty })
        if (individual) single = Object.fromEntries((qty === 1 ? rows : await buildPricingGrid({ quantity: 1 })).filter(r => !r.error).map(r => [r.key, r.orderShipping]))
      } catch {
        throw new ToolError('Could not read live prices from Artelo or Shopify right now. Try again in a minute.')
      }
      let out = quoteRows(rows, { channel, quantity: qty, discountPct: discount, includePhoto, shipMode: individual ? 'individual' : 'consignment', shippingTotal: shippingTotal ?? null, singleRows: single })
      if (size) out = out.filter(r => r.sizeLabel === size)
      if (frame) out = out.filter(r => r.frame === (frame === 'framed' ? 'Framed' : 'Unframed'))
      if (!out.length) throw new ToolError(size ? `We don't sell ${size}${frame ? ` ${frame}` : ''} right now.` : 'No sizes came back.')
      const failed = rows.filter(r => r.error).map(r => `${r.sizeLabel} ${r.frame}`)
      const one = out.length === 1 ? out[0] : null
      return {
        channel, quantity: qty,
        discount: channel === 'wholesale' ? `${discount}%${discountPct == null ? (tier ? ` (${tier.label} tier)` : ' (under 10 units: no published tier)') : ' (modeled)'}` : null,
        shipping: channel === 'retail' ? 'one print per order' : individual ? 'a parcel to each runner' : shippingTotal != null ? `one consignment, ${usd(shippingTotal)} quoted` : 'one consignment, Artelo rate',
        photoAddOn: includePhoto,
        rows: out.map(r => ({
          print: `${r.sizeLabel} ${r.frameLabel}`, notOnWholesaleSheet: r.offSheet || undefined,
          listPrice: usd(r.listPrice), unitPrice: usd(r.unitPrice), shippingCharged: r.shippingCharged ? usd(r.shippingCharged) : undefined,
          production: usd(r.productionCost), shipping: usd(r.unitShipping), branding: usd(r.unitBranding), processingFee: usd(r.unitFee),
          totalCost: usd(r.unitCost + r.unitFee), profit: usd(r.grossProfit), margin: pct(r.grossMarginPct),
        })),
        order: one && channel === 'wholesale' ? {
          prints: qty, revenue: usd(one.unitPrice * qty), profit: usd(one.grossProfit * qty),
          margin: pct(one.unitPrice > 0 ? (one.grossProfit / one.unitPrice) * 100 : null), customerSaves: usd((one.listPrice - one.unitPrice) * qty),
        } : undefined,
        tiers: channel === 'wholesale' ? WHOLESALE_TIERS.map(t => `${t.label}: ${Math.round(t.discount * 100)}% off`) : undefined,
        unpriced: failed.length ? failed : undefined,
        source: 'Artelo pricing API (production, shipping) and Shopify (retail), read just now',
      }
    },
  },
]
