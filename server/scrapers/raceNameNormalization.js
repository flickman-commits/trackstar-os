/**
 * Race name normalization
 *
 * Maps "bare" race names (without "Marathon") to their canonical form so
 * scraper alias lookups continue to work after Shopify listing-title changes.
 *
 * Add a new entry here whenever a Shopify (or Etsy) listing title parses
 * to a name that doesn't match the scraper's canonical raceName / alias.
 */

const RACE_NAME_ALIASES = {
  // Shopify dropped "Marathon" from these listing titles (Apr 2026):
  Boston: 'Boston Marathon',
  Chicago: 'Chicago Marathon',

  // Future-proofing — currently parse correctly but cheap to be defensive:
  Eugene: 'Eugene Marathon',
  'Orange County': 'Orange County Marathon',

  // World Majors collection (May 2026) — listings titled
  // "Personalized {City} World Major Race Poster" parse to "{City} World Major Race"
  'New York City World Major Race': 'NYC Marathon',
  'London World Major Race': 'London Marathon',
  'Chicago World Major Race': 'Chicago Marathon',
  'Boston World Major Race': 'Boston Marathon',
  'Berlin World Major Race': 'Berlin Marathon',
  'Tokyo World Major Race': 'Tokyo Marathon',
  'Sydney World Major Race': 'Sydney Marathon',
}

// Listing-title decorations stripped before matching a title to a race.
// Longest first so "Personalized Race Print" wins over "Print".
const TITLE_SUFFIXES = ['Personalized Race Print', 'Race Print', 'Personalized Poster', 'Poster', 'Print']

/**
 * Parse a race name out of a Shopify/Etsy product title.
 *
 * Shared by order ingestion (server/processOrders.js,
 * api/orders/refresh-shopify-data.js) AND the public results-lookup widget,
 * so a product title resolves to the same canonical race name everywhere.
 *
 * Handles two title formats:
 *   Old: "Boston Marathon Personalized Race Print" → "Boston Marathon"
 *   New: "Personalized Boston Poster"              → "Boston Marathon" (via normalize)
 *        "Personalized Vermont City Marathon Poster" → "Vermont City Marathon"
 *
 * @param {string|null|undefined} productTitle
 * @returns {string|null} canonical race name, or null if input was empty
 */
export function parseRaceNameFromTitle(productTitle) {
  if (!productTitle) return null

  let raceName = productTitle.trim()

  // Strip leading "Personalized " prefix (new title format)
  raceName = raceName.replace(/^Personalized\s+/i, '').trim()

  // A listing that sells the half too says so in its title: "Eugene Marathon
  // (+ Half Marathon) Personalized Poster". The race is still the marathon's;
  // the event comes from the order, not the title.
  raceName = raceName.replace(/\s*\(\s*\+\s*half(\s+marathon)?\s*\)\s*/i, ' ').trim()

  for (const suffix of TITLE_SUFFIXES) {
    if (raceName.toLowerCase().endsWith(suffix.toLowerCase())) {
      raceName = raceName.slice(0, -suffix.length).trim()
      break
    }
  }

  // Map bare names ("Boston") to canonical ("Boston Marathon") for scraper lookup
  return normalizeRaceName(raceName) || null
}

/**
 * Parse a race name out of a Shopify product handle.
 *
 * Handles are lowercase, dash-separated slugs, e.g.
 *   "personalized-vermont-city-marathon-poster" → "Vermont City Marathon"
 * Converts dashes to spaces and delegates to parseRaceNameFromTitle, so the
 * storefront widget can resolve a product handle without a title round-trip.
 *
 * @param {string|null|undefined} handle
 * @returns {string|null} canonical race name, or null if input was empty
 */
export function parseRaceNameFromHandle(handle) {
  if (!handle) return null
  const title = String(handle).replace(/-+/g, ' ').trim()
  return parseRaceNameFromTitle(title)
}

/**
 * Normalize a race name to its canonical form. Idempotent on canonical names.
 *
 * @param {string|null|undefined} raceName
 * @returns {string|null} canonical race name, or null if input was empty
 */
export function normalizeRaceName(raceName) {
  if (!raceName) return null
  const trimmed = raceName.trim()
  if (!trimmed) return null

  // Exact match first
  if (RACE_NAME_ALIASES[trimmed]) return RACE_NAME_ALIASES[trimmed]

  // Case-insensitive match — preserves "Boston Marathon" capitalization
  // even if input was "boston" or "BOSTON"
  const lower = trimmed.toLowerCase()
  for (const [bare, canonical] of Object.entries(RACE_NAME_ALIASES)) {
    if (bare.toLowerCase() === lower) return canonical
  }

  return trimmed
}

export { RACE_NAME_ALIASES }
