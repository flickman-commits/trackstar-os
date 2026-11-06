/**
 * A race year's print data (date and weather), and the two human checks on
 * it: confirming a suggested date against its sources and confirming the
 * calculated weather. Each confirm answers with the value it confirmed and
 * where that value came from, so the caller saw what they put their name to.
 * Any signed-in person may confirm, the same as the order view
 * (api/_routes/races/confirm-weather.js).
 */
import { z } from 'zod'
import prisma from '../../../../api/_lib/prisma.js'
import { ToolError } from '../server.js'
import { printBlockers, dateVerified, confirmWeather, confirmRaceDate } from '../../../domain/races/verification.js'

const day = d => (d ? new Date(d).toISOString().slice(0, 10) : null)

async function findRace({ raceId, race, year }) {
  if (raceId) {
    const r = await prisma.race.findUnique({ where: { id: raceId } })
    if (!r) throw new ToolError(`No race with id ${raceId}.`)
    return r
  }
  if (!race || !year) throw new ToolError('Give a raceId, or a race name and a year.')
  const hits = await prisma.race.findMany({ where: { year, raceName: { contains: race.trim(), mode: 'insensitive' } }, take: 6 })
  if (!hits.length) throw new ToolError(`No race year matching "${race}" ${year}.`)
  const exact = hits.find(h => h.raceName.toLowerCase() === race.trim().toLowerCase())
  if (exact) return exact
  if (hits.length > 1) throw new ToolError(`More than one race matches: ${hits.map(h => `${h.raceName} (id ${h.id})`).join(', ')}. Use the raceId.`)
  return hits[0]
}

function dateShape(r) {
  return {
    date: day(r.raceDate),
    source: r.raceDateSource || null,
    sourceUrl: r.raceDateSourceUrl || null,
    evidence: r.raceDateEvidence || null,
    verified: dateVerified(r),
    confirmedBy: r.raceDateConfirmedByPerson || null,
    verifiedBy: r.raceDateVerifiedBy || null,
    verifiedAt: r.raceDateVerifiedAt || null,
  }
}

function weatherShape(r) {
  const has = Boolean(r.weatherTemp && r.weatherCondition)
  return {
    condition: r.weatherCondition || null,
    temp: r.weatherTemp || null,
    source: has ? `calculated: average of 7am to 1pm at ${r.location || 'the race location'} on ${day(r.raceDate) || 'the race date'}` : null,
    calculatedAt: r.weatherFetchedAt || null,
    status: !has ? 'not calculated' : r.weatherConfirmedAt ? 'confirmed' : 'calculated, not confirmed',
    confirmedBy: r.weatherConfirmedBy || null,
    confirmedAt: r.weatherConfirmedAt || null,
  }
}

const WHICH = {
  raceId: z.number().int().optional().describe('The Race row id (race_data_blockers lists them).'),
  race: z.string().max(80).optional().describe('A race name, with year, instead of raceId.'),
  year: z.number().int().min(1990).max(2100).optional(),
}

export const raceTools = [
  {
    name: 'race_year_status',
    title: 'Race year status',
    description: 'One race year\'s print data: the date with its source and whether it is confirmed, the weather and temp with whether it is calculated or confirmed and by whom, and what still stops it printing.',
    scope: 'read',
    readOnly: true,
    input: WHICH,
    async handler(args) {
      const r = await findRace(args)
      const openOrders = await prisma.order.count({ where: { trackstarOrderType: 'standard', status: { not: 'completed' }, OR: [{ raceName: r.raceName, raceYear: r.year, yearOverride: null, raceNameOverride: null }, { raceNameOverride: r.raceName, yearOverride: r.year }, { raceName: r.raceName, yearOverride: r.year, raceNameOverride: null }, { raceNameOverride: r.raceName, raceYear: r.year, yearOverride: null }] } })
      return {
        raceId: r.id, race: r.raceName, year: r.year, location: r.location || null,
        date: dateShape(r), weather: weatherShape(r),
        printedSince: r.firstPrintedAt || null,
        blockers: printBlockers(r),
        openOrders,
      }
    },
  },
  {
    name: 'confirm_race_date',
    title: 'Confirm race date',
    description: 'Confirm a race year\'s suggested date after checking it against its sources. Answers with the date and source confirmed. Confirms it for every order of that race year.',
    scope: 'write',
    readOnly: false,
    input: WHICH,
    async handler(args, { principal }) {
      const r = await findRace(args)
      if (!r.raceDate) throw new ToolError(`${r.raceName} ${r.year} has no date to confirm.`)
      if (!r.raceDateSourceUrl && !r.raceDateEvidence) throw new ToolError(`${r.raceName} ${r.year} has no source on file to confirm the date against. Use verify_race_date with a source.`)
      const updated = await confirmRaceDate({ raceId: r.id, user: principal.user })
      const d = dateShape(updated)
      return { summary: `${r.raceName} ${r.year}: confirmed race date ${d.date} (${d.source || 'no source type'}${d.sourceUrl ? `, ${d.sourceUrl}` : ''})`, raceId: r.id, race: r.raceName, year: r.year, confirmed: d, blockers: printBlockers(updated) }
    },
  },
  {
    name: 'confirm_weather',
    title: 'Confirm weather',
    description: 'Confirm a race year\'s calculated weather after checking it. Answers with the weather and temp confirmed and how they were calculated. Confirms it for every order of that race year.',
    scope: 'write',
    readOnly: false,
    input: WHICH,
    async handler(args, { principal }) {
      const r = await findRace(args)
      if (!r.weatherTemp || !r.weatherCondition) throw new ToolError(`${r.raceName} ${r.year} has no weather to confirm yet.`)
      if (r.raceDate && r.raceDate.getTime() > Date.now()) throw new ToolError(`${r.raceName} ${r.year} has not happened yet.`)
      const updated = await confirmWeather({ raceId: r.id, user: principal.user })
      const w = weatherShape(updated)
      return { summary: `${r.raceName} ${r.year}: confirmed weather ${w.condition} ${w.temp} (${w.source})`, raceId: r.id, race: r.raceName, year: r.year, confirmed: w, date: dateShape(updated), blockers: printBlockers(updated) }
    },
  },
]
