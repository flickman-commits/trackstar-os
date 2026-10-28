import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Zap } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Avatar } from '@/components/AssigneePicker'
import { btnSecondary, sectionCount } from '@/lib/ui'

/**
 * Admin only: custom designs each designer made in a month, for payouts:
 * counted the month the first proof went to the customer, credited to the
 * assigned designer. A repeat (a race designed before) pays half; the toggle
 * on each row corrects the automatic call. Each row is one print.
 */

type Row = { id: string; display: string; item: number; runnerName: string; race: string; customerName: string | null; rush: boolean; completedAt: string; estimated: boolean; repeat: boolean; repeatSet: boolean; autoRepeat: boolean; rateCents: number; sentToProduction: boolean }
type Designer = { userId: string | null; name: string; count: number; repeats: number; rateCents: number; payoutCents: number; orders: Row[] }
type Data = { month: string; total: number; payoutCents: number; designers: Designer[] }

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const label = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })

export default function CustomCounter() {
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setData(null); setError(null)
    apiFetch(`/api/admin/custom-counter?month=${month}`)
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not load'); return j })
      .then(j => { if (live) setData(j) })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not load') })
    return () => { live = false }
  }, [month])

  const atNow = month >= thisMonth()

  // Flip one custom between repeat and new; back to automatic when it matches the automatic call.
  const toggleRepeat = async (o: Row) => {
    const next = !o.repeat
    const body = { orderId: o.id, repeat: next === o.autoRepeat ? null : next }
    const res = await apiFetch('/api/admin/custom-counter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!res.ok) return
    const fresh = await apiFetch(`/api/admin/custom-counter?month=${month}`).then(r => (r.ok ? r.json() : null))
    if (fresh) setData(fresh)
  }

  return (
    <div>
      <div>
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm text-off-black/55">Customs each designer sent to production, by month.</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setMonth(m => shift(m, -1))} className={btnSecondary} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
            <span className="min-w-[140px] text-center font-semibold text-off-black">{label(month)}</span>
            <button onClick={() => setMonth(m => shift(m, 1))} disabled={atNow} className={btnSecondary} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!data && !error && <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-white border border-border-gray rounded-lg p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Total</div>
                <div className="text-3xl font-bold text-off-black mt-1">{data.total}</div>
                <div className="text-sm font-semibold text-green-700 mt-0.5">{usd(data.payoutCents)}</div>
              </div>
              {data.designers.map(d => (
                <div key={d.userId || 'none'} className="bg-white border border-border-gray rounded-lg p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40 truncate">{d.name}</div>
                  <div className="text-3xl font-bold text-off-black mt-1">{d.count}</div>
                  <div className="text-sm font-semibold text-green-700 mt-0.5">{d.rateCents ? `${usd(d.payoutCents)} · ${usd(d.rateCents)} each${d.repeats ? `, ${d.repeats} repeat${d.repeats === 1 ? '' : 's'} at ${usd(d.rateCents / 2)}` : ''}` : 'Not paid per custom'}</div>
                </div>
              ))}
            </div>

            {!data.designers.length && <p className="text-sm text-off-black/50 py-10 text-center">No custom designs sent for review in {label(month)}.</p>}

            <div className="space-y-5">
              {data.designers.map(d => (
                <section key={d.userId || 'none'} className="bg-white border border-border-gray rounded-lg shadow-sm overflow-hidden">
                  <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border-gray bg-subtle-gray">
                    {d.userId && <Avatar user={{ id: d.userId, firstName: d.name, lastName: '' }} size={24} />}
                    <span className="font-semibold text-off-black">{d.name}</span>
                    <span className={sectionCount}>{d.count}</span>
                    {d.rateCents > 0 && <span className="ml-auto text-sm font-semibold text-green-700">{d.count - d.repeats} × {usd(d.rateCents)}{d.repeats ? ` + ${d.repeats} × ${usd(d.rateCents / 2)}` : ''} = {usd(d.payoutCents)}</span>}
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-[11px] font-semibold uppercase tracking-wider text-off-black/45">
                      <tr className="border-b border-border-gray">
                        <th className="text-left px-4 py-2">First proof</th>
                        <th className="text-left px-4 py-2">Order</th>
                        <th className="text-left px-4 py-2 hidden md:table-cell">Runner</th>
                        <th className="text-left px-4 py-2 hidden md:table-cell">Race</th>
                        <th className="text-right px-4 py-2">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.orders.map(o => (
                        <tr key={o.id} className="border-b border-border-gray last:border-0">
                          <td className="px-4 py-2 whitespace-nowrap text-off-black/70" title={o.estimated ? 'From before completions were tracked by person: credited to the assignee' : undefined}>
                            {day(o.completedAt)}{o.estimated ? '*' : ''}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap font-medium text-off-black">
                            {o.display}{o.item > 1 ? <span className="text-off-black/45"> · item {o.item}</span> : null}
                            {o.rush && <Zap className="inline w-3.5 h-3.5 ml-1 text-amber-500" aria-label="Rush" />}
                          </td>
                          <td className="px-4 py-2 hidden md:table-cell text-off-black/70">{o.runnerName || o.customerName || ''}</td>
                          <td className="px-4 py-2 hidden md:table-cell text-off-black/70">{o.race}</td>
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            {d.rateCents > 0 && (
                              <button onClick={() => toggleRepeat(o)} title={o.repeatSet ? 'Set by hand. Click to change.' : `Decided automatically (${o.autoRepeat ? 'a race designed before' : 'a new race'}). Click to change.`}
                                className={`mr-2 px-1.5 py-0.5 rounded text-[11px] font-medium border ${o.repeat ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-border-gray text-off-black/45 hover:text-off-black'}`}>
                                {o.repeat ? 'Repeat' : 'New'}{o.repeatSet ? ' ✎' : ''}
                              </button>
                            )}
                            <span className="font-medium text-off-black tabular-nums">{d.rateCents ? usd(o.rateCents) : ''}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
            {data.designers.some(d => d.orders.some(o => o.estimated)) && (
              <p className="text-xs text-off-black/45 mt-4">* No proof on file (made before proofs, or by hand), so it is dated by when it was sent to production.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
