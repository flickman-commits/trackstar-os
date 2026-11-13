/**
 * Needs you, on the Finance overview: one card per payment Matt has coming
 * (hours to approve, the team's two-week pay, race partners 30 days after
 * their race, last month's customs and designer fee), with the action that
 * does it. overview.js adds one alert when the margin is under 10%.
 *
 * Each card: { key, kind, tone, title, detail, cents?, due?, action: { label, to }, text }
 *   key: names the card for a dismissal; a card that moves on (coming up to
 *   due, a new period) gets a new key and shows again.
 *   tone: 'due' (do it now), 'soon' (coming up), 'alert' (a number to look at)
 *   text: the card in one line, for the MCP tool and anything that reads lines.
 */
import prisma from '../../db.js'
import { unpaidWeeks, unpaidMonths } from './payouts.js'
import { listRacePayouts, RACE_PAYOUTS_CACHE } from './racePayouts.js'
import { addDays, dayLabel, mondayOf } from './periods.js'

const PAY_EVERY_DAYS = 14
const RACE_SOON_DAYS = 7
const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const hrs = m => `${(m / 60).toFixed(1).replace(/\.0$/, '')}h`
const card = c => ({ key: c.key || `${c.kind}:${c.title}`, ...c, text: `${c.title}${c.detail ? `: ${c.detail}` : ''}${c.cents != null ? ` (${usd(c.cents)})` : ''}` })

/** Gives up on a slow source (Attio) rather than hold the whole page. */
const within = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))])

/**
 * The team's pay: hourly people are paid every two weeks. The period runs
 * from the day after the last hours run to 14 days on; once it has ended,
 * its approved weeks are due. Before any run, it starts the Monday of the
 * oldest approved week.
 */
async function teamPay(today) {
  const [weeks, lastRun, open] = await Promise.all([
    unpaidWeeks(),
    prisma.payRun.findFirst({ where: { kind: 'hours' }, orderBy: { periodEnd: 'desc' }, select: { periodEnd: true } }),
    prisma.payRun.findMany({ where: { status: { in: ['draft', 'approved'] } }, select: { id: true, label: true, status: true, lines: { select: { amountCents: true } } } }),
  ])
  const out = []
  for (const r of open) {
    const cents = r.lines.reduce((a, l) => a + l.amountCents, 0)
    out.push(card(r.status === 'draft'
      ? { key: `run:${r.id}:draft`, kind: 'run', tone: 'due', title: 'Approve the pay run', detail: r.label, cents, action: { label: 'Review run', to: '/finance/payouts' } }
      : { key: `run:${r.id}:approved`, kind: 'run', tone: 'due', title: 'Pay and mark paid', detail: `${r.label} is approved`, cents, action: { label: 'Mark paid', to: '/finance/payouts' } }))
  }
  if (!weeks.length) return out
  const start = lastRun ? addDays(lastRun.periodEnd, 1) : mondayOf(weeks[0].weekStart)
  const end = addDays(start, PAY_EVERY_DAYS - 1)
  const inPeriod = weeks.filter(w => w.weekStart <= end)
  const due = today > end && inPeriod.length
  const list = due ? inPeriod : weeks
  const byPerson = new Map()
  for (const w of list) byPerson.set(w.name, (byPerson.get(w.name) || 0) + w.minutes)
  const people = [...byPerson].map(([n, m]) => `${n.split(' ')[0]} ${hrs(m)}`).join(', ')
  const cents = list.reduce((a, w) => a + w.amountCents, 0)
  out.push(card(due
    ? { key: `payouts:${start}:due`, kind: 'payouts', tone: 'due', title: 'Pay the team', detail: `Hours for ${dayLabel(start)} to ${dayLabel(end)}: ${people}`, cents, due: addDays(end, 1), action: { label: 'Start pay run', to: '/finance/payouts' } }
    : { key: `payouts:${start}:soon`, kind: 'payouts', tone: 'soon', title: 'Team pay coming up', detail: `${people} approved so far. The period ends ${dayLabel(end)}.`, cents, due: addDays(end, 1), action: { label: 'See payouts', to: '/finance/payouts' } }))
  return out
}

/**
 * The race list comes from Attio, which takes 20 seconds cold. The last good
 * list is kept (listRacePayouts saves it); the page reads it when Attio is
 * slow, and the slow call finishes in the background and refreshes it.
 */
async function raceRows(today) {
  const rows = await within(listRacePayouts({ today }).catch(() => null), 4000, null)
  if (rows) return rows
  const cached = await prisma.systemConfig.findUnique({ where: { key: RACE_PAYOUTS_CACHE } }).catch(() => null)
  try { return cached ? JSON.parse(cached.value) : null } catch { return null }
}

/** Race partners: their share is due 30 days after race day, once the sales window has closed. */
async function racePay(today) {
  const rows = await raceRows(today)
  if (!rows) return []
  const out = []
  for (const r of rows) {
    if (r.status === 'paid' || !r.dueDate) continue
    const to = '/finance/payouts?tab=races'
    if (r.status === 'sent') {
      out.push(card({ key: `race:${r.name}:sent`, kind: 'race', tone: 'due', title: `Mark ${r.name} paid`, detail: `Report sent${r.emailedTo ? ` to ${r.emailedTo}` : ''}. Record the payment once it goes out.`, cents: r.payoutCents, action: { label: 'Mark paid', to } }))
      continue
    }
    // From the due date, not the saved daysToDue: the cached list may be a day old.
    const daysLeft = Math.round((Date.parse(r.dueDate) - Date.parse(today)) / 86_400_000)
    if (daysLeft == null || daysLeft > RACE_SOON_DAYS) continue
    const when = daysLeft < 0 ? `${-daysLeft} day${daysLeft === -1 ? '' : 's'} overdue` : daysLeft === 0 ? 'due today' : `due ${dayLabel(r.dueDate)}`
    if (r.final && r.sales?.unitsSold) {
      out.push(card({ key: `race:${r.name}:pay:${daysLeft <= 0 ? 'due' : 'soon'}`, kind: 'race', tone: daysLeft <= 0 ? 'due' : 'soon', title: `Pay ${r.name}`, detail: `${r.sales.unitsSold} print${r.sales.unitsSold === 1 ? '' : 's'} sold, ${when}. Email the report, then pay.`, cents: r.payoutCents, due: r.dueDate, action: { label: 'Email report', to } }))
    } else if (!r.final) {
      // (A closed window with nothing sold has nothing to pay: no card; the Races tab still lists it.)
      out.push(card({ key: `race:${r.name}:pull:${r.windowClosed ? 'closed' : 'open'}`, kind: 'race', tone: daysLeft <= 0 ? 'due' : 'soon', title: `Pull ${r.name} sales`, detail: r.windowClosed ? `The sales window closed; pull the final numbers. Payout ${when}.` : `The sales window closes ${dayLabel(r.window.end)}. Payout ${when}.`, due: r.dueDate, action: { label: r.windowClosed ? 'Pull sales' : 'Open', to } }))
    }
  }
  return out
}

/** Last month's custom designs and the designer fee, once the month is closed. */
async function monthlyPay(today) {
  const months = await unpaidMonths({ today, back: 2 }).catch(() => [])
  return months.map(m => card({ key: `monthly:${m.label}`, kind: 'monthly', tone: 'due', title: `Pay ${m.label} customs and designer fee`, detail: m.items.map(i => `${i.name.split(' ')[0]} ${i.kind === 'designer_fee' ? 'fee' : `${i.quantity} custom${i.quantity === 1 ? '' : 's'}`}`).join(', '), cents: m.totalCents, action: { label: 'Start monthly run', to: '/finance/payouts' } }))
}

export async function moneyNeeds({ today }) {
  const [submitted, team, races, monthly] = await Promise.all([
    prisma.timesheet.findMany({ where: { status: 'submitted' }, select: { weekStart: true, user: { select: { firstName: true } } }, orderBy: { weekStart: 'asc' } }),
    teamPay(today), racePay(today), monthlyPay(today),
  ])
  const out = []
  if (submitted.length) {
    const who = [...new Set(submitted.map(t => t.user.firstName))].join(', ')
    out.push(card({ key: `timesheets:${submitted.map(t => `${t.user.firstName}${new Date(t.weekStart).toISOString().slice(0, 10)}`).join(',')}`, kind: 'timesheets', tone: 'due', title: `Approve ${submitted.length} week${submitted.length === 1 ? '' : 's'} of hours`, detail: `${who} submitted, oldest the week of ${dayLabel(submitted[0].weekStart)}.`, action: { label: 'Review timesheets', to: '/finance/timesheets' } }))
  }
  out.push(...team, ...races, ...monthly)
  const rank = { due: 0, soon: 1, alert: 2 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || String(a.due || '9999').localeCompare(String(b.due || '9999')))
}

export { card as needCard }

/**
 * Dismissed cards, shared by the admins (Finance is theirs alone):
 * SystemConfig `finance_needs_dismissed`, { [key]: dismissedAt }. Entries
 * older than 90 days are dropped on the next write; by then their card has
 * a new key anyway.
 */
const DISMISSED = 'finance_needs_dismissed'
const KEEP_DAYS = 90

export async function dismissedNeeds() {
  const row = await prisma.systemConfig.findUnique({ where: { key: DISMISSED } }).catch(() => null)
  try { return row ? JSON.parse(row.value) || {} : {} } catch { return {} }
}

export async function setNeedDismissed(key, dismissed, now = new Date()) {
  if (typeof key !== 'string' || !key || key.length > 500) throw Object.assign(new Error('Which card?'), { status: 400, expose: true })
  const map = await dismissedNeeds()
  const cutoff = now.getTime() - KEEP_DAYS * 86_400_000
  for (const [k, at] of Object.entries(map)) if (Date.parse(at) < cutoff) delete map[k]
  if (dismissed) map[key] = now.toISOString()
  else delete map[key]
  const value = JSON.stringify(map)
  await prisma.systemConfig.upsert({ where: { key: DISMISSED }, create: { key: DISMISSED, value }, update: { value } })
  return map
}
