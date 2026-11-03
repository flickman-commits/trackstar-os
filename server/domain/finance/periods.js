/**
 * Days and periods, in Eastern time, as the Daily Tracker counts them.
 *
 * A "day" is a YYYY-MM-DD string. Everything here works on those strings so
 * no caller has to think about the clock: the sheet's rows are days, the
 * ledger's rows are days, and a period is a first day and a last day.
 */
const TZ = 'America/New_York'

/** Today (or the given instant) as YYYY-MM-DD, Eastern. */
export function todayET(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const parse = d => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
const fmt = ms => new Date(ms).toISOString().slice(0, 10)

/** The day N days after (or before, negative) a day. */
export function addDays(day, n) { return fmt(parse(day) + n * 86400000) }
export function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000) }
/** Every day from first to last, inclusive. */
export function eachDay(first, last) {
  const out = []
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d)
  return out
}
export function monthOf(day) { return day.slice(0, 7) }
export function firstOfMonth(day) { return `${day.slice(0, 7)}-01` }
export function lastOfMonth(day) {
  const [y, m] = day.split('-').map(Number)
  return fmt(Date.UTC(y, m, 0))
}
export function shiftMonth(month, by) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
/** The Monday on or before a day (weeks run Monday to Sunday). */
export function mondayOf(day) {
  const dow = new Date(parse(day)).getUTCDay() // 0 Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow)
}
export function isValidDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && fmt(parse(day)) === day
}
export function isValidMonth(month) {
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
}

/** "Mon 11/03", "Nov 3", "November 2026": the sheet's own spellings. */
export function dayLabel(day, style = 'short') {
  const d = new Date(parse(day))
  const opts = style === 'weekday' ? { weekday: 'short', month: 'numeric', day: 'numeric' } : style === 'long' ? { month: 'long', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }
  return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(d)
}
export function monthLabel(month) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(parse(`${month}-15`)))
}

export const PERIODS = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Past 7 days',
  '30d': 'Past 30 days',
  mtd: 'Month to date',
  last_month: 'Last month',
  qtd: 'Quarter to date',
  ytd: 'Year to date',
}

/**
 * A period key (or "YYYY-MM-DD..YYYY-MM-DD") -> { first, last, label }, and
 * the matching compare window: the same length of days just before it, or for
 * month to date the same days of last month, for last month the month before.
 */
export function resolvePeriod(key, today = todayET()) {
  const custom = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(String(key || ''))
  if (custom && isValidDay(custom[1]) && isValidDay(custom[2]) && custom[1] <= custom[2]) {
    const first = custom[1], last = custom[2], n = daysBetween(first, last) + 1
    return { key, first, last, label: `${dayLabel(first)} to ${dayLabel(last)}`, compare: { first: addDays(first, -n), last: addDays(first, -1), label: `the ${n} days before` } }
  }
  const y = today.slice(0, 4)
  switch (key) {
    case 'yesterday': { const d = addDays(today, -1); return { key, first: d, last: d, label: 'Yesterday', compare: { first: addDays(d, -1), last: addDays(d, -1), label: 'the day before' } } }
    case '7d': return { key, first: addDays(today, -6), last: today, label: 'Past 7 days', compare: { first: addDays(today, -13), last: addDays(today, -7), label: 'the 7 days before' } }
    case '30d': return { key, first: addDays(today, -29), last: today, label: 'Past 30 days', compare: { first: addDays(today, -59), last: addDays(today, -30), label: 'the 30 days before' } }
    case 'mtd': {
      const first = firstOfMonth(today), prev = shiftMonth(monthOf(today), -1)
      const dayNo = Number(today.slice(8, 10))
      const prevLast = lastOfMonth(`${prev}-01`)
      const cmpLast = `${prev}-${String(Math.min(dayNo, Number(prevLast.slice(8, 10)))).padStart(2, '0')}`
      return { key, first, last: today, label: 'Month to date', compare: { first: `${prev}-01`, last: cmpLast, label: 'the same days last month' } }
    }
    case 'last_month': {
      const m = shiftMonth(monthOf(today), -1), before = shiftMonth(m, -1)
      return { key, first: `${m}-01`, last: lastOfMonth(`${m}-01`), label: monthLabel(m), compare: { first: `${before}-01`, last: lastOfMonth(`${before}-01`), label: monthLabel(before) } }
    }
    case 'qtd': {
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3)
      const first = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`
      const n = daysBetween(first, today) + 1
      const pq = shiftMonth(first.slice(0, 7), -3)
      return { key, first, last: today, label: 'Quarter to date', compare: { first: `${pq}-01`, last: addDays(`${pq}-01`, n - 1), label: 'the same days last quarter' } }
    }
    case 'ytd': {
      const first = `${y}-01-01`, n = daysBetween(first, today) + 1
      const py = String(Number(y) - 1)
      return { key, first, last: today, label: 'Year to date', compare: { first: `${py}-01-01`, last: addDays(`${py}-01-01`, n - 1), label: 'the same days last year' } }
    }
    case 'today':
    default:
      return { key: 'today', first: today, last: today, label: 'Today', compare: { first: addDays(today, -1), last: addDays(today, -1), label: 'yesterday' } }
  }
}
