/**
 * /api/products/custom-fee
 *
 * The custom design fee, and the custom prints' prices that follow from it
 * (standard print price for the same size and frame + fee). See
 * server/services/customPricing.js.
 *
 *   GET                         current fee + the plan for it (what each
 *                               custom variant costs now vs. should cost)
 *   GET ?fee=150                the plan for a different fee (preview)
 *   POST { action: 'apply', fee }
 *                               reprice every custom variant, then save the
 *                               fee to the shop metafield the storefront reads
 *
 * Apply recomputes from a fresh Shopify read rather than trusting the preview,
 * and logs the price change as a ProductEditBatch, so it shows in the bulk
 * editor's history and Undo puts the prices AND the fee back.
 */

import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import { fetchVariantCatalog, applyVariantPrices } from '../../../server/services/shopifyProducts.js'
import { getCustomFee, setCustomFee, planCustomPrices } from '../../../server/services/customPricing.js'

// Sanity bounds, not policy: a typo like 1250 should not reach Shopify.
const MAX_FEE = 1000

function parseFee(raw) {
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= MAX_FEE ? n : null
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  const admin = await requireAdminRole(req, res, actor)
  if (!admin) return

  try {
    if (req.method === 'GET') {
      const [catalog, currentFee] = await Promise.all([fetchVariantCatalog(), getCustomFee()])
      let fee = currentFee
      if (req.query.fee !== undefined) {
        fee = parseFee(req.query.fee)
        if (fee === null) return res.status(400).json({ error: `Fee must be a whole number of dollars from 0 to ${MAX_FEE}` })
      }
      const plan = planCustomPrices(catalog, fee)
      return res.status(200).json({ currentFee, fee, ...plan })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (req.body?.action !== 'apply') return res.status(400).json({ error: 'Unknown action' })

    const fee = parseFee(req.body.fee)
    if (fee === null) return res.status(400).json({ error: `Fee must be a whole number of dollars from 0 to ${MAX_FEE}` })

    const [catalog, feeBefore] = await Promise.all([fetchVariantCatalog(), getCustomFee()])
    const { rows, problems } = planCustomPrices(catalog, fee)
    if (!rows.length) return res.status(400).json({ error: 'No custom variants found to price' })

    const toChange = rows.filter(r => r.changes)
    let updated = []
    let failures = []
    if (toChange.length) {
      ({ updated, failures } = await applyVariantPrices(
        toChange.map(r => ({ variantId: r.variantId, productId: r.productId, price: r.next }))
      ))
    }

    // The words follow the prices: the fee is only saved once every custom
    // price landed, so the site never advertises a fee the prices do not match.
    // A partial failure keeps the old fee; saving again retries the rest.
    const allLanded = failures.length === 0
    if (allLanded && fee !== feeBefore) await setCustomFee(fee)

    let batch = null
    if (updated.length) {
      const updatedIds = new Set(updated.map(u => u.variantId))
      batch = await prisma.productEditBatch.create({
        data: {
          description: `Custom design fee $${feeBefore} → $${fee}`,
          actorId: admin.id || null,
          actorEmail: admin.email || actor.email || null,
          // Read by the bulk editor's undo, which also restores the fee.
          filters: { kind: 'custom_fee', feeBefore, feeAfter: fee, feeSaved: allLanded },
          changes: toChange
            .filter(r => updatedIds.has(r.variantId))
            .map(r => ({
              variantId: r.variantId,
              productId: r.productId,
              productTitle: r.productTitle,
              size: r.size,
              frame: r.frame,
              before: r.current,
              after: r.next,
            })),
        },
      })
    }

    await recordAudit({
      action: 'price.custom_fee',
      summary: allLanded
        ? `Custom design fee $${feeBefore} → $${fee}; repriced ${updated.length} custom variant${updated.length === 1 ? '' : 's'}`
        : `Custom design fee change to $${fee} partly failed: ${updated.length} repriced, ${failures.length} failed; fee left at $${feeBefore}`,
      detail: { batchId: batch?.id || null, feeBefore, feeAfter: fee, repriced: updated.length, failed: failures.length },
      actor: admin,
    })

    return res.status(allLanded ? 200 : 207).json({
      feeBefore,
      fee: allLanded ? fee : feeBefore,
      feeSaved: allLanded,
      repriced: updated.length,
      alreadyRight: rows.length - toChange.length,
      failures,
      problems,
      batchId: batch?.id || null,
    })
  } catch (err) {
    console.error('[custom-fee]', err)
    return res.status(500).json({ error: 'Could not update the custom design fee. Nothing was saved to the storefront copy.' })
  }
}
