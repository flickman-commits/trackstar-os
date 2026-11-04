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
    <div className="fixed z-[150] right-3 md:right-4 bottom-[calc(100px+env(safe-area-inset-bottom))] md:bottom-4 flex items-center gap-3 rounded-xl border border-border-gray bg-white shadow-lg pl-3.5 pr-2 py-2">
      <button onClick={onOpen} className="flex items-center gap-2.5 text-left min-w-0" title="Open Hours">
        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
        <span className="min-w-0">
          <span className="block text-base font-bold tabular-nums text-off-black leading-tight">{clock(now - new Date(running.startedAt).getTime())}</span>
          {running.note && <span className="block text-[11px] text-off-black/50 truncate max-w-[160px]">{running.note}</span>}
        </span>
      </button>
      <button onClick={stop} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-dark-fill px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3 h-3 fill-white" />}Stop
      </button>
    </div>
  )
}
