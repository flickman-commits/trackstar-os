/**
 * /api/products/bulk-edit
 *
 * Backend for the /products bulk editor.
 *
 *   GET  ?action=catalog   every variant in the store, flattened for filtering
 *   GET  ?action=batches   recent applied batches (for the undo list)
 *   POST { action: 'apply', variantIds[], price, filters?, description? }
 *   POST { action: 'undo', batchId }
 *
 * Apply takes explicit variant IDs rather than a filter spec. The client sends
 * exactly the rows it previewed, so what you saw is what changes — a filter
 * re-evaluated server-side could quietly select a different set if the catalog
 * shifted between preview and apply.
 *
 * The BEFORE price always comes from a fresh Shopify read at apply time, never
 * from the client, so an undo restores what was really there.
 */

import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import {
  fetchVariantCatalog,
  applyVariantPrices,
  fetchVariantSnapshots,
  findProductsLosingEveryVariant,
  deleteVariants,
  recreateVariants,
} from '../../../server/services/shopifyProducts.js'
import { setCustomFee } from '../../../server/services/customPricing.js'

// A full 8x10 sweep is ~116 variants. This is a runaway guard, not a real limit.
const MAX_BATCH = 1000

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return

  // The whole bulk editor is part of the admin view, reads included: the
  // catalog it returns carries every price in the store. The write paths below
  // check again anyway, because the read gate is not what protects them.
  const admin = await requireAdminRole(req, res, actor)
  if (!admin) return
  req.actingUser = admin

  try {
    if (req.method === 'GET') {
      if (req.query.action === 'batches') {
        const batches = await prisma.productEditBatch.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
        return res.status(200).json({
          batches: batches.map(b => ({
            id: b.id,
            createdAt: b.createdAt,
            description: b.description,
            count: Array.isArray(b.changes) ? b.changes.length : 0,
            undoneAt: b.undoneAt,
            actorEmail: b.actorEmail,
            undoneBy: b.undoneBy,
          })),
        })
      }

      const variants = await fetchVariantCatalog()
      return res.status(200).json({ variants })
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const { action } = req.body || {}

    if (action === 'apply') {
      const { variantIds, price, filters, description } = req.body

      if (!Array.isArray(variantIds) || variantIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one variant' })
      }
      if (variantIds.length > MAX_BATCH) {
        return res.status(400).json({ error: `Too many variants (${variantIds.length}), max ${MAX_BATCH}` })
      }
      const newPrice = Number(price)
      if (!Number.isFinite(newPrice) || newPrice <= 0) {
        return res.status(400).json({ error: 'Price must be a positive number' })
      }

      // Re-read the catalog so the recorded "before" values are what Shopify
      // actually holds right now, not what the browser was showing.
      const catalog = await fetchVariantCatalog()
      const byId = new Map(catalog.map(v => [v.variantId, v]))

      const wanted = []
      const missing = []
      for (const id of variantIds) {
        const v = byId.get(id)
        if (v) wanted.push(v)
        else missing.push(id)
      }
      if (!wanted.length) {
        return res.status(400).json({ error: 'None of those variants exist in Shopify any more' })
      }

      const target = newPrice.toFixed(2)
      // Nothing to do for variants already at the target price. Skipping them
      // keeps the batch log honest — an undo should not "restore" a price to
      // the value it already had.
      const toChange = wanted.filter(v => v.price !== target)

      if (!toChange.length) {
        return res.status(200).json({
          applied: 0, skipped: wanted.length, failures: [], missing,
          message: 'Every selected variant is already at that price',
        })
      }

      const { updated, failures } = await applyVariantPrices(
        toChange.map(v => ({ variantId: v.variantId, productId: v.productId, price: target }))
      )

      let batch = null
      if (updated.length) {
        const updatedIds = new Set(updated.map(u => u.variantId))
        batch = await prisma.productEditBatch.create({
          data: {
            description: description || `Set price to $${target}`,
            actorId: req.actingUser?.id || null,
            actorEmail: req.actingUser?.email || actor.email || null,
            filters: filters || undefined,
            changes: toChange
              .filter(v => updatedIds.has(v.variantId))
              .map(v => ({
                variantId: v.variantId,
                productId: v.productId,
                productTitle: v.productTitle,
                size: v.size,
                frame: v.frame,
                before: v.price,
                after: target,
              })),
          },
        })
      }

      if (updated.length) {
        await recordAudit({
          action: 'price.apply',
          summary: `Set ${updated.length} variant${updated.length === 1 ? '' : 's'} to $${target}`,
          detail: { batchId: batch?.id || null, price: target, count: updated.length, description: description || null },
          actor: req.actingUser || actor,
        })
      }

      return res.status(200).json({
        applied: updated.length,
        skipped: wanted.length - toChange.length,
        failures,
        missing,
        batchId: batch?.id || null,
      })
    }

    if (action === 'delete') {
      const { variantIds, filters, description, dryRun } = req.body

      if (!Array.isArray(variantIds) || variantIds.length === 0) {
        return res.status(400).json({ error: 'Select at least one variant' })
      }
      if (variantIds.length > MAX_BATCH) {
        return res.status(400).json({ error: `Too many variants (${variantIds.length}), max ${MAX_BATCH}` })
      }

      // Snapshot BEFORE deleting. This is the only copy of what these variants
      // were: Shopify keeps nothing recoverable once they are gone, so an undo
      // is only as good as what we write down here.
      const snapshots = await fetchVariantSnapshots(variantIds)
      if (!snapshots.length) {
        return res.status(400).json({ error: 'None of those variants exist in Shopify any more' })
      }
      const found = new Set(snapshots.map(s => s.variantId))
      const missing = variantIds.filter(id => !found.has(id))

      // A product cannot lose every variant it has. Drop those products from
      // the batch instead of letting the mutation fail partway.
      const blocked = await findProductsLosingEveryVariant(snapshots)
      const blockedIds = new Set(blocked.map(b => b.productId))
      const deletable = snapshots.filter(s => !blockedIds.has(s.productId))

      if (dryRun) {
        return res.status(200).json({
          dryRun: true,
          wouldDelete: deletable.length,
          missing,
          blocked,
          products: [...new Set(deletable.map(s => s.productId))].length,
          sample: deletable.slice(0, 10).map(s => ({
            productTitle: s.productTitle, title: s.title, sku: s.sku, price: s.price,
          })),
        })
      }

      if (!deletable.length) {
        return res.status(400).json({
          error: 'Every selected variant is the last one on its product', blocked,
        })
      }

      const { deleted, failures } = await deleteVariants(deletable)

      let batch = null
      if (deleted.length) {
        const deletedIds = new Set(deleted.map(d => d.variantId))
        batch = await prisma.productEditBatch.create({
          data: {
            description: description || `Removed ${deleted.length} variants`,
            actorId: req.actingUser?.id || null,
            actorEmail: req.actingUser?.email || actor.email || null,
            // `kind` rides in filters because ProductEditBatch has no column for
            // it and adding one means a production migration for a discriminator.
            // The undo path reads it off the changes rows, which carry it too.
            filters: { ...(filters || {}), kind: 'delete' },
            changes: deletable
              .filter(s => deletedIds.has(s.variantId))
              .map(s => ({ kind: 'delete', ...s })),
          },
        })
      }

      if (deleted.length) {
        await recordAudit({
          action: 'variant.delete',
          summary: `Deleted ${deleted.length} variant${deleted.length === 1 ? '' : 's'} from Shopify`,
          detail: { batchId: batch?.id || null, count: deleted.length, description: description || null },
          actor: req.actingUser || actor,
        })
      }

      return res.status(200).json({
        deleted: deleted.length,
        failures,
        missing,
        blocked,
        batchId: batch?.id || null,
      })
    }

    if (action === 'undo') {
      const { batchId } = req.body
      if (!batchId) return res.status(400).json({ error: 'batchId is required' })

      const batch = await prisma.productEditBatch.findUnique({ where: { id: batchId } })
      if (!batch) return res.status(404).json({ error: 'Batch not found' })
      if (batch.undoneAt) return res.status(400).json({ error: 'That batch was already undone' })

      const changes = Array.isArray(batch.changes) ? batch.changes : []
      if (!changes.length) return res.status(400).json({ error: 'That batch recorded no changes' })

      // Undoing a removal means building the variants again from the snapshot.
      // They come back with the same options, price, SKU, weight and image, but
      // NOT the same variant ids — Shopify mints new ones, and nothing can
      // change that. Anything holding an old id will not find the restored row.
      if (changes.every(c => c.kind === 'delete')) {
        const { created, failures } = await recreateVariants(changes)
        if (created.length === changes.length) {
          await prisma.productEditBatch.update({
            where: { id: batchId },
            data: { undoneAt: new Date(), undoneBy: req.actingUser?.email || actor.email || null },
          })
        }
        await recordAudit({
          action: 'variant.restore',
          summary: `Restored ${created.length} of ${changes.length} deleted variants`,
          detail: { batchId, restored: created.length, total: changes.length },
          actor: req.actingUser || actor,
        })
        return res.status(200).json({
          restored: created.length,
          total: changes.length,
          failures,
          fullyUndone: created.length === changes.length,
          note: 'Restored variants have new Shopify variant IDs.',
        })
      }

      const { updated, failures } = await applyVariantPrices(
        changes.map(c => ({ variantId: c.variantId, productId: c.productId, price: c.before }))
      )

      // Only mark the batch undone if every variant went back. A partial undo
      // stays open so the remainder can be retried.
      if (updated.length === changes.length) {
        // A custom design fee change also moved the fee the storefront copy
        // shows; put that back with the prices so the two keep agreeing.
        const f = batch.filters
        if (f && f.kind === 'custom_fee' && f.feeSaved && Number.isInteger(f.feeBefore)) {
          await setCustomFee(f.feeBefore)
        }
        await prisma.productEditBatch.update({
          where: { id: batchId },
          data: { undoneAt: new Date(), undoneBy: req.actingUser?.email || actor.email || null },
        })
      }

      await recordAudit({
        action: 'price.undo',
        summary: `Reverted ${updated.length} of ${changes.length} price changes`,
        detail: { batchId, reverted: updated.length, total: changes.length },
        actor: req.actingUser || actor,
      })

      return res.status(200).json({
        reverted: updated.length,
        total: changes.length,
        failures,
        fullyUndone: updated.length === changes.length,
      })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (error) {
    console.error('[API /products/bulk-edit] Error:', error)
    const missingScope = /write_products|access denied|not approved/i.test(error.message || '')
    return res.status(missingScope ? 403 : 500).json({
      error: missingScope
        ? 'Shopify rejected the write. The app needs the write_products scope.'
        : error.message,
    })
  }
}
