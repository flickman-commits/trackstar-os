/**
 * Trybe Brand API (https://api.jointrybe.com/v1), read-only.
 *
 * Trybe pays creators a commission on the sales their content drives and
 * bills us weekly for it. The Brand API reports, per creator and per UTC
 * day range, what they earned (earnings_cents) and the sales Trybe
 * attributed to them (trybe_gmv_cents, trybe_conversions). Money is integer
 * cents, USD. Days are UTC calendar days and only complete ones: end_date
 * must be yesterday (UTC) or earlier.
 *
 * Auth: TRYBE_API_KEY, a brand key (tk_live_...) made on the Integrations
 * page in Trybe, sent as a bearer token. Limits: 60 requests a minute and
 * 5,000 a day; a 429 says how long to wait in retry-after.
 */
import { requireConnection } from '../lib/connections.js'

const BASE = 'https://api.jointrybe.com/v1'

export class TrybeError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function trybeGet(path, params = {}, attempt = 0) {
  await requireConnection('trybe')
  const key = process.env.TRYBE_API_KEY
  if (!key) throw new TrybeError('TRYBE_API_KEY is not set', 503)
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))
  const res = await fetch(`${BASE}${path}${qs.size ? `?${qs}` : ''}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  if (res.status === 429 && attempt < 4) {
    await sleep(Math.min(60, Number(res.headers.get('retry-after') || 2)) * 1000)
    return trybeGet(path, params, attempt + 1)
  }
  if (!res.ok) {
    let type = ''
    try { type = (await res.json())?.error?.type || '' } catch { /* not JSON */ }
    throw new TrybeError(`Trybe answered ${res.status}${type ? ` (${type})` : ''}`, res.status)
  }
  return res.json()
}

/**
 * One UTC day, summed across every creator: what they earned, and the sales
 * and conversions Trybe attributed to them.
 */
export async function dayTotals(day) {
  let after = null
  const out = { earningsCents: 0, gmvCents: 0, conversions: 0, creators: 0 }
  for (let page = 0; page < 50; page++) {
    const res = await trybeGet('/creator-performance', { start_date: day, end_date: day, limit: 100, after })
    for (const row of res.data || []) {
      const p = row.performance || {}
      out.earningsCents += Number(p.earnings_cents || 0)
      out.gmvCents += Number(p.trybe_gmv_cents || 0)
      out.conversions += Number(p.trybe_conversions || 0)
      out.creators++
    }
    if (!res.has_more || !res.next_cursor) break
    after = res.next_cursor
  }
  return out
}

/** Read-only check for Settings > Connections. */
export async function ping() {
  const res = await trybeGet('/creators', { limit: 1 })
  return res.has_more || (res.data || []).length ? 'Brand API answering' : 'Brand API answering, no creators yet'
}
