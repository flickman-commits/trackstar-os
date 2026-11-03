/**
 * Is every print still hooked up to Artelo? Run every hour
 * (api/cron/fulfillment-check.js); pings Slack when a variant comes unhooked,
 * once, and again when it is back.
 *
 * Why: three times (2026-09-16, 10-12, 10-20) something switched a print
 * variant off at the "Artelo" location (Artelo's fulfillment service) while
 * leaving it on at "Artelo Kentucky Fulfillment", which is not a fulfillment
 * service. The variant stopped selling and nobody knew: Custom 12x18 Black Oak,
 * the best seller, sold nothing for three days. Who does it is not known yet
 * (not this app: it has no inventory scopes; Artelo is the likeliest writer).
 *
 * The check: every variant with a SKU on an active product must be active at
 * the Artelo location. That is the failure itself; the storefront does not
 * show it (a disconnected variant still reads available there). Reading
 * assignments needs read_inventory and read_locations on the Shopify app;
 * without them the run fails and says so, rather than passing as clean.
 * Variants with no SKU (Photo Add-On, gift cards, fees) are not prints and are
 * skipped. A variant sold elsewhere on purpose goes in IGNORE_SKUS.
 */
import prisma from '../../db.js'
import { shopifyGraphql } from '../../services/shopifyProducts.js'
import { clearTokenCache } from '../../services/shopifyAuth.js'
import { slackTo } from '../../lib/slack.js'

export const ARTELO_LOCATION_ID = 'gid://shopify/Location/110232568091'
const IGNORE_SKUS = new Set([])
const STATE_KEY = 'fulfillment_hookup_unhooked'

async function scopes() {
  const data = await shopifyGraphql(`{ currentAppInstallation { accessScopes { handle } } }`)
  return new Set(data.currentAppInstallation.accessScopes.map(s => s.handle))
}

/** Variants on active products that are not active at the Artelo location. */
async function exactCheck() {
  const out = []
  out.checked = 0
  let cursor = null
  for (;;) {
    const data = await shopifyGraphql(`query($cursor: String) {
      products(first: 25, after: $cursor, query: "status:active") {
        pageInfo { hasNextPage endCursor }
        nodes { title handle variants(first: 50) { nodes { id sku title inventoryItem { inventoryLevels(first: 10) { nodes { location { id name } } } } } } }
      }
    }`, { cursor })
    for (const p of data.products.nodes) {
      for (const v of p.variants.nodes) {
        if (!v.sku || IGNORE_SKUS.has(v.sku)) continue
        out.checked++
        const at = v.inventoryItem.inventoryLevels.nodes.map(l => l.location)
        if (at.some(l => l.id === ARTELO_LOCATION_ID)) continue
        out.push({ id: v.id, sku: v.sku, product: p.title, variant: v.title, handle: p.handle, detail: at.length ? `active only at ${at.map(l => l.name).join(', ')}` : 'not active at any location' })
      }
    }
    if (!data.products.pageInfo.hasNextPage) return out
    cursor = data.products.pageInfo.endCursor
  }
}

async function post(text) {
  if (!(await slackTo('alerts', text, { timeoutMs: 10000 }))) console.log('[fulfillment-hookup]', text)
}

/**
 * Look, compare with the last run, and ping on what changed.
 * @param {{ notify?: boolean }} [opts]  notify: false to look without posting (a dry run)
 */
export async function checkFulfillmentHookup({ notify = true } = {}) {
  let have = await scopes()
  // A token cached from before the scopes were granted does not carry them: get a new one once.
  if (!have.has('read_inventory') || !have.has('read_locations')) { clearTokenCache(); have = await scopes() }
  const missing = ['read_inventory', 'read_locations'].filter(s => !have.has(s))
  if (missing.length) throw new Error(`The Shopify app needs ${missing.join(' and ')} to check which location each variant is on`)
  const unhooked = await exactCheck()
  // Nothing looked at is a broken check, not a healthy catalog.
  if (!unhooked.checked) throw new Error('Fulfillment check found no print variants to check')

  const row = await prisma.systemConfig.findUnique({ where: { key: STATE_KEY } })
  let before = []
  try { before = JSON.parse(row?.value || '[]') } catch { before = [] }
  const beforeIds = new Set(before.map(v => v.id)), nowIds = new Set(unhooked.map(v => v.id))
  const fresh = unhooked.filter(v => !beforeIds.has(v.id))
  const back = before.filter(v => !nowIds.has(v.id))

  if (notify) {
    if (fresh.length) {
      const lines = fresh.slice(0, 15).map(v => `• ${v.product} · ${v.variant} (\`${v.sku}\`): ${v.detail}`)
      if (fresh.length > 15) lines.push(`• and ${fresh.length - 15} more`)
      const fix = 'In Shopify: the product > the variant > Inventory, turn the "Artelo" location back on. Leave Artelo Kentucky Fulfillment on and tracking off. Orders placed meanwhile went to Kentucky and never reached Artelo: check them.'
      await post(`:warning: *${fresh.length === 1 ? 'A print came' : `${fresh.length} prints came`} unhooked from Artelo* and will not sell until fixed:\n${lines.join('\n')}\n${fix}`)
    }
    if (back.length) {
      await post(`:white_check_mark: Hooked up to Artelo again: ${back.slice(0, 15).map(v => `${v.product} · ${v.variant}`).join('; ')}${back.length > 15 ? ` and ${back.length - 15} more` : ''}`)
    }
  }
  if (notify) {
    const value = JSON.stringify(unhooked.map(({ id, sku, product, variant }) => ({ id, sku, product, variant })))
    await prisma.systemConfig.upsert({ where: { key: STATE_KEY }, update: { value }, create: { key: STATE_KEY, value } })
  }
  return { checked: unhooked.checked, unhooked: unhooked.length, newlyUnhooked: fresh.length, reconnected: back.length, list: unhooked }
}
