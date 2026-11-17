/**
 * Customs -> the Daily Tracker's "Custom Payouts" tab (dailyTab.js): what the
 * designers earned on custom designs each day, and who. A design counts on
 * the day its first proof went out, at the designer's rate (new or repeat),
 * exactly as the Custom Counter pays it (orders/customCounter.js). The
 * roll-ups count it as a fixed cost of the month.
 *
 * Each run redoes this month and the one before (a repeat flag or a rate can
 * still change there); older months are left as written.
 */
import { customCounter } from '../orders/customCounter.js'
import { syncDailyTab } from './dailyTab.js'
import { monthOf, shiftMonth, todayET } from './periods.js'

export const TAB = 'Custom Payouts'
const TZ = 'America/New_York'

const usd = cents => `$${(Math.round(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const etDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

/** A month's counter -> { day: { cents, text } }, e.g. "Dan 3 customs $125.00; Creed 1 custom $50.00". */
export function customsByDay(counter) {
  const days = {}
  for (const d of counter.designers) {
    const who = String(d.name || 'Unattributed').split(' ')[0]
    for (const o of d.orders) {
      if (!o.rateCents) continue
      const day = etDay(o.completedAt)
      const people = days[day] || (days[day] = new Map())
      const p = people.get(who) || { count: 0, cents: 0 }
      p.count += 1
      p.cents += o.rateCents
      people.set(who, p)
    }
  }
  const out = {}
  for (const [day, people] of Object.entries(days)) {
    const list = [...people.entries()].sort((a, b) => b[1].cents - a[1].cents)
    out[day] = { cents: list.reduce((n, [, p]) => n + p.cents, 0), text: list.map(([who, p]) => `${who} ${p.count} custom${p.count === 1 ? '' : 's'} ${usd(p.cents)}`).join('; ') }
  }
  return out
}

export async function customsDetail(months) {
  const out = {}
  for (const m of months) Object.assign(out, customsByDay(await customCounter(m)))
  return out
}

export async function syncCustomPayoutSheet({ today = todayET() } = {}) {
  const month = monthOf(today), prev = shiftMonth(month, -1)
  return syncDailyTab(TAB, () => customsDetail([prev, month]), { today, since: `${prev}-01`, statusKey: 'finance_custom_payout_sheet' })
}
