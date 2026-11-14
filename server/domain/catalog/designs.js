/**
 * Which distances a listing can actually be printed in, read off the design
 * list (PrintTemplate, Settings > Designs). The design list is the one source
 * of truth: the storefront's distance pills, the "Designs available" line on
 * a listing and the wizard's "we do not have this design" stop all come from
 * here, never from a listing's title.
 *
 * A design counts only when it is enabled and its last check passed, which is
 * what the pipeline needs to render it (pipeline.js).
 *
 * Two readers:
 *   - listingDistances(title, keys): the labels for a listing, e.g.
 *     ["Full Marathon", "Half Marathon"]. Written to the product's
 *     trackstar.distances metafield by the catalog sync, for Liquid.
 *   - hasDesignFor(title, eventType, keys): does the design for the event a
 *     runner ran exist? Uses resolveTemplate, the same call the pipeline
 *     makes, so the wizard and the Action queue cannot disagree.
 */
import { parseRaceNameFromTitle } from '../../scrapers/raceNameNormalization.js'
import { getCanonicalRaceName, mainEventFor } from '../../scrapers/index.js'
import { resolveTemplate, eventLabel } from '../render/spec.js'

export const DISTANCES_NAMESPACE = 'trackstar'
export const DISTANCES_KEY = 'distances'

const isWorldMajors = title => /world\s*major/i.test(String(title || ''))
// Parts of a template key that name a design variant, not a distance.
const NOT_A_DISTANCE = part => /^(original|world majors)$/i.test(part) || /^BULK-/i.test(part)

/** How a distance reads to a shopper. "Marathon" is "Full Marathon" beside a half. */
export function distanceLabel(event) {
  const e = String(event || '').trim()
  if (!e) return null
  if (/half/i.test(e)) return 'Half Marathon'
  if (/^marathon$/i.test(e)) return 'Full Marathon'
  if (/ultra/i.test(e)) return 'Ultra Marathon'
  if (/10\s*mile|ten\s*mile/i.test(e)) return '10 Miler'
  const k = e.match(/^(\d+(?:\.\d+)?)\s*k$/i)
  if (k) return `${k[1]}K`
  return eventLabel(e)
}

/** The distance a race is named for, when no config says: "Army Ten Miler", "Marine Corps 17.75k". */
function distanceFromName(race) {
  const n = String(race || '')
  if (/half/i.test(n)) return 'Half Marathon'
  if (/ultra/i.test(n)) return 'Ultra Marathon'
  if (/10\s*mile|ten\s*mile/i.test(n)) return '10 Miler'
  const k = n.match(/(\d+(?:\.\d+)?)\s*k\b/i)
  if (k) return `${k[1]}K`
  if (/marathon/i.test(n)) return 'Full Marathon'
  return null
}

const ORDER = ['Ultra Marathon', 'Full Marathon', 'Half Marathon', '10 Miler']
const rank = l => { const i = ORDER.indexOf(l); return i === -1 ? ORDER.length : i }

/** The race a listing sells, as written and by its standard name. */
export function listingRace(title) {
  const parsed = parseRaceNameFromTitle(title) || String(title || '').trim()
  const canonical = getCanonicalRaceName(parsed) || parsed
  return { parsed, canonical, edition: isWorldMajors(title) ? 'World Majors' : null }
}

/**
 * The distance labels a listing has a ready design for.
 * @param {string} title the listing's title
 * @param {Iterable<string>} keys ready template keys
 */
export function listingDistances(title, keys) {
  const { parsed, canonical, edition } = listingRace(title)
  const races = new Set([parsed, canonical])
  const out = new Set()
  for (const key of keys) {
    const [race, ...parts] = String(key).split(' / ')
    if (!races.has(race)) continue
    if (parts.some(p => /^original$/i.test(p) || /^BULK-/i.test(p))) continue
    if (parts.some(p => /^world majors$/i.test(p)) !== Boolean(edition)) continue
    const event = parts.find(p => !NOT_A_DISTANCE(p)) || null
    const label = event ? distanceLabel(event) : (distanceLabel(mainEventFor(canonical)) || distanceFromName(canonical))
    if (label) out.add(label)
  }
  return [...out].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }))
}

/**
 * Is there a ready design for this event on this listing? Null when we
 * cannot say (no event), so a caller never blocks on a guess.
 */
export function hasDesignFor(title, eventType, keys) {
  if (!eventType) return null
  const set = keys instanceof Set ? keys : new Set(keys)
  if (!set.size) return null
  const { parsed } = listingRace(title)
  // The order a shopper would place: this listing, bought now.
  const order = { trackstarOrderType: 'standard', lineItemIndex: 0, createdAt: new Date(), shopifyOrderData: { line_items: [{ title: String(title || '') }] } }
  return set.has(resolveTemplate(order, parsed, eventType, k => set.has(k)))
}
