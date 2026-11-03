import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Undo2, X } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { Avatar } from '@/components/AssigneePicker'
import { btnPrimary, btnSecondary, btnGhost, modalInput, modalPrimary, modalCancel, segment, segmentGroup, toolbarSelect } from '@/lib/ui'
import { financeApi, usd, hoursText, dayLabel } from '@/lib/financeApi'
import type { Person, Timesheet } from '@/types/finance'
import { card, ErrorCard, Spinner, StatusChip, tableHead, num } from './bits'

const STATUSES: [string, string][] = [['submitted', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Sent back'], ['draft', 'In progress'], ['all', 'All']]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Every person's weeks of hours. Approve locks the week and freezes the rate; reject sends it back with a note. */
export default function Timesheets() {
  const [status, setStatus] = useState('submitted')
  const [person, setPerson] = useState('')
  const [data, setData] = useState<{ timesheets: Timesheet[]; people: Person[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [reject, setReject] = useState<Timesheet | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await financeApi.timesheets(status, person)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [status, person])
  useEffect(() => { load() }, [load])

  const act = async (ts: Timesheet, action: 'approve' | 'reject' | 'withdraw', note = '') => {
    setBusy(ts.id)
    try { await financeApi.review(ts.id, action, note); toast.success(action === 'approve' ? `Approved ${ts.user?.firstName}'s week` : action === 'reject' ? 'Sent back' : 'Approval withdrawn'); setReject(null); await load() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const approveAll = async () => {
    const waiting = (data?.timesheets || []).filter(t => t.status === 'submitted')
    if (!waiting.length) return
    setBusy('all')
    let ok = 0
    for (const t of waiting) { try { await financeApi.review(t.id, 'approve'); ok++ } catch (e) { toast.error(`${t.user?.firstName}: ${(e as Error).message}`) } }
    toast.success(`Approved ${ok} week${ok === 1 ? '' : 's'}`)
    setBusy(null); await load()
  }
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const waiting = (data?.timesheets || []).filter(t => t.status === 'submitted').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className={segmentGroup}>{STATUSES.map(([k, l]) => <button key={k} onClick={() => setStatus(k)} className={segment(status === k, 'sm')}>{l}</button>)}</div>
          <select value={person} onChange={e => setPerson(e.target.value)} className={`${toolbarSelect(Boolean(person))} !w-auto !py-1.5 text-xs`}>
            <option value="">Everyone</option>
            {(data?.people || []).map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
          </select>
        </div>
        {waiting > 1 && status === 'submitted' && <button onClick={approveAll} disabled={busy !== null} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Approve all {waiting}</button>}
      </div>
      {error ? <ErrorCard text={error} /> : !data ? <Spinner /> : data.timesheets.length === 0 ? (
        <div className={`${card} p-6 text-sm text-off-black/50`}>
          {status === 'submitted' ? 'Nothing waiting for approval.' : 'No weeks here.'}
          {data.people.length === 0 && <span> Nobody has the Hours capability yet: give it to a role in Settings &gt; Roles, and add the people in Settings &gt; People.</span>}
        </div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          <table className="w-full text-xs">
            <thead><tr className="bg-subtle-gray border-b border-border-gray">
              <th className="w-6" /><th className={`px-2 py-2 text-left ${tableHead}`}>Person</th><th className={`px-2 py-2 text-left ${tableHead}`}>Week</th>
              {DAYS.map(d => <th key={d} className={`px-1 py-2 ${tableHead} ${num} hidden md:table-cell`}>{d}</th>)}
              <th className={`px-2 py-2 ${tableHead} ${num}`}>Hours</th><th className={`px-2 py-2 ${tableHead} ${num}`}>Pay</th><th className={`px-2 py-2 text-left ${tableHead}`}>Status</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody>
              {data.timesheets.map(t => {
                const rate = t.hourlyRateCents ?? t.rateNow ?? null
                const isOpen = open.has(t.id)
                return (
                  <TsRow key={t.id} t={t} rate={rate} isOpen={isOpen} busy={busy === t.id || busy === 'all'} onToggle={() => toggle(t.id)} onApprove={() => act(t, 'approve')} onReject={() => setReject(t)} onWithdraw={() => act(t, 'withdraw')} />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {reject && <RejectModal t={reject} busy={busy === reject.id} onClose={() => setReject(null)} onSend={note => act(reject, 'reject', note)} />}
    </div>
  )
}

function TsRow({ t, rate, isOpen, busy, onToggle, onApprove, onReject, onWithdraw }: { t: Timesheet; rate: number | null; isOpen: boolean; busy: boolean; onToggle: () => void; onApprove: () => void; onReject: () => void; onWithdraw: () => void }) {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(Date.UTC(Number(t.weekStart.slice(0, 4)), Number(t.weekStart.slice(5, 7)) - 1, Number(t.weekStart.slice(8, 10)) + i)); return d.toISOString().slice(0, 10) })
  const pay = rate != null ? Math.round((t.totalMinutes * rate) / 60) : null
  return (
    <>
      <tr className="border-b border-border-gray/60 hover:bg-subtle-gray cursor-pointer" onClick={onToggle}>
        <td className="pl-2 text-off-black/40">{isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
        <td className="px-2 py-2"><span className="inline-flex items-center gap-1.5">{t.user && <Avatar user={t.user} size={18} />}<span className="font-medium">{t.user?.firstName} {t.user?.lastName}</span></span></td>
        <td className="px-2 py-2 whitespace-nowrap">{dayLabel(t.weekStart)} to {dayLabel(t.weekEnd)}{t.submittedAt && <span className="text-off-black/40"> · sent {dayLabel(t.submittedAt.slice(0, 10))}</span>}</td>
        {days.map(d => <td key={d} className={`px-1 py-2 ${num} hidden md:table-cell ${(t.byDay[d] || 0) > 12 * 60 ? 'text-red-600 font-semibold' : t.byDay[d] ? '' : 'text-off-black/30'}`}>{t.byDay[d] ? hoursText(t.byDay[d]) : '·'}</td>)}
        <td className={`px-2 py-2 ${num} font-semibold`}>{hoursText(t.totalMinutes)}</td>
        <td className={`px-2 py-2 ${num}`}>{pay != null ? usd(pay) : <span className="text-amber-700">no rate</span>}{rate != null && <span className="text-off-black/40"> · {usd(rate)}/h</span>}</td>
        <td className="px-2 py-2"><StatusChip status={t.paid ? 'paid' : t.status} />{t.flags.length > 0 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-700" title={t.flags.join('\n')}><AlertTriangle className="w-3.5 h-3.5" /> {t.flags.length}</span>}</td>
        <td className="px-2 py-2 whitespace-nowrap" onClick={e => e.stopPropagation()}>
          {t.status === 'submitted' && <span className="inline-flex gap-1"><button onClick={onApprove} disabled={busy} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Approve</button><button onClick={onReject} disabled={busy} className={btnSecondary}><X className="w-3.5 h-3.5" /> Send back</button></span>}
          {t.status === 'approved' && !t.paid && <button onClick={onWithdraw} disabled={busy} className={btnGhost} title="Reopen this week"><Undo2 className="w-3.5 h-3.5" /> Withdraw</button>}
          {t.status === 'draft' && <button onClick={onApprove} disabled={busy} className={btnGhost} title="Approve without waiting for them to submit">Approve</button>}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-subtle-gray/60 border-b border-border-gray/60"><td colSpan={13} className="px-4 py-2">
          {t.reviewNote && <p className="text-xs text-off-black/70 mb-2"><span className="font-semibold">Note:</span> {t.reviewNote}</p>}
          {t.flags.length > 0 && <ul className="text-xs text-amber-800 mb-2 list-disc pl-4">{t.flags.map(f => <li key={f}>{f}</li>)}</ul>}
          {t.entries.length === 0 ? <p className="text-xs text-off-black/45">No entries.</p> : (
            <table className="text-xs"><tbody>
              {t.entries.map(e => <tr key={e.id}><td className="pr-3 py-0.5 text-off-black/60 whitespace-nowrap">{dayLabel(e.day, 'weekday')}</td><td className={`pr-3 py-0.5 ${num} font-medium`}>{e.startedAt && !e.endedAt ? 'running' : hoursText(e.minutes)}</td><td className="py-0.5 text-off-black/80">{e.note || <span className="text-off-black/35">no note</span>}</td></tr>)}
            </tbody></table>
          )}
        </td></tr>
      )}
    </>
  )
}

function RejectModal({ t, busy, onClose, onSend }: { t: Timesheet; busy: boolean; onClose: () => void; onSend: (note: string) => void }) {
  const [note, setNote] = useState('')
  return (
    <ActionModal icon={X} title="Send back" sub={`${t.user?.firstName}, week of ${dayLabel(t.weekStart)}`} description="They get your note in a Slack DM and the week opens up for them to fix." onClose={onClose} busy={busy} size="sm"
      footer={<><button onClick={onClose} className={modalCancel} disabled={busy}>Cancel</button><button onClick={() => onSend(note)} disabled={busy || !note.trim()} className={modalPrimary}>Send back</button></>}>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="What needs to change" className={modalInput} autoFocus />
    </ActionModal>
  )
}
