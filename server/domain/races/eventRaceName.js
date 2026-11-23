/**
 * The name of a distance's own Race row, when it runs on another day than the
 * race's main event (races/eventRaces.js). Pure: no database.
 */
import { separateDayEvents } from '../../scrapers/index.js'

/** "Half Marathon", "half", "HALF MARATHON" read the same; "8K", "8k" too. */
function sameEvent(a, b) {
  const norm = e => {
    const s = String(e || '').trim().toLowerCase()
    if (/half/.test(s)) return 'half marathon'
    return s.replace(/\s+/g, '')
  }
  return Boolean(a && b) && norm(a) === norm(b)
}

/** The event row's name for this distance, or null when it runs on the main event's day. */
export function eventRaceName(raceName, year, eventType) {
  if (!eventType) return null
  const ev = separateDayEvents(raceName, year).find(e => sameEvent(e.label, eventType))
  return ev ? `${ev.raceName} / ${ev.label}` : null
}

