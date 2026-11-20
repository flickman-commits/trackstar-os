import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { openHours } from '@/lib/openHours'
import { HOURS_STATE, hoursState, type HoursState } from '@/lib/hoursState'
import { useAuth } from '@/lib/auth'

const elapsed = (s: HoursState, now: number) => {
  const m = Math.max(0, Math.floor((now - new Date(s.startedAt!).getTime()) / 60000) + s.carriedMinutes)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * The Hours Tracker, in the page header where nobody misses it: a filled
 * "Clock in" while your timer is off, so recording time is the obvious next
 * step, and "On the clock 1h 12m" while it runs. It reads the timer from the
 * running-timer card (RunningTimer), which already asks the server.
 */
export default function HoursButton() {
  // An admin (Matt) opens it to see and log hours, not to start a shift: plain "Hours" (2026-11-20).
  const { isAdmin } = useAuth()
  const [state, setState] = useState<HoursState | null>(hoursState)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const on = (e: Event) => setState((e as CustomEvent<HoursState>).detail)
    window.addEventListener(HOURS_STATE, on)
    return () => window.removeEventListener(HOURS_STATE, on)
  }, [])
  useEffect(() => {
    if (!state?.running) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [state?.running])
  if (state?.running && state.startedAt) return (
    <button onClick={openHours} title="Open the Hours Tracker"
      className="inline-flex items-center gap-2 h-[46px] px-4 rounded-lg border border-[#2E7D5B]/40 bg-[#2E7D5B]/[0.06] text-sm font-semibold text-[#2E7D5B] hover:bg-[#2E7D5B]/10 whitespace-nowrap">
      <span className="w-2 h-2 rounded-full bg-[#2E7D5B] animate-pulse" /><span className="hidden xl:inline">On the clock</span> <span className="tabular-nums">{elapsed(state, now)}</span>
    </button>
  )
  return (
    <button onClick={openHours} aria-label={state?.paused ? 'Resume your timer' : isAdmin ? 'Hours' : 'Clock in'} title={state?.paused ? 'Your timer is paused. Open the Hours Tracker to resume.' : 'Start your timer, or log time you worked'}
      className="inline-flex items-center gap-2 h-[46px] px-4 rounded-lg bg-dark-fill text-sm aria-[label]:px-3.5 font-semibold text-white hover:opacity-90 whitespace-nowrap">
      <Clock className="w-4 h-4" /><span className="hidden xl:inline">{state?.paused ? 'Paused · resume' : isAdmin ? 'Hours' : 'Clock in'}</span>
    </button>
  )
}
