/**
 * Race rows for the distances of a race weekend that run on their own day.
 *
 * A Race row is one race and year: one date, one weather. Philadelphia runs
 * its half and 8K on the Saturday and the marathon on the Sunday, so a half
 * print read the marathon's row and printed Sunday's date and weather (2026,
 * 18 half renders at 11.22.26). A distance the race config lists under
 * `eventDates` now has its own row, named like its design file,
 * "Philadelphia Marathon / Half Marathon", with its own verified date and
 * computed weather. Research rows keep pointing at the race's main row; every
 * reader that prints a date or weather goes through raceForEvent with the
 * runner's distance. A race whose distances all run the same day is untouched.
 */
import prisma from '../../db.js'
import { separateDayEvents } from '../../scrapers/index.js'
import { eventRaceName } from './eventRaceName.js'
import { setRaceDate, computeRaceWeather, weatherWindowClosed } from './verification.js'

export { eventRaceName }

/**
 * The Race row a print reads its date and weather from: the distance's own
 * row when it runs on another day, else `race`. `lookup(name, year)` returns
 * a loaded row or null. A distance whose row does not exist yet gets an empty
 * stand-in with no date, so the print waits instead of borrowing the main
 * event's day.
 */
export function raceForEvent(race, eventType, lookup) {
  if (!race) return race
  const name = eventRaceName(race.raceName, race.year, eventType)
  if (!name) return race
  return lookup(name, race.year) || { id: null, raceName: name, year: race.year, raceDate: null, location: race.location || null, missing: true }
}

/**
 * Create the event rows a race year needs, each with its pinned date (through
 * setRaceDate, the one path that writes a date) and, once the race-morning
 * window has closed, its computed weather. Rows that exist are left alone.
 * Returns the event rows.
 */
export async function ensureEventRaceRows(raceName, year, { mainRace = null } = {}) {
  const events = separateDayEvents(raceName, year)
  if (!events.length) return []
  const out = []
  for (const ev of events) {
    const name = `${ev.raceName} / ${ev.label}`
    let row = await prisma.race.findUnique({ where: { raceName_year: { raceName: name, year } } })
    if (!row) {
      try {
        row = await prisma.race.create({
          data: {
            raceName: name, year, raceDate: null, eventTypes: [ev.label],
            location: mainRace?.location || ev.location || null,
            resultsUrl: mainRace?.resultsUrl || null, resultsSiteType: mainRace?.resultsSiteType || null,
          },
        })
      } catch (err) {
        // Two writers at once: the other one made it.
        row = await prisma.race.findUnique({ where: { raceName_year: { raceName: name, year } } })
        if (!row) throw err
      }
    }
    if (!row.raceDate) {
      row = await setRaceDate({ raceId: row.id, date: ev.date, source: 'config', sourceUrl: ev.url || undefined, evidence: ev.evidence || `${name} ${year}: ${ev.date}, pinned in the race config`, by: 'config' })
    }
    if (!row.weatherTemp && row.location && weatherWindowClosed(row.raceDate)) {
      try { row = await computeRaceWeather(row.id, { by: 'system' }) } catch (err) { console.warn(`[eventRaces] weather for ${name} ${year}: ${err.message}`) }
    }
    out.push(row)
  }
  return out
}
