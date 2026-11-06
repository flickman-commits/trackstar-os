import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Undo2, X } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { Avatar } from '@/components/AssigneePicker'
import { btnPrimary, btnSecondary, btnGhost, modalInput, modalPrimary, modalCancel, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, hoursText, dayLabel, addDays, mondayOf, todayET } from '@/lib/financeApi'
import type { Person, Timesheet } from '@/types/finance'
import { card, ErrorCard, Spinner, StatusChip, tableHead, num } from './bits'

/**
 * Everyone's hours for one week, opening on this week. Three tabs, the three
 * states a week can be in: In progress (still being filled in, including a
 * week sent back to fix and anyone with nothing logged yet), Submitted
 * (waiting on Matt) and Approved. Approve locks the week and freezes the
 * rate; Send back opens it again with a note.
 */
type Tab = 'in_progress' | 'submitted' | 'approved'
const TABS: [Tab, string][] = [['in_progress', 'In progress'], ['submitted', 'Submitted'], ['approved', 'Approved']]
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const tabOf = (t: Timesheet): Tab => (t.status === 'submitted' ? 'submitted' : t.status === 'approved' ? 'approved' : 'in_progress')

/** A person with Hours but no week yet: shown In progress with nothing logged. */
function blankWeek(p: Person, weekStart: string): Timesheet {
  return { id: `blank-${p.id}`, userId: p.id, user: { id: p.id, firstName: p.firstName, lastName: p.lastName, role: p.role }, weekStart, weekEnd: addDays(weekStart, 6), status: 'draft', submittedAt: null, reviewedAt: null, reviewNote: null, hourlyRateCents: null, paid: false, entries: [], totalMinutes: 0, byDay: {}, flags: [], rateNow: p.hourlyRateCents }
}

export default function Timesheets() {
  const thisWeek = mondayOf(todayET())
  const [week, setWeek] = useState(thisWeek)
  const [tab, setTab] = useState<Tab>('in_progress')
  const [data, setData] = useState<{ timesheets: Timesheet[]; people: Person[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [reject, setReject] = useState<Timesheet | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await financeApi.timesheetsWeek(week)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [week])
  useEffect(() => { setData(null); load() }, [load])

  // Every week this week, plus everyone with Hours who has not started one.
  const rows = useMemo(() => {
    if (!data) return []
    const have = new Set(data.timesheets.map(t => t.userId))
    const blanks = week <= thisWeek ? data.people.filter(p => !have.has(p.id)).map(p => blankWeek(p, week)) : []
    return [...data.timesheets, ...blanks].sort((a, b) => (a.user?.firstName || '').localeCompare(b.user?.firstName || ''))
  }, [data, week, thisWeek])
  const counts = useMemo(() => {
    const c: Record<Tab, number> = { in_progress: 0, submitted: 0, approved: 0 }
    for (const r of rows) c[tabOf(r)]++
    return c
  }, [rows])
  const shown = rows.filter(r => tabOf(r) === tab)

  const act = async (ts: Timesheet, action: 'approve' | 'reject' | 'withdraw', note = '') => {
    setBusy(ts.id)
    try { await financeApi.review(ts.id, action, note); toast.success(action === 'approve' ? `Approved ${ts.user?.firstName}'s week` : action === 'reject' ? 'Sent back' : 'Approval withdrawn'); setReject(null); await load() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const approveAll = async () => {
    const waiting = rows.filter(t => t.status === 'submitted')
    if (!waiting.length) return
    setBusy('all')
    let ok = 0
    for (const t of waiting) { try { await financeApi.review(t.id, 'approve'); ok++ } catch (e) { toast.error(`${t.user?.firstName}: ${(e as Error).message}`) } }
    toast.success(`Approved ${ok} week${ok === 1 ? '' : 's'}`)
    setBusy(null); await load()
  }
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const weekLabel = week === thisWeek ? 'This week' : week === addDays(thisWeek, -7) ? 'Last week' : `Week of ${dayLabel(week)}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setWeek(w => addDays(w, -7))} className={btnSecondary} aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></button>
            <span className="min-w-[200px] text-center text-sm"><span className="font-semibold text-off-black">{weekLabel}</span> <span className="text-off-black/50">{dayLabel(week)} to {dayLabel(addDays(week, 6))}</span></span>
            <button onClick={() => setWeek(w => addDays(w, 7))} disabled={week >= thisWeek} className={btnSecondary} aria-label="Next week"><ChevronRight className="w-4 h-4" /></button>
            {week !== thisWeek && <button onClick={() => setWeek(thisWeek)} className={btnGhost}>This week</button>}
          </div>
          <div className={segmentGroup}>
            {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={segment(tab === k, 'sm')}>{l}{data ? <span className="ml-1.5 opacity-60">{counts[k]}</span> : null}</button>)}
          </div>
        </div>
        {tab === 'submitted' && counts.submitted > 1 && <button onClick={approveAll} disabled={busy !== null} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Approve all {counts.submitted}</button>}
      </div>
      {error ? <ErrorCard text={error} /> : !data ? <Spinner /> : data.people.length === 0 && rows.length === 0 ? (
        <div className={`${card} p-6 text-sm text-off-black/50`}>Nobody logs hours yet. Give Hours to a role in Settings &gt; Roles, or to a person in Settings &gt; People.</div>
      ) : shown.length === 0 ? (
        <div className={`${card} p-6 text-sm text-off-black/50`}>{tab === 'submitted' ? 'Nothing submitted for this week.' : tab === 'approved' ? 'Nothing approved for this week yet.' : 'Everyone has submitted this week.'}</div>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-xs">
            <thead><tr className="bg-subtle-gray border-b border-border-gray">
              <th className="w-6" /><th className={`px-2 py-2 text-left ${tableHead}`}>Person</th>
              {DAYS.map((d, i) => <th key={d} className={`px-1 py-2 ${tableHead} ${num} hidden md:table-cell`}>{d} <span className="font-normal text-off-black/35">{addDays(week, i).slice(8).replace(/^0/, '')}</span></th>)}
              <th className={`px-2 py-2 ${tableHead} ${num}`}>Hours</th><th className={`px-2 py-2 ${tableHead} ${num}`}>Pay</th><th className={`px-2 py-2 text-left ${tableHead}`}>Status</th><th className="px-2 py-2" />
            </tr></thead>
            <tbody>
              {shown.map(t => (
                <TsRow key={t.id} t={t} week={week} rate={t.hourlyRateCents ?? t.rateNow ?? null} isOpen={open.has(t.id)} busy={busy === t.id || busy === 'all'} onToggle={() => toggle(t.id)} onApprove={() => act(t, 'approve')} onReject={() => setReject(t)} onWithdraw={() => act(t, 'withdraw')} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reject && <RejectModal t={reject} busy={busy === reject.id} onClose={() => setReject(null)} onSend={note => act(reject, 'reject', note)} />}
    </div>
  )
}

function TsRow({ t, week, rate, isOpen, busy, onToggle, onApprove, onReject, onWithdraw }: { t: Timesheet; week: string; rate: number | null; isOpen: boolean; busy: boolean; onToggle: () => void; onApprove: () => void; onReject: () => void; onWithdraw: () => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const pay = rate != null ? Math.round((t.totalMinutes * rate) / 60) : null
  const blank = t.id.startsWith('blank-')
  return (
    <>
      <tr className={`border-b border-border-gray/60 ${blank ? '' : 'hover:bg-subtle-gray cursor-pointer'}`} onClick={blank ? undefined : onToggle}>
        <td className="pl-2 text-off-black/40">{blank ? null : isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</td>
        <td className="px-2 py-2 whitespace-nowrap"><span className="inline-flex items-center gap-1.5">{t.user && <Avatar user={t.user} size={18} />}<span className="font-medium">{t.user?.firstName} {t.user?.lastName}</span></span></td>
        {days.map(d => <td key={d} className={`px-1 py-2 ${num} hidden md:table-cell ${(t.byDay[d] || 0) > 12 * 60 ? 'text-red-600 font-semibold' : t.byDay[d] ? '' : 'text-off-black/30'}`}>{t.byDay[d] ? hoursText(t.byDay[d]) : '·'}</td>)}
        <td className={`px-2 py-2 ${num} font-semibold whitespace-nowrap`}>{t.totalMinutes ? hoursText(t.totalMinutes) : <span className="font-normal text-off-black/35">nothing yet</span>}</td>
        <td className={`px-2 py-2 ${num} whitespace-nowrap`}>{rate == null ? <span className="text-amber-700" title="Set an hourly rate in Payouts > Rates">no rate</span> : <>{usd(pay ?? 0)}<span className="text-off-black/40"> · {usd(rate)}/h</span></>}</td>
        <td className="px-2 py-2 whitespace-nowrap">
          <StatusChip status={t.status} />
          {t.status === 'rejected' && <span className="ml-1.5 text-[11px] text-rose-700">sent back</span>}
          {t.paid && <span className="ml-1.5 text-[11px] text-emerald-700">paid</span>}
          {t.flags.length > 0 && <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-700" title={t.flags.join('\n')}><AlertTriangle className="w-3.5 h-3.5" /> {t.flags.length}</span>}
        </td>
        <td className="px-2 py-2 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
          {t.status === 'submitted' && <span className="inline-flex gap-1"><button onClick={onApprove} disabled={busy} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Approve</button><button onClick={onReject} disabled={busy} className={btnSecondary}><X className="w-3.5 h-3.5" /> Send back</button></span>}
          {t.status === 'approved' && !t.paid && <button onClick={onWithdraw} disabled={busy} className={btnGhost} title="Reopen this week"><Undo2 className="w-3.5 h-3.5" /> Withdraw</button>}
          {(t.status === 'draft' || t.status === 'rejected') && !blank && t.totalMinutes > 0 && <button onClick={onApprove} disabled={busy} className={btnGhost} title="Approve without waiting for them to submit">Approve</button>}
        </td>
      </tr>
      {isOpen && !blank && (
        <tr className="bg-subtle-gray/60 border-b border-border-gray/60"><td colSpan={13} className="px-4 py-2">
          {t.reviewNote && <p className="text-xs text-off-black/70 mb-2"><span className="font-semibold">Note:</span> {t.reviewNote}</p>}
          {t.flags.length > 0 && <ul className="text-xs text-amber-800 mb-2 list-disc pl-4">{t.flags.map(f => <li key={f}>{f}</li>)}</ul>}
          {t.entries.length === 0 ? <p className="text-xs text-off-black/45">No entries.</p> : (
            <table className="text-xs"><tbody>
              {t.entries.map(e => <tr key={e.id}><td className="pr-3 py-0.5 text-off-black/60 whitespace-nowrap">{dayLabel(e.day, 'weekday')}</td><td className={`pr-3 py-0.5 ${num} font-medium whitespace-nowrap`}>{e.startedAt && !e.endedAt ? 'running' : hoursText(e.minutes)}</td><td className="py-0.5 text-off-black/80">{e.note || <span className="text-off-black/35">no note</span>}</td></tr>)}
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
