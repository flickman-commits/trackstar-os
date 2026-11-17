import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronLeft, ChevronRight, Undo2 } from 'lucide-react'
import CustomCounter, { RatesEditor } from '@/components/CustomCounter'
import RacePayouts from '@/components/finance/RacePayouts'
import PayPeriods from '@/components/finance/PayPeriods'
import DesignPay from '@/components/finance/DesignPay'
import { WisePayees } from '@/components/finance/WisePay'
import { btnPrimary, btnSecondary, btnGhost, inputBase, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, todayET, monthLabel } from '@/lib/financeApi'
import type { MonthLine, MonthPayouts, Rate } from '@/types/finance'
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
  { kind: 'customs', title: 'Customs', blurb: 'Per designer, at their rate. Paid the last day of the month.' },
  { kind: 'designer_fee', title: 'Head designer fee', blurb: 'The share of the month, from the scoreboard.' },
  { kind: 'hours', title: 'Hours', blurb: 'By two-week pay period, paid the Monday after it ends.' },
  { kind: 'race', title: 'Race partners', blurb: 'Revenue share due this month.' },
]

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

  const approve = async (l: MonthLine) => approveAll([l])
  const approveAll = async (ls: MonthLine[]) => {
    const l = ls[0]
    if (!l) return
    setBusy(l.key)
    try {
      for (const x of ls) {
        if (x.kind === 'hours' && x.timesheetId) await financeApi.review(x.timesheetId, 'approve')
        else await financeApi.payoutAction({ action: 'approve_line', month, key: x.key })
      }
      toast.success(`Approved ${l.name}`)
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const undo = async (l: MonthLine) => undoAll([l])
  const undoAll = async (ls: MonthLine[]) => {
    const l = ls[0]
    if (!l) return
    setBusy(l.key)
    try {
      for (const x of ls) {
        if (x.kind === 'hours' && x.timesheetId) await financeApi.review(x.timesheetId, 'withdraw')
        else await financeApi.payoutAction({ action: 'unapprove_line', month, key: x.key })
      }
      toast.success('Approval taken back')
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => data && setMonth(data.previous)} disabled={!data} className={btnSecondary} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
        <span className="min-w-[160px] text-center font-semibold text-off-black">{monthLabel(month)}</span>
        <button onClick={() => data?.next && setMonth(data.next)} disabled={!data?.next} className={btnSecondary} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
        {month !== thisMonth && <button onClick={() => setMonth(thisMonth)} className={btnGhost}>This month</button>}
      </div>

      {error ? <ErrorCard text={error} /> : !data ? <Spinner /> : (
        <>
          <Totals data={data} />

          <DesignPay month={month} label={data.label} lines={data.lines} today={data.today} payday={data.designPayday} onChanged={load} />

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
                {sec.kind === 'hours' ? <PayPeriods lines={lines} today={data.today} busy={busy !== null} onApprove={approveAll} onUndo={undoAll} onChanged={load} />
                  : lines.length === 0 ? <p className="px-4 py-3 text-xs text-off-black/45">{sec.kind === 'customs' ? 'No customs sent for review this month.' : 'No hours logged for weeks starting this month.'}</p> : (
                  <table className="w-full text-xs">
                    <tbody>{lines.map(l => (
                      <tr key={l.key} className="border-b border-border-gray/60 last:border-0">
                        <td className="px-4 py-2 font-medium whitespace-nowrap w-44">{l.name}</td>
                        <td className="py-2 text-off-black/65">{l.detail}</td>
                        <td className={`py-2 px-3 ${num} font-semibold whitespace-nowrap w-28`}>{l.amountCents == null ? <span className="font-normal text-amber-700">–</span> : usd(l.amountCents)}</td>
                        <td className="py-2 whitespace-nowrap w-40">
                          <StatusChip status={l.paid ? 'paid' : l.status} />
                          {l.sentBack && <span className="ml-1.5 text-[11px] text-rose-700">sent back</span>}
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

/**
 * The month's payouts: the total, then where it stands in three colour-coded
 * cards that match the row chips. In progress takes in Submitted (both wait
 * on someone); Approved is approved and not paid yet; Paid is paid.
 */
const BUCKETS = [
  { key: 'in_progress', label: 'In progress', note: 'Being worked, or waiting for your approval', cls: 'bg-amber-50 border-amber-200', text: 'text-amber-900', sub: 'text-amber-800/70' },
  { key: 'approved', label: 'Approved', note: 'Approved, not paid yet', cls: 'bg-blue-50 border-blue-200', text: 'text-blue-900', sub: 'text-blue-800/70' },
  { key: 'paid', label: 'Paid', note: 'Marked paid', cls: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-900', sub: 'text-emerald-800/70' },
] as const
// A line on a Wise payment still on its way (or failed) counts as approved, not paid, until the money has left.
const bucketOf = (l: MonthLine) => (l.paid && (!l.wise || l.wise.status === 'funded' || l.wise.status === 'sent') ? 'paid' : l.paid || l.status === 'approved' ? 'approved' : 'in_progress')

function Totals({ data }: { data: MonthPayouts }) {
  const sums = { in_progress: 0, approved: 0, paid: 0 }
  const counts = { in_progress: 0, approved: 0, paid: 0 }
  for (const l of data.lines) { const b = bucketOf(l); sums[b] += l.amountCents || 0; counts[b] += 1 }
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className={`${card} p-4 col-span-2 lg:col-span-1`}>
        <p className="text-xs text-off-black/50">Total payouts</p>
        <p className="text-3xl font-semibold text-off-black tabular-nums mt-0.5">{usd(data.totals.totalCents)}</p>
        <p className="text-[11px] text-off-black/45 mt-0.5">{data.label}</p>
        {data.totals.unpriced > 0 && <p className="text-[11px] text-amber-700 mt-0.5">{data.totals.unpriced} line{data.totals.unpriced === 1 ? '' : 's'} not counted yet (no rate, or race sales not pulled)</p>}
      </div>
      {BUCKETS.map(b => (
        <div key={b.key} className={`rounded-lg border p-4 ${b.cls} ${b.key === 'paid' ? 'col-span-2 lg:col-span-1' : ''}`}>
          <p className={`text-xs font-semibold ${b.text}`}>{b.label}</p>
          <p className={`text-2xl font-semibold tabular-nums mt-0.5 ${b.text}`}>{usd(sums[b.key])}</p>
          <p className={`text-[11px] mt-0.5 ${b.sub}`}>{counts[b.key]} line{counts[b.key] === 1 ? '' : 's'} · {b.note}</p>
        </div>
      ))}
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
      <WisePayees />
      <RatesEditor onSaved={load} />
    </div>
  )
}
