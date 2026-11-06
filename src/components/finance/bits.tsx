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

/** The change against the compare period as a small pill: green when it went the good way, red when not. */
export function DeltaPill({ now, before, costly = false }: { now: number | null; before: number | null; costly?: boolean }) {
  if (now == null || before == null || !before) return <span className="shrink-0 rounded-full bg-off-black/5 px-2.5 py-1 text-[11px] font-medium text-off-black/45">No compare</span>
  const pct = ((now - before) / Math.abs(before)) * 100
  const up = pct >= 0
  const good = costly ? !up : up
  const flat = Math.abs(pct) < 0.05
  const tone = flat ? 'bg-off-black/5 text-off-black/55' : good ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${tone}`}>{up ? '▲' : '▼'} {Math.abs(pct).toFixed(Math.abs(pct) >= 100 ? 0 : 1)}%</span>
}

/**
 * One number per card, like the charity bib finder: the label and the change
 * on top, the big number, the shape of the last 30 days, and two plain
 * details at the bottom.
 */
export function Tile({ label, value, pill, compare, spark, details = [], title }: {
  label: string; value: ReactNode; pill?: ReactNode; compare?: ReactNode; spark?: ReactNode
  details?: [string, ReactNode][]; title?: string
}) {
  return (
    <div className="rounded-xl bg-white border border-border-gray/70 p-5 flex flex-col min-w-0" title={title}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-off-black/80">{label}</p>
        {pill}
      </div>
      <p className="mt-4 text-[34px] leading-none font-bold tracking-tight text-off-black tabular-nums">{value}</p>
      {compare && <p className="mt-1.5 text-[11px] text-off-black/45">{compare}</p>}
      {spark && <div className="mt-4 h-12 -mx-1">{spark}</div>}
      {details.length > 0 && (
        <div className="mt-auto pt-4 flex items-end justify-between gap-4">
          {details.slice(0, 2).map(([k, v], i) => (
            <div key={k} className={`min-w-0 ${i ? 'text-right' : ''}`}>
              <p className="text-[11px] text-off-black/50">{k}</p>
              <p className="text-base font-bold text-off-black tabular-nums leading-tight">{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A 30-day line of one metric, no axes: the shape of the last month. */
export function Spark({ values, color = '#121212' }: { values: (number | null)[]; color?: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter(p => p[1] != null) as [number, number][]
  if (pts.length < 2) return null
  const w = 240, h = 48, pad = 4
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(0, ...ys), maxY = Math.max(...ys)
  const sx = (x: number) => pad + ((x - minX) / Math.max(1, maxX - minX)) * (w - pad * 2)
  const sy = (y: number) => h - pad - ((y - minY) / Math.max(1, maxY - minY)) * (h - pad * 2)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-full overflow-visible" aria-hidden="true">
      <path d={`${d} L${sx(last[0]).toFixed(1)},${h} L${sx(pts[0][0]).toFixed(1)},${h} Z`} fill={color} opacity="0.08" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function StatusChip({ status }: { status: string }) {
  // Three states everywhere: In progress (still being filled in, or sent back to fix), Submitted (waiting on Matt), Approved.
  const tone: Record<string, string> = {
    draft: 'bg-white border-border-gray text-off-black/60', in_progress: 'bg-white border-border-gray text-off-black/60', rejected: 'bg-white border-rose-300 text-rose-800',
    submitted: 'bg-amber-100 border-amber-300 text-amber-800', approved: 'bg-emerald-100 border-emerald-300 text-emerald-800',
    paid: 'bg-emerald-100 border-emerald-300 text-emerald-800', empty: 'bg-white border-border-gray text-off-black/40',
  }
  const label: Record<string, string> = { draft: 'In progress', in_progress: 'In progress', rejected: 'In progress', submitted: 'Submitted', approved: 'Approved', paid: 'Paid', empty: 'No hours' }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${tone[status] || tone.draft}`}>{label[status] || status}</span>
}
