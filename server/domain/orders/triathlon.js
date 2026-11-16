/**
 * Standard triathlon prints. One design serves every triathlon, made by hand.
 * IRONMAN and IRONMAN 70.3 races have a scraper (IronmanScraper) that fills
 * the result, legs included; for every other triathlon, and any leg the
 * lookup could not fill, a person looks the athlete up on the race's results
 * site and enters what prints. The print shows the overall time and bib, and
 * for each leg its time and distance (Swim 00:40:15 / 1.5 mi), plus the race
 * date and weather like every other print.
 */

/** The leg fields a triathlon result holds, in print order. */
export const TRI_LEGS = ['swim', 'bike', 'run']
export const TRI_FIELDS = ['swimTime', 'swimDistance', 'bikeTime', 'bikeDistance', 'runTime', 'runDistance']

/** A standard order for a triathlon: by its product, or by a race name no marathon has. */
export function isTriathlon(order) {
  if (!order) return false
  const items = Array.isArray(order.shopifyOrderData?.line_items) ? order.shopifyOrderData.line_items : []
  const title = String(items[order.lineItemIndex]?.title || '')
  const race = String(order.raceNameOverride ?? order.raceName ?? '')
  return /triathlon/i.test(title) || /triathlon|ironman|iron\s*man|70\.3/i.test(race)
}

/** What a triathlon result still needs before it can print, as field labels. */
export function triathlonMissing(research) {
  const missing = []
  if (!research?.bibNumber) missing.push('bib')
  if (!research?.officialTime) missing.push('overall time')
  for (const leg of TRI_LEGS) {
    if (!research?.[`${leg}Time`]) missing.push(`${leg} time`)
    if (!research?.[`${leg}Distance`]) missing.push(`${leg} distance`)
  }
  return missing
}
