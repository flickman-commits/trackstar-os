/**
 * Yotpo review request links, one per product: the one list, read by the
 * app (src/lib/reviewLinks.ts: the Request Reviews panel and the Support
 * review action) and by Claude's support drafts. Add a race here.
 *
 * Plain data in a JS module, not a JSON file: Vercel bundles what a server
 * function imports, and a JSON file read with require() was left out, which
 * crashed every Support function on Oct 31, 2026.
 */
export const REVIEW_PRODUCTS = [
  { name: "Air Force Marathon", link: "https://yotpo.com/go/eLj6ln1g" },
  { name: "Austin Marathon", link: "https://yotpo.com/go/eLj6ln1g" },
  { name: "Baltimore Marathon", link: "https://yotpo.com/go/eLj6ln1g" },
  { name: "Berlin Marathon", link: "https://yotpo.com/go/llWZcm1S" },
  { name: "Charlotte Marathon", link: "https://yotpo.com/go/37ERxS4X" },
  { name: "Chicago Marathon", link: "https://yotpo.com/go/mgtsCHbm" },
  { name: "CIM (California International Marathon)", link: "https://yotpo.com/go/llWZcm1S" },
  { name: "Cowtown Marathon", link: "https://yotpo.com/go/llWZcm1S" },
  { name: "Custom", link: "https://yotpo.com/go/nHef7FVS" },
  { name: "Dallas Marathon", link: "https://yotpo.com/go/ajHf1AG9" },
  { name: "Grandma's Marathon", link: "https://yotpo.com/go/naDPT01J" },
  { name: "Illinois Marathon", link: "https://yotpo.com/go/cXM5yNtH" },
  { name: "Jersey City Marathon", link: "https://yotpo.com/go/eDoEWm89" },
  { name: "Los Angeles Marathon", link: "https://yotpo.com/go/iBKm90pS" },
  { name: "Marine Corps Marathon", link: "https://yotpo.com/go/y3xVMKmD" },
  { name: "New York City Marathon", link: "https://yotpo.com/go/oRVzQUez" },
  { name: "Oakland Marathon", link: "https://yotpo.com/go/8IZybQzV" },
  { name: "Orange County Marathon", link: "https://yotpo.com/go/7lr2btIj" },
  { name: "Philadelphia Marathon", link: "https://yotpo.com/go/luOGA59H" },
  { name: "San Francisco Marathon", link: "https://yotpo.com/go/9Yq2KlYT" },
  { name: "Sydney Marathon", link: "https://yotpo.com/go/g2IWTHnl" },
  { name: "Tokyo Marathon", link: "https://yotpo.com/go/aj2ABnX7" },
  { name: "Twin Cities Marathon", link: "https://yotpo.com/go/A3v2ZhPB" },
]

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The review link for a race; custom orders use the Custom link. Null when the race has none yet. */
export function reviewLinkFor(race, type) {
  if (type === 'custom') return REVIEW_PRODUCTS.find(p => p.name === 'Custom') || null
  const r = norm(race)
  if (!r) return null
  return REVIEW_PRODUCTS.find(p => norm(p.name) === r)
    || REVIEW_PRODUCTS.find(p => p.name !== 'Custom' && (norm(p.name).includes(r) || r.includes(norm(p.name))))
    || null
}
