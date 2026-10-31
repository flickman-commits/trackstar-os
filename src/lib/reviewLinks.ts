/**
 * Yotpo review request links, one per product. Shared by the dashboard's
 * Request Reviews panel, the Support panel's review action and Claude's
 * support drafts (server/lib/reviewLinks.js), so a new race is added once.
 */
// The list lives in server/lib/reviewLinks.js so support drafts (server)
// read the same links; add a race there.
import { REVIEW_PRODUCTS } from '../../server/lib/reviewLinks.js'
export { REVIEW_PRODUCTS }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The review link for an order's race; custom orders use the Custom link. Null when the race has none yet. */
export function reviewLinkFor(race: string | null | undefined, type?: string | null): { name: string; link: string } | null {
  if (type === 'custom') return REVIEW_PRODUCTS.find(p => p.name === 'Custom') || null
  const r = norm(race || '')
  if (!r) return null
  return REVIEW_PRODUCTS.find(p => norm(p.name) === r)
    || REVIEW_PRODUCTS.find(p => p.name !== 'Custom' && (norm(p.name).includes(r) || r.includes(norm(p.name))))
    || null
}

/** The ask, in Matt's words. */
export function reviewAsk(link: string) {
  return `If you have 2 minutes, would you mind leaving us a review? It really helps us as a young brand. Link here: ${link}`
}
