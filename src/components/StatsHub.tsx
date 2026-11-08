import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { segment, segmentGroup, btnGhost } from '@/lib/ui'
import { usd } from '@/lib/financeApi'

/**
 * Settings > Stats (admin only): every number on one page of cards, the way
 * the Charity Bib Finder lays out a charity (a small line and a coloured tag
 * on top, the number as the big bold title, label-over-value details along
 * the bottom), for one period picked at the top.
 *
 * Every period is fetched when the page opens, the one on screen first, so
 * switching periods shows numbers at once. Two reads per period:
 * /api/admin/stats (order speed and the Shopify numbers) and
 * /api/admin/support-stats (email tickets, orders with a ticket, who closed
 * what, replacement spend). Its old addresses (/settings/support_closes,
 * /settings/support_stats) open it too.
 */

const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
] as const
type RangeKey = (typeof RANGES)[number]['key']

type Metric = { key: string; label: string; unit: string; describe: string; value: number | null; detail: string; note: string | null }
type TimeSummary = { count: number; meanHours: number | null; withinGoal: number; withinGoalPct: number | null }
type CustomPromise = { withProofs: number; firstLookOnTime: number; firstLookOnTimePct: number | null; openPastDue: number }
type Fulfillment = { standard: TimeSummary; customPromise?: CustomPromise; openStandard: { workable: number; pastGoal: number }; goalHours: number; goalMeanHours: number }
type Shop = { fulfillment?: Fulfillment | null; rangeLabel: string; orderCount: number; metrics: Metric[] }
type Support = {
  days: number
  email: { received: number; closed: number }
  rate: { windowDays: number; orders: number; withTicket: number; pct: number | null; stillCounting: boolean; partial: boolean }
  closers: { id: string; name: string; closed: number }[]
  replacements: { count: number; cents: number }
}
type Period = { shop?: Shop; support?: Support; error?: string }

// The Bib Finder's cause colours: a soft fill and a dark ink of the same hue.
const TAGS = {
  Fulfillment: 'bg-[#D7EFF6] text-[#0D5A6D]',
  Customs: 'bg-[#DCEAFB] text-[#1C4A82]',
  Shopify: 'bg-[#FFE4CC] text-[#813F00]',
  Support: 'bg-[#FCE4EC] text-[#8E1A45]',
  Team: 'bg-[#DEF1D6] text-[#2C641C]',
  Finance: 'bg-[#FCE0DA] text-[#8F2A19]',
} as const
type Tag = keyof typeof TAGS

const GOOD = 'text-[#2E7D5B]', OK = 'text-amber-600', BAD = 'text-red-600'
const pctTone = (p: number | null) => p === null ? '' : p >= 90 ? GOOD : p >= 75 ? OK : BAD
const meanTone = (h: number | null, goal: number) => h === null ? '' : h <= goal ? GOOD : h <= goal + 12 ? OK : BAD

type Card = { key: string; line: string; tag: Tag; value: string | null; unit?: string; tone?: string; facts: { k: string; v: string }[]; title?: string; note?: string | null }

/** The period's cards, in reading order: speed, support, money, then the Shopify numbers. */
function cardsFor(p: Period, label: string): Card[] {
  const out: Card[] = []
  const f = p.shop?.fulfillment
  if (f) {
    const s = f.standard, c = f.customPromise
    const goalDays = (f.goalHours / 24).toFixed(1).replace(/\.0$/, '')
    out.push({
      key: 'std-goal', line: `Standard out within ${goalDays} days`, tag: 'Fulfillment',
      value: s.withinGoalPct === null ? null : String(s.withinGoalPct), unit: '%', tone: pctTone(s.withinGoalPct),
      facts: [{ k: 'On time', v: `${s.withinGoal} of ${s.count}` }, { k: 'Open past goal now', v: String(f.openStandard.pastGoal) }],
      title: 'From when we could start (the order, or race day if later) to when it went to production at Artelo. Shipping is not counted.',
    })
    out.push({
      key: 'std-mean', line: 'Standard average time out', tag: 'Fulfillment',
      value: s.meanHours === null ? null : (s.meanHours / 24).toFixed(1), unit: ' days', tone: meanTone(s.meanHours, f.goalMeanHours),
      facts: [{ k: 'Goal', v: `${(f.goalMeanHours / 24).toFixed(1)} days` }, { k: 'Orders', v: String(s.count) }],
      title: 'Average from when we could start to production at Artelo.',
    })
    out.push({
      key: 'custom-first', line: 'Custom first designs within 14 days', tag: 'Customs',
      value: !c || c.firstLookOnTimePct === null ? null : String(c.firstLookOnTimePct), unit: '%', tone: pctTone(c?.firstLookOnTimePct ?? null),
      facts: [{ k: 'On time', v: c ? `${c.firstLookOnTime} of ${c.withProofs}` : '–' }, { k: 'Open past due', v: c ? String(c.openPastDue) : '–' }],
      title: 'Custom orders whose first designs reached the customer within 14 days (4 with the rush fee). Time the customer spends reviewing is not counted.',
    })
  }
  const sp = p.support
  if (sp) {
    const perDay = (n: number) => sp.days > 1 ? (n / sp.days).toFixed(1) : String(n)
    out.push({
      key: 'tickets-in', line: sp.days > 1 ? 'Email tickets in a day' : 'Email tickets in', tag: 'Support',
      value: perDay(sp.email.received),
      facts: [{ k: 'In', v: String(sp.email.received) }, { k: 'Closed', v: String(sp.email.closed) }],
      title: "A customer's first email, or their first after it was closed. Filtered senders are left out.",
    })
    out.push({
      key: 'tickets-closed', line: sp.days > 1 ? 'Email tickets closed a day' : 'Email tickets closed', tag: 'Support',
      value: perDay(sp.email.closed), tone: sp.email.closed >= sp.email.received ? GOOD : OK,
      facts: [{ k: 'Closed', v: String(sp.email.closed) }, { k: sp.email.closed >= sp.email.received ? 'Ahead by' : 'Behind by', v: String(Math.abs(sp.email.closed - sp.email.received)) }],
      title: 'Conversations closed, by anyone, once a day each.',
    })
    out.push({
      key: 'ticket-rate', line: 'Orders with a support ticket', tag: 'Support',
      value: sp.rate.pct === null ? null : String(sp.rate.pct), unit: '%',
      facts: [{ k: 'Wrote in', v: `${sp.rate.withTicket} of ${sp.rate.orders}` }, { k: 'Counted for', v: `${sp.rate.windowDays} days` }],
      title: `Orders placed ${label.toLowerCase()} (one per Shopify or Etsy order) whose customer emailed us within ${sp.rate.windowDays} days. Instagram messages have no email to match.`,
      note: sp.rate.partial ? 'Starts before the inbox was tracked, so it reads low.' : sp.rate.stillCounting ? `Still counting: these customers have up to ${sp.rate.windowDays} days to write.` : null,
    })
    const allClosed = sp.closers.reduce((n, c) => n + c.closed, 0)
    for (const c of sp.closers) {
      out.push({
        key: `closer-${c.id}`, line: `${c.name} closed`, tag: 'Team', value: String(c.closed),
        facts: [{ k: 'A day', v: sp.days > 1 ? (c.closed / sp.days).toFixed(1) : String(c.closed) }, { k: 'Share of closes', v: allClosed ? `${Math.round((c.closed / allClosed) * 100)}%` : '–' }],
        title: 'Support conversations this person closed, email and Instagram, credited to whoever clicked Close.',
      })
    }
    out.push({
      key: 'replacements', line: 'Replacements we paid for', tag: 'Finance', value: usd(sp.replacements.cents),
      facts: [{ k: 'Sent', v: String(sp.replacements.count) }, { k: 'Each', v: sp.replacements.count ? usd(Math.round(sp.replacements.cents / sp.replacements.count)) : '–' }],
      title: 'Replacements made from Support, at what Artelo billed. Cancelled and paid-back ones are left out. Finance > Replacements has each one.',
    })
  }
  for (const m of p.shop?.metrics || []) {
    out.push({ key: `shop-${m.key}`, line: m.label, tag: 'Shopify', value: m.value === null ? null : String(m.value), unit: m.unit, facts: [{ k: 'Out of', v: m.detail }], title: m.describe, note: m.note })
  }
  return out
}

function StatCard({ c, i, enter }: { c: Card; i: number; enter: boolean }) {
  return (
    <div title={c.title} style={enter ? { animationDelay: `${Math.min(i, 12) * 35}ms`, animationFillMode: 'both', animationDuration: '450ms' } : undefined}
      className={`${enter ? 'animate-fade-in-up ' : ''}flex flex-col p-5 bg-white rounded-lg min-h-[196px] transition-shadow hover:shadow-[0_0_0_1.5px_#4600D6]`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-medium leading-tight text-off-black">{c.line}</span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${TAGS[c.tag]}`}>{c.tag}</span>
      </div>
      <div className={`mt-3 mb-5 text-[40px] font-bold leading-none tracking-[-0.05em] tabular-nums ${c.value === null ? '' : c.tone || 'text-off-black'}`}>
        {c.value === null ? <span className="text-xl font-medium tracking-normal text-off-black/35">Not enough data</span> : <>{c.value}{c.unit && <span className="text-2xl text-off-black/35">{c.unit}</span>}</>}
      </div>
      <div className={`mt-auto grid gap-3 ${c.facts.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {c.facts.map((f, n) => (
          <div key={f.k} className={n === 1 ? 'text-right' : ''}>
            <span className="block text-[13px] text-off-black/50 mb-0.5">{f.k}</span>
            <span className={`block font-bold leading-tight tracking-[-0.04em] text-off-black ${f.v.length > 14 ? 'text-sm' : 'text-xl'}`}>{f.v}</span>
          </div>
        ))}
      </div>
      {c.note && <p className="mt-3 pt-2 border-t border-border-gray/70 text-xs text-off-black/50">{c.note}</p>}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col p-5 bg-white rounded-lg min-h-[196px] animate-pulse">
      <div className="flex justify-between"><div className="h-4 w-36 rounded bg-off-black/[0.07]" /><div className="h-6 w-20 rounded-full bg-off-black/[0.07]" /></div>
      <div className="mt-4 h-10 w-28 rounded bg-off-black/[0.08]" />
      <div className="mt-auto grid grid-cols-2 gap-3"><div className="h-9 rounded bg-off-black/[0.06]" /><div className="h-9 rounded bg-off-black/[0.06]" /></div>
    </div>
  )
}

async function getJson<T>(url: string): Promise<T> {
  const r = await apiFetch(url)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Could not load')
  return j as T
}

export default function StatsHub(_props: { initial?: string }) {
  const [range, setRange] = useState<RangeKey>('30d')
  const [periods, setPeriods] = useState<Partial<Record<RangeKey, Period>>>({})
  const [refreshing, setRefreshing] = useState(false)
  const order = useRef<RangeKey[]>([])

  const loadOne = useCallback(async (key: RangeKey) => {
    const [shop, support] = await Promise.allSettled([getJson<Shop>(`/api/admin/stats?range=${key}`), getJson<Support>(`/api/admin/support-stats?range=${key}`)])
    setPeriods(prev => ({ ...prev, [key]: {
      shop: shop.status === 'fulfilled' ? shop.value : undefined,
      support: support.status === 'fulfilled' ? support.value : undefined,
      error: shop.status === 'rejected' && support.status === 'rejected' ? (shop.reason as Error).message : undefined,
    } }))
  }, [])

  // The period on screen first, then the rest behind it, so a switch is instant.
  const loadAll = useCallback(async (first: RangeKey) => {
    order.current = [first, ...RANGES.map(r => r.key).filter(k => k !== first)]
    await loadOne(first)
    await Promise.all(order.current.slice(1).map(loadOne))
  }, [loadOne])
  useEffect(() => { void loadAll('30d') }, [loadAll])

  const refresh = async () => { setRefreshing(true); try { setPeriods({}); setEntered(false); await loadAll(range) } finally { setRefreshing(false) } }

  const p = periods[range]
  // The cards fade in once, when the first period lands; after that a switch
  // (or a card moving because the order changed) shows at once.
  const [entered, setEntered] = useState(false)
  useEffect(() => { if (!p || entered) return; const t = window.setTimeout(() => setEntered(true), 1200); return () => window.clearTimeout(t) }, [p, entered])
  const label = RANGES.find(r => r.key === range)?.label || ''
  const cards = p ? cardsFor(p, label) : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={`${segmentGroup} max-w-full overflow-x-auto`}>
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} className={`${segment(range === r.key, 'sm')} whitespace-nowrap`}>
              {r.label}{!periods[r.key] && <span className="ml-1.5 inline-block w-1 h-1 rounded-full bg-current opacity-30 animate-pulse align-middle" />}
            </button>
          ))}
        </div>
        <button onClick={refresh} className={btnGhost} disabled={refreshing} title="Read everything again">
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      <div className="rounded-[18px] bg-[#F6F5F2] p-2 sm:p-3">
        {p?.error ? <p className="p-4 text-sm text-red-600">{p.error}</p> : (
          // Cards fade in once; a period switch updates them in place, instantly.
          <div key={p ? 'ready' : 'loading'} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
            {p ? cards.map((c, i) => <StatCard key={c.key} c={c} i={i} enter={!entered} />) : Array.from({ length: 9 }, (_, i) => <Skeleton key={i} />)}
          </div>
        )}
      </div>
    </div>
  )
}
