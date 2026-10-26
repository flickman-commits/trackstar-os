/**
 * Whether a race year's data is fit to print, and the one way to change it.
 *
 * Every value that reaches a print carries where it came from and the
 * evidence. A race date is verified when its source is a person, a pinned
 * config entry, or the nightly routine's research, and a link to the
 * evidence is on the row. Weather is computed, on purpose: there is no one
 * accurate source for race-morning weather, so the tool averages the hours
 * from 7am to 1pm at the race's location (WeatherService) and keeps the
 * breakdown so anyone can see how it got the number. Weather is fit to
 * print when it was computed for the verified date.
 *
 * Once a print made from a race year has been approved, the year is locked:
 * changing its date or weather needs a reason, is written to the Activity
 * Log. Renders made with the old values are not flagged: by the time a
 * value changes, those prints have almost always gone out.
 */
import prisma from '../../db.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { WeatherService } from '../../services/WeatherService.js'

export const VERIFIED_SOURCES = ['config', 'manual', 'researched']

export function dateVerified(race) {
  if (!race?.raceDate || !race.raceDateVerifiedAt) return false
  // A suggested date (scraped off a results page) counts once a person confirms it.
  if (!VERIFIED_SOURCES.includes(race.raceDateSource) && !race.raceDateConfirmedByPerson) return false
  // A link is the evidence; a config pin's citation (the prose in the scraper config) counts too.
  return Boolean(race.raceDateSourceUrl || race.raceDateEvidence)
}

/**
 * Weather is fit to print when it exists for a verified date. setRaceDate
 * clears the weather whenever the date changes, so weather on a row is
 * always the current date's weather.
 */
export function weatherReady(race) {
  return Boolean(race?.weatherTemp && race?.weatherCondition && dateVerified(race) && race?.weatherConfirmedAt)
}

/** The reasons a race year cannot print yet, in plain words. Empty means it can. */
export function printBlockers(race) {
  const out = []
  if (!race) return ['Race not found']
  if (!race.raceDate) out.push('Race has no date')
  else if (!dateVerified(race)) out.push(race.raceDateSourceUrl || race.raceDateEvidence ? 'Race date is suggested but not verified yet (confirm it against its sources)' : 'Race date is not verified (no source on file)')
  else if (new Date(race.raceDate).getTime() > Date.now()) out.push('Race has not happened yet')
  if (!race.location) out.push('Race has no location, so weather cannot be computed')
  if (!race.weatherTemp || !race.weatherCondition) { if (race.raceDate && new Date(race.raceDate).getTime() <= Date.now()) out.push('Weather has not been computed') }
  else if (!race.weatherConfirmedAt) out.push('Weather is calculated but not confirmed yet')
  return out
}

/**
 * Set or confirm a race date with its evidence. The only path that writes a
 * date. `by` is a user id or a system name ("config", "nightly").
 */
export async function setRaceDate({ raceId, date, source = 'manual', sourceUrl, evidence, by, reason, actor = null }) {
  const race = await prisma.race.findUnique({ where: { id: Number(raceId) } })
  if (!race) throw new Error('Race not found')
  if (!VERIFIED_SOURCES.includes(source)) throw new Error(`Source must be one of ${VERIFIED_SOURCES.join(', ')}`)
  const url = String(sourceUrl || '').trim()
  if (url && !/^https?:\/\//.test(url)) throw new Error('The source should be a link (https://...)')
  if (!url && !String(evidence || '').trim()) throw new Error('A verified date needs a link to where it was confirmed')
  const d = date instanceof Date ? date : new Date(`${String(date).slice(0, 10)}T12:00:00Z`)
  if (isNaN(d.getTime())) throw new Error('Not a date')

  const changed = !race.raceDate || race.raceDate.toISOString().slice(0, 10) !== d.toISOString().slice(0, 10)
  if (changed && race.firstPrintedAt && !String(reason || '').trim()) {
    throw new Error(`${race.raceName} ${race.year} has already been printed with ${race.raceDate?.toISOString().slice(0, 10)}. Changing the date needs a reason.`)
  }

  const data = {
    raceDate: d, raceDateSource: source, raceDateSourceUrl: url || null,
    raceDateEvidence: evidence ? String(evidence).slice(0, 1000) : race.raceDateEvidence,
    raceDateVerifiedAt: new Date(), raceDateVerifiedBy: String(by || 'unknown').slice(0, 80),
    raceDateConfirmedByPerson: null,
  }
  // A new date makes the old weather wrong. It is recomputed for the new date by the next research run.
  if (changed) Object.assign(data, { weatherTemp: null, weatherCondition: null, weatherDetails: null, weatherFetchedAt: null, weatherConfirmedAt: null, weatherConfirmedBy: null })
  const updated = await prisma.race.update({ where: { id: race.id }, data })

  if (changed) {
    await recordAudit({
      action: 'race.date',
      summary: `${race.raceName} ${race.year}: date ${race.raceDate ? race.raceDate.toISOString().slice(0, 10) : 'none'} -> ${d.toISOString().slice(0, 10)} (${source}${reason ? `; ${reason}` : ''})`,
      detail: { raceId: race.id, sourceUrl: url, evidence, reason, printed: Boolean(race.firstPrintedAt) },
      actor: actor || { id: null, email: String(by || 'system'), name: String(by || 'system') },
    })
  }
  return updated
}

/** Weather was recomputed. Same lock rule: after a print, a change needs a reason. */
export async function noteWeatherChange({ raceId, before, after, by, reason, actor = null }) {
  const race = await prisma.race.findUnique({ where: { id: Number(raceId) } })
  if (!race) return 0
  const same = before?.weatherTemp === after?.weatherTemp && before?.weatherCondition === after?.weatherCondition
  if (same) return 0
  if (race.firstPrintedAt && !String(reason || '').trim()) throw new Error(`${race.raceName} ${race.year} has already been printed with ${before?.weatherCondition} ${before?.weatherTemp}. Changing the weather needs a reason.`)
  await recordAudit({
    action: 'race.weather',
    summary: `${race.raceName} ${race.year}: weather ${before?.weatherCondition || '-'} ${before?.weatherTemp || '-'} -> ${after?.weatherCondition} ${after?.weatherTemp}${reason ? ` (${reason})` : ''}`,
    detail: { raceId: race.id, before, after, reason, printed: Boolean(race.firstPrintedAt) },
    actor: actor || { id: null, email: String(by || 'system'), name: String(by || 'system') },
  })
  return 1
}

/**
 * Compute weather for a race year from its verified date and location: the
 * average of 7am to 1pm local, with the hourly breakdown kept so anyone can
 * see how the number was reached. Respects the print lock.
 */
export async function computeRaceWeather(raceId, { by = 'system', reason, actor = null } = {}) {
  const race = await prisma.race.findUnique({ where: { id: Number(raceId) } })
  if (!race) throw new Error('Race not found')
  if (!dateVerified(race)) throw new Error('Verify the date before computing weather')
  if (!race.location) throw new Error('The race needs a location before weather can be computed')
  if (race.raceDate.getTime() > Date.now()) throw new Error('The race has not happened yet, so there is no weather to calculate')
  let previous = null; try { previous = race.weatherDetails ? JSON.parse(race.weatherDetails) : null } catch { previous = null }
  const result = await new WeatherService().calculateRaceWeather(race.raceDate.toISOString().slice(0, 10), race.location, previous)
  if (!result?.temp || !result?.condition) throw new Error(result?.error || 'Could not compute weather for that date and place')
  const before = { weatherTemp: race.weatherTemp, weatherCondition: race.weatherCondition }
  const after = { weatherTemp: result.temp, weatherCondition: result.condition }
  if (before.weatherTemp) await noteWeatherChange({ raceId: race.id, before, after, by, reason, actor })
  const changed = (before.weatherTemp || '') !== after.weatherTemp || String(before.weatherCondition || '').toLowerCase() !== String(after.weatherCondition).toLowerCase()
  return prisma.race.update({
    where: { id: race.id },
    data: { ...after, weatherFetchedAt: new Date(), weatherDetails: JSON.stringify(result.breakdown), ...(changed ? { weatherConfirmedAt: null, weatherConfirmedBy: null } : {}) },
  })
}

/** A print made from this race year was approved: lock the year. */
export async function markRacePrinted(raceId) {
  await prisma.race.updateMany({ where: { id: Number(raceId), firstPrintedAt: null }, data: { firstPrintedAt: new Date() } })
}

/**
 * The Settings view: every race year with open orders, verified or not,
 * blockers first. Also what the nightly routine reads to know what to go find.
 */
export async function verificationOverview() {
  const open = await prisma.order.findMany({
    where: { trackstarOrderType: 'standard', status: { notIn: ['completed'] } },
    select: { raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true },
  })
  const counts = {}
  for (const o of open) { const k = `${o.raceNameOverride ?? o.raceName}|${o.yearOverride ?? o.raceYear}`; counts[k] = (counts[k] || 0) + 1 }
  const races = await prisma.race.findMany({ orderBy: [{ year: 'desc' }, { raceName: 'asc' }] })
  const rows = races.map(r => {
    const blockers = printBlockers(r)
    return {
      id: r.id, raceName: r.raceName, year: r.year, raceDate: r.raceDate, raceDateSource: r.raceDateSource, raceDateSourceUrl: r.raceDateSourceUrl,
      raceDateEvidence: r.raceDateEvidence, raceDateVerifiedAt: r.raceDateVerifiedAt, raceDateVerifiedBy: r.raceDateVerifiedBy,
      location: r.location, weatherTemp: r.weatherTemp, weatherCondition: r.weatherCondition, weatherFetchedAt: r.weatherFetchedAt, weatherDetails: r.weatherDetails,
      firstPrintedAt: r.firstPrintedAt, openOrders: counts[`${r.raceName}|${r.year}`] || 0,
      dateVerified: dateVerified(r), weatherReady: weatherReady(r), blockers,
    }
  })
  const missing = Object.entries(counts).filter(([k]) => !races.some(r => `${r.raceName}|${r.year}` === k)).map(([k, n]) => { const [raceName, year] = k.split('|'); return { raceName, year: Number(year), openOrders: n } })
  return { races: rows, missingRaceRows: missing }
}

/** A person checked the calculated weather against the breakdown and confirms it for printing. */
/**
 * A person checked a race date against its sources and confirms it. The date
 * stays as it is. A date with no source on file (one a config set, say) is
 * confirmed with sourceUrl, the page the person checked it on, which is saved
 * as its source.
 */
export async function confirmRaceDate({ raceId, user, sourceUrl = null }) {
  const race = await prisma.race.findUnique({ where: { id: Number(raceId) } })
  if (!race) throw new Error('Race not found')
  if (!race.raceDate) throw new Error('There is no date to confirm')
  let link = null
  if (sourceUrl) {
    try { link = new URL(String(sourceUrl).trim()) } catch { /* checked below */ }
    if (!link || !/^https?:$/.test(link.protocol)) throw new Error('That is not a link. Paste the page that shows the race date.')
  }
  if (!link && !race.raceDateSourceUrl && !race.raceDateEvidence) throw new Error('There is no source on file to confirm against. Add a link to the page that shows the date.')
  const by = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'unknown'
  const updated = await prisma.race.update({ where: { id: race.id }, data: { raceDateVerifiedAt: new Date(), raceDateVerifiedBy: user?.id || by, raceDateConfirmedByPerson: by, ...(link ? { raceDateSourceUrl: link.toString() } : {}) } })
  await recordAudit({ action: 'race.date-confirm', summary: `${race.raceName} ${race.year}: confirmed race date ${race.raceDate.toISOString().slice(0, 10)}`, detail: { raceId: race.id }, actor: user })
  return updated
}

export async function confirmWeather({ raceId, user }) {
  const race = await prisma.race.findUnique({ where: { id: Number(raceId) } })
  if (!race) throw new Error('Race not found')
  if (!race.weatherTemp || !race.weatherCondition) throw new Error('There is no weather to confirm')
  if (race.raceDate && race.raceDate.getTime() > Date.now()) throw new Error('The race has not happened yet')
  const by = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : 'unknown'
  const updated = await prisma.race.update({ where: { id: race.id }, data: { weatherConfirmedAt: new Date(), weatherConfirmedBy: by } })
  await recordAudit({ action: 'race.weather-confirm', summary: `${race.raceName} ${race.year}: confirmed weather ${race.weatherCondition} ${race.weatherTemp}`, detail: { raceId: race.id }, actor: user })
  return updated
}
