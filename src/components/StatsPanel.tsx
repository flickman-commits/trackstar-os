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

interface DaySummary { meanDays: number | null; medianDays: number | null; p90Days: number | null }

interface CustomPromise {
  count: number
  finalOnTime: number
  finalOnTimePct: number | null
  withProofs: number
  firstLookOnTime: number
  firstLookOnTimePct: number | null
  firstLook: DaySummary
  toFinal: DaySummary
  meanRounds: number | null
  noProofs: number
  openPastDue: number
  openNoProofsPastDue: number
}

interface Fulfillment {
  standard: TimeSummary
  custom: TimeSummary
  customPromise?: CustomPromise
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

const pctTone = (p: number | null) => p === null ? 'text-off-black' : p >= 90 ? 'text-green-700' : p >= 75 ? 'text-amber-600' : 'text-red-600'
// The average against its goal: met is green, within half a day of it amber.
const meanTone = (h: number | null, goal: number) => h === null ? 'text-off-black' : h <= goal ? 'text-green-700' : h <= goal + 12 ? 'text-amber-600' : 'text-red-600'

/** One number, its denominator under it: the same card as Gifting rate. */
function SpeedCard({ label, value, unit, tone, detail, title }: { label: string; value: string | null; unit?: string; tone: string; detail: string; title: string }) {
  return (
    <div className="rounded-lg border border-border-gray bg-white p-4" title={title}>
      <p className="text-xs text-off-black/50">{label}</p>
      <p className={`text-2xl font-semibold mt-0.5 tabular-nums ${value === null ? '' : tone}`}>
        {value === null ? <span className="text-base font-normal text-off-black/35">Not enough data</span> : <>{value}{unit && <span className="text-base text-off-black/40">{unit}</span>}</>}
      </p>
      <p className="text-[11px] text-off-black/40 mt-0.5">{detail}</p>
    </div>
  )
}

/**
 * How fast we get orders out, as plain cards. Standard prints: the share out
 * within the 1.5-day goal and the average. Customs: the share whose first
 * designs reached the customer within the 14-day design turnaround (time the
 * customer then spends reviewing is theirs, so it is not counted).
 */
function FulfillmentTime({ f, rangeLabel }: { f: Fulfillment; rangeLabel: string }) {
  const s = f.standard
  const c = f.customPromise
  const goalDays = (f.goalHours / 24).toFixed(1).replace(/\.0$/, '')
  return (
    <>
      <p className="text-xs font-semibold text-off-black/50">How fast we get orders out</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SpeedCard
          label={`Standard out within ${goalDays} days`}
          value={s.withinGoalPct === null ? null : String(s.withinGoalPct)} unit="%"
          tone={pctTone(s.withinGoalPct)}
          detail={`${s.withinGoal} of ${s.count} orders`}
          title={`From when we could start (the order, or race day if later) to when it went to production at Artelo. ${rangeLabel}. Shipping is not counted.`}
        />
        <SpeedCard
          label="Standard average time out"
          value={s.meanHours === null ? null : (s.meanHours / 24).toFixed(1)} unit=" days"
          tone={meanTone(s.meanHours, f.goalMeanHours)}
          detail={`Goal ${(f.goalMeanHours / 24).toFixed(1)} days · ${f.openStandard.pastGoal} open past ${goalDays} days now`}
          title={`Average from when we could start to production at Artelo, ${rangeLabel.toLowerCase()}.`}
        />
        <SpeedCard
          label="Customs: first designs within 14 days"
          value={!c || c.firstLookOnTimePct === null ? null : String(c.firstLookOnTimePct)} unit="%"
          tone={pctTone(c?.firstLookOnTimePct ?? null)}
          detail={c ? `${c.firstLookOnTime} of ${c.withProofs} custom orders` : 'No custom orders'}
          title={`Custom orders whose first designs were emailed to the customer within 14 days of the order (4 with the rush fee), of those sent to production ${rangeLabel.toLowerCase()}. Time the customer spends reviewing is not counted.`}
        />
      </div>
    </>
  )
}
