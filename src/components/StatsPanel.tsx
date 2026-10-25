/**
 * Storefront stats, on the dashboard.
 *
 * Renders whatever /api/admin/stats returns rather than a fixed set of cards:
 * adding a metric server-side makes it appear here with no change to this file.
 * That is the point of the shape - the panel knows how to draw "a percentage
 * with a denominator", not which percentages exist.
 *
 * Every card shows its denominator. A gifting rate of 100% means something very
 * different over eighteen answers than over four hundred, and a percentage
 * printed alone hides which one you are looking at.
 */
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { segment, segmentGroup, btnGhost } from '@/lib/ui'

interface Metric {
  key: string
  label: string
  unit: string
  describe: string
  value: number | null
  numerator: number
  denominator: number
  detail: string
  note: string | null
}

interface TimeSummary {
  count: number
  medianHours: number | null
  meanHours: number | null
  p90Hours: number | null
  withinGoal: number
  withinGoalPct: number | null
  overFiveDays: number
  orderedBeforeRace: number
  weekly: { from: string; count: number; meanHours: number | null; medianHours: number | null; withinGoalPct: number | null }[]
  leftOut: Record<string, number>
}

interface Fulfillment {
  standard: TimeSummary
  custom: TimeSummary
  openStandard: { workable: number; pastGoal: number }
  goalHours: number
  goalMeanHours: number
}

interface StatsPayload {
  fulfillment?: Fulfillment | null
  range: string
  rangeLabel: string
  orderCount: number
  metrics: Metric[]
  ranges: { key: string; label: string }[]
  computedAt: string
  cached?: boolean
}

const DEFAULT_RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
]

/** Short labels for the toggle; the API's own labels are longer prose. */
const SHORT: Record<string, string> = {
  today: 'Today', yesterday: 'Yesterday', '7d': '7d', '30d': '30d', '90d': '90d',
}

export default function StatsPanel() {
  const [range, setRange] = useState('30d')
  const [data, setData] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (key: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`/api/admin/stats?range=${key}`)
      const json = await res.json()
      if (!res.ok) setError(json.error || 'Could not load stats')
      else setData(json)
    } catch {
      setError('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(range) }, [range, load])

  const ranges = data?.ranges ?? DEFAULT_RANGES

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <div className={segmentGroup}>
            {ranges.map(r => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={segment(range === r.key, 'sm')}
              >
                {SHORT[r.key] ?? r.label}
              </button>
            ))}
          </div>
          <button onClick={() => load(range)} className={btnGhost} disabled={loading} title="Refresh from Shopify">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-border-gray bg-white p-4 text-body-sm text-off-black/50">
          {error}
        </div>
      ) : loading && !data ? (
        <div className="rounded-lg border border-border-gray bg-white p-6 flex justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />
        </div>
      ) : (
        <>
        {data?.fulfillment && <FulfillmentTime f={data.fulfillment} rangeLabel={data.rangeLabel} />}
        <div className="pt-2">
          <p className="text-xs font-semibold text-off-black/50">From Shopify</p>
          {data && <p className="text-[11px] text-off-black/45">{data.orderCount} order{data.orderCount === 1 ? '' : 's'} in this window. Cancelled and test orders are left out.</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data?.metrics.map(m => (
            <div
              key={m.key}
              className="rounded-lg border border-border-gray bg-white p-4"
              title={[m.describe, m.note].filter(Boolean).join('\n\n')}
            >
              <p className="text-xs text-off-black/50">{m.label}</p>
              <p className="text-2xl font-semibold text-off-black mt-0.5 tabular-nums">
                {m.value === null ? (
                  <span className="text-base font-normal text-off-black/35">Not enough data</span>
                ) : (
                  <>{m.value}<span className="text-base text-off-black/40">{m.unit}</span></>
                )}
              </p>
              {/* The denominator, always. A rate without it is unreadable. */}
              <p className="text-[11px] text-off-black/40 mt-0.5">{m.detail}</p>
              {/* A caveat that changes how the number should be read belongs on
                  the card, not in a tooltip nobody hovers. */}
              {m.note && (
                <p className="text-[11px] text-off-black/45 mt-2 pt-2 border-t border-border-gray/60">{m.note}</p>
              )}
            </div>
          ))}
        </div>
        </>
      )}
    </section>
  )
}

const fmtHours = (h: number | null) => {
  if (h === null) return '–'
  if (h < 48) return `${Math.round(h)} hours`
  const d = h / 24
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`
}
const pctTone = (p: number | null) => p === null ? 'text-off-black' : p >= 90 ? 'text-green-700' : p >= 75 ? 'text-amber-600' : 'text-red-600'
// The average against its goal: met is green, within half a day of it amber.
const meanTone = (h: number | null, goal: number) => h === null ? 'text-off-black' : h <= goal ? 'text-green-700' : h <= goal + 12 ? 'text-amber-600' : 'text-red-600'
const fmtDays = (h: number | null) => h === null ? '–' : `${(h / 24).toFixed(1)} days`

/**
 * Our handling time, said plainly: the average against the goal (1.5 days),
 * the share that made the two-day deadline, what a typical order took, the
 * slowest tenth, and the last three weeks.
 * Standard prints and custom designs are different jobs and get their own card.
 */
function FulfillmentTime({ f, rangeLabel }: { f: Fulfillment; rangeLabel: string }) {
  const goalDays = f.goalHours / 24
  const goalMean = f.goalMeanHours ?? 36
  const Card = ({ label, t, how, backlog }: { label: string; t: TimeSummary; how: string; backlog?: { workable: number; pastGoal: number } }) => {
    const weeks = t.weekly.filter(w => w.count > 0).slice(-3).reverse()
    const weekWords = ['This week', 'last week', 'the week before']
    return (
      <div className="rounded-lg border border-border-gray bg-white p-4 space-y-3">
        <p className="text-sm font-semibold text-off-black">{label}</p>
        {t.count === 0 ? (
          <p className="text-sm text-off-black/50">Nothing was completed in this window.</p>
        ) : (
          <>
            <p className="text-off-black leading-snug">
              <span className={`text-3xl font-semibold tabular-nums ${meanTone(t.meanHours, goalMean)}`}>{fmtDays(t.meanHours)}</span>
              <span className="text-sm text-off-black/70"> on average. The goal is {goalMean / 24} days.</span>
            </p>
            <p className="text-sm text-off-black/70">
              <span className={`font-semibold ${pctTone(t.withinGoalPct)}`}>{t.withinGoalPct}%</span> got out within {goalDays} days.
              A typical order took <span className="font-semibold text-off-black">{fmtHours(t.medianHours)}</span>.
              The slowest 1 in 10 took <span className="font-semibold text-off-black">{fmtHours(t.p90Hours)}</span> or more.
            </p>
            {weeks.length > 1 && (
              <p className="text-sm text-off-black/70">
                {weeks.map((w, i) => (
                  <span key={w.from}>{i > 0 ? ', ' : ''}{weekWords[i]} <span className={`font-semibold ${meanTone(w.meanHours, goalMean)}`}>{fmtDays(w.meanHours)}</span></span>
                ))}.
              </p>
            )}
          </>
        )}
        {backlog && (
          <p className="text-sm text-off-black/70">
            Right now <span className={`font-semibold ${backlog.pastGoal ? 'text-red-600' : 'text-off-black'}`}>{backlog.pastGoal}</span> open order{backlog.pastGoal === 1 ? ' has' : 's have'} been waiting more than {goalDays} days{backlog.workable ? `, out of ${backlog.workable} we could be working on` : ''}.
          </p>
        )}
        <p className="text-[11px] text-off-black/45 pt-2 border-t border-border-gray/60">{how} Based on {t.count} order{t.count === 1 ? '' : 's'} completed {rangeLabel.toLowerCase()}. Shipping is not counted.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-off-black/50">How fast we get orders out</p>
      <Card label="Standard prints" t={f.standard} backlog={f.openStandard}
        how={`Counted from when we could start on the order (the order itself, or race day if the race had not happened yet) to when it went to production at Artelo (sent automatically, or marked complete here by someone on the team).`} />
      <Card label="Custom designs" t={f.custom}
        how="Counted from the order to when the design was sent to production." />
    </div>
  )
}
