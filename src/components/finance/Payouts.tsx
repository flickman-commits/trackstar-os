import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, DollarSign, Plus, Trash2 } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import CustomCounter from '@/components/CustomCounter'
import RacePayouts from '@/components/finance/RacePayouts'
import { btnPrimary, btnSecondary, btnGhost, inputBase, modalInput, modalPrimary, modalCancel, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, hoursText, dayLabel, todayET, mondayOf, addDays } from '@/lib/financeApi'
import type { LedgerMonth, LedgerStatus, PayoutsPayload, PayRun, Rate } from '@/types/finance'
import { card, ErrorCard, Spinner, StatusChip, tableHead, num } from './bits'

type Tab = 'owed' | 'runs' | 'customs' | 'races' | 'rates'
const TABS: [Tab, string][] = [['owed', 'Owed'], ['runs', 'Pay runs'], ['customs', 'Customs'], ['races', 'Races'], ['rates', 'Rates']]
const KIND: Record<string, string> = { customs: 'Customs', hours: 'Hours', designer_fee: 'Designer fee', bonus: 'Bonus', reimbursement: 'Reimbursement', other: 'Other' }

/**
 * Who is owed what, and what was paid. Hours are paid every two weeks from
 * approved timesheets; customs and Dan's fee at month end. A run is one
 * period's payments: draft, approved, paid. The app records; it never pays.
 */
export default function Payouts() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'owed'
  const setTab = (t: Tab) => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); return n })
  const [data, setData] = useState<PayoutsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => { try { setData(await financeApi.payouts()); setError(null) } catch (e) { setError((e as Error).message) } }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className={segmentGroup}>{TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={segment(tab === k, 'sm')}>{l}{k === 'owed' && data?.owed.totalCents ? <span className="ml-1.5 text-[10px] opacity-70">{usd(data.owed.totalCents)}</span> : null}</button>)}</div>
      {tab === 'customs' ? <CustomCounter /> : tab === 'races' ? <RacePayouts /> : error ? <ErrorCard text={error} /> : !data ? <Spinner /> : tab === 'owed' ? <Owed data={data} reload={load} /> : tab === 'runs' ? <Runs runs={data.runs} rates={data.rates} reload={load} /> : <Rates rates={data.rates} onSaved={setData} />}
    </div>
  )
}

/** Where a line stands, as a chip: owed, on a run, approved, or paid on a date. */
function LineStatus({ status, paidAt }: { status: LedgerStatus; paidAt?: string | null }) {
  const tone: Record<LedgerStatus, string> = {
    owed: 'bg-amber-50 border-amber-300 text-amber-800',
    draft: 'bg-white border-border-gray text-off-black/65',
    approved: 'bg-blue-50 border-blue-200 text-blue-800',
    paid: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  }
  const label: Record<LedgerStatus, string> = { owed: 'Owed', draft: 'On a run', approved: 'Approved', paid: 'Paid' }
  const when = status === 'paid' && paidAt ? ` ${new Date(paidAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${tone[status]}`}>{label[status]}{when}</span>
}

const MONTH_TONE: Record<LedgerMonth['status'], [string, string]> = {
  owed: ['Owed', 'text-amber-800'], on_run: ['On a run', 'text-off-black/60'], paid: ['All paid', 'text-emerald-700'], empty: ['Nothing yet', 'text-off-black/40'],
}

/**
 * Owed, month by month like the Custom Counter: each month's customs, the
 * designer fee and the hours whose week starts in it, with where each line
 * stands. A month that is over can go on a run, or be marked paid in one go
 * when it was paid outside the app.
 */
function Owed({ data, reload }: { data: PayoutsPayload; reload: () => Promise<void> }) {
  const today = todayET()
  const lastSunday = addDays(mondayOf(today), -1)
  const [start, setStart] = useState(addDays(lastSunday, -13))
  const [end, setEnd] = useState(lastSunday)
  const [busy, setBusy] = useState<string | null>(null)
  const [paying, setPaying] = useState<LedgerMonth | null>(null)
  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    try { toast.success(await fn()); await reload() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const createMonthRun = (m: LedgerMonth) => act(m.month, async () => {
    const r = await financeApi.payoutAction({ action: 'create_run', kind: 'monthly', month: m.month })
    return `Created "${r.label}" (${usd(r.totalCents)}). Approve and pay it under Pay runs.`
  })
  const markMonthPaid = (m: LedgerMonth, ref: string, at: string) => act(m.month, async () => {
    const r = await financeApi.payoutAction({ action: 'create_run', kind: 'monthly', month: m.month })
    await financeApi.payoutAction({ action: 'mark_paid', id: r.id, paidRef: ref, paidAt: at })
    setPaying(null)
    return `${m.label} marked paid (${usd(r.totalCents)})`
  })
  const hoursOwed = data.owed.hours.reduce((a, p) => a + p.amountCents, 0)
  const ledger = data.ledger || []
  return (
    <div className="space-y-3">
      <div className={`${card} p-4 flex flex-wrap items-center justify-between gap-2`}>
        <div>
          <p className="text-xs text-off-black/50">Owed in all</p>
          <p className="text-2xl font-bold tabular-nums text-off-black leading-tight">{usd(data.owed.totalCents)}</p>
        </div>
        {data.owed.hours.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-off-black/60">Hours, {usd(hoursOwed)}:</span>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className={`${inputBase} py-1`} /><span className="text-off-black/40">to</span><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={`${inputBase} py-1`} />
            <button onClick={() => act('hours', async () => { const r = await financeApi.payoutAction({ action: 'create_run', kind: 'hours', periodStart: start, periodEnd: end }); return `Created "${r.label}" (${usd(r.totalCents)})` })} disabled={busy !== null} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Create hours run</button>
          </div>
        )}
      </div>

      {ledger.map(m => {
        const [mLabel, mTone] = MONTH_TONE[m.status]
        return (
          <div key={m.month} className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border-gray">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-off-black">{m.label}</span>
                  <span className="text-sm tabular-nums text-off-black/60">{usd(m.totalCents)}</span>
                  <span className={`text-xs font-medium ${mTone}`}>{m.inProgress ? 'In progress' : mLabel}</span>
                </div>
                <p className="text-[11px] text-off-black/45">
                  {m.inProgress ? 'Customs and the designer fee are paid once the month is over.' : [m.owedCents ? `${usd(m.owedCents)} owed` : null, m.onRunCents ? `${usd(m.onRunCents)} on a run` : null, m.paidCents ? `${usd(m.paidCents)} paid` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              {m.canCreateRun && (
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPaying(m)} disabled={busy !== null} className={btnGhost} title="It was paid outside the app: put it on a run and mark it paid">Mark paid</button>
                  <button onClick={() => createMonthRun(m)} disabled={busy !== null} className={btnSecondary}><Plus className="w-3.5 h-3.5" /> Create run</button>
                </div>
              )}
            </div>
            {m.items.length === 0 ? <p className="px-4 py-3 text-sm text-off-black/45">Nothing yet this month.</p> : (
              <div className="divide-y divide-border-gray/60">
                {m.items.map(i => (
                  <div key={i.key} className="px-4 py-2 flex flex-wrap md:flex-nowrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-medium text-off-black w-32 shrink-0">{i.name}</span>
                    <span className="text-off-black/55 w-24 shrink-0 text-xs">{KIND[i.kind] || i.kind}</span>
                    <span className="text-off-black/65 text-xs flex-1 min-w-[12rem]">{i.note}{i.run ? <span className="text-off-black/40"> · {i.run.label}</span> : null}</span>
                    <span className="tabular-nums font-semibold text-off-black w-24 text-right ml-auto">{usd(i.amountCents)}</span>
                    <span className="w-24 text-right"><LineStatus status={i.status} paidAt={i.paidAt} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {paying && <MonthPaidModal month={paying} busy={busy === paying.month} onClose={() => setPaying(null)} onPay={(ref, at) => markMonthPaid(paying, ref, at)} />}
    </div>
  )
}

function MonthPaidModal({ month, busy, onClose, onPay }: { month: LedgerMonth; busy: boolean; onClose: () => void; onPay: (ref: string, at: string) => void }) {
  const [ref, setRef] = useState('')
  const [at, setAt] = useState(todayET())
  const owedItems = month.items.filter(i => i.status === 'owed' && i.kind !== 'hours')
  return (
    <ActionModal icon={DollarSign} title={`Mark ${month.label} paid`} sub={usd(owedItems.reduce((a, i) => a + i.amountCents, 0))} description={`For a month that was already paid outside the app: ${owedItems.map(i => `${i.name}, ${KIND[i.kind] || i.kind}`).join('; ')}. It goes on a run marked paid.`} onClose={onClose} busy={busy} size="sm"
      footer={<><button onClick={onClose} className={modalCancel} disabled={busy}>Cancel</button><button onClick={() => onPay(ref, at)} disabled={busy} className={modalPrimary}>Mark paid</button></>}>
      <input type="date" value={at} onChange={e => setAt(e.target.value)} className={modalInput} />
      <input value={ref} onChange={e => setRef(e.target.value)} placeholder="How: Venmo, Wise, bank, a reference" className={modalInput} />
    </ActionModal>
  )
}

function Runs({ runs, rates, reload }: { runs: PayRun[]; rates: Rate[]; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [paying, setPaying] = useState<PayRun | null>(null)
  const [adding, setAdding] = useState<PayRun | null>(null)
  const act = async (body: Record<string, unknown>, key: string, done: string) => {
    setBusy(key)
    try { await financeApi.payoutAction(body); toast.success(done); setPaying(null); setAdding(null); await reload() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  if (!runs.length) return <div className={`${card} p-6 text-sm text-off-black/50`}>No pay runs yet. Create one from Owed.</div>
  return (
    <div className="space-y-3">
      {runs.map(r => (
        <div key={r.id} className={`${card} overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border-gray">
            <div className="flex items-center gap-2"><span className="text-sm font-semibold">{r.label}</span><StatusChip status={r.status} /><span className="text-xs text-off-black/50">{r.lines.length} line{r.lines.length === 1 ? '' : 's'} · {usd(r.totalCents)}{r.paidAt && ` · paid ${dayLabel(r.paidAt.slice(0, 10))}`}</span></div>
            <div className="flex items-center gap-1.5">
              {r.status !== 'paid' && <button onClick={() => setAdding(r)} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Line</button>}
              {r.status === 'draft' && <button onClick={() => act({ action: 'approve_run', id: r.id }, r.id, 'Run approved')} disabled={busy !== null} className={btnSecondary}><Check className="w-3.5 h-3.5" /> Approve</button>}
              {r.status !== 'paid' && <button onClick={() => setPaying(r)} disabled={busy !== null} className={btnPrimary}><DollarSign className="w-3.5 h-3.5" /> Mark paid</button>}
              {r.status !== 'paid' && <button onClick={() => { if (confirm(`Delete "${r.label}"? Its weeks and months go back to Owed.`)) act({ action: 'delete_run', id: r.id }, r.id, 'Run deleted') }} disabled={busy !== null} className={btnGhost} title="Delete this run"><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          </div>
          <table className="w-full text-xs">
            <tbody>{r.lines.map(l => (
              <tr key={l.id} className="border-b border-border-gray/60 last:border-0">
                <td className="px-4 py-1.5 font-medium w-36">{l.name}</td><td className="py-1.5 text-off-black/60 w-28">{KIND[l.kind] || l.kind}</td>
                <td className="py-1.5 text-off-black/70">{l.note}{l.kind === 'hours' && l.quantity != null && ` · ${hoursText(l.quantity)} at ${usd(l.rateCents)}/h`}{l.kind === 'customs' && l.quantity != null && ` · ${l.quantity} at ${usd(l.rateCents)}`}</td>
                <td className={`py-1.5 ${num} font-semibold w-24`}>{usd(l.amountCents)}</td>
                <td className="px-3 py-1.5 w-8">{r.status !== 'paid' && <button onClick={() => act({ action: 'delete_line', lineId: l.id }, l.id, 'Line removed')} disabled={busy !== null} className="text-off-black/35 hover:text-red-600" title="Remove"><Trash2 className="w-3.5 h-3.5" /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {r.note && <p className="px-4 py-2 text-[11px] text-off-black/50 border-t border-border-gray">{r.note}</p>}
        </div>
      ))}
      {paying && <PayModal run={paying} busy={busy === paying.id} onClose={() => setPaying(null)} onPay={(ref, at) => act({ action: 'mark_paid', id: paying.id, paidRef: ref, paidAt: at }, paying.id, 'Marked paid')} />}
      {adding && <LineModal run={adding} rates={rates} busy={busy === adding.id} onClose={() => setAdding(null)} onAdd={(b) => act({ action: 'add_line', runId: adding.id, ...b }, adding.id, 'Line added')} />}
    </div>
  )
}

function PayModal({ run, busy, onClose, onPay }: { run: PayRun; busy: boolean; onClose: () => void; onPay: (ref: string, at: string) => void }) {
  const [ref, setRef] = useState('')
  const [at, setAt] = useState(todayET())
  return (
    <ActionModal icon={DollarSign} title="Mark paid" sub={run.label} description={`${usd(run.totalCents)} to ${new Set(run.lines.map(l => l.userId)).size} ${new Set(run.lines.map(l => l.userId)).size === 1 ? 'person' : 'people'}. This records the payment; make it the way you always do.`} onClose={onClose} busy={busy} size="sm"
      footer={<><button onClick={onClose} className={modalCancel} disabled={busy}>Cancel</button><button onClick={() => onPay(ref, at)} disabled={busy} className={modalPrimary}>Mark paid</button></>}>
      <input type="date" value={at} onChange={e => setAt(e.target.value)} className={modalInput} />
      <input value={ref} onChange={e => setRef(e.target.value)} placeholder="How: Venmo, Wise, bank, a reference" className={modalInput} />
    </ActionModal>
  )
}

function LineModal({ run, rates, busy, onClose, onAdd }: { run: PayRun; rates: Rate[]; busy: boolean; onClose: () => void; onAdd: (b: { userId: string; kind: string; amountCents: number; note: string }) => void }) {
  const [userId, setUserId] = useState(rates[0]?.userId || '')
  const [kind, setKind] = useState('bonus')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const cents = Math.round(Number(amount) * 100)
  return (
    <ActionModal icon={Plus} title="Add a line" sub={run.label} onClose={onClose} busy={busy} size="sm"
      footer={<><button onClick={onClose} className={modalCancel} disabled={busy}>Cancel</button><button onClick={() => onAdd({ userId, kind, amountCents: cents, note })} disabled={busy || !userId || !cents} className={modalPrimary}>Add</button></>}>
      <select value={userId} onChange={e => setUserId(e.target.value)} className={modalInput}>{rates.map(r => <option key={r.userId} value={r.userId}>{r.name}</option>)}</select>
      <select value={kind} onChange={e => setKind(e.target.value)} className={modalInput}>{['bonus', 'reimbursement', 'designer_fee', 'other'].map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select>
      <div className="flex items-center gap-2"><span className="text-off-black/50">$</span><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className={modalInput} /></div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="What for" className={modalInput} />
    </ActionModal>
  )
}

/** Hourly rates, per person. Custom rates are edited on the Customs tab (the counter's own editor). */
function Rates({ rates, onSaved }: { rates: Rate[]; onSaved: (d: (prev: PayoutsPayload | null) => PayoutsPayload | null) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const dollars = (c: number | null) => (c == null ? '' : (c / 100).toFixed(c % 100 ? 2 : 0))
  const save = async (r: Rate) => {
    const v = draft[r.userId]
    const cents = v === undefined || v.trim() === '' ? null : Math.round(Number(v) * 100)
    if (cents !== null && !Number.isFinite(cents)) { toast.error('That is not a number'); return }
    setSaving(r.userId)
    try { const out = await financeApi.setHourlyRate(r.userId, cents); onSaved(p => (p ? { ...p, rates: out.rates } : p)); setDraft(p => { const n = { ...p }; delete n[r.userId]; return n }); toast.success('Rate saved') } catch (e) { toast.error((e as Error).message) } finally { setSaving(null) }
  }
  return (
    <div className={`${card} p-4`}>
      <p className="text-[11px] text-off-black/50 mb-3">Per hour, for approved timesheets. A change applies from the next approval; approved weeks keep the rate they were approved at. Custom rates are on the Customs tab.</p>
      <table className="w-full text-xs">
        <thead><tr className="border-b border-border-gray"><th className={`py-1.5 text-left ${tableHead}`}>Person</th><th className={`py-1.5 text-left ${tableHead}`}>Role</th><th className={`py-1.5 text-left ${tableHead}`}>Per hour</th><th className={`py-1.5 text-left ${tableHead}`}>Per custom</th></tr></thead>
        <tbody>{rates.map(r => {
          const d = draft[r.userId] ?? dollars(r.hourlyRateCents)
          const changed = draft[r.userId] !== undefined && draft[r.userId] !== dollars(r.hourlyRateCents)
          return (
            <tr key={r.userId} className="border-b border-border-gray/60">
              <td className="py-1.5 font-medium">{r.name}</td><td className="py-1.5 text-off-black/60">{r.role.replace('_', ' ')}</td>
              <td className="py-1.5"><span className="inline-flex items-center gap-1.5"><span className="text-off-black/40">$</span><input value={d} onChange={e => setDraft(p => ({ ...p, [r.userId]: e.target.value }))} placeholder="not hourly" inputMode="decimal" className={`${inputBase} w-24 py-1`} />{changed && <button onClick={() => save(r)} disabled={saving === r.userId} className={`${btnSecondary} py-1`}>{saving === r.userId ? 'Saving…' : 'Save'}</button>}</span></td>
              <td className="py-1.5 text-off-black/60">{r.customs ? `${usd(r.customs.newCents)} new · ${usd(r.customs.repeatCents)} repeat${r.customs.custom ? ' (own rate)' : ''}` : '–'}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}
