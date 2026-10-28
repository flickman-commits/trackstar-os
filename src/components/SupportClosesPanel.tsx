import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { segment, segmentGroup } from '@/lib/ui'

type Person = { id: string; name: string; total: number; byDay: Record<string, number> }
type Data = { days: string[]; people: Person[] }

const RANGES = [7, 30, 90] as const

/** "2026-10-27" -> "Tue, Oct 27". */
function dayLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * Settings > Tickets Resolved (admin only): Support conversations each person
 * closed per day, Eastern time. Credited to whoever clicked Close, not who it
 * was assigned to (server/domain/support/closeCounter.js).
 */
export default function SupportClosesPanel() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setData(null); setError(null)
    apiFetch(`/api/admin/support-closes?days=${days}`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not load'); return j })
      .then(j => { if (live) setData(j) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load') })
    return () => { live = false }
  }, [days])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-off-black/55">Support tickets each person resolved, credited to whoever clicked Close. Eastern time.</p>
        <div className={segmentGroup}>
          {RANGES.map(r => <button key={r} onClick={() => setDays(r)} className={segment(days === r)}>{r} days</button>)}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {data.people.map(p => (
              <div key={p.id} className="bg-white border border-border-gray rounded-lg p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40 truncate">{p.name}</div>
                <div className="text-3xl font-bold text-off-black mt-1 tabular-nums">{p.total}</div>
                <div className="text-sm text-off-black/50 mt-0.5 tabular-nums">{(p.total / days).toFixed(1)} a day</div>
              </div>
            ))}
          </div>

          {!data.people.length ? (
            <p className="text-sm text-off-black/50 py-10 text-center">No tickets resolved in the last {days} days.</p>
          ) : (
            <div className="bg-white border border-border-gray rounded-lg shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-subtle-gray border-b border-border-gray">
                  <tr>
                    <th className="text-left font-semibold text-off-black/60 px-4 py-2">Day</th>
                    {data.people.map(p => <th key={p.id} className="text-right font-semibold text-off-black/60 px-4 py-2 whitespace-nowrap">{p.name.split(' ')[0]}</th>)}
                    <th className="text-right font-semibold text-off-black/60 px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-gray">
                  {data.days.map(d => {
                    const total = data.people.reduce((s, p) => s + (p.byDay[d] || 0), 0)
                    return (
                      <tr key={d}>
                        <td className="px-4 py-2 text-off-black whitespace-nowrap">{dayLabel(d)}</td>
                        {data.people.map(p => <td key={p.id} className={`px-4 py-2 text-right tabular-nums ${p.byDay[d] ? 'text-off-black' : 'text-off-black/25'}`}>{p.byDay[d] || 0}</td>)}
                        <td className={`px-4 py-2 text-right tabular-nums font-semibold ${total ? 'text-off-black' : 'text-off-black/25'}`}>{total}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
