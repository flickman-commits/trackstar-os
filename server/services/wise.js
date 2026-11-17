/**
 * Wise: pays the team from the Wise Business USD balance (US-registered
 * profile, personal API token). Every call checks in with Connections first,
 * so Settings > Connections can switch Wise off. Only
 * server/domain/finance/wisePay.js sends money through this; nothing here is
 * reachable from a cron or the MCP.
 *
 * API facts (docs.wise.com, checked 2026-11-16):
 *   - Bearer personal token. A US profile may fund transfers by API, and SCA
 *     does not apply to US profiles. Base https://api.wise.com, sandbox
 *     https://api.wise-sandbox.com, chosen by WISE_ENV; no code change between them.
 *   - The /v1../v4 paths here are Wise's "legacy" set, supported with no sunset
 *     planned (the new default is calendar-versioned, /2026Q4/...).
 *   - One transfer per person (POST /v1/transfers, then fund from the balance
 *     with /v3/profiles/{p}/transfers/{id}/payments). Batch groups exist, but
 *     funding a batch returns no per-transfer result; for a handful of people
 *     single transfers are simpler and each one says how it went.
 *   - customerTransactionId: repeats never make a second transfer.
 *   - x-trace-id on every response is what Wise support asks for. It is kept;
 *     the token is never logged.
 */
import { requireConnection } from '../lib/connections.js'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'

const env = k => String(process.env[k] || '').trim()

export const wiseEnv = () => (env('WISE_ENV') === 'production' ? 'production' : 'sandbox')
const BASE = { production: 'https://api.wise.com', sandbox: 'https://api.wise-sandbox.com' }
export const profileId = () => env('WISE_PROFILE_ID')

/**
 * A Wise call that failed. `message` is fit to show (Wise's own error text is
 * not: its docs say so); `code` is Wise's error code. `unsure` means the call
 * may have reached Wise (a timeout, a 5xx): retry with the same
 * customerTransactionId, never a new one.
 */
export class WiseError extends Error {
  constructor(message, { status = 502, code = null, traceId = null, unsure = false } = {}) {
    super(message); this.status = status; this.expose = true; this.code = code; this.traceId = traceId; this.unsure = unsure
  }
}

export async function wise(path, { method = 'GET', body, timeoutMs = 30_000 } = {}) {
  await requireConnection('wise')
  const token = env('WISE_API_TOKEN')
  if (!token) throw new WiseError('WISE_API_TOKEN is not set', { status: 503 })
  let res
  try {
    res = await fetchWithTimeout(`${BASE[wiseEnv()]}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, timeoutMs)
  } catch (err) {
    throw new WiseError('Wise did not answer in time', { unsure: true, code: err?.name === 'TimeoutError' ? 'timeout' : 'network' })
  }
  const traceId = res.headers.get('x-trace-id') || null
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) {
    const code = data?.errors?.[0]?.code || data?.error || data?.errorCode || null
    console.warn(`[wise] ${method} ${path.replace(/\d{5,}/g, '…')} -> ${res.status}${code ? ` ${code}` : ''}${traceId ? ` trace ${traceId}` : ''}`)
    const words = res.status === 401 || res.status === 403 ? 'Wise refused the token: check WISE_API_TOKEN and WISE_PROFILE_ID'
      : res.status === 404 ? 'Wise could not find that'
      : res.status === 429 ? 'Wise asked us to slow down; try again in a minute'
      : res.status >= 500 ? 'Wise had a problem on their side'
      : `Wise said no${code ? ` (${code})` : ''}`
    throw new WiseError(words, { status: res.status >= 500 ? 502 : res.status === 404 ? 404 : 400, code, traceId, unsure: res.status >= 500 })
  }
  return { data, traceId }
}

const pid = () => {
  const p = profileId()
  if (!p) throw new WiseError('WISE_PROFILE_ID is not set', { status: 503 })
  return encodeURIComponent(p)
}
const toCents = v => Math.round(Number(v || 0) * 100)
const toDollars = cents => Math.round(cents) / 100

/** The profile's USD balance available to send, in cents (null when it has none). */
export async function usdBalanceCents() {
  const { data } = await wise(`/v4/profiles/${pid()}/balances?types=STANDARD`)
  const usd = (data || []).find(b => b.currency === 'USD')
  return usd ? toCents(usd.amount?.value) : null
}

/** Every recipient on the profile, optionally one currency: what we need to pick and check one. */
export async function listRecipients({ currency = null } = {}) {
  const out = []
  let seek = null
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ profileId: profileId(), size: '20' })
    if (currency) q.set('currency', currency)
    if (seek != null) q.set('seekPosition', String(seek))
    const { data } = await wise(`/v2/accounts?${q}`)
    const rows = data?.content || []
    out.push(...rows.map(shapeRecipient))
    seek = data?.seekPositionForNext ?? null
    if (!rows.length || seek == null) break
  }
  return out
}

export async function getRecipient(id) {
  const { data } = await wise(`/v2/accounts/${encodeURIComponent(id)}`)
  return shapeRecipient(data)
}

/**
 * The parts of a recipient we use. `summary` is Wise's masked account summary
 * (shown on the page, never stored); `ibanPrefix` is the IBAN's first two
 * letters, enough to check a CRC account is a Costa Rican IBAN.
 */
export function shapeRecipient(r) {
  const iban = String(r?.details?.iban || r?.details?.IBAN || '').replace(/\s+/g, '').toUpperCase()
  return {
    id: String(r?.id ?? ''),
    name: r?.name?.fullName || r?.accountHolderName || r?.details?.accountHolderName || '',
    currency: r?.currency || null,
    country: r?.country || r?.details?.address?.country || null,
    type: r?.type || null,
    summary: r?.longAccountSummary || r?.accountSummary || '',
    ibanPrefix: iban ? iban.slice(0, 2) : (/\bCR\d{2}/.test(String(r?.accountSummary || '')) ? 'CR' : null),
    active: r?.active !== false,
  }
}

/** A quote for a fixed USD amount to a recipient: rate, what they get, the fee, when it expires. */
export async function createQuote({ sourceCents, targetCurrency, recipientId }) {
  const { data, traceId } = await wise(`/v3/profiles/${pid()}/quotes`, {
    method: 'POST',
    body: { sourceCurrency: 'USD', targetCurrency, sourceAmount: toDollars(sourceCents), targetAccount: Number(recipientId) || recipientId, payOut: 'BANK_TRANSFER', preferredPayIn: 'BALANCE' },
  })
  const option = (data?.paymentOptions || []).find(o => o.payIn === 'BALANCE' && !o.disabled) || (data?.paymentOptions || [])[0] || null
  return {
    quoteId: data?.id,
    rate: data?.rate != null ? String(data.rate) : null,
    targetMinor: option?.targetAmount != null ? toCents(option.targetAmount) : data?.targetAmount != null ? toCents(data.targetAmount) : null,
    feeCents: option?.fee?.total != null ? toCents(option.fee.total) : null,
    expiresAt: data?.expirationTime || data?.rateExpirationTime || null,
    disabled: option?.disabled ? 'Wise cannot send this one from the balance' : null,
    traceId,
  }
}

/** Make the transfer (not paid for yet). Safe to repeat with the same customerTransactionId. */
export async function createTransfer({ recipientId, quoteId, customerTransactionId, reference }) {
  const { data, traceId } = await wise('/v1/transfers', {
    method: 'POST',
    body: { targetAccount: Number(recipientId) || recipientId, quoteUuid: quoteId, customerTransactionId, details: { reference: String(reference || '').slice(0, 10) || 'Trackstar' } },
  })
  return { transferId: String(data?.id ?? ''), state: data?.status || null, traceId }
}

/** Pay for a transfer from the USD balance. */
export async function fundTransfer(transferId) {
  const { data, traceId } = await wise(`/v3/profiles/${pid()}/transfers/${encodeURIComponent(transferId)}/payments`, { method: 'POST', body: { type: 'BALANCE' } })
  return { status: data?.status || null, errorCode: data?.errorCode || null, traceId }
}

export async function getTransfer(transferId) {
  const { data, traceId } = await wise(`/v1/transfers/${encodeURIComponent(transferId)}`)
  return { transferId: String(data?.id ?? transferId), state: data?.status || null, traceId }
}

/** Cancel a transfer Wise has not paid out yet (before it is funded). */
export async function cancelTransfer(transferId) {
  const { data, traceId } = await wise(`/v1/transfers/${encodeURIComponent(transferId)}/cancel`, { method: 'PUT' })
  return { state: data?.status || null, traceId }
}

/** For Settings > Connections: who we are connected as, read only. */
export async function whoAmI() {
  const { data } = await wise('/v2/profiles')
  const p = (data || []).find(x => String(x.id) === profileId())
  if (!p) throw new WiseError(`WISE_PROFILE_ID ${profileId()} is not one of this token's profiles`, { status: 400 })
  return { name: p.businessName || p.fullName || p.details?.name || `Profile ${p.id}`, type: p.type }
}
