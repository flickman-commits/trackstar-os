import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Clock, Play, Send, Square, Trash2 } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { btnPrimary, btnSecondary, btnGhost, inputBase, modalPrimary, modalCancel } from '@/lib/ui'
import { financeApi, dayLabel, mondayOf, addDays, todayET } from '@/lib/financeApi'
import type { HoursPayload, TimeEntry } from '@/types/finance'
import { StatusChip } from '@/components/finance/bits'
import { useLocation } from 'react-router-dom'
import { HOURS_CHANGED } from './RunningTimer'

/** What a timer started from this page is for, by default. */
function panelName(path: string) {
  if (path.startsWith('/support')) return 'Customer Support'
  if (path.startsWith('/creators') || path.startsWith('/briefs')) return 'Creators'
  if (path.startsWith('/sales') || path.startsWith('/send')) return 'Sales'
  if (path.startsWith('/finance')) return 'Finance'
  return 'Fulfillment'
}

/**
 * Your hours, one week at a time: seven days, the entries on each, a timer
 * for right now, and Submit week when it is done. Submitted and approved
 * weeks are locked; a week sent back opens again with Matt's note on it.
 * Reached from Hours in Support's left column, or Tools > Hours on the rail.
 */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Time worked as people say it: "12 min", "3h 2m", "3h". Never 0.02h. */
function minutesText(total: number): string {
  const m = Math.max(0, Math.round(total || 0))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h}h ${r}m` : `${h}h`
}

/** "This week", "Last week", "2 weeks ago" for the week starting `monday`, counted from `thisMonday`. */
function weeksAgo(monday: string, thisMonday: string): string {
  const n = Math.round((new Date(`${thisMonday}T12:00:00Z`).getTime() - new Date(`${monday}T12:00:00Z`).getTime()) / (7 * 86400000))
  return n <= 0 ? 'This week' : n === 1 ? 'Last week' : `${n} weeks ago`
}

/** "1.5", "1:30", "90m", "2h" -> minutes. */
function parseHours(text: string): number | null {
  const s = text.trim().toLowerCase()
  if (!s) return null
  let m: RegExpExecArray | null
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return Number(m[1]) * 60 + Number(m[2])
  if ((m = /^(\d+(?:\.\d+)?)\s*m(in(utes?)?)?$/.exec(s))) return Math.round(Number(m[1]))
  if ((m = /^(\d+(?:\.\d+)?)\s*h?(ours?|rs?)?$/.exec(s))) return Math.round(Number(m[1]) * 60)
  return null
}

export default function HoursModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return <HoursBody onClose={onClose} />
}

function HoursBody({ onClose }: { onClose: () => void }) {
  const [week, setWeek] = useState<string>(mondayOf(todayET()))
  const [data, setData] = useState<HoursPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const { pathname } = useLocation()
  const [timerNote, setTimerNote] = useState(() => panelName(pathname))
  const [tick, setTick] = useState(0)

  const load = useCallback(async (w: string) => {
    try { setData(await financeApi.hours(w)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { load(week) }, [week, load])
  useEffect(() => { if (!data?.running) return; const id = window.setInterval(() => setTick(t => t + 1), 15_000); return () => window.clearInterval(id) }, [data?.running])

  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true)
    try { const out = await financeApi.hoursAction({ weekStart: week, ...body }); setData(out); if (out.week.weekStart !== week) setWeek(out.week.weekStart); window.dispatchEvent(new Event(HOURS_CHANGED)); if (ok) toast.success(ok) }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const ts = data?.week
  const locked = ts?.status === 'submitted' || ts?.status === 'approved'
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const today = data?.today || todayET()
  const thisMonday = mondayOf(today)
  const running = data?.running
  const elapsed = running?.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(running.startedAt).getTime()) / 60000)) : 0
  void tick

  return (
    <ActionModal icon={Clock} title="Hours Tracker" sub={ts ? `week of ${dayLabel(ts.weekStart)}` : undefined} onClose={onClose} size="xl" bare
      actions={<div className="flex items-center gap-1 mr-2">
        <button onClick={() => setWeek(w => addDays(w, -7))} className={btnGhost} aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => setWeek(w => addDays(w, 7))} disabled={week >= thisMonday} className={btnGhost} aria-label="Next week"><ChevronRight className="w-4 h-4" /></button>
      </div>}
      footer={ts && <>
        <span className="text-sm text-off-black/60 mr-auto">{minutesText(ts.totalMinutes)} this week{ts.hourlyRateCents != null && ts.status === 'approved' ? ` · approved at $${(ts.hourlyRateCents / 100).toFixed(2)}/h` : ''}</span>
        {!locked && <button onClick={() => setConfirm(true)} disabled={busy || !ts.totalMinutes || Boolean(running)} className={modalPrimary}><Send className="w-3.5 h-3.5" /> Submit week</button>}
        {locked && <StatusChip status={ts.status} />}
      </>}>
      <div className="p-4 md:p-5 space-y-4">
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!ts ? <p className="text-sm text-off-black/50">Loading…</p> : (
          <>
            {ts.status !== 'draft' && <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={ts.status} />
              {ts.status === 'rejected' && ts.reviewNote && <span className="text-sm text-rose-800">Matt sent this back: {ts.reviewNote}</span>}
              {ts.status === 'submitted' && <span className="text-xs text-off-black/50">Locked until Matt reviews it.</span>}
              {ts.status === 'approved' && <span className="text-xs text-off-black/50">Approved{ts.reviewNote ? `: ${ts.reviewNote}` : '.'}</span>}
            </div>}
            {week === thisMonday && (
              <div className="rounded-xl bg-subtle-gray border border-border-gray p-3 md:p-4">
                {running ? (
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="inline-flex items-center gap-2 text-sm font-semibold text-off-black"><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />Timer running</p>
                      <p className="text-2xl font-bold tabular-nums text-off-black mt-0.5">{minutesText(elapsed)}</p>
                      {running.note && <p className="text-sm text-off-black/55 truncate">{running.note}</p>}
                    </div>
                    <button onClick={() => act({ action: 'stop' }, 'Timer stopped')} disabled={busy} className="md:w-72 h-16 rounded-xl bg-dark-fill text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50">
                      <Square className="w-4 h-4 fill-white" /> Stop timer
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col md:flex-row md:items-end gap-3">
                    <label className="flex-1 min-w-0">
                      <span className="block text-xs font-medium text-off-black/60 mb-1">What are you working on?</span>
                      <input value={timerNote} onChange={e => setTimerNote(e.target.value)} placeholder="Customer Support" className={`${inputBase} w-full py-2.5`} disabled={locked} />
                    </label>
                    <button onClick={() => { act({ action: 'start', note: timerNote }, 'Timer started'); setTimerNote(panelName(pathname)) }} disabled={busy || locked}
                      className="md:w-72 h-16 rounded-xl bg-[#4600D6] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-[#3A00B0] transition-colors disabled:opacity-50">
                      <Play className="w-4 h-4 fill-white" /> Start timer
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
              {days.map((d, i) => (
                <DayColumn key={d} day={d} label={DAYS[i]} entries={ts.entries.filter(e => e.day === d)} total={ts.byDay[d] || 0} future={d > today} locked={locked} busy={busy} onAdd={(minutes, note) => act({ action: 'add', day: d, minutes, note })} onDelete={id => act({ action: 'delete', id })} onUpdate={(id, minutes, note) => act({ action: 'update', id, minutes, note })} />
              ))}
            </div>
            {data && data.weeks.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-off-black/45 mb-1">Earlier weeks</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.weeks.map(w => (
                    <button key={w.weekStart} onClick={() => setWeek(w.weekStart)} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs ${w.weekStart === week ? 'bg-dark-fill text-white border-dark-fill' : 'bg-white border-border-gray text-off-black/70 hover:bg-subtle-gray'}`}>
                      <span className="font-medium">{weeksAgo(w.weekStart, thisMonday)}</span>
                      <span className="opacity-60">{dayLabel(w.weekStart)}{w.totalMinutes ? ` · ${minutesText(w.totalMinutes)}` : ''}</span>
                      {w.status !== 'empty' && w.status !== 'draft' && <span className={`w-1.5 h-1.5 rounded-full ${w.status === 'approved' ? 'bg-emerald-500' : w.status === 'rejected' ? 'bg-rose-500' : 'bg-amber-500'}`} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {confirm && ts && (
        <ActionModal icon={Send} title="Submit this week?" description={`${minutesText(ts.totalMinutes)} for the week of ${dayLabel(ts.weekStart)}. It locks until Matt reviews it.`} onClose={() => setConfirm(false)} busy={busy} size="sm"
          footer={<><button onClick={() => setConfirm(false)} className={modalCancel} disabled={busy}>Not yet</button><button onClick={async () => { await act({ action: 'submit', weekStart: ts.weekStart }, 'Week submitted'); setConfirm(false) }} disabled={busy} className={modalPrimary}>Submit</button></>} />
      )}
    </ActionModal>
  )
}

function DayColumn({ day, label, entries, total, future, locked, busy, onAdd, onDelete, onUpdate }: {
  day: string; label: string; entries: TimeEntry[]; total: number; future: boolean; locked: boolean; busy: boolean
  onAdd: (minutes: number, note: string) => void; onDelete: (id: string) => void; onUpdate: (id: string, minutes: number, note: string) => void
}) {
  const [hrs, setHrs] = useState('')
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [eh, setEh] = useState('')
  const [en, setEn] = useState('')
  const add = () => {
    const minutes = parseHours(hrs)
    if (!minutes) { toast.error('Hours like 1.5, 1:30 or 90m'); return }
    onAdd(minutes, note); setHrs(''); setNote('')
  }
  const isToday = day === todayET()
  return (
    <div className={`rounded-md border ${isToday ? 'border-off-black/40' : 'border-border-gray'} ${future ? 'bg-subtle-gray/60' : 'bg-white'} p-2 flex flex-col min-h-[120px]`}>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-xs font-semibold text-off-black">{label} <span className="font-normal text-off-black/45">{dayLabel(day).replace(/^\w+ /, '')}</span></span>
        <span className={`text-xs tabular-nums ${total > 12 * 60 ? 'text-red-600 font-semibold' : 'text-off-black/60'}`}>{total ? minutesText(total) : ''}</span>
      </div>
      <div className="space-y-1 flex-1">
        {entries.map(e => editing === e.id ? (
          <div key={e.id} className="rounded bg-subtle-gray p-1.5 space-y-1">
            <input value={eh} onChange={ev => setEh(ev.target.value)} className={`${inputBase} w-full py-1 text-xs`} placeholder="1.5" />
            <input value={en} onChange={ev => setEn(ev.target.value)} className={`${inputBase} w-full py-1 text-xs`} placeholder="note" />
            <div className="flex gap-1"><button onClick={() => { const m = parseHours(eh); if (!m) { toast.error('Hours like 1.5, 1:30 or 90m'); return } onUpdate(e.id, m, en); setEditing(null) }} disabled={busy} className={`${btnPrimary} py-1 px-2`}>Save</button><button onClick={() => setEditing(null)} className={`${btnGhost} py-1 px-2`}>Cancel</button></div>
          </div>
        ) : (
          <div key={e.id} className="group rounded bg-subtle-gray px-1.5 py-1 text-xs flex items-start gap-1">
            <button disabled={locked || Boolean(e.startedAt && !e.endedAt)} onClick={() => { setEditing(e.id); setEh((e.minutes / 60).toString()); setEn(e.note || '') }} className="flex-1 text-left min-w-0 disabled:cursor-default">
              <span className="font-semibold tabular-nums">{e.startedAt && !e.endedAt ? 'running' : minutesText(e.minutes)}</span>
              {e.note && <span className="block text-off-black/60 truncate">{e.note}</span>}
            </button>
            {!locked && <button onClick={() => onDelete(e.id)} disabled={busy} className="opacity-0 group-hover:opacity-100 text-off-black/35 hover:text-red-600 shrink-0" aria-label="Remove"><Trash2 className="w-3 h-3" /></button>}
          </div>
        ))}
      </div>
      {!locked && !future && (
        <div className="mt-1.5 space-y-1">
          <input value={hrs} onChange={e => setHrs(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="1.5" inputMode="decimal" className={`${inputBase} w-full py-1 text-xs`} aria-label={`Hours on ${label}`} />
          <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="what" className={`${inputBase} w-full py-1 text-xs`} aria-label={`Note for ${label}`} />
          {hrs && <button onClick={add} disabled={busy} className={`${btnSecondary} w-full py-1`}>Add</button>}
        </div>
      )}
    </div>
  )
}
