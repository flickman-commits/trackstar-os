import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { GripVertical, Loader2, Pause, Play, Square } from 'lucide-react'
import { financeApi, mondayOf, todayET } from '@/lib/financeApi'
import type { HoursPayload, TimeEntry } from '@/types/finance'

/** Fired by the Hours modal after a start, stop or edit, so this card catches up at once. */
export const HOURS_CHANGED = 'hours:changed'

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const POS_KEY = 'hours_timer_pos'
type Pos = { x: number; y: number }
const readPos = (): Pos | null => {
  try { const p = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null } catch { return null }
}
/** Keep the card on screen, even after the window shrinks. */
const clamp = (p: Pos, el: HTMLElement | null): Pos => {
  const w = el?.offsetWidth || 280, h = el?.offsetHeight || 72
  return { x: Math.min(Math.max(8, p.x), window.innerWidth - w - 8), y: Math.min(Math.max(8, p.y), window.innerHeight - h - 8) }
}

/**
 * The card's frame. Drag it by the grip on its left to wherever it is out of
 * the way; the spot is remembered on this device. Until it is moved it sits in
 * the bottom right (above the bottom bar on a phone).
 */
function Floating({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(readPos)
  useEffect(() => {
    if (!pos) return
    const fit = () => setPos(p => (p ? clamp(p, ref.current) : p))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const start = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return
    e.preventDefault()
    const box = el.getBoundingClientRect()
    const dx = e.clientX - box.left, dy = e.clientY - box.top
    let last: Pos = { x: box.left, y: box.top }
    const move = (ev: PointerEvent) => { last = clamp({ x: ev.clientX - dx, y: ev.clientY - dy }, el); setPos(last) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      try { localStorage.setItem(POS_KEY, JSON.stringify(last)) } catch { /* private window */ }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const reset = () => { setPos(null); try { localStorage.removeItem(POS_KEY) } catch { /* private window */ } }
  return (
    <div ref={ref} style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`fixed z-[150] ${pos ? '' : 'right-3 md:right-5 bottom-[calc(100px+env(safe-area-inset-bottom))] md:bottom-5'} flex items-center gap-3 rounded-2xl border border-border-gray bg-white shadow-xl pl-1.5 pr-3 py-3 min-w-[260px]`}>
      <span onPointerDown={start} onDoubleClick={reset} title="Drag to move. Double-click to put it back in the corner." aria-label="Move the timer"
        className="self-stretch flex items-center px-1 -my-3 cursor-grab active:cursor-grabbing text-off-black/25 hover:text-off-black/50 touch-none select-none">
        <GripVertical className="w-4 h-4" />
      </span>
      {children}
    </div>
  )
}

/**
 * While your timer runs, a small card in the bottom right of every page:
 * how long it has been running, what it is for, Pause and Stop (or, while
 * paused, Resume and Stop). It can be dragged out of the way (Floating). It reads your
 * week once a minute and whenever the Hours modal changes it. Only for
 * people whose role includes Hours.
 */
export default function RunningTimer({ onOpen }: { onOpen?: () => void }) {
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [paused, setPaused] = useState<HoursPayload['paused']>(null)
  const [carried, setCarried] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { const d = await financeApi.hours(mondayOf(todayET())); setRunning(d.running); setPaused(d.running ? null : d.paused || null); setCarried(d.carriedMinutes || 0) } catch { /* keep what we had */ }
  }, [])
  useEffect(() => {
    load()
    const id = window.setInterval(load, 60_000)
    window.addEventListener(HOURS_CHANGED, load)
    return () => { window.clearInterval(id); window.removeEventListener(HOURS_CHANGED, load) }
  }, [load])
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  if (!running?.startedAt && !paused) return null
  const act = async (action: 'stop' | 'pause' | 'resume' | 'end', ok: string) => {
    setBusy(true)
    try {
      const d = await financeApi.hoursAction({ weekStart: mondayOf(todayET()), action })
      setRunning(d.running); setPaused(d.running ? null : d.paused || null); setCarried(d.carriedMinutes || 0)
      toast.success(ok)
      window.dispatchEvent(new Event(HOURS_CHANGED))
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  if (!running?.startedAt && paused) return (
    <Floating>
      <button onClick={onOpen} className="flex items-center gap-3 text-left min-w-0 flex-1" title="Open the Hours Tracker">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-off-black/50 leading-tight">Paused</span>
          <span className="block text-xl font-bold tabular-nums text-off-black leading-tight">{clock(paused.carriedMinutes * 60000)}</span>
          {paused.note && <span className="block text-xs text-off-black/55 truncate max-w-[150px]">{paused.note}</span>}
        </span>
      </button>
      <button onClick={() => act('resume', 'Timer resumed')} disabled={busy} className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-[#4600D6] px-4 h-12 text-sm font-semibold text-white hover:bg-[#3A00B0] disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}Resume
      </button>
      <button onClick={() => act('end', 'Done for now')} disabled={busy} className="shrink-0 inline-flex items-center justify-center rounded-xl border border-border-gray w-12 h-12 text-off-black hover:bg-subtle-gray disabled:opacity-50" title="Stop: your time so far is already logged" aria-label="Stop">
        <Square className="w-3.5 h-3.5 fill-off-black" />
      </button>
    </Floating>
  )
  if (!running?.startedAt) return null
  return (
    <Floating>
      <button onClick={onOpen} className="flex items-center gap-3 text-left min-w-0 flex-1" title="Open the Hours Tracker">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-off-black/50 leading-tight">Timer running</span>
          <span className="block text-xl font-bold tabular-nums text-off-black leading-tight">{clock(now - new Date(running.startedAt).getTime() + carried * 60000)}</span>
          {running.note && <span className="block text-xs text-off-black/55 truncate max-w-[170px]">{running.note}</span>}
        </span>
      </button>
      <button onClick={() => act('pause', 'Timer paused')} disabled={busy} className="shrink-0 inline-flex items-center justify-center rounded-xl border border-border-gray w-12 h-12 text-off-black hover:bg-subtle-gray disabled:opacity-50" title="Pause" aria-label="Pause">
        <Pause className="w-3.5 h-3.5 fill-off-black" />
      </button>
      <button onClick={() => act('stop', 'Timer stopped')} disabled={busy} className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-dark-fill px-5 h-12 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-white" />}Stop
      </button>
    </Floating>
  )
}
