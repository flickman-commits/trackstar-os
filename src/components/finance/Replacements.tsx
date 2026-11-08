import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { btnGhost, btnSecondary } from '@/lib/ui'
import { financeApi, usd, todayET, type ReplacementsPayload, type ReplacementRow } from '@/lib/financeApi'
import { card, ErrorCard, Spinner, tableHead, num } from './bits'

/** "2026-11" -> "November 2026" */
const monthLabel = (m: string) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
const shift = (m: string, by: number) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const what = (r: ReplacementRow) => r.items.map(i => `${i.kind === 'frame' ? 'Frame' : 'Print'} ${i.size}${i.kind === 'print' && i.frame && i.frame !== 'Unframed' ? `, ${i.frame.replace(/([a-z])([A-Z])/g, '$1 $2')}` : i.kind === 'frame' ? `, ${i.frame.replace(/([a-z])([A-Z])/g, '$1 $2')}` : ', unframed'}`).join(' + ')

/**
 * Finance > Replacements: what we spent sending replacements in a month, for
 * the P&L. Each one is recorded when Support's New Artelo order makes it,
 * with the reason picked there, and costs what Artelo billed
 * (server/domain/finance/replacements.js). Cancelled ones and ones paid back
 * are listed but not counted.
 */
export default function Replacements() {
  const thisMonth = todayET().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState<ReplacementsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await financeApi.replacements(month)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [month])
  useEffect(() => { setData(null); load() }, [load])

  const update = async (r: ReplacementRow, body: { reason?: string; reimbursed?: boolean }) => {
    setBusy(r.id)
    try { await financeApi.replacementUpdate({ id: r.id, ...body }); await load() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setMonth(m => shift(m, -1))} className={btnSecondary} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
        <span className="min-w-[160px] text-center font-semibold text-off-black">{monthLabel(month)}</span>
        <button onClick={() => setMonth(m => shift(m, 1))} disabled={month >= thisMonth} className={btnSecondary} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
        {month !== thisMonth && <button onClick={() => setMonth(thisMonth)} className={btnGhost}>This month</button>}
      </div>

      {error ? <ErrorCard text={error} /> : !data ? <Spinner /> : (
        <>
          <div className={`${card} p-4 flex flex-wrap items-end justify-between gap-4`}>
            <div>
              <p className="text-xs text-off-black/50">Replacements we paid for{month === thisMonth ? ' so far' : ''}</p>
              <p className="text-3xl font-semibold text-off-black tabular-nums mt-0.5">{usd(data.totalCents)}</p>
              <p className="text-xs text-off-black/50 mt-0.5">{data.count} sent{data.estimated ? ' · some are the price check until Artelo bills them' : ''}</p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {data.byReason.map(r => (
                <div key={r.reason}><p className="text-off-black/45">{r.label}</p><p className="font-semibold tabular-nums text-off-black">{usd(r.cents)} <span className="font-normal text-off-black/45">· {r.count}</span></p></div>
              ))}
            </div>
          </div>

          <div className={`${card} overflow-x-auto`}>
            {data.rows.length === 0 ? <p className="px-4 py-6 text-sm text-off-black/50">No replacements sent in {monthLabel(month)}.</p> : (
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border-gray">
                  <th className={`${tableHead} text-left px-4 py-2`}>Order</th>
                  <th className={`${tableHead} text-left py-2`}>What</th>
                  <th className={`${tableHead} text-left py-2`}>Why</th>
                  <th className={`${tableHead} text-left py-2`}>Sent</th>
                  <th className={`${tableHead} ${num} py-2 px-3`}>Cost</th>
                  <th className={`${tableHead} text-left py-2 pr-4`}>Paid back</th>
                </tr></thead>
                <tbody>{data.rows.map(r => (
                  <tr key={r.id} className={`border-b border-border-gray/60 last:border-0 align-top ${r.canceled || r.reimbursed ? 'text-off-black/40' : ''}`}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <div className="font-medium">{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">{r.arteloOrderId}<ExternalLink className="w-3 h-3" /></a> : r.arteloOrderId}</div>
                      <div className="text-off-black/45">replaces <Link to={`/orders/${r.orderNumber}`} className="hover:underline">#{r.orderNumber}</Link>{r.canceled ? ' · cancelled' : ''}</div>
                    </td>
                    <td className="py-2 pr-3 text-off-black/70">{what(r) || '–'}</td>
                    <td className="py-2 pr-3">
                      <select value={r.reason} disabled={busy === r.id} onChange={e => update(r, { reason: e.target.value })} className="bg-transparent border border-border-gray rounded px-1.5 py-0.5 text-xs">
                        {data.reasons.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}
                      </select>
                      {r.note && <div className="mt-0.5 text-off-black/50 max-w-[260px]">{r.note}</div>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-off-black/60">{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{r.by ? ` · ${r.by}` : ''}</td>
                    <td className={`py-2 px-3 ${num} whitespace-nowrap font-semibold`}>{usd(r.cents)}{!r.billed && <div className="font-normal text-[10px] text-amber-700">estimate</div>}</td>
                    <td className="py-2 pr-4"><input type="checkbox" checked={r.reimbursed} disabled={busy === r.id} onChange={e => update(r, { reimbursed: e.target.checked })} className="w-4 h-4 accent-[#4600D6]" title="Artelo or someone paid it back: left out of the total" /></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
