/**
 * Design switches: a race's print design changed on a date, and everyone who
 * bought before it gets the design they bought.
 *
 * 2026-11-11: "Marathon" comes off the Philadelphia and NYC prints. (Chicago
 * keeps its design: it was planned, then dropped the same morning.)
 * Orders placed before 11:00 AM ET that day print the old design; orders
 * after print the new one.
 *
 * How it prints: each switched design has two production files in the race's
 * folder, registered under Settings > Designs as
 *   "<key>"              the new design (orders placed after the switch)
 *   "<key> / Original"   the old design (orders placed before it)
 * An order from before the switch always renders from "/ Original". If that
 * file is missing or not yet checked, the order waits ("No prepared
 * template"); it never falls back to the new design.
 *
 * Which time counts: when the customer bought (Shopify's created_at), not
 * when we imported the order. Etsy orders all predate the switch (the Etsy
 * listings came down on 2026-11-10).
 *
 * To move the switch time (the new designs went live later than planned),
 * change `at` and deploy. To switch another race, add an entry.
 */
export const ORIGINAL = 'Original'

/*
 * race       the race's standard name: orders of it bought before `at` get the
 *            "USE OLD DESIGN" note
 * keys       the production files that switch. Empty: the note only, because
 *            the main file is still the old design (no "OLD" file in the folder
 *            yet). Add the keys, and register their "/ Original" files, the
 *            moment the new file goes in.
 * at         when the new design went on sale
 * newFileAt  when the main file became the new design, if before `at`. A
 *            design rendered from the main file before then is the old design;
 *            from then on it is the new one, so an old order's print made from
 *            it is re-rendered from the old file.
 *
 * In the race folder the old file carries "OLD" in its name
 * ("Philadelphia Marathon_Production OLD.ai").
 */
export const DESIGN_SWITCHES = [
  {
    race: 'Philadelphia Marathon',
    keys: ['Philadelphia Marathon', 'Philadelphia Marathon / Half Marathon'],
    at: '2026-11-11T16:00:00.000Z', // 11:00 AM ET
    // The OLD copies were made Nov 9 at 4:14 PM ET; the main files have been the new design since.
    newFileAt: '2026-11-09T21:14:00.000Z',
  },
  // The main file was the old design until the switch: its OLD copy was renamed in at 11:00.
  { race: 'NYC Marathon', keys: ['NYC Marathon'], at: '2026-11-11T16:00:00.000Z' },
]

export const OLD_DESIGN_NOTE = 'USE OLD DESIGN - THEY BOUGHT BEFORE WE SWITCHED'
export const NEW_DESIGN_NOTE = 'USE NEW DESIGN - THEY BOUGHT AFTER WE SWITCHED'

const byKey = new Map(DESIGN_SWITCHES.flatMap(s => s.keys.map(k => [k, s])))
const byRace = new Map(DESIGN_SWITCHES.map(s => [s.race, s]))

/** The switch a production file key belongs to, or null. */
export function switchForKey(key) {
  return byKey.get(String(key || '')) || null
}

/** When the customer bought: Shopify's own time, else when the order came in. */
export function placedAt(order) {
  const shop = order?.shopifyOrderData?.created_at
  if (shop) {
    const d = new Date(shop)
    if (!Number.isNaN(d.getTime())) return d
  }
  const etsy = Number(order?.etsyOrderData?.create_timestamp || order?.etsyOrderData?.created_timestamp)
  if (etsy) return new Date(etsy * 1000)
  return order?.createdAt ? new Date(order.createdAt) : null
}

/** Did this order buy before `at`? An order we cannot date counts as before (it is old). */
function boughtBefore(order, at) {
  // Set by hand on the order (7950: a creator's NYC print on the new design).
  if (order?.designChoice === 'new') return false
  if (order?.designChoice === 'old') return true
  if (order?.source === 'etsy') return true
  const p = placedAt(order)
  return !p || p.getTime() < new Date(at).getTime()
}

/** The old-design key for this order and production file key, or null when it gets the file as is. */
export function originalKeyFor(order, key) {
  const s = switchForKey(key)
  return s && boughtBefore(order, s.at) ? `${key} / ${ORIGINAL}` : null
}

/**
 * Should the person handling this order use the old design? By race (its
 * standard name), for the banner and tag on the order.
 * @param canonicalRace the order's race, as getCanonicalRaceName gives it
 */
export function usesOldDesign(order, canonicalRace) {
  if (order?.trackstarOrderType && order.trackstarOrderType !== 'standard') return false
  const s = byRace.get(String(canonicalRace || ''))
  return Boolean(s && boughtBefore(order, s.at))
}

/** The other side: bought after the switch, so the new design (races whose files switched). */
export function usesNewDesign(order, canonicalRace) {
  if (order?.trackstarOrderType && order.trackstarOrderType !== 'standard') return false
  const s = byRace.get(String(canonicalRace || ''))
  return Boolean(s && s.keys.length && !boughtBefore(order, s.at))
}

/**
 * The same design? A print made before the switch from "<key>" is the old
 * design, the same one "<key> / Original" prints, so an approved print from
 * before the switch still sends and is not re-rendered.
 * @param want      the template the order should print from now
 * @param made      the template the design was rendered from
 * @param renderedAt when that design was queued
 */
export function sameDesign(want, made, renderedAt) {
  if ((want ?? null) === (made ?? null)) return true
  const s = switchForKey(made)
  return Boolean(s && want === `${made} / ${ORIGINAL}` && renderedAt && new Date(renderedAt).getTime() < new Date(s.newFileAt || s.at).getTime())
}
