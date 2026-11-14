/**
 * Hours: a person's week, the entries in it, the timer, submitting the week,
 * and an admin's review of it. Weeks run Monday to Sunday, Eastern.
 *
 * Draft: the person edits freely. Submitted: locked, waiting for review.
 * Approved: locked for good, the hourly rate frozen on it; the only way back
 * is an admin's withdraw, and not once it is on a paid run. Rejected: open
 * again with the reviewer's note; the next edit puts it back in draft.
 */
import prisma from '../../db.js'
import { slackTo, slackDm, slackText } from '../../lib/slack.js'
import { loadRoleCaps } from '../../../api/_lib/roles.js'
import { todayET, mondayOf, addDays, isValidDay, eachDay, dayLabel } from './periods.js'

export class HoursError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true }
}

export const MAX_MINUTES_PER_ENTRY = 24 * 60
export const LONG_DAY_MINUTES = 12 * 60

const name = u => [u?.firstName, u?.lastName].filter(Boolean).join(' ') || 'Someone'
/** Hours and minutes, never a fraction: "3h 2m", "45m", "8h". */
export const hoursText = minutes => { const m = Math.max(0, Math.round(minutes)); const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m` }
const hours = hoursText

/** DM a person through the Slack bot (their own DM webhook if the bot cannot). Never throws. */
const dm = (user, text) => slackDm(user, text).catch(() => false)
const dmMatt = text => slackTo('matt', text, { or: 'alerts' }).catch(() => false)

export function weekFor(day) {
  const weekStart = mondayOf(day)
  return { weekStart, weekEnd: addDays(weekStart, 6), days: eachDay(weekStart, addDays(weekStart, 6)) }
}

const ENTRY_SELECT = { id: true, day: true, minutes: true, startedAt: true, endedAt: true, note: true, createdAt: true, updatedAt: true }

/** Totals and the things a reviewer should see before approving. */
export function summarizeEntries(entries) {
  const byDay = {}
  let total = 0
  for (const e of entries) { byDay[e.day] = (byDay[e.day] || 0) + e.minutes; total += e.minutes }
  const flags = []
  for (const [d, m] of Object.entries(byDay)) if (m > LONG_DAY_MINUTES) flags.push(`${dayLabel(d, 'weekday')}: ${hours(m)} in one day`)
  if (entries.some(e => e.startedAt && !e.endedAt)) flags.push('A timer is still running')
  if (entries.some(e => !e.minutes && e.endedAt)) flags.push('An entry has no time on it')
  return { totalMinutes: total, byDay, flags }
}

function shape(ts, user) {
  const s = summarizeEntries(ts.entries || [])
  return { id: ts.id, userId: ts.userId, user: user ? { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role } : undefined, weekStart: ts.weekStart, weekEnd: addDays(ts.weekStart, 6),
    status: ts.status, submittedAt: ts.submittedAt, reviewedAt: ts.reviewedAt, reviewNote: ts.reviewNote, reviewedById: ts.reviewedById, hourlyRateCents: ts.hourlyRateCents, paid: Boolean(ts.payoutLineId),
    entries: (ts.entries || []).map(e => ({ ...e })), ...s }
}

/** A person's week, created as a draft the first time it is opened. Future weeks are refused. */
export async function getWeek(userId, weekStart, { today = todayET() } = {}) {
  if (!isValidDay(weekStart) || mondayOf(weekStart) !== weekStart) throw new HoursError('weekStart must be a Monday (YYYY-MM-DD)')
  if (weekStart > mondayOf(today)) throw new HoursError('That week has not started yet')
  let ts = await prisma.timesheet.findUnique({ where: { userId_weekStart: { userId, weekStart } }, include: { entries: { select: ENTRY_SELECT, orderBy: [{ day: 'asc' }, { createdAt: 'asc' }] } } })
  if (!ts) ts = await prisma.timesheet.create({ data: { userId, weekStart }, include: { entries: { select: ENTRY_SELECT } } })
  return shape(ts)
}

/** Recent weeks for the person's own list: this week and the 11 before, with status and hours. */
export async function myWeeks(userId, { today = todayET(), count = 12 } = {}) {
  const thisMonday = mondayOf(today)
  const starts = Array.from({ length: count }, (_, i) => addDays(thisMonday, -7 * i))
  const rows = await prisma.timesheet.findMany({ where: { userId, weekStart: { in: starts } }, include: { entries: { select: { minutes: true, day: true, startedAt: true, endedAt: true } } } })
  const by = new Map(rows.map(r => [r.weekStart, r]))
  return starts.map(ws => { const r = by.get(ws); return r ? { weekStart: ws, weekEnd: addDays(ws, 6), status: r.status, totalMinutes: summarizeEntries(r.entries).totalMinutes, reviewNote: r.reviewNote } : { weekStart: ws, weekEnd: addDays(ws, 6), status: 'empty', totalMinutes: 0, reviewNote: null } })
}

// byAdmin: Matt adding or removing someone's time from the review page. A
// submitted week is still waiting on him, so he may change it; an approved
// one has to be withdrawn first (its rate is frozen and it may be on a run).
async function editableWeek(userId, day, today, { byAdmin = false } = {}) {
  const { weekStart } = weekFor(day)
  if (weekStart > mondayOf(today)) throw new HoursError('That day has not come yet')
  const ts = await prisma.timesheet.findUnique({ where: { userId_weekStart: { userId, weekStart } } })
    || await prisma.timesheet.create({ data: { userId, weekStart } })
  if (ts.status === 'submitted' && !byAdmin) throw new HoursError('That week is submitted and locked. Ask Matt to send it back if something is wrong.')
  if (ts.status === 'approved') throw new HoursError(byAdmin ? 'That week is approved. Withdraw the approval first, then add or remove time.' : 'That week is approved and locked.')
  if (ts.status === 'rejected') await prisma.timesheet.update({ where: { id: ts.id }, data: { status: 'draft' } })
  return ts
}

function cleanMinutes(minutes) {
  const m = Math.round(Number(minutes))
  if (!Number.isFinite(m) || m < 1 || m > MAX_MINUTES_PER_ENTRY) throw new HoursError('Minutes must be between 1 and 1440')
  return m
}
const cleanNote = note => { const s = String(note ?? '').trim(); if (s.length > 300) throw new HoursError('Keep the note under 300 characters'); return s || null }

export async function addEntry(userId, { day, minutes, note }, { today = todayET(), byAdmin = false } = {}) {
  if (!isValidDay(day)) throw new HoursError('day must be YYYY-MM-DD')
  if (day > today) throw new HoursError('That day has not come yet')
  const ts = await editableWeek(userId, day, today, { byAdmin })
  const e = await prisma.timeEntry.create({ data: { timesheetId: ts.id, userId, day, minutes: cleanMinutes(minutes), note: cleanNote(note) }, select: ENTRY_SELECT })
  return { entry: e, weekStart: ts.weekStart }
}

export async function updateEntry(userId, id, { minutes, note }, { today = todayET() } = {}) {
  const e = await prisma.timeEntry.findFirst({ where: { id, userId } })
  if (!e) throw new HoursError('No such entry', 404)
  if (e.startedAt && !e.endedAt) throw new HoursError('Stop the timer first')
  await editableWeek(userId, e.day, today)
  const data = {}
  if (minutes !== undefined) data.minutes = cleanMinutes(minutes)
  if (note !== undefined) data.note = cleanNote(note)
  return prisma.timeEntry.update({ where: { id }, data, select: ENTRY_SELECT })
}

export async function deleteEntry(userId, id, { today = todayET(), byAdmin = false } = {}) {
  const e = await prisma.timeEntry.findFirst({ where: { id, userId } })
  if (!e) throw new HoursError('No such entry', 404)
  if (byAdmin && e.startedAt && !e.endedAt) throw new HoursError('Their timer is still running on that entry')
  await editableWeek(userId, e.day, today, { byAdmin })
  await prisma.timeEntry.delete({ where: { id } })
  return { deleted: id, day: e.day, minutes: e.minutes }
}

export async function runningTimer(userId) {
  return prisma.timeEntry.findFirst({ where: { userId, startedAt: { not: null }, endedAt: null }, select: ENTRY_SELECT })
}

/**
 * Pause and resume. Pausing stops the running entry like Stop does (the time
 * so far is logged), and remembers what it was for and how long the session
 * has run, so Resume picks the same work back up and the clock carries on
 * from there. Stop ends the session. Kept in SystemConfig per person:
 * { note, carriedMinutes, pausedAt } (pausedAt null while running again).
 */
const SESSION_KEY = userId => `hours_session:${userId}`

export async function timerSession(userId) {
  const row = await prisma.systemConfig.findUnique({ where: { key: SESSION_KEY(userId) } }).catch(() => null)
  if (!row) return null
  try { const s = JSON.parse(row.value); return { note: s.note || null, carriedMinutes: Number(s.carriedMinutes) || 0, pausedAt: s.pausedAt || null } } catch { return null }
}
const saveSession = (userId, s) => prisma.systemConfig.upsert({ where: { key: SESSION_KEY(userId) }, update: { value: JSON.stringify(s) }, create: { key: SESSION_KEY(userId), value: JSON.stringify(s) } })
export const endSession = userId => prisma.systemConfig.deleteMany({ where: { key: SESSION_KEY(userId) } })

export async function pauseTimer(userId, { now = new Date() } = {}) {
  const before = await timerSession(userId)
  const e = await stopTimer(userId, { now, keepSession: true })
  await saveSession(userId, { note: e.note, carriedMinutes: (before?.carriedMinutes || 0) + e.minutes, pausedAt: now.toISOString() })
  return e
}

export async function resumeTimer(userId, { now = new Date() } = {}) {
  const s = await timerSession(userId)
  if (!s?.pausedAt) throw new HoursError('Nothing is paused')
  const out = await startTimer(userId, { note: s.note }, { now, keepSession: true })
  await saveSession(userId, { ...s, pausedAt: null })
  return out
}

export async function startTimer(userId, { note } = {}, { now = new Date(), keepSession = false } = {}) {
  if (await runningTimer(userId)) throw new HoursError('A timer is already running. Stop it first.')
  if (!keepSession) await endSession(userId)
  const today = todayET(now)
  const ts = await editableWeek(userId, today, today)
  const e = await prisma.timeEntry.create({ data: { timesheetId: ts.id, userId, day: today, minutes: 0, startedAt: now, note: cleanNote(note) }, select: ENTRY_SELECT })
  return { entry: e, weekStart: ts.weekStart }
}

export async function stopTimer(userId, { now = new Date(), keepSession = false } = {}) {
  const e = await runningTimer(userId)
  if (!e) throw new HoursError('No timer is running')
  if (!keepSession) await endSession(userId)
  const minutes = Math.min(MAX_MINUTES_PER_ENTRY, Math.max(1, Math.round((now - new Date(e.startedAt)) / 60000)))
  return prisma.timeEntry.update({ where: { id: e.id }, data: { endedAt: now, minutes }, select: ENTRY_SELECT })
}

/** Submit the week: locked, Matt pinged. */
export async function submitWeek(userId, weekStart, { today = todayET() } = {}) {
  const ts = await getWeek(userId, weekStart, { today })
  if (ts.status === 'submitted') throw new HoursError('Already submitted')
  if (ts.status === 'approved') throw new HoursError('Already approved')
  if (!ts.totalMinutes) throw new HoursError('Nothing to submit: add your hours first')
  if (ts.entries.some(e => e.startedAt && !e.endedAt)) throw new HoursError('Stop the timer first')
  const saved = await prisma.timesheet.update({ where: { id: ts.id }, data: { status: 'submitted', submittedAt: new Date(), reviewNote: null }, include: { user: true, entries: { select: ENTRY_SELECT } } })
  await dmMatt(`*${slackText(name(saved.user))}* submitted ${hours(ts.totalMinutes)} for the week of ${dayLabel(weekStart)}. Review it in Finance > Timesheets.`)
  return shape(saved, saved.user)
}

/** An admin approves, rejects (with a note) or withdraws an approval. */
export async function review(id, action, { note = '', reviewer }) {
  const ts = await prisma.timesheet.findUnique({ where: { id }, include: { user: true, entries: { select: ENTRY_SELECT, orderBy: [{ day: 'asc' }, { createdAt: 'asc' }] } } })
  if (!ts) throw new HoursError('No such timesheet', 404)
  const n = String(note || '').trim().slice(0, 500)
  let data
  if (action === 'approve') {
    if (ts.status !== 'submitted' && ts.status !== 'draft') throw new HoursError(`This week is ${ts.status}, not waiting for approval`)
    const rate = ts.user.hourlyRateCents
    if (rate == null) throw new HoursError(`${name(ts.user)} has no hourly rate yet. Set one in Payouts > Rates first.`)
    data = { status: 'approved', reviewedById: reviewer.id, reviewedAt: new Date(), reviewNote: n || null, hourlyRateCents: rate }
  } else if (action === 'reject') {
    if (ts.status !== 'submitted') throw new HoursError('Only a submitted week can be sent back')
    if (!n) throw new HoursError('Say what needs to change')
    data = { status: 'rejected', reviewedById: reviewer.id, reviewedAt: new Date(), reviewNote: n }
  } else if (action === 'withdraw') {
    if (ts.status !== 'approved') throw new HoursError('Only an approved week can be withdrawn')
    if (ts.payoutLineId) throw new HoursError('This week is on a pay run. Take it off the run first.')
    data = { status: 'submitted', reviewedById: reviewer.id, reviewedAt: new Date(), reviewNote: n || null, hourlyRateCents: null }
  } else throw new HoursError('action must be approve, reject or withdraw')
  const saved = await prisma.timesheet.update({ where: { id }, data, include: { user: true, entries: { select: ENTRY_SELECT, orderBy: [{ day: 'asc' }, { createdAt: 'asc' }] } } })
  const first = saved.user.firstName
  if (action === 'approve') await dm(saved.user, `Hey ${slackText(first)}! Your ${hours(summarizeEntries(saved.entries).totalMinutes)} for the week of ${dayLabel(saved.weekStart)} are approved.${n ? ` Note from Matt: ${slackText(n)}` : ''}`)
  if (action === 'reject') await dm(saved.user, `Hey ${slackText(first)}, Matt sent back your hours for the week of ${dayLabel(saved.weekStart)}: ${slackText(n)}. Fix them up and submit the week again.`)
  return shape(saved, saved.user)
}

/** The admin list: every week in a status (or all), newest first. */
export async function listTimesheets({ status = null, userId = null, weekStart = null, limit = 200 } = {}) {
  const where = {}
  if (weekStart) where.weekStart = weekStart
  if (status && status !== 'all') where.status = status
  if (userId) where.userId = userId
  const rows = await prisma.timesheet.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true, role: true, extraRoles: true, extraCaps: true, deniedCaps: true, hourlyRateCents: true } }, entries: { select: ENTRY_SELECT, orderBy: [{ day: 'asc' }, { createdAt: 'asc' }] } }, orderBy: [{ weekStart: 'desc' }, { createdAt: 'asc' }], take: Math.min(500, Math.max(1, limit)) })
  // An admin's own minutes are tests (Matt is not hourly): never on the team's sheets.
  return rows.filter(r => r.user?.role !== 'admin').filter(r => r.status !== 'draft' || r.entries.length).map(r => ({ ...shape(r, r.user), rateNow: r.user.hourlyRateCents }))
}

/** Everyone whose role includes hours (for the admin's filters and the reminders). */
export async function hourlyPeople() {
  const caps = await loadRoleCaps()
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, firstName: true, lastName: true, email: true, role: true, extraRoles: true, extraCaps: true, deniedCaps: true, hourlyRateCents: true }, orderBy: { firstName: 'asc' } })
  return users.filter(u => u.role === 'admin' ? false : (caps[u.role] || []).includes('hours'))
}

/**
 * Monday morning: anyone with hours who has not submitted last week gets a
 * DM; whoever has no DM webhook is listed to Matt. Once per week.
 */
export async function remindUnsubmitted({ now = new Date() } = {}) {
  const today = todayET(now)
  const lastWeek = addDays(mondayOf(today), -7)
  const key = `hours_reminded:${lastWeek}`
  if (await prisma.systemConfig.findUnique({ where: { key } })) return { week: lastWeek, skipped: 'already reminded' }
  const people = await hourlyPeople()
  const sheets = await prisma.timesheet.findMany({ where: { weekStart: lastWeek, userId: { in: people.map(p => p.id) } }, select: { userId: true, status: true } })
  const by = new Map(sheets.map(s => [s.userId, s.status]))
  const reminded = [], noWebhook = []
  for (const p of people) {
    const st = by.get(p.id)
    if (st === 'submitted' || st === 'approved') continue
    const ok = await dm(p, `Hey ${slackText(p.firstName)}! Your hours for the week of ${dayLabel(lastWeek)} are not submitted yet. Open Hours in Support (or Tools > Hours), check the week, and press Submit week.`)
    if (ok) reminded.push(p.firstName); else noWebhook.push(p.firstName)
  }
  if (noWebhook.length) await dmMatt(`Hours not submitted for the week of ${dayLabel(lastWeek)} and no Slack DM set up for: ${noWebhook.map(slackText).join(', ')}.`)
  await prisma.systemConfig.create({ data: { key, value: JSON.stringify({ at: now.toISOString(), reminded, noWebhook }) } })
  return { week: lastWeek, reminded, noWebhook }
}
