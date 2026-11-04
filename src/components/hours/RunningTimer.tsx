import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Square } from 'lucide-react'
import { financeApi, mondayOf, todayET } from '@/lib/financeApi'
import type { TimeEntry } from '@/types/finance'

/** Fired by the Hours modal after a start, stop or edit, so this card catches up at once. */
export const HOURS_CHANGED = 'hours:changed'

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * While your timer runs, a small card in the bottom right of every page:
 * how long it has been running, what it is for, and Stop. It reads your
 * week once a minute and whenever the Hours modal changes it. Only for
 * people whose role includes Hours.
 */
export default function RunningTimer({ onOpen }: { onOpen?: () => void }) {
  const [running, setRunning] = useState<TimeEntry | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setRunning((await financeApi.hours(mondayOf(todayET()))).running) } catch { /* keep what we had */ }
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

  if (!running?.startedAt) return null
  const stop = async () => {
    setBusy(true)
    try {
      await financeApi.hoursAction({ weekStart: mondayOf(todayET()), action: 'stop' })
      setRunning(null)
      toast.success('Timer stopped')
      window.dispatchEvent(new Event(HOURS_CHANGED))
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="fixed z-[150] right-3 md:right-5 bottom-[calc(100px+env(safe-area-inset-bottom))] md:bottom-5 flex items-center gap-4 rounded-2xl border border-border-gray bg-white shadow-xl pl-5 pr-3 py-3 min-w-[260px]">
      <button onClick={onOpen} className="flex items-center gap-3 text-left min-w-0 flex-1" title="Open the Hours Tracker">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-off-black/50 leading-tight">Timer running</span>
          <span className="block text-xl font-bold tabular-nums text-off-black leading-tight">{clock(now - new Date(running.startedAt).getTime())}</span>
          {running.note && <span className="block text-xs text-off-black/55 truncate max-w-[170px]">{running.note}</span>}
        </span>
      </button>
      <button onClick={stop} disabled={busy} className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-dark-fill px-5 h-12 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-3.5 h-3.5 fill-white" />}Stop
      </button>
    </div>
  )
}
