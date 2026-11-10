/**
 * Reading finish times, with nothing else imported, so code that only needs
 * these (acceptMatch.js) does not load the research service and its scrapers.
 */

/** "03:12:07" and "3:12:07" are the same clock reading; seconds, or null. */
export function clockSeconds(t) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/)
  if (!m) return null
  return m[3] != null ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])
}

/**
 * The time the customer typed, when it is what the order's result holds now:
 * a research row from the checkout (customer_supplied, or customer_verified
 * by Instant Lookup) with a time. A typed time prints as typed (it is often
 * the runner's watch time); an official result found later confirms who they
 * are, and never replaces it on its own.
 */
export function typedTime(row) {
  return row && /^customer_/.test(String(row.source || '')) && row.officialTime ? String(row.officialTime) : null
}

/** Two time readings that say the same thing: "3:12:07" and "03:12:07", or the same digits however typed. */
export function sameClock(a, b) {
  const x = clockSeconds(a), y = clockSeconds(b)
  if (x != null && y != null) return x === y
  const d = t => String(t || '').replace(/\D/g, '').replace(/^0+/, '')
  return Boolean(d(a)) && d(a) === d(b)
}
