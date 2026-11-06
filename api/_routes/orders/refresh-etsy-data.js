/**
 * POST /api/orders/refresh-etsy-data
 *
 * Re-fetch Etsy receipt data for existing Etsy orders that are missing etsyOrderData.
 * Similar to refresh-shopify-data.js but for Etsy orders.
 */

import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { Prisma } from '@prisma/client'
import { etsyFetch } from '../../../server/services/etsyAuth.js'
import { parseEtsyRaceName, parseEtsyPersonalization } from '../../../server/services/etsyPersonalization.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  // Admin only: it rewrites every Etsy order that is missing data.
  if (!(await requireAdminOnly(req, res))) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const shopId = process.env.ETSY_SHOP_ID

  if (!shopId) {
    return res.status(500).json({ error: 'ETSY_SHOP_ID not configured' })
  }

  try {
    // Find Etsy orders missing etsyOrderData
    const etsyOrders = await prisma.order.findMany({
      where: {
        source: 'etsy',
        etsyOrderData: { equals: Prisma.DbNull },
        status: { not: 'completed' }
      },
      select: {
        id: true,
        orderNumber: true,
        parentOrderNumber: true,
        lineItemIndex: true,
        raceName: true,
        runnerName: true,
        raceYear: true,
        customerEmail: true
      }
    })

    console.log(`[refresh-etsy-data] Found ${etsyOrders.length} Etsy orders missing data`)

    let updated = 0
    let failed = 0
    const errors = []

    // Group by parentOrderNumber to avoid duplicate receipt fetches
    const byParent = {}
    for (const order of etsyOrders) {
      if (!byParent[order.parentOrderNumber]) {
        byParent[order.parentOrderNumber] = []
      }
      byParent[order.parentOrderNumber].push(order)
    }

    for (const [receiptId, orders] of Object.entries(byParent)) {
      try {
        console.log(`[refresh-etsy-data] Fetching receipt ${receiptId}...`)

        const receipt = await etsyFetch(`/shops/${shopId}/receipts/${receiptId}`)

        if (!receipt) {
          console.log(`[refresh-etsy-data] No receipt data for ${receiptId}`)
          failed += orders.length
          continue
        }

        for (const order of orders) {
          try {
            const transaction = receipt.transactions?.[order.lineItemIndex]
            const updateData = {
              etsyOrderData: receipt,
              customerEmail: receipt.buyer_email || order.customerEmail
            }

            if (transaction) {
              // Parse race name from listing title
              const raceName = parseEtsyRaceName(transaction.title)
              if (raceName && order.raceName === 'Unknown Race') {
                updateData.raceName = raceName
              }

              // Parse personalization
              const variations = transaction.variations || []
              const personalization = variations.find(
                v => v.formatted_name === 'Personalization' ||
                     v.formatted_name?.toLowerCase() === 'personalization'
              )

              if (personalization?.formatted_value) {
                const parsed = parseEtsyPersonalization(personalization.formatted_value)
                if (parsed.runnerName && order.runnerName === order.customerEmail) {
                  updateData.runnerName = parsed.runnerName
                }
                if (parsed.raceYear) {
                  updateData.raceYear = parsed.raceYear
                }
              }
            }

            await prisma.order.update({
              where: { id: order.id },
              data: updateData
            })

            updated++
            console.log(`[refresh-etsy-data] Updated ${order.orderNumber}`)
          } catch (orderError) {
            failed++
            errors.push({ orderNumber: order.orderNumber, error: orderError.message })
          }
        }

        // Rate limit: 1 second between receipt fetches
        await new Promise(resolve => setTimeout(resolve, 1000))

      } catch (receiptError) {
        failed += orders.length
        errors.push({ receiptId, error: receiptError.message })
        console.error(`[refresh-etsy-data] Error fetching receipt ${receiptId}:`, receiptError.message)
      }
    }

    return res.status(200).json({
      success: true,
      total: etsyOrders.length,
      updated,
      failed,
      errors: errors.length > 0 ? errors : undefined
    })

  } catch (error) {
    console.error('[refresh-etsy-data] Error:', error)
    return res.status(500).json({
      success: false,
      error: 'Something went wrong. Try again, and tell Matt if it keeps happening.'
    })
  }
}
