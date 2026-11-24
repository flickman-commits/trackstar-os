/**
 * A co-branded file can hold every distance as an artboard of its own
 * ("AHA_Philadelphia Marathon 8x10", "AHA_Philadelphia Half Marathon 8x10",
 * "AHA_Philadelphia 8K 8x10"). Which artboard prints which event.
 */
import { eventPart } from './spec.js'

const eventIn = name => /half/i.test(name) ? 'Half Marathon' : (/\b(\d+(?:\.\d+)?)\s*k\b/i.exec(name)?.[0].replace(/\s+/g, '').toUpperCase() || (/\b(\d+)[\s-]*mile/i.exec(name)?.[1] ? `${/\b(\d+)[\s-]*mile/i.exec(name)[1]} Miler` : null))

/**
 * @param names  the artboards of the run's one size
 * @returns [{ event: null | 'Half Marathon' | '8K', artboard }], or null when
 * the names do not say (two for one distance, or a rule that would fit two).
 */
export function boardsByEvent(raceName, names) {
  if (!Array.isArray(names) || names.length < 2) return null
  const list = names.map(n => ({ event: eventPart(raceName, eventIn(String(n).replace(/_/g, ' '))), artboard: String(n) }))
  if (new Set(list.map(b => b.event)).size !== list.length) return null
  // The main event's artboard must be there: its row is the upload itself.
  if (!list.some(b => b.event === null)) return null
  const fits = b => list.filter(o => o.artboard.toLowerCase().includes(b.artboard.toLowerCase())).length === 1
  return list.every(fits) ? list : null
}
