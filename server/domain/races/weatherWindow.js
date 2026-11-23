/**
 * When a race day's weather exists. The print's weather is the average of
 * 7am to 1pm where the race is (WeatherService), so it exists once 1pm
 * local has passed on race day. Before that, any number is a forecast.
 *
 * Philadelphia and CIM 2026 had weather typed in ten days early, for a
 * creator's print made before race day, and it was confirmed for every order
 * of the year. These helpers are what stop that.
 */

/** Milliseconds the timezone is ahead of UTC at `ts`. */
function tzOffsetMs(ts, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts))
  const get = t => Number(parts.find(p => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ts
}

/**
 * The moment the 7am to 1pm window closes: 1pm on the race date in the race's
 * timezone. With no timezone known, 13:00 UTC, the earliest 1pm anywhere we
 * sell (London), so a row is never called early when it might not be; the
 * calculation itself knows the timezone and checks exactly.
 * @param raceDate  a Date, or "YYYY-MM-DD"
 * @param timeZone  an IANA name ("America/New_York"), or null
 */
export function weatherWindowClosesAt(raceDate, timeZone = null) {
  if (!raceDate) return null
  const day = raceDate instanceof Date ? raceDate.toISOString().slice(0, 10) : String(raceDate).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 13)
  if (!timeZone) return new Date(naive)
  try {
    return new Date(naive - tzOffsetMs(naive, timeZone))
  } catch {
    return new Date(naive)
  }
}

export function weatherWindowClosed(raceDate, timeZone = null, now = Date.now()) {
  const at = weatherWindowClosesAt(raceDate, timeZone)
  return Boolean(at) && now >= at.getTime()
}

/** The timezone a computed weather breakdown recorded, if any. */
export function breakdownTimezone(weatherDetails) {
  try { return (typeof weatherDetails === 'string' ? JSON.parse(weatherDetails) : weatherDetails)?.timezone || null } catch { return null }
}
