/**
 * Finance: the scoreboard for a period and what the team is owed (admin
 * only), and a person's own hours (anyone whose role includes hours). Money
 * comes back as dollars text alongside cents; nothing here is a raw sheet.
 */
import { z } from 'zod'
import { ToolError } from '../server.js'
import { overview } from '../../../domain/finance/overview.js'
import { owed } from '../../../domain/finance/payouts.js'
import * as hours from '../../../domain/finance/timesheets.js'
import { todayET, mondayOf, isValidDay, dayLabel } from '../../../domain/finance/periods.js'

const usd = c => (c == null ? null : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const pct = v => (v == null ? null : `${v.toFixed(1)}%`)
const h = m => Math.round((m / 60) * 100) / 100

function weekOut(w) {
  return { weekStart: w.weekStart, weekEnd: w.weekEnd, status: w.status, hours: h(w.totalMinutes), reviewNote: w.reviewNote,
    entries: w.entries.map(e => ({ id: e.id, day: e.day, hours: h(e.minutes), note: e.note, running: Boolean(e.startedAt && !e.endedAt) })) }
}
const person = principal => { if (!principal.user) throw new ToolError('This needs a key that acts as a person.'); return principal.user.id }

export const financeTools = [
  {
    name: 'finance_overview', title: 'Finance overview', scope: 'read', adminOnly: true, readOnly: true,
    description: 'The scoreboard for a period: revenue, contribution margin, ad spend and ROAS, orders and AOV, where the money went, and what needs Matt. Periods: today, yesterday, 7d, 30d, mtd, last_month, qtd, ytd, or YYYY-MM-DD..YYYY-MM-DD.',
    input: { period: z.string().max(30).default('today') },
    handler: async ({ period }) => {
      const o = await overview({ period })
      const t = o.totals, c = o.compare
      return {
        period: o.period.label, from: o.period.first, to: o.period.last, through: o.through, partial: o.partial,
        revenue: usd(t.revenue), contributionMargin: usd(t.cm), contributionMarginPct: pct(t.cmPct), grossProfit: usd(t.grossProfit), grossMarginPct: pct(t.grossMarginPct),
        adSpend: usd(t.adSpend), roas: t.roas == null ? null : `${t.roas.toFixed(2)}x`, orders: t.orders, aov: usd(t.aov), cpa: usd(t.cpa), breakevenCpa: usd(t.breakevenCpa),
        compare: { label: o.period.compareLabel, revenue: usd(c.revenue), contributionMargin: usd(c.cm), adSpend: usd(c.adSpend), orders: c.orders },
        whereTheMoneyWent: o.waterfall.map(w => ({ line: w.label, amount: usd(w.cents), pctOfRevenue: pct(w.pctOfRevenue) })),
        needsYou: o.needs.map(n => n.text), lastSheetRead: o.sync?.at || null,
      }
    },
  },
  {
    name: 'payouts_owed', title: 'Payouts owed', scope: 'read', adminOnly: true, readOnly: true,
    description: 'What the team is owed and not yet on a pay run: approved weeks of hours by person, and closed months of customs and the designer fee.',
    input: {},
    handler: async () => {
      const o = await owed()
      return {
        total: usd(o.totalCents),
        hours: o.hours.map(p => ({ name: p.name, hours: h(p.minutes), amount: usd(p.amountCents), weeks: p.weeks.map(w => `${dayLabel(w.weekStart)}: ${h(w.minutes)}h at ${usd(w.rateCents)}`) })),
        months: o.months.map(m => ({ month: m.label, total: usd(m.totalCents), lines: m.items.map(i => ({ name: i.name, kind: i.kind, amount: usd(i.amountCents), note: i.note })) })),
      }
    },
  },
  {
    name: 'timesheet_week', title: 'My hours this week', scope: 'read', cap: 'hours', readOnly: true,
    description: 'Your own hours for a week (a Monday, default this week): the entries, the total, the status, and whether a timer is running.',
    input: { week: z.string().max(10).optional().describe('The Monday, YYYY-MM-DD') },
    handler: async ({ week }, { principal }) => {
      const userId = person(principal)
      const ws = week ? (isValidDay(week) ? mondayOf(week) : null) : mondayOf(todayET())
      if (!ws) throw new ToolError('week must be YYYY-MM-DD')
      const [w, running] = await Promise.all([hours.getWeek(userId, ws), hours.runningTimer(userId)])
      return { ...weekOut(w), timerRunning: running ? { since: running.startedAt, note: running.note } : null }
    },
  },
  {
    name: 'timesheet_log', title: 'Log hours', scope: 'write', cap: 'hours', readOnly: false,
    description: 'Add a block of your own time to a day (hours, with a note on what it was), or remove an entry by id.',
    input: {
      day: z.string().max(10).optional().describe('YYYY-MM-DD, default today'),
      hours: z.number().min(0.01).max(24).optional(),
      note: z.string().max(300).optional(),
      remove: z.string().max(40).optional().describe('An entry id to delete instead'),
    },
    handler: async ({ day, hours: hrs, note, remove }, { principal }) => {
      const userId = person(principal)
      if (remove) { await hours.deleteEntry(userId, remove); return { summary: 'Removed an hours entry', removed: remove } }
      if (!hrs) throw new ToolError('Say how many hours')
      const d = day || todayET()
      const out = await hours.addEntry(userId, { day: d, minutes: Math.round(hrs * 60), note })
      return { summary: `Logged ${hrs}h on ${dayLabel(d)}`, entry: { id: out.entry.id, day: d, hours: hrs, note: note || null }, week: weekOut(await hours.getWeek(userId, out.weekStart)) }
    },
  },
  {
    name: 'timesheet_submit', title: 'Submit my week', scope: 'write', cap: 'hours', readOnly: false,
    description: 'Submit your week of hours for approval (a Monday, default last week if it is not submitted, else this week). The week locks until Matt reviews it.',
    input: { week: z.string().max(10).optional().describe('The Monday, YYYY-MM-DD') },
    handler: async ({ week }, { principal }) => {
      const userId = person(principal)
      let ws = week ? mondayOf(week) : null
      if (!ws) {
        // Last week if it is still open with hours on it, else this week.
        const recent = await hours.myWeeks(userId, { count: 2 })
        const last = recent[1]
        ws = last && last.totalMinutes && last.status !== 'submitted' && last.status !== 'approved' ? last.weekStart : recent[0].weekStart
      }
      const ts = await hours.submitWeek(userId, ws)
      return { summary: `Submitted ${h(ts.totalMinutes)}h for the week of ${dayLabel(ts.weekStart)}`, week: weekOut(ts) }
    },
  },
  {
    name: 'timesheet_review', title: 'Review a timesheet', scope: 'admin', adminOnly: true, readOnly: false,
    description: 'Approve, reject (with a note) or withdraw approval of a submitted week of hours. Without an id, lists the weeks waiting for approval.',
    input: { id: z.string().max(40).optional(), action: z.enum(['approve', 'reject', 'withdraw']).optional(), note: z.string().max(500).optional() },
    handler: async ({ id, action, note }, { principal }) => {
      if (!id) {
        const list = await hours.listTimesheets({ status: 'submitted' })
        return { summary: 'Listed the weeks waiting for approval', waiting: list.map(t => ({ id: t.id, name: `${t.user.firstName} ${t.user.lastName || ''}`.trim(), weekStart: t.weekStart, hours: h(t.totalMinutes), flags: t.flags })) }
      }
      if (!action) throw new ToolError('Say approve, reject or withdraw')
      const ts = await hours.review(id, action, { note, reviewer: principal.user })
      return { summary: `${action === 'approve' ? 'Approved' : action === 'reject' ? 'Sent back' : 'Withdrew approval of'} ${ts.user.firstName}'s ${h(ts.totalMinutes)}h for the week of ${dayLabel(ts.weekStart)}`, week: weekOut(ts) }
    },
  },
]
