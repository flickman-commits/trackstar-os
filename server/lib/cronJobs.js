/**
 * Every scheduled job the tool runs, for Settings > System > Scheduled Jobs.
 *
 * The schedules are read from vercel.json, the one place they are set, so
 * this list cannot drift from what Vercel runs; JOBS only adds a name and a
 * line on what each does. Vercel runs crons in UTC, so times shown in
 * Eastern move an hour when the clocks change. Each run is stamped as it
 * starts (api/_lib/auth.js isCronRequest, SystemConfig cron_run:<path>), so
 * the page can say when a job last ran and flag one that has gone quiet.
 */
import vercel from '../../vercel.json' with { type: 'json' }
import prisma from '../db.js'

const TZ = 'America/New_York'

/** Name and purpose by path. A cron in vercel.json with no entry still shows, under its path. */
const JOBS = {
  '/api/cron/artelo-send': { name: 'Send to Artelo production', what: 'Sends approved prints whose hold is over to Artelo, one at a time.' },
  '/api/support/sync': { name: 'Support mailbox sync', what: 'Brings new fast@ email into Support, then Claude drafts replies for new messages.' },
  '/api/orders/auto-import': { name: 'Order import', what: 'Pulls new orders from Artelo, and checks that photo and file uploads to storage still work.' },
  '/api/sales/send-due': { name: 'Sales: send later', what: 'Sends scheduled sales emails whose time has come.' },
  '/api/cron/fulfillment-check': { name: 'Artelo hookup check', what: 'Pings Slack when a print variant comes unhooked from Artelo, and when it is back.' },
  '/api/cron/custom-statements': { name: 'Designer statements', what: 'At the end of the month, each designer gets their custom statement in a Slack DM.' },
  '/api/cron/support-triage': { name: 'Support triage', what: 'Claude stars the urgent Support conversations and reports the count in #trackstar-reports.' },
  '/api/cron/retention': { name: 'Log cleanup', what: 'Deletes old rows from the log tables.' },
  '/api/orders/actions?action=daily-design-update': { name: 'Daily design update', what: 'Posts the custom and standard design standup to #design.' },
  '/api/cron/bulk-runs': { name: 'Bulk runs', what: 'Researches runners for bulk runs whose race is over and posts runs within a week of their race.' },
  '/api/cron/artelo-completed-check': { name: 'Artelo completed check', what: 'Flags orders complete here that Artelo never sent to production.' },
  '/api/cron/research-agent': { name: 'Research agent', what: 'Works the research queue: fills in results read off the official page, leaves a note on the rest.' },
  '/api/orders/actions?action=health-check': { name: 'Health check', what: 'Tests every connection and scraper fixture and reports to Slack.' },
  '/api/cron/support-playbook': { name: 'Support playbook review', what: 'Revises the drafting playbook from the week\'s replies and posts the changes.' },
  '/api/orders/actions?action=monday-pipeline': { name: 'Monday design pipeline', what: 'Posts the custom design pipeline, with what is due soon, to Slack.' },
}

/** The key a run is stamped under: the path, plus ?action= for the shared actions handler. */
export function cronKey(url) {
  const u = new URL(String(url || '/'), 'http://local')
  const action = u.searchParams.get('action')
  return `${u.pathname}${action ? `?action=${action}` : ''}`
}

/** Stamp a cron run as it starts. Never throws: a failed stamp must not stop the job. */
export function recordCronRun(url) {
  const key = `cron_run:${cronKey(url)}`
  const value = new Date().toISOString()
  return prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } }).catch(() => {})
}

// ---------------------------------------------------------------------------
// Cron expressions: the five standard fields, with *, */n, a-b, a,b.
// ---------------------------------------------------------------------------

function field(spec, min, max) {
  const out = new Set()
  for (const part of spec.split(',')) {
    const [range, step] = part.split('/')
    const [a, b] = range === '*' ? [min, max] : range.split('-').map(Number)
    for (let v = a; v <= (b ?? a); v += Number(step) || 1) out.add(v)
  }
  return out
}

export function parseCron(expr) {
  const [m, h, dom, mon, dow] = String(expr).trim().split(/\s+/)
  return {
    minute: field(m, 0, 59), hour: field(h, 0, 23), dom: field(dom, 1, 31), month: field(mon, 1, 12),
    dow: new Set([...field(dow, 0, 7)].map(d => d % 7)),
    anyDom: dom === '*', anyDow: dow === '*', raw: { m, h, dom, dow },
  }
}

function matches(c, d) {
  if (!c.minute.has(d.getUTCMinutes()) || !c.hour.has(d.getUTCHours()) || !c.month.has(d.getUTCMonth() + 1)) return false
  const domOk = c.dom.has(d.getUTCDate()), dowOk = c.dow.has(d.getUTCDay())
  // Standard cron: when both day fields are set, either one is enough.
  if (!c.anyDom && !c.anyDow) return domOk || dowOk
  return domOk && dowOk
}

/** The next `count` run times after `from`, looking up to 62 days ahead. */
export function nextRuns(c, from = new Date(), count = 3) {
  const out = []
  const d = new Date(Math.floor(from.getTime() / 60000) * 60000 + 60000)
  for (let i = 0; i < 62 * 1440 && out.length < count; i++, d.setTime(d.getTime() + 60000)) {
    if (matches(c, d)) out.push(new Date(d))
  }
  return out
}

/** The last run time at or before `from`, looking back up to 62 days. */
export function previousRun(c, from = new Date()) {
  const d = new Date(Math.floor(from.getTime() / 60000) * 60000)
  for (let i = 0; i < 62 * 1440; i++, d.setTime(d.getTime() - 60000)) if (matches(c, d)) return new Date(d)
  return null
}

const etTime = d => d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const etMinuteOfDay = d => { const [h, m] = d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number); return h * 60 + m }
const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const ord = n => `${n}${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}`
const list = xs => xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`

/**
 * How often, in words, Eastern time, and which group it sits in. Times come
 * from today's real run times, so they are right for the season we are in.
 */
export function describe(c, now = new Date()) {
  const { m, h, dom } = c.raw
  if (h === '*' && m.startsWith('*/')) return { group: 'frequent', when: `Every ${m.slice(2)} minutes` }
  if (h === '*' && m === '*') return { group: 'frequent', when: 'Every minute' }
  if (h === '*') {
    const at = `at :${String([...c.minute][0]).padStart(2, '0')}`
    if (dom !== '*') return { group: 'monthly', when: `Every hour ${at}, on the ${list([...c.dom].map(ord))}` }
    return { group: 'hourly', when: `Every hour ${at}` }
  }
  // Fixed hours: read the times off the next day's worth of runs.
  const runs = nextRuns(c, now, 12)
  const byMinute = new Map(runs.map(d => [etMinuteOfDay(d), etTime(d)]))
  const dayTimes = [...byMinute.keys()].sort((a, b) => a - b)
  const timesText = list(dayTimes.map(t => byMinute.get(t)))
  if (!c.anyDow) return { group: 'weekly', when: `${list([...c.dow].sort().map(d => DAYS[d]))} at ${timesText}`, dayTimes, days: [...c.dow] }
  if (!c.anyDom) return { group: 'monthly', when: `On the ${list([...c.dom].map(ord))} at ${timesText}`, dayTimes }
  const perDay = ['Every day', 'Twice a day', 'Three times a day'][dayTimes.length - 1] || `${dayTimes.length} times a day`
  return { group: 'daily', when: `${perDay} at ${timesText}`, dayTimes }
}

/** What the Scheduled Jobs page shows. */
export async function listCronJobs(now = new Date()) {
  const crons = vercel.crons || []
  const stamps = await prisma.systemConfig.findMany({ where: { key: { startsWith: 'cron_run:' } } }).catch(() => [])
  const lastRun = new Map(stamps.map(s => [s.key.slice('cron_run:'.length), s.value]))
  const jobs = crons.map(({ path, schedule }) => {
    const key = cronKey(path)
    const c = parseCron(schedule)
    const d = describe(c, now)
    const last = lastRun.get(key) || null
    const prev = previousRun(c, now)
    // Late: a run was due more than ten minutes ago and none was stamped since.
    // Never flagged before the first stamp, so a new job is not "late" on day one.
    const late = Boolean(last && prev && now - prev > 10 * 60000 && new Date(last) < new Date(prev.getTime() - 60000))
    return {
      path: key,
      name: JOBS[key]?.name || key,
      what: JOBS[key]?.what || '',
      schedule,
      when: d.when,
      group: d.group,
      dayTimes: d.dayTimes || null,
      days: d.days || null,
      next: nextRuns(c, now, 3).map(x => x.toISOString()),
      lastRunAt: last,
      late,
    }
  })
  return { timezone: TZ, now: now.toISOString(), jobs }
}
