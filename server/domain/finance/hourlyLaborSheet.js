/**
 * Hours -> the Daily Tracker's "Hourly Labor" tab (dailyTab.js): what the
 * hourly team's logged time cost on each day, and who. The roll-ups count it
 * as a fixed cost of the month the hours were worked.
 *
 * Every logged entry counts, whatever its week's state (draft, submitted,
 * approved): the time was worked either way, and a week sent back still gets
 * paid once it is fixed. An approved week is priced at the rate frozen on it;
 * any other at the person's current rate. A timer still running counts once it
 * stops. Someone with no hourly rate costs nothing here.
 */
import prisma from '../../db.js'
import { hoursText } from './timesheets.js'
import { syncDailyTab } from './dailyTab.js'

export const TAB = 'Hourly Labor'

const usd = cents => `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Entries (with their week's state and rate, and the person) -> { day: { cents, text } }. */
export function laborByDay(entries) {
  const days = {}
  for (const e of entries) {
    if (e.startedAt && !e.endedAt) continue
    const t = e.timesheet
    const rate = t.status === 'approved' && t.hourlyRateCents != null ? t.hourlyRateCents : t.user.hourlyRateCents
    if (!rate || !e.minutes) continue
    const who = t.user.firstName || 'Someone'
    const people = days[e.day] || (days[e.day] = new Map())
    const p = people.get(who) || { minutes: 0, cents: 0 }
    p.minutes += e.minutes
    p.cents += (e.minutes / 60) * rate
    people.set(who, p)
  }
  const out = {}
  for (const [day, people] of Object.entries(days)) {
    const list = [...people.entries()].sort((a, b) => b[1].cents - a[1].cents)
    out[day] = { cents: Math.round(list.reduce((n, [, p]) => n + p.cents, 0)), text: list.map(([who, p]) => `${who} ${hoursText(p.minutes)} ${usd(p.cents)}`).join('; ') }
  }
  return out
}

async function detailFor(first, last) {
  const entries = await prisma.timeEntry.findMany({
    where: { day: { gte: first, lte: last } },
    select: { day: true, minutes: true, startedAt: true, endedAt: true, timesheet: { select: { status: true, hourlyRateCents: true, user: { select: { firstName: true, hourlyRateCents: true } } } } },
  })
  return laborByDay(entries)
}

export const syncHourlyLaborSheet = ({ today } = {}) => syncDailyTab(TAB, detailFor, { today, statusKey: 'finance_hourly_labor_sheet' })
