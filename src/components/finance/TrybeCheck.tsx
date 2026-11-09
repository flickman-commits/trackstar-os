import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { btnGhost } from '@/lib/ui'
import { financeApi, usd, xText, intText, dayLabel } from '@/lib/financeApi'
import type { TrybeCheck as Check, TrybeWeek } from '@/types/finance'
import { card, tableHead, num } from './bits'

/**
 * Is Trybe paying for itself? Week by week, the Meta ads running Trybe
 * creators' content against the rest of the Meta account, after Trybe's
 * commission. Both sides are Meta's own numbers. The math and its limits are
 * in server/domain/finance/trybeCheck.js.
 */
export default function TrybeCheck() {
  const [data, setData] = useState<Check | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (refresh = false) => {
    setBusy(true)
    try { setData(await financeApi.trybeCheck(refresh)); setError(null) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }, [])
  useEffect(() => { load() }, [load])

  if (data && !data.configured) return null
  const weeks = data?.weeks ?? []
  const latest = [...weeks].reverse().find(w => !w.partial && w.verdict !== 'quiet') || null
  const t = data?.totals
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-off-black">Is Trybe paying for itself?</h3>
        <button onClick={() => load(true)} disabled={busy} className={btnGhost} title="Read Trybe again"><RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /></button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : !data ? <p className="text-sm text-off-black/40">Reading Trybe…</p> : weeks.length === 0 ? <p className="text-sm text-off-black/50">No Trybe weeks yet.</p> : (
        <>
          {latest && <Headline w={latest} />}
          {t && <p className="text-[11px] text-off-black/50 mt-1">Over these {weeks.length} weeks: {usd(t.costCents)} paid to Trybe, {t.vsOtherCents >= 0 ? `${usd(t.vsOtherCents)} more` : `${usd(-t.vsOtherCents)} less`} margin than the same spend on your other ads, {intText(t.newSubmissions)} new videos ({t.newSubmissions ? usd(Math.round(t.costCents / t.newSubmissions)) : '–'} each). Paying for itself in {t.weeksPaying} of {t.fullWeeks} full weeks.</p>}
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="border-b border-border-gray">
                {['Week', 'Trybe ad spend', 'Trybe ROAS', 'Other ads ROAS', 'Needs', 'After commission', 'Trybe cost', 'Vs other ads', 'New videos'].map((h, i) => <th key={h} className={`px-2 py-1.5 ${tableHead} ${i ? num : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[...weeks].reverse().map(w => (
                  <tr key={w.start} className="border-b border-border-gray/60">
                    <td className="px-2 py-1.5">{dayLabel(w.start)}{w.partial && <span className="text-off-black/40"> (so far)</span>}</td>
                    <td className={`px-2 py-1.5 ${num}`}>{usd(w.trybe.adSpendCents)}{w.metaShare != null && <span className="text-off-black/40"> · {Math.round(w.metaShare * 100)}%</span>}</td>
                    <td className={`px-2 py-1.5 ${num} font-semibold ${w.verdict === 'paying' ? 'text-emerald-700' : w.verdict === 'not_paying' ? 'text-red-600' : ''}`}>{xText(w.trybeRoas)}</td>
                    <td className={`px-2 py-1.5 ${num}`}>{xText(w.otherRoas)}</td>
                    <td className={`px-2 py-1.5 ${num} text-off-black/60`}>{xText(w.breakEvenRoas)}</td>
                    <td className={`px-2 py-1.5 ${num}`}>{xText(w.afterRoas)}</td>
                    <td className={`px-2 py-1.5 ${num}`}>{usd(w.costCents)}</td>
                    <td className={`px-2 py-1.5 ${num} ${w.vsOtherCents != null && w.vsOtherCents < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{w.vsOtherCents == null ? '–' : `${w.vsOtherCents < 0 ? '−' : '+'}${usd(Math.abs(w.vsOtherCents))}`}</td>
                    <td className={`px-2 py-1.5 ${num}`}>{intText(w.trybe.newSubmissions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-off-black/40 mt-2">Both ROAS columns are Meta's own numbers. Needs: the ROAS the Trybe ads need to leave as much margin as the same spend on your other ads, after Trybe's cost (commission, platform fee, processing). Vs other ads is the margin made or lost against that spend at your other ads' average; more spend there would earn a little less per dollar, so a loss is at most this and at least Trybe's cost.</p>
        </>
      )}
    </div>
  )
}

function Headline({ w }: { w: TrybeWeek }) {
  const paying = w.verdict === 'paying'
  return (
    <p className="text-sm text-off-black/80">
      <span className={`font-semibold ${paying ? 'text-emerald-700' : 'text-red-600'}`}>{paying ? 'Yes' : 'No'}</span>, week of {dayLabel(w.start)}: Trybe ads returned {xText(w.trybeRoas)} against {xText(w.otherRoas)} for your other ads, and needed {xText(w.breakEvenRoas)} to cover the {usd(w.costCents)} Trybe cost.
    </p>
  )
}
