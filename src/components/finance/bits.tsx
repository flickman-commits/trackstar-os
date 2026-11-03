import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/** The small pieces the Finance pages share. */
export const card = 'rounded-lg border border-border-gray bg-white'
export const tableHead = 'text-[10px] font-semibold uppercase tracking-wider text-off-black/45'
export const num = 'tabular-nums text-right'

export function Spinner() {
  return <div className={`${card} p-8 flex justify-center`}><Loader2 className="w-4 h-4 animate-spin text-off-black/30" /></div>
}
export function ErrorCard({ text }: { text: string }) {
  return <div className={`${card} p-4 text-sm text-red-700`}>{text}</div>
}

/** A value against the compare period: green up, red down, with the tone flipped for costs. */
export function Delta({ now, before, costly = false, fmt }: { now: number | null; before: number | null; costly?: boolean; fmt?: (v: number) => string }) {
  if (now == null || before == null || !before) return <span className="text-[11px] text-off-black/40">no compare</span>
  const pct = ((now - before) / Math.abs(before)) * 100
  const up = pct >= 0
  const good = costly ? !up : up
  const tone = Math.abs(pct) < 0.05 ? 'text-off-black/45' : good ? 'text-green-700' : 'text-red-600'
  return <span className={`text-[11px] font-medium tabular-nums ${tone}`}>{up ? '▲' : '▼'} {Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%{fmt ? <span className="text-off-black/40 font-normal"> vs {fmt(before)}</span> : null}</span>
}

/** Big number, its label, a line under it, an optional sparkline on the right. */
export function Tile({ label, value, sub, delta, spark, title }: { label: string; value: ReactNode; sub?: ReactNode; delta?: ReactNode; spark?: ReactNode; title?: string }) {
  return (
    <div className={`${card} p-4 flex items-start justify-between gap-3 min-w-0`} title={title}>
      <div className="min-w-0">
        <p className="text-xs text-off-black/50">{label}</p>
        <p className="text-2xl md:text-[28px] font-semibold text-off-black mt-0.5 tabular-nums leading-tight truncate">{value}</p>
        {sub && <p className="text-[11px] text-off-black/50 mt-0.5">{sub}</p>}
        {delta && <p className="mt-1">{delta}</p>}
      </div>
      {spark && <div className="w-20 h-10 shrink-0 self-center">{spark}</div>}
    </div>
  )
}

/** A 30-day line of one metric, no axes: the shape of the last month. */
export function Spark({ values, color = '#121212' }: { values: (number | null)[]; color?: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter(p => p[1] != null) as [number, number][]
  if (pts.length < 2) return null
  const w = 80, h = 40, pad = 3
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(0, ...ys), maxY = Math.max(...ys)
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (w - pad * 2)
  const sy = (y: number) => h - pad - ((y - minY) / Math.max(1, maxY - minY)) * (h - pad * 2)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={sx(last[0])} cy={sy(last[1])} r="3" fill={color} stroke="#fff" strokeWidth="2" />
    </svg>
  )
}

export function StatusChip({ status }: { status: string }) {
  const tone: Record<string, string> = {
    draft: 'bg-white border-border-gray text-off-black/60', submitted: 'bg-amber-100 border-amber-300 text-amber-800', approved: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    rejected: 'bg-rose-100 border-rose-300 text-rose-800', paid: 'bg-emerald-100 border-emerald-300 text-emerald-800', empty: 'bg-white border-border-gray text-off-black/40',
  }
  const label: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Sent back', paid: 'Paid', empty: 'No hours' }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${tone[status] || tone.draft}`}>{label[status] || status}</span>
}
