import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { segment, segmentGroup } from '@/lib/ui'

type Day = { day: string; received: number; closed: number }
type Month = { month: string; orders: number; withTicket: number | null; pct: number | null; tracked: boolean; complete: boolean }
type Data = { daily: { days: Day[]; totals: { received: number; closed: number } }; rate: { windowDays: number; trackedFrom: string | null; months: Month[] } }

const RANGES = [7, 30, 90] as const
const dayLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
const monthLabel = (iso: string) => { const [y, m] = iso.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

/**
 * Settings > Stats > Support (admin only): email tickets in and closed per
 * day, and the share of orders whose customer wrote in
 * (server/domain/support/supportStats.js).
 */
export default function SupportStatsPanel() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setData(null); setError(null)
    apiFetch(`/api/admin/support-stats?days=${days}&months=6`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not load'); return j })
      .then(j => { if (live) setData(j) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load') })
    return () => { live = false }
  }, [days])

  const max = data ? Math.max(1, ...data.daily.days.map(d => Math.max(d.received, d.closed))) : 1
  const thisMonth = data?.rate.months[0]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-off-black/55">Email tickets and how many orders lead to one. Eastern time.</p>
        <div className={segmentGroup}>
          {RANGES.map(r => <button key={r} onClick={() => setDays(r)} className={segment(days === r)}>{r} days</button>)}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-white border border-border-gray rounded-lg p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Tickets in</div>
              <div className="text-3xl font-bold text-off-black mt-1 tabular-nums">{(data.daily.totals.received / days).toFixed(1)}</div>
              <div className="text-sm text-off-black/50 mt-0.5 tabular-nums">a day · {data.daily.totals.received} in {days} days</div>
            </div>
            <div className="bg-white border border-border-gray rounded-lg p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Closed</div>
              <div className="text-3xl font-bold text-off-black mt-1 tabular-nums">{(data.daily.totals.closed / days).toFixed(1)}</div>
              <div className="text-sm text-off-black/50 mt-0.5 tabular-nums">a day · {data.daily.totals.closed} in {days} days</div>
            </div>
            {thisMonth && (
              <div className="bg-white border border-border-gray rounded-lg p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Orders with a ticket</div>
                <div className="text-3xl font-bold text-off-black mt-1 tabular-nums">{thisMonth.pct == null ? '–' : `${thisMonth.pct}%`}</div>
                <div className="text-sm text-off-black/50 mt-0.5 tabular-nums">{monthLabel(thisMonth.month)}, so far</div>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-off-black mb-1">Orders with a support ticket</h3>
            <p className="text-xs text-off-black/50 mb-2">Orders placed that month (one per Shopify or Etsy order) whose customer emailed us within {data.rate.windowDays} days. Instagram messages have no email to match, so they are not counted. A month is final once its last orders are {data.rate.windowDays} days old.</p>
            <div className="bg-white border border-border-gray rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border-gray text-[10px] font-semibold uppercase tracking-wider text-off-black/45">
                  <th className="text-left px-4 py-2">Month</th><th className="text-right py-2">Orders</th><th className="text-right py-2">With a ticket</th><th className="text-right px-4 py-2">Share</th>
                </tr></thead>
                <tbody>{data.rate.months.map(m => (
                  <tr key={m.month} className="border-b border-border-gray/60 last:border-0">
                    <td className="px-4 py-2">{monthLabel(m.month)}{m.tracked && !m.complete && <span className="ml-2 text-[11px] text-off-black/40">still counting</span>}</td>
                    <td className="py-2 text-right tabular-nums">{m.orders.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{m.withTicket == null ? '–' : m.withTicket.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{m.tracked ? `${m.pct ?? 0}%` : <span className="font-normal text-[11px] text-off-black/40">before the inbox was tracked</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-off-black mb-1">Email tickets by day</h3>
            <p className="text-xs text-off-black/50 mb-2">In: a customer's first email, or their first after it was closed. Closed: conversations closed that day, by anyone. Filtered senders are left out.</p>
            <div className="bg-white border border-border-gray rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border-gray text-[10px] font-semibold uppercase tracking-wider text-off-black/45">
                  <th className="text-left px-4 py-2">Day</th><th className="text-right py-2 w-16">In</th><th className="text-right py-2 w-16">Closed</th><th className="px-4 py-2 w-1/2" />
                </tr></thead>
                <tbody>{data.daily.days.map(d => (
                  <tr key={d.day} className="border-b border-border-gray/60 last:border-0">
                    <td className="px-4 py-1.5 whitespace-nowrap">{dayLabel(d.day)}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.received}</td>
                    <td className="py-1.5 text-right tabular-nums">{d.closed}</td>
                    <td className="px-4 py-1.5">
                      <div className="space-y-0.5">
                        <div className="h-1.5 rounded-full bg-[#4600D6]/70" style={{ width: `${(d.received / max) * 100}%` }} title={`${d.received} in`} />
                        <div className="h-1.5 rounded-full bg-off-black/25" style={{ width: `${(d.closed / max) * 100}%` }} title={`${d.closed} closed`} />
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="flex gap-4 px-4 py-2 border-t border-border-gray text-[11px] text-off-black/50">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-[#4600D6]/70" />In</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-full bg-off-black/25" />Closed</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
