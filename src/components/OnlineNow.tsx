import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Avatar } from '@/components/AssigneePicker'

/**
 * Admins only: who is on right now. A glowing dot on everyone who used the
 * app in the last few minutes, and a clock on anyone with their hours timer
 * running (server/domain/people/presence.js). Refreshed every minute.
 */
type Person = { userId: string; firstName: string; lastName: string; lastSeenAt: string | null; timerSince: string | null }

const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
const since = (iso: string) => { const m = mins(iso); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m` }

export default function OnlineNow() {
  const [people, setPeople] = useState<Person[] | null>(null)
  useEffect(() => {
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
  }, [])
  if (!people?.length) return null
  const sorted = [...people].sort((a, b) => Number(Boolean(b.timerSince)) - Number(Boolean(a.timerSince)) || a.firstName.localeCompare(b.firstName))
  return (
    <div className="hidden md:flex flex-col items-end gap-1 whitespace-nowrap">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Online · {people.length}</span>
      <div className="flex items-center -space-x-1.5 py-1">
        {sorted.map(p => {
          const title = [
            `${p.firstName}${p.lastName ? ` ${p.lastName}` : ''}`,
            p.timerSince ? `timer running ${since(p.timerSince)}` : null,
            p.lastSeenAt ? (mins(p.lastSeenAt) < 1 ? 'active just now' : `active ${mins(p.lastSeenAt)} min ago`) : 'not in the app right now',
          ].filter(Boolean).join(' · ')
          return (
            <span key={p.userId} className="relative inline-flex rounded-full ring-2 ring-white" title={title}>
              <Avatar user={{ id: p.userId, firstName: p.firstName, lastName: p.lastName }} size={26} />
              {p.lastSeenAt && (
                <span className="absolute -bottom-0.5 -right-0.5 flex w-2.5 h-2.5">
                  <span className="absolute inline-flex w-full h-full rounded-full bg-[#2E7D5B] opacity-60 animate-ping" />
                  <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-[#2E7D5B] ring-2 ring-white" />
                </span>
              )}
              {p.timerSince && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white ring-1 ring-border-gray">
                  <Clock className="w-2.5 h-2.5 text-[#2E7D5B]" />
                </span>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
