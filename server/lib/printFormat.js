/**
 * How a result reads on the print: the one place for the date, temperature,
 * time and pace formats. The order list (api/_routes/orders/index.js) and the render
 * spec (server/domain/render/spec.js) both use these, so what a designer sees
 * in the panel and what the worker puts on the print cannot drift apart.
 */

/** 10.11.26 */
export function formatRaceDate(date) {
  if (!date) return null
  const d = new Date(date)
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const year = String(d.getUTCFullYear()).slice(-2)
  return `${month}.${day}.${year}`
}

/** "63°F" or "63" -> "63°" */
export function formatTemp(temp) {
  if (!temp) return null
  if (temp.includes('°')) return temp
  return `${temp}°`
}

/** Round milliseconds to the second and drop a leading zero: 04:37:44.935 -> 4:37:45 */
export function formatTime(time) {
  if (!time) return null
  let cleaned = time
  const msMatch = cleaned.match(/^(.+)\.(\d+)$/)
  if (msMatch) {
    const ms = parseInt(msMatch[2].padEnd(3, '0').slice(0, 3))
    cleaned = msMatch[1]
    if (ms >= 500) {
      const parts = cleaned.split(':').map(Number)
      parts[parts.length - 1] += 1
      for (let i = parts.length - 1; i > 0; i--) {
        if (parts[i] >= 60) { parts[i] -= 60; parts[i - 1] += 1 }
      }
      cleaned = parts.map((p, i) => i === 0 ? String(p) : String(p).padStart(2, '0')).join(':')
    }
  }
  return cleaned.replace(/^0(\d):/, '$1:')
}

/** Strip any suffix and a leading zero: "09:43 / mi" -> "9:43" */
export function formatPace(pace) {
  if (!pace) return null
  let cleaned = pace.replace(/\s*\/\s*mi$/i, '').replace(/\s*min\/mile$/i, '')
  cleaned = cleaned.replace(/\/M$/i, '')
  return cleaned.replace(/^0/, '').trim()
}

export function looksLikeTime(v) {
  return typeof v === 'string' && /^\s*\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*$/.test(v)
}

/** Customer-typed time and pace are free text on custom orders; only a real time counts. */
export function pickCustomerValue(v) {
  return looksLikeTime(v) ? v.trim() : null
}

/** "sunny" -> "Sunny" */
export function formatCondition(condition) {
  if (!condition) return null
  return condition.charAt(0).toUpperCase() + condition.slice(1)
}
