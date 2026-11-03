import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, DollarSign, Plus, Trash2 } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import CustomCounter from '@/components/CustomCounter'
import RacePayouts from '@/components/finance/RacePayouts'
import { btnPrimary, btnSecondary, btnGhost, inputBase, modalInput, modalPrimary, modalCancel, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, hoursText, dayLabel, todayET, mondayOf, addDays } from '@/lib/financeApi'
import type { PayoutsPayload, PayRun, Rate } from '@/types/finance'
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

function Owed({ data, reload }: { data: PayoutsPayload; reload: () => Promise<void> }) {
  const today = todayET()
  const lastSunday = addDays(mondayOf(today), -1)
  const [start, setStart] = useState(addDays(lastSunday, -13))
  const [end, setEnd] = useState(lastSunday)
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (body: Record<string, unknown>, key: string) => {
    setBusy(key)
    try { const r = await financeApi.payoutAction(body); toast.success(`Created "${r.label}" (${usd(r.totalCents)})`); await reload() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const o = data.owed
  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div><h3 className="text-sm font-semibold text-off-black">Hours</h3><p className="text-[11px] text-off-black/50">Approved weeks not on a run yet. Hourly people are paid every two weeks.</p></div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className={`${inputBase} py-1`} /><span className="text-off-black/40">to</span><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={`${inputBase} py-1`} />
            <button onClick={() => run({ action: 'create_run', kind: 'hours', periodStart: start, periodEnd: end }, 'hours')} disabled={busy !== null || !o.hours.length} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> Create hours run</button>
          </div>
        </div>
        {o.hours.length === 0 ? <p className="text-sm text-off-black/50">Nothing owed for hours.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border-gray"><th className={`py-1.5 text-left ${tableHead}`}>Person</th><th className={`py-1.5 text-left ${tableHead}`}>Weeks</th><th className={`py-1.5 ${tableHead} ${num}`}>Hours</th><th className={`py-1.5 ${tableHead} ${num}`}>Owed</th></tr></thead>
            <tbody>{o.hours.map(p => (
              <tr key={p.userId} className="border-b border-border-gray/60 align-top">
                <td className="py-1.5 font-medium">{p.name}</td>
                <td className="py-1.5 text-off-black/70">{p.weeks.map(w => <div key={w.timesheetId}>{dayLabel(w.weekStart)}: {hoursText(w.minutes)} at {usd(w.rateCents)}/h</div>)}</td>
                <td className={`py-1.5 ${num}`}>{hoursText(p.minutes)}</td><td className={`py-1.5 ${num} font-semibold`}>{usd(p.amountCents)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className={`${card} p-4`}>
        <div className="mb-3"><h3 className="text-sm font-semibold text-off-black">Month end</h3><p className="text-[11px] text-off-black/50">Customs per designer (the Custom Counter) and the head designer's fee, for months that are over and not on a run yet.</p></div>
        {o.months.length === 0 ? <p className="text-sm text-off-black/50">Every closed month is on a run.</p> : o.months.map(m => (
          <div key={m.month} className="mb-3 last:mb-0">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold">{m.label} <span className="font-normal text-off-black/50">· {usd(m.totalCents)}</span></span>
              <button onClick={() => run({ action: 'create_run', kind: 'monthly', month: m.month }, m.month)} disabled={busy !== null} className={btnSecondary}><Plus className="w-3.5 h-3.5" /> Create {m.label.split(' ')[0]} run</button>
            </div>
            <table className="w-full text-xs"><tbody>{m.items.map(i => (
              <tr key={i.sourceRef} className="border-b border-border-gray/60"><td className="py-1 font-medium w-32">{i.name}</td><td className="py-1 text-off-black/60 w-24">{KIND[i.kind]}</td><td className="py-1 text-off-black/70">{i.note}</td><td className={`py-1 ${num} font-semibold w-24`}>{usd(i.amountCents)}</td></tr>
            ))}</tbody></table>
          </div>
        ))}
      </div>
      <div className={`${card} p-4 flex items-center justify-between`}><span className="text-sm font-semibold">Owed in all</span><span className="text-lg font-semibold tabular-nums">{usd(o.totalCents)}</span></div>
    </div>
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
