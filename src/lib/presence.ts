import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

export type Presence = { userId: string; firstName: string; lastName: string; lastSeenAt: string | null; timerSince: string | null }

/** Admins: who is on now, refreshed every minute while the page is in view. */
export function usePresence(enabled: boolean) {
  const [people, setPeople] = useState<Presence[]>([])
  useEffect(() => {
    if (!enabled) return
    let live = true
    const load = () => {
      if (document.hidden) return
      apiFetch('/api/team/presence').then(r => r.ok ? r.json() : null).then(d => { if (live && d) setPeople(d.people || []) }).catch(() => {})
    }
    load()
    const t = setInterval(load, 60_000)
    const onShow = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onShow)
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [enabled])
  return people
}
