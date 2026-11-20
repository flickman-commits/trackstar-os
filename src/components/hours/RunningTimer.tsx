import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Clock, Loader2, Pause, Play, Square } from 'lucide-react'
import { financeApi, mondayOf, todayET } from '@/lib/financeApi'
import type { HoursPayload, TimeEntry } from '@/types/finance'
import { tell, type HoursState } from '@/lib/hoursState'

/** Fired by the Hours modal after a start, stop or edit, so this card catches up at once. */
export const HOURS_CHANGED = 'hours:changed'

const stateOf = (d: HoursPayload): HoursState => ({ running: Boolean(d.running?.startedAt), startedAt: d.running?.startedAt || null, carriedMinutes: d.running ? d.carriedMinutes || 0 : 0, paused: Boolean(!d.running && d.paused) })

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** The bar's height; the rail, the phone menu and the page move up by it (--hours-bar-h). */
const BAR_H = 52

/**
 * The bar along the bottom of the whole app while your timer runs or is
 * paused, like Slack's huddle bar (Matt, 2026-11-20): what it is, how long,
 * and the same buttons as before. It sets --hours-bar-h so nothing sits under it.
 */
function Bar({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--hours-bar-h', `calc(${BAR_H}px + env(safe-area-inset-bottom))`)
    return () => { root.style.removeProperty('--hours-bar-h') }
  }, [])
  return (
    <div role="status" style={{ height: `calc(${BAR_H}px + env(safe-area-inset-bottom))`, paddingBottom: 'env(safe-area-inset-bottom)' }}
      className="fixed inset-x-0 bottom-0 z-[150] flex items-center gap-2 sm:gap-3 px-3 sm:px-5 bg-[#1A1A1A] text-white border-t border-white/10 shadow-[0_-4px_16px_rgba(0,0,0,0.15)]">
      {children}
    </div>
  )
}

const BTN = 'shrink-0 inline-flex items-center gap-1.5 rounded-[5px] h-9 px-3 sm:px-4 text-sm font-semibold disabled:opacity-50 transition-colors'
const FILLED = `${BTN} bg-white text-[#1A1A1A] hover:bg-[#E0E0E0]`
const OUTLINE = `${BTN} border border-white/60 text-white hover:bg-white hover:text-[#1A1A1A]`

/**
 * While your timer runs, a bar along the bottom of every page (Bar): how
 * long it has been running, what it is for, Pause and Stop (or, while
 * paused, Resume and Stop). It reads your
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
    try { const d = await financeApi.hours(mondayOf(todayET())); setRunning(d.running); setPaused(d.running ? null : d.paused || null); setCarried(d.carriedMinutes || 0); tell(stateOf(d)) } catch { /* keep what we had */ }
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
      setRunning(d.running); setPaused(d.running ? null : d.paused || null); setCarried(d.carriedMinutes || 0); tell(stateOf(d))
      toast.success(ok)
      window.dispatchEvent(new Event(HOURS_CHANGED))
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  if (!running?.startedAt && paused) return (
    <Bar>
      <button onClick={onOpen} className="flex items-center gap-2.5 text-left min-w-0 flex-1" title="Open the Hours Tracker">
        <Clock className="w-4 h-4 text-white/70 shrink-0" />
        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
        <span className="text-sm font-semibold shrink-0">Paused</span>
        <span className="text-sm font-semibold tabular-nums shrink-0">{clock(paused.carriedMinutes * 60000)}</span>
        {paused.note && <span className="hidden sm:inline text-sm text-white/60 truncate">· {paused.note}</span>}
      </button>
      <button onClick={() => act('resume', 'Timer resumed')} disabled={busy} className={FILLED}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}Resume
      </button>
      <button onClick={() => act('end', 'Done for now')} disabled={busy} className={OUTLINE} title="Stop: your time so far is already logged">
        <Square className="w-3 h-3 fill-current" />Stop
      </button>
    </Bar>
  )
  if (!running?.startedAt) return null
  return (
    <Bar>
      <button onClick={onOpen} className="flex items-center gap-2.5 text-left min-w-0 flex-1" title="Open the Hours Tracker">
        <Clock className="w-4 h-4 text-white/70 shrink-0" />
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="hidden sm:inline text-sm font-semibold shrink-0">Timer running</span>
        <span className="text-sm font-semibold tabular-nums shrink-0">{clock(now - new Date(running.startedAt).getTime() + carried * 60000)}</span>
        {running.note && <span className="hidden sm:inline text-sm text-white/60 truncate">· {running.note}</span>}
      </button>
      <button onClick={() => act('pause', 'Timer paused')} disabled={busy} className={OUTLINE}>
        <Pause className="w-3.5 h-3.5 fill-current" />Pause
      </button>
      <button onClick={() => act('stop', 'Timer stopped')} disabled={busy} className={FILLED}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-3 h-3 fill-current" />}Stop
      </button>
    </Bar>
  )
}
