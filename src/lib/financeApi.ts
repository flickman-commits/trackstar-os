/** Typed client for /api/finance/*, and the money and time spellings the pages share. */
import { apiFetch } from '@/lib/api'
import type { ForecastPayload, MonthPayouts, DailyPayload, DayInput, HoursPayload, OverviewPayload, PayRun, Person, RacePayout, RacePayoutsPayload, Rate, SyncInfo, Timesheet, TrybeCheck } from '@/types/finance'

export class FinanceApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new FinanceApiError((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}
const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const financeApi = {
  overview: (period: string) => request<OverviewPayload>(`/api/finance/overview?period=${encodeURIComponent(period)}`),
  daily: (month: string) => request<DailyPayload>(`/api/finance/daily?month=${month}`),
  dayInputs: (day: string) => request<{ day: string; inputs: DayInput[]; readAt: string | null }>(`/api/finance/daily?day=${day}`),
  sync: (all = false) => post<NonNullable<SyncInfo>>('/api/finance/daily', { action: 'sync', all }),
  override: (day: string, field: string, value: number | null) => post<{ day: string; inputs: DayInput[] }>('/api/finance/daily', { action: 'override', day, field, value }),
  hours: (week?: string) => request<HoursPayload>(`/api/finance/hours${week ? `?week=${week}` : ''}`),
  hoursAction: (body: Record<string, unknown>) => post<HoursPayload>('/api/finance/hours', body),
  timesheetsWeek: (week: string) => request<{ timesheets: Timesheet[]; people: Person[]; weekStart: string; thisWeek: string }>(`/api/finance/timesheets?week=${week}`),
  timesheets: (status = 'all', user = '') => request<{ timesheets: Timesheet[]; people: Person[] }>(`/api/finance/timesheets?status=${status}${user ? `&user=${user}` : ''}`),
  review: (id: string, action: 'approve' | 'reject' | 'withdraw', note = '') => post<{ timesheet: Timesheet }>('/api/finance/timesheets', { action, id, note }),
  payoutAction: <T = PayRun,>(body: Record<string, unknown>) => post<T>('/api/finance/payouts', body),
  racePayouts: () => request<RacePayoutsPayload>('/api/finance/race-payouts'),
  racePayoutAction: (body: Record<string, unknown>) => post<{ race: RacePayout }>('/api/finance/race-payouts', body),
  trybeCheck: (refresh = false) => request<TrybeCheck>(`/api/finance/trybe${refresh ? '?refresh=1' : ''}`),
  racePayoutsRefresh: () => post<{ refreshed: number; failed: { name: string; error: string }[] }>('/api/finance/race-payouts', { action: 'refresh_live' }),
  racePayoutsDue: () => post<{ computed: number; failed: { name: string; error: string }[] }>('/api/finance/race-payouts', { action: 'compute_due' }),
  replacements: (month: string) => request<ReplacementsPayload>(`/api/finance/replacements?month=${month}`),
  replacementUpdate: (body: { id: string; reason?: string; note?: string; reimbursed?: boolean }) => post<{ ok: true }>('/api/finance/replacements', body),
  forecast: (scenario: string) => request<ForecastPayload>(`/api/finance/forecast?scenario=${scenario}`),
  forecastAction: (body: Record<string, unknown>) => post<ForecastPayload>('/api/finance/forecast', body),
  payoutsMonth: (month: string) => request<MonthPayouts>(`/api/finance/payouts?month=${month}`),
  payoutRates: () => request<{ rates: Rate[] }>('/api/finance/payouts?rates=1'),
  setHourlyRate: (userId: string, cents: number | null) => post<{ rates: Rate[] }>('/api/finance/payouts', { action: 'set_hourly_rate', userId, cents }),
}

/** "$50,064" above a thousand dollars, "$845.00" under it; negatives in parentheses. */
export function usd(cents: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (cents == null || Number.isNaN(cents)) return '–'
  const abs = Math.abs(cents)
  const showCents = opts.cents ?? abs < 100_000
  const s = `$${(abs / 100).toLocaleString('en-US', { minimumFractionDigits: showCents ? 2 : 0, maximumFractionDigits: showCents ? 2 : 0 })}`
  return cents < 0 ? `(${s})` : s
}
/** "$1.2k" / "$50k" for a tight axis. */
export function usdShort(cents: number): string {
  const d = cents / 100
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}m`
  if (Math.abs(d) >= 1000) return `$${Math.round(d / 1000)}k`
  return `$${Math.round(d)}`
}
export const pctText = (v: number | null | undefined, digits = 1) => (v == null ? '–' : `${v.toFixed(digits)}%`)
export const xText = (v: number | null | undefined) => (v == null ? '–' : `${v.toFixed(2)}x`)
export const intText = (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('en-US'))

/** Hours and minutes, never a fraction: "3h 2m", "45m", "8h". */
export const hoursText = (minutes: number) => { const m = Math.max(0, Math.round(minutes)); const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m` }
export const hhmm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`

const parseDay = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)) }
export const dayLabel = (d: string, style: 'short' | 'weekday' | 'long' = 'short') =>
  new Intl.DateTimeFormat('en-US', style === 'weekday' ? { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' } : style === 'long' ? { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parseDay(d))
export const monthLabel = (m: string) => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDay(`${m}-15`))
export const addDays = (d: string, n: number) => parseDay(d).getTime() + n * 86400000 > 0 ? new Date(parseDay(d).getTime() + n * 86400000).toISOString().slice(0, 10) : d
export const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export const mondayOf = (d: string) => { const dow = parseDay(d).getUTCDay(); return addDays(d, dow === 0 ? -6 : 1 - dow) }
export const shiftMonth = (month: string, by: number) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }

/** The chart series, in the validated order (dataviz reference palette, light). */
export const SERIES = { cogs: '#2a78d6', adSpend: '#eb6834', designerFee: '#9b6fd0', cm: '#1baf7a', revenue: '#eda100', muted: '#9a9a9a' }

export type ReplacementRow = {
  id: string; arteloOrderId: string; orderNumber: string; url: string | null; threadId: string | null
  reason: string; note: string; items: { label?: string; kind: 'print' | 'frame'; size: string; frame: string }[]
  cents: number; billed: boolean; canceled: boolean; reimbursed: boolean; by: string | null; createdAt: string
}
export type ReplacementsPayload = {
  month: string; today: string; reasons: { value: string; label: string }[]
  count: number; totalCents: number; estimated: boolean
  byReason: { reason: string; label: string; count: number; cents: number }[]
  rows: ReplacementRow[]
}
