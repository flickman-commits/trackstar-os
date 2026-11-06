import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import CustomCounter, { RatesEditor } from '@/components/CustomCounter'
import RacePayouts from '@/components/finance/RacePayouts'
import { btnPrimary, btnSecondary, btnGhost, inputBase, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, todayET } from '@/lib/financeApi'
import type { MonthLine, MonthPayouts, PayoutState, Rate } from '@/types/finance'
import { card, ErrorCard, Spinner, StatusChip, tableHead, num } from './bits'

/**
 * Payouts: one month at a time. Everything paid out for the month (customs
 * per designer, the head designer's fee, hours by the week, race partners
 * due that month), each In progress, Submitted or Approved, and the month's
 * total. Arrows step back through past months. Races and Rates keep their
 * own tabs.
 */
type Tab = 'month' | 'races' | 'rates'
const TABS: [Tab, string][] = [['month', 'Month'], ['races', 'Races'], ['rates', 'Rates']]

export default function Payouts() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = raw === 'races' || raw === 'rates' ? raw : 'month'
  const setTab = (t: Tab) => setParams(p => { const n = new URLSearchParams(p); if (t === 'month') n.delete('tab'); else n.set('tab', t); return n })
  return (
    <div className="space-y-4">
      <div className={segmentGroup}>{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={segment(tab === k, 'sm')}>{l}</button>)}</div>
      {tab === 'races' ? <RacePayouts /> : tab === 'rates' ? <Rates /> : <Month />}
    </div>
  )
}

const SECTIONS: { kind: MonthLine['kind']; title: string; blurb: string }[] = [
  { kind: 'customs', title: 'Customs', blurb: 'Per designer, at their rate. Submitted once the month is over.' },
  { kind: 'designer_fee', title: 'Head designer fee', blurb: 'The share of the month, from the scoreboard.' },
  { kind: 'hours', title: 'Hours', blurb: 'By the week, for weeks that start this month.' },
  { kind: 'race', title: 'Race partners', blurb: 'Revenue share due this month.' },
]
const STATE_LABEL: Record<PayoutState, string> = { in_progress: 'In progress', submitted: 'Submitted', approved: 'Approved' }

function Month() {
  const [params, setParams] = useSearchParams()
  const thisMonth = todayET().slice(0, 7)
  const month = params.get('month') || thisMonth
  const setMonth = (m: string) => setParams(p => { const n = new URLSearchParams(p); if (m === thisMonth) n.delete('month'); else n.set('month', m); return n })
  const [data, setData] = useState<MonthPayouts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [showCustoms, setShowCustoms] = useState(false)

  const load = useCallback(async () => {
    try { setData(await financeApi.payoutsMonth(month)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [month])
  useEffect(() => { setData(null); load() }, [load])

  const approve = async (l: MonthLine) => {
    setBusy(l.key)
    try {
      if (l.kind === 'hours' && l.timesheetId) await financeApi.review(l.timesheetId, 'approve')
      else await financeApi.payoutAction({ action: 'approve_line', month, key: l.key })
      toast.success(`Approved ${l.name}`)
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const undo = async (l: MonthLine) => {
    setBusy(l.key)
    try {
      if (l.kind === 'hours' && l.timesheetId) await financeApi.review(l.timesheetId, 'withdraw')
      else await financeApi.payoutAction({ action: 'unapprove_line', month, key: l.key })
      toast.success('Approval taken back')
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => data && setMonth(data.previous)} disabled={!data} className={btnSecondary} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
        <span className="min-w-[160px] text-center font-semibold text-off-black">{data?.label || month}</span>
        <button onClick={() => data?.next && setMonth(data.next)} disabled={!data?.next} className={btnSecondary} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
        {month !== thisMonth && <button onClick={() => setMonth(thisMonth)} className={btnGhost}>This month</button>}
      </div>

      {error ? <ErrorCard text={error} /> : !data ? <Spinner /> : (
        <>
          <div className={`${card} p-4 flex flex-wrap items-end justify-between gap-4`}>
            <div>
              <p className="text-xs text-off-black/50">{data.current ? 'Spent so far this month' : `Total for ${data.label}`}</p>
              <p className="text-3xl font-semibold text-off-black tabular-nums mt-0.5">{usd(data.totals.totalCents)}</p>
              {data.totals.unpriced > 0 && <p className="text-[11px] text-amber-700 mt-0.5">{data.totals.unpriced} line{data.totals.unpriced === 1 ? '' : 's'} not counted yet (no rate, or race sales not pulled)</p>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
              {(['in_progress', 'submitted', 'approved'] as PayoutState[]).map(st => (
                <div key={st}><p className="text-off-black/45">{STATE_LABEL[st]}</p><p className="font-semibold tabular-nums text-off-black">{usd(st === 'in_progress' ? data.totals.inProgressCents : st === 'submitted' ? data.totals.submittedCents : data.totals.approvedCents)}</p></div>
              ))}
            </div>
          </div>

          {SECTIONS.map(sec => {
            const lines = data.lines.filter(l => l.kind === sec.kind)
            if (!lines.length && sec.kind !== 'customs' && sec.kind !== 'hours') return null
            const subtotal = lines.reduce((n, l) => n + (l.amountCents || 0), 0)
            return (
              <div key={sec.kind} className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 border-b border-border-gray">
                  <div className="flex items-baseline gap-2"><h3 className="text-sm font-semibold text-off-black">{sec.title}</h3><span className="text-[11px] text-off-black/45">{sec.blurb}</span></div>
                  <span className="text-sm font-semibold tabular-nums">{usd(subtotal)}</span>
                </div>
                {lines.length === 0 ? <p className="px-4 py-3 text-xs text-off-black/45">{sec.kind === 'customs' ? 'No customs sent for review this month.' : 'No hours logged for weeks starting this month.'}</p> : (
                  <table className="w-full text-xs">
                    <tbody>{lines.map(l => (
                      <tr key={l.key} className="border-b border-border-gray/60 last:border-0">
                        <td className="px-4 py-2 font-medium whitespace-nowrap w-44">{l.name}</td>
                        <td className="py-2 text-off-black/65">{l.detail}</td>
                        <td className={`py-2 px-3 ${num} font-semibold whitespace-nowrap w-28`}>{l.amountCents == null ? <span className="font-normal text-amber-700">–</span> : usd(l.amountCents)}</td>
                        <td className="py-2 whitespace-nowrap w-40">
                          <StatusChip status={l.status} />
                          {l.sentBack && <span className="ml-1.5 text-[11px] text-rose-700">sent back</span>}
                          {l.paid && <span className="ml-1.5 text-[11px] text-emerald-700">paid</span>}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-right w-36">
                          {l.kind === 'race' ? <Link to="/finance/payouts?tab=races" className="text-[11px] text-blue-600 hover:underline">Open in Races</Link>
                            : l.status === 'submitted' ? <button onClick={() => approve(l)} disabled={busy !== null} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Approve</button>
                            : l.status === 'approved' && !l.paid ? <button onClick={() => undo(l)} disabled={busy !== null} className={btnGhost} title="Take the approval back"><Undo2 className="w-3.5 h-3.5" /></button>
                            : l.kind === 'hours' && l.status === 'in_progress' ? <Link to="/finance/timesheets" className="text-[11px] text-blue-600 hover:underline">Timesheets</Link>
                            : null}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                {sec.kind === 'customs' && (
                  <div className="border-t border-border-gray">
                    <button onClick={() => setShowCustoms(v => !v)} className="w-full flex items-center gap-1.5 px-4 py-2 text-[11px] text-off-black/60 hover:bg-subtle-gray">
                      {showCustoms ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Every custom this month, with new or repeat
                    </button>
                    {showCustoms && <div className="px-4 pb-4"><CustomCounter month={month} onChanged={load} /></div>}
                  </div>
                )}
              </div>
            )
          })}
          {data.racesError && <p className="text-[11px] text-amber-700">Race partner payouts are left out: {data.racesError}</p>}
        </>
      )}
    </div>
  )
}

/** Hourly rates per person, and each designer's rate per custom. */
function Rates() {
  const [rates, setRates] = useState<Rate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const load = useCallback(async () => { try { setRates((await financeApi.payoutRates()).rates); setError(null) } catch (e) { setError((e as Error).message) } }, [])
  useEffect(() => { load() }, [load])
  const dollars = (c: number | null) => (c == null ? '' : (c / 100).toFixed(c % 100 ? 2 : 0))
  const save = async (r: Rate) => {
    const v = draft[r.userId]
    const cents = v === undefined || v.trim() === '' ? null : Math.round(Number(v) * 100)
    if (cents !== null && !Number.isFinite(cents)) { toast.error('That is not a number'); return }
    setSaving(r.userId)
    try { const out = await financeApi.setHourlyRate(r.userId, cents); setRates(out.rates); setDraft(p => { const n = { ...p }; delete n[r.userId]; return n }); toast.success('Rate saved') } catch (e) { toast.error((e as Error).message) } finally { setSaving(null) }
  }
  if (error) return <ErrorCard text={error} />
  if (!rates) return <Spinner />
  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <h3 className="text-sm font-semibold text-off-black mb-1">Per hour</h3>
        <p className="text-[11px] text-off-black/50 mb-3">For approved timesheets. A change applies from the next approval; approved weeks keep the rate they were approved at.</p>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border-gray"><th className={`py-1.5 text-left ${tableHead}`}>Person</th><th className={`py-1.5 text-left ${tableHead}`}>Role</th><th className={`py-1.5 text-left ${tableHead}`}>Per hour</th></tr></thead>
          <tbody>{rates.map(r => {
            const d = draft[r.userId] ?? dollars(r.hourlyRateCents)
            const changed = draft[r.userId] !== undefined && draft[r.userId] !== dollars(r.hourlyRateCents)
            return (
              <tr key={r.userId} className="border-b border-border-gray/60">
                <td className="py-1.5 font-medium">{r.name}</td><td className="py-1.5 text-off-black/60">{r.role.replace('_', ' ')}</td>
                <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><span className="text-off-black/40">$</span><input value={d} onChange={e => setDraft(p => ({ ...p, [r.userId]: e.target.value }))} placeholder="not hourly" inputMode="decimal" className={`${inputBase} w-24 py-1`} />{changed && <button onClick={() => save(r)} disabled={saving === r.userId} className={`${btnSecondary} py-1`}>{saving === r.userId ? 'Saving…' : 'Save'}</button>}</span></td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <RatesEditor onSaved={load} />
    </div>
  )
}
