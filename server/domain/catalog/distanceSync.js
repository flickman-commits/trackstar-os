/**
 * Publishes each listing's distances to Shopify, so the storefront can show
 * them without calling us. Two product metafields, both lists:
 *   trackstar.distances       ["Full Marathon", "Half Marathon"]: every design
 *                             the listing has. The wizard reads it.
 *   trackstar.distance_pills  ["Full", "Half"]: the tags on race cards and the
 *                             listing page. Empty for a one-event race.
 *
 * The design list decides (designs.js); this only writes what changed. Runs
 * with the catalog sync (nightly, and the sync_catalog tool), so a design
 * added or switched off shows on the storefront by the next sync. The
 * wizard's own check at lookup time reads the design list live.
 */
import prisma from '../../db.js'
import { shopifyGraphql } from '../../services/shopifyProducts.js'
import { listingDistances, listingPills, DISTANCES_NAMESPACE, DISTANCES_KEY, PILLS_KEY } from './designs.js'

/** Template keys the pipeline can render from: enabled, and the last check passed. */
export async function readyTemplateKeys() {
  const rows = await prisma.printTemplate.findMany({ where: { enabled: true, lastCheckOk: true }, select: { key: true } })
  return new Set(rows.map(r => r.key))
}

const TTL = 5 * 60 * 1000
let cache = null
/** The same set, held for five minutes per instance: the public lookup asks on every search. */
export async function cachedReadyTemplateKeys() {
  if (cache && Date.now() - cache.at < TTL) return cache.keys
  cache = { at: Date.now(), keys: await readyTemplateKeys() }
  return cache.keys
}

const LISTINGS_QUERY = `
  query Listings($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title status
        distances: metafield(namespace: "${DISTANCES_NAMESPACE}", key: "${DISTANCES_KEY}") { value }
        pills: metafield(namespace: "${DISTANCES_NAMESPACE}", key: "${PILLS_KEY}") { value }
      }
    }
  }
`

function parseList(value) {
  try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v.map(String) : [] } catch { return [] }
}

/**
 * Bring every listing's distances metafield in line with the design list.
 * @returns {{ checked: number, changed: Array<{ handle: string, key: string, from: string[], to: string[] }> }}
 */
export async function syncListingDistances({ dryRun = false } = {}) {
  const keys = await readyTemplateKeys()
  // No ready designs at all is a broken read, not a fact: never wipe the storefront on it.
  if (!keys.size) throw new Error('The design list came back empty; refusing to sync distances')

  const listings = []
  let cursor = null
  for (;;) {
    const data = await shopifyGraphql(LISTINGS_QUERY, { cursor })
    listings.push(...data.products.nodes)
    if (!data.products.pageInfo.hasNextPage) break
    cursor = data.products.pageInfo.endCursor
  }

  const changed = []
  for (const p of listings) {
    if (p.status === 'ARCHIVED') continue
    for (const [key, from, to] of [
      [DISTANCES_KEY, parseList(p.distances?.value), listingDistances(p.title, keys)],
      [PILLS_KEY, parseList(p.pills?.value), listingPills(p.title, keys)],
    ]) {
      if (JSON.stringify(from) !== JSON.stringify(to)) changed.push({ id: p.id, handle: p.handle, key, from, to })
    }
  }

  if (!dryRun) {
    const sets = changed.filter(c => c.to.length)
    for (let i = 0; i < sets.length; i += 25) {
      const data = await shopifyGraphql(`mutation($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { userErrors { field message } } }`, {
        metafields: sets.slice(i, i + 25).map(c => ({ ownerId: c.id, namespace: DISTANCES_NAMESPACE, key: c.key, type: 'list.single_line_text_field', value: JSON.stringify(c.to) })),
      })
      const errors = data.metafieldsSet.userErrors
      if (errors.length) throw new Error(`Shopify would not save distances: ${errors.map(e => e.message).join('; ')}`)
    }
    // A listing that lost its last design: an empty list is not a value Shopify keeps, so remove it.
    const clears = changed.filter(c => !c.to.length)
    for (let i = 0; i < clears.length; i += 25) {
      const data = await shopifyGraphql(`mutation($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { userErrors { field message } } }`, {
        metafields: clears.slice(i, i + 25).map(c => ({ ownerId: c.id, namespace: DISTANCES_NAMESPACE, key: c.key })),
      })
      const errors = data.metafieldsDelete.userErrors
      if (errors.length) throw new Error(`Shopify would not clear distances: ${errors.map(e => e.message).join('; ')}`)
    }
  }
  return { checked: listings.length, changed: changed.map(({ handle, key, from, to }) => ({ handle, key, from, to })) }
}
