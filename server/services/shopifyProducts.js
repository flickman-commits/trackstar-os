/**
 * shopifyProducts.js - Catalog reads and bulk variant writes for the /products
 * bulk editor.
 *
 * Needs the `write_products` scope for anything that mutates. Reads work with
 * `read_products` alone, which is deliberate: the editor can load, filter and
 * preview a change on a store that has never granted write access.
 */

import { getShopifyToken, SHOPIFY_API_VERSION } from './shopifyAuth.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'

const API_VERSION = SHOPIFY_API_VERSION

export async function shopifyGraphql(query, variables) {
  const store = process.env.SHOPIFY_STORE
  if (!store) throw new Error('Missing SHOPIFY_STORE')
  const token = await getShopifyToken()

  const res = await fetchWithTimeout(
    `https://${store}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    },
    20000
  )

  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`)
  }
  const json = await res.json()
  if (json.errors?.length) {
    // A missing write scope surfaces here rather than as an HTTP error.
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`)
  }
  return json.data
}

const CATALOG_QUERY = `
  query Catalog($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        status
        tags
        featuredImage { url }
        variants(first: 100) {
          nodes {
            id
            sku
            price
            selectedOptions { name value }
          }
        }
      }
    }
  }
`

/**
 * Every variant in the store, flattened into rows the editor can filter.
 *
 * Size and Frame are real Shopify product options here, so they are read off
 * selectedOptions rather than parsed out of the SKU. The SKU encodes them too
 * (e.g. "mesa-s1p-8x10-bl-oak-am") but as display-adjacent text it drifts —
 * one product uses a bare "chi" for every variant.
 */
export async function fetchVariantCatalog() {
  const rows = []
  let cursor = null

  while (true) {
    const data = await shopifyGraphql(CATALOG_QUERY, { cursor })
    for (const product of data.products.nodes) {
      const isCustom = product.tags.some(t => t.toLowerCase() === 'custom')
      for (const variant of product.variants.nodes) {
        const opt = name => variant.selectedOptions.find(o => o.name === name)?.value || null
        rows.push({
          variantId: variant.id,
          productId: product.id,
          productTitle: product.title,
          productHandle: product.handle,
          productStatus: product.status,
          imageUrl: product.featuredImage?.url || null,
          tags: product.tags,
          isCustom,
          sku: variant.sku || null,
          price: variant.price,
          size: opt('Size'),
          frame: opt('Frame'),
        })
      }
    }
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
  }

  return rows
}

const BULK_UPDATE = `
  mutation BulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`

/**
 * Apply new prices to specific variants.
 *
 * `updates` is [{ variantId, productId, price }]. Shopify's bulk mutation is
 * scoped to one product, so updates are grouped by product and sent as one
 * call each. Products are processed sequentially — the catalog is small (58
 * products for a full 8x10 sweep) and serial calls stay well inside the API
 * rate limit without needing backoff.
 *
 * Returns { updated, failures } rather than throwing on a partial failure, so
 * the caller can still record the variants that did land. A batch that only
 * half-applied still needs its successful half to be undoable.
 */
export async function applyVariantPrices(updates) {
  const byProduct = new Map()
  for (const u of updates) {
    if (!byProduct.has(u.productId)) byProduct.set(u.productId, [])
    byProduct.get(u.productId).push(u)
  }

  const updated = []
  const failures = []

  for (const [productId, group] of byProduct) {
    try {
      const data = await shopifyGraphql(BULK_UPDATE, {
        productId,
        variants: group.map(u => ({ id: u.variantId, price: String(u.price) })),
      })
      const result = data.productVariantsBulkUpdate
      if (result.userErrors?.length) {
        failures.push({ productId, message: result.userErrors.map(e => e.message).join('; ') })
        continue
      }
      const priceById = new Map(result.productVariants.map(v => [v.id, v.price]))
      for (const u of group) {
        if (priceById.has(u.variantId)) {
          updated.push({ ...u, price: priceById.get(u.variantId) })
        } else {
          failures.push({ productId, message: `Variant ${u.variantId} missing from response` })
        }
      }
    } catch (error) {
      failures.push({ productId, message: error.message })
    }
  }

  return { updated, failures }
}

// ---------------------------------------------------------------------------
// Variant removal, and putting it back
// ---------------------------------------------------------------------------

/**
 * Everything needed to recreate a variant byte-for-byte later.
 *
 * The image is captured as a URL, not an id. Deleting a variant leaves the
 * product's media alone, so at restore time we re-find the same file among the
 * product's media and re-attach it (see mediaIdsByFile). Storing the id instead
 * would be no more stable and would rot silently if media were re-uploaded.
 */
const VARIANT_SNAPSHOT_QUERY = `
  query VariantSnapshot($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on ProductVariant {
        id
        title
        price
        compareAtPrice
        barcode
        taxable
        position
        selectedOptions { name value }
        image { url }
        inventoryPolicy
        inventoryItem {
          sku
          tracked
          requiresShipping
          measurement { weight { value unit } }
        }
        product { id title handle }
      }
    }
  }
`

const PRODUCT_VARIANT_COUNT_QUERY = `
  query VariantCounts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        variantsCount { count }
      }
    }
  }
`

const PRODUCT_MEDIA_QUERY = `
  query ProductMedia($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        media(first: 250) {
          nodes { id ... on MediaImage { image { url } } }
        }
      }
    }
  }
`

const BULK_DELETE = `
  mutation BulkDelete($productId: ID!, $variantsIds: [ID!]!) {
    productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
      product { id }
      userErrors { field message }
    }
  }
`

const BULK_CREATE = `
  mutation BulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id title }
      userErrors { field message }
    }
  }
`

/** Shopify caps a nodes() lookup, and we routinely ask about ~200 variants. */
function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * The CDN path of a Shopify file URL, minus the ?v= cache buster.
 * Two URLs for the same uploaded file agree on this and on nothing else, which
 * is what lets a restored variant find its original image again.
 */
function fileKey(url) {
  const m = /\/files\/([^?]+)/.exec(url || '')
  return m ? m[1] : null
}

/** Full snapshots for the given variant ids, in no particular order. */
export async function fetchVariantSnapshots(variantIds) {
  const out = []
  for (const ids of chunk(variantIds, 100)) {
    const data = await shopifyGraphql(VARIANT_SNAPSHOT_QUERY, { ids })
    for (const n of data.nodes) {
      if (!n) continue
      out.push({
        variantId: n.id,
        productId: n.product.id,
        productTitle: n.product.title,
        productHandle: n.product.handle,
        title: n.title,
        price: n.price,
        compareAtPrice: n.compareAtPrice,
        barcode: n.barcode,
        taxable: n.taxable,
        position: n.position,
        optionValues: n.selectedOptions.map(o => ({ optionName: o.name, name: o.value })),
        imageUrl: n.image?.url || null,
        inventoryPolicy: n.inventoryPolicy,
        sku: n.inventoryItem?.sku || null,
        tracked: n.inventoryItem?.tracked ?? null,
        requiresShipping: n.inventoryItem?.requiresShipping ?? null,
        weight: n.inventoryItem?.measurement?.weight?.value ?? null,
        weightUnit: n.inventoryItem?.measurement?.weight?.unit ?? null,
      })
    }
  }
  return out
}

/**
 * Which of these products would be left with no variants at all?
 *
 * Shopify refuses to delete a product's last variant, and rightly so. Rather
 * than let the mutation fail halfway through a batch we check first and hand
 * the caller a list to exclude, so a 200-variant sweep does not stop dead on
 * the one product that only sells one size.
 */
export async function findProductsLosingEveryVariant(deletions) {
  const wanted = new Map()
  for (const d of deletions) {
    wanted.set(d.productId, (wanted.get(d.productId) || 0) + 1)
  }

  const blocked = []
  for (const ids of chunk([...wanted.keys()], 100)) {
    const data = await shopifyGraphql(PRODUCT_VARIANT_COUNT_QUERY, { ids })
    for (const n of data.nodes) {
      if (!n) continue
      const total = n.variantsCount?.count ?? 0
      if (wanted.get(n.id) >= total) {
        blocked.push({ productId: n.id, productTitle: n.title, total, selected: wanted.get(n.id) })
      }
    }
  }
  return blocked
}

/**
 * Delete variants, grouped by product.
 *
 * Mirrors applyVariantPrices: one call per product, sequential, and a partial
 * failure is reported rather than thrown so the caller can still record what
 * did go. A batch that half-applied still needs its half to be restorable.
 */
export async function deleteVariants(deletions) {
  const byProduct = new Map()
  for (const d of deletions) {
    if (!byProduct.has(d.productId)) byProduct.set(d.productId, [])
    byProduct.get(d.productId).push(d)
  }

  const deleted = []
  const failures = []

  for (const [productId, group] of byProduct) {
    try {
      const data = await shopifyGraphql(BULK_DELETE, {
        productId,
        variantsIds: group.map(d => d.variantId),
      })
      const result = data.productVariantsBulkDelete
      if (result.userErrors?.length) {
        failures.push({ productId, message: result.userErrors.map(e => e.message).join('; ') })
        continue
      }
      deleted.push(...group)
    } catch (error) {
      failures.push({ productId, message: error.message })
    }
  }

  return { deleted, failures }
}

/** file key -> media id, for each of the given products. */
async function mediaIdsByFile(productIds) {
  const map = new Map()
  for (const ids of chunk(productIds, 50)) {
    const data = await shopifyGraphql(PRODUCT_MEDIA_QUERY, { ids })
    for (const n of data.nodes) {
      if (!n) continue
      const inner = new Map()
      for (const m of n.media.nodes) {
        const key = fileKey(m.image?.url)
        if (key) inner.set(key, m.id)
      }
      map.set(n.id, inner)
    }
  }
  return map
}

/**
 * Recreate variants from snapshots taken before they were deleted.
 *
 * Option values that no longer exist on the product (deleting every 24x36
 * variant takes "24x36" off the Size option with it) are re-added by Shopify
 * as a side effect of creating a variant that uses them, so the option comes
 * back on its own.
 *
 * The one thing this cannot restore is identity: recreated variants get new
 * ids. Anything holding an old variant id — a saved cart, a draft order, a
 * hardcoded id in the theme — will not resolve to the restored variant.
 */
export async function recreateVariants(snapshots) {
  const byProduct = new Map()
  for (const s of snapshots) {
    if (!byProduct.has(s.productId)) byProduct.set(s.productId, [])
    byProduct.get(s.productId).push(s)
  }

  const media = await mediaIdsByFile([...byProduct.keys()])
  const created = []
  const failures = []

  for (const [productId, group] of byProduct) {
    const forProduct = media.get(productId) || new Map()
    try {
      const data = await shopifyGraphql(BULK_CREATE, {
        productId,
        variants: group.map(s => {
          const input = {
            optionValues: s.optionValues,
            price: String(s.price),
            taxable: s.taxable ?? true,
            inventoryPolicy: s.inventoryPolicy || 'CONTINUE',
            inventoryItem: {
              sku: s.sku || null,
              tracked: s.tracked ?? false,
              requiresShipping: s.requiresShipping ?? true,
            },
          }
          if (s.compareAtPrice) input.compareAtPrice = String(s.compareAtPrice)
          if (s.barcode) input.barcode = s.barcode
          if (s.weight != null && s.weightUnit) {
            input.inventoryItem.measurement = {
              weight: { value: s.weight, unit: s.weightUnit },
            }
          }
          const mediaId = forProduct.get(fileKey(s.imageUrl))
          if (mediaId) input.mediaId = mediaId
          return input
        }),
      })
      const result = data.productVariantsBulkCreate
      if (result.userErrors?.length) {
        failures.push({ productId, message: result.userErrors.map(e => e.message).join('; ') })
        continue
      }
      created.push(...result.productVariants.map(v => ({ productId, variantId: v.id, title: v.title })))
    } catch (error) {
      failures.push({ productId, message: error.message })
    }
  }

  return { created, failures }
}

// ---------------------------------------------------------------------------
// Product-level catalog sync
// ---------------------------------------------------------------------------

/**
 * Product-level fields, as opposed to CATALOG_QUERY above which flattens down
 * to variants for the price editor. `templateSuffix` is here because it tells
 * us which PDP template a product uses, which is how we know whether the
 * personalization wizard is on it.
 */
const PRODUCT_QUERY = `
  query Products($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        legacyResourceId
        title
        handle
        status
        templateSuffix
        tags
        featuredImage { url }
      }
    }
  }
`

/** Every product in the store. */
export async function fetchProductCatalog() {
  const out = []
  let cursor = null
  while (true) {
    const data = await shopifyGraphql(PRODUCT_QUERY, { cursor })
    for (const p of data.products.nodes) {
      out.push({
        // Line items carry the numeric id, so that is what we key on.
        productId: String(p.legacyResourceId || p.id.split('/').pop()),
        handle: p.handle,
        title: p.title,
        status: p.status || null,
        templateSuffix: p.templateSuffix || null,
        featuredImage: p.featuredImage?.url || null,
        tags: p.tags || [],
      })
    }
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
  }
  return out
}

/**
 * Sync Shopify into the ShopifyProduct table and resolve each product to a
 * canonical race.
 *
 * Resolution deliberately reuses the SAME chain the storefront lookup uses
 * (parseRaceNameFromTitle then getCanonicalRaceName) rather than inventing a
 * second matcher. A product that resolves differently here than it does at
 * lookup time would be worse than no coverage data at all, because it would
 * report a race as covered while shoppers on that page get nothing.
 */
export async function syncProductCatalog() {
  const [{ default: prisma }, norm, scrapers] = await Promise.all([
    import('../../api/_lib/prisma.js'),
    import('../scrapers/raceNameNormalization.js'),
    import('../scrapers/index.js'),
  ])

  const products = await fetchProductCatalog()

  for (const p of products) {
    const parsed = norm.parseRaceNameFromTitle(p.title) || p.title
    const raceCanonical = scrapers.getCanonicalRaceName(parsed)
    const row = { ...p, tags: p.tags, raceCanonical: raceCanonical || null }
    await prisma.shopifyProduct.upsert({
      where: { productId: p.productId },
      create: row,
      update: row,
    })
  }

  // Products deleted from Shopify should stop counting as gaps here. An empty
  // catalog is never real (it is a scope or API problem), and `notIn: []`
  // would match every row, so refuse rather than wipe the table.
  const seen = products.map(p => p.productId)
  if (!seen.length) throw new Error('Shopify returned no products; refusing to sync the catalog')
  const removed = await prisma.shopifyProduct.deleteMany({
    where: { productId: { notIn: seen } },
  })

  return { synced: products.length, removed: removed.count }
}
