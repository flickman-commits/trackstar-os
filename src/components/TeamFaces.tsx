import { Clock } from 'lucide-react'
import type { Presence } from '@/lib/presence'
import { Avatar, type Teammate } from '@/components/AssigneePicker'

/**
 * The team, one face each, in the queue header: each face carries its count
 * (what is left for them), and for admins a glowing dot when they used the
 * app in the last few minutes and a clock while their hours timer runs
 * (server/domain/people/presence.js). Anyone online with nothing in the queue
 * still shows, without a count. Hover a face for the detail; click to see
 * only their orders. Replaces the wide per-person chips and the separate
 * Online row (2026-11-17).
 */
export type { Presence } from '@/lib/presence'

/** facts: what shows beside the name, e.g. "65 left · 85 sent". */
export type Face = { key: string; userId?: string; user?: Teammate; name: string; facts?: string; detail: string }

const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
const span = (iso: string) => { const m = mins(iso); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m` }

export default function TeamFaces({ label, faces, presence = [], selected, onSelect }: {
  label: string
  faces: Face[]
  presence?: Presence[]
  selected?: string
  onSelect?: (userId: string) => void
}) {
  const on = new Map(presence.map(p => [p.userId, p]))
  const all = [...faces]
  for (const p of presence) if (!all.some(f => f.userId === p.userId)) all.push({ key: `p-${p.userId}`, userId: p.userId, user: { id: p.userId, firstName: p.firstName, lastName: p.lastName }, name: p.firstName, detail: 'Nothing in this queue' })
  if (!all.length) return null
  return (
    <div className="hidden md:flex items-center gap-3 whitespace-nowrap ml-auto">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40">
        {/* The totals only where they fit beside the faces. */}
        <span className="2xl:hidden">{label.split(' · ')[0]}</span><span className="hidden 2xl:inline">{label}</span>
      </span>
      <div className="flex items-center gap-1.5">
        {all.map(f => {
          const p = f.userId ? on.get(f.userId) : undefined
          const click = onSelect && f.userId && f.user ? () => onSelect(f.userId!) : undefined
          const title = [
            `${f.name}: ${f.detail}`,
            p?.timerSince ? `timer running ${span(p.timerSince)}` : null,
            p?.lastSeenAt ? (mins(p.lastSeenAt) < 1 ? 'online now' : `online, active ${mins(p.lastSeenAt)} min ago`) : null,
          ].filter(Boolean).join(' · ')
          return (
            <button key={f.key} type="button" onClick={click} disabled={!click} title={title}
              className={`inline-flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border transition-colors ${f.userId && selected === f.userId ? 'border-off-black bg-off-black/5' : 'border-border-gray bg-white'} ${click ? 'hover:border-off-black/40' : 'cursor-default'}`}>
              <span className={`relative inline-flex ${p?.lastSeenAt ? 'online-glow' : ''}`}>
                {f.user ? <Avatar user={f.user} size={24} /> : <span className="w-6 h-6 rounded-full bg-off-black/10" />}
                {p?.timerSince && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white ring-1 ring-border-gray">
                    <Clock className="w-2.5 h-2.5 text-[#2E7D5B]" />
                  </span>
                )}
              </span>
              <span className="text-xs font-medium text-off-black">{f.name}</span>
              {f.facts && <span className="text-xs text-off-black/50 tabular-nums">{f.facts}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
