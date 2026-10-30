/**
 * Yotpo review request links, one per product, for the server (support
 * drafts). The list is server/lib/reviewLinks.json, which the app reads too
 * (src/lib/reviewLinks.ts); add a race there.
 */
import { createRequire } from 'node:module'

const products = createRequire(import.meta.url)('./reviewLinks.json')
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The review link for a race; custom orders use the Custom link. Null when the race has none yet. */
export function reviewLinkFor(race, type) {
  if (type === 'custom') return products.find(p => p.name === 'Custom') || null
  const r = norm(race)
  if (!r) return null
  return products.find(p => norm(p.name) === r)
    || products.find(p => p.name !== 'Custom' && (norm(p.name).includes(r) || r.includes(norm(p.name))))
    || null
}
