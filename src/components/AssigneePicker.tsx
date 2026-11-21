import { useEffect, useRef, useState } from 'react'
import { Check, UserRound } from 'lucide-react'
import { colorFor, setTeamColors } from '@/lib/teamColors'
import TeamFaces, { type Face, type Presence } from '@/components/TeamFaces'

/**
 * Who has this order, as a person rather than a dropdown: an initial in a
 * colored circle and a full name. Click to hand it to someone else.
 */
export type Teammate = { id: string; firstName: string; lastName: string }

export function Avatar({ user, size = 24 }: { user: Teammate; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0"
      style={{ width: size, height: size, backgroundColor: colorFor(user.id), fontSize: Math.round(size * 0.46) }}
      aria-hidden
    >
      {(user.firstName || '?').charAt(0).toUpperCase()}
    </span>
  )
}

export default function AssigneePicker({ team, value, meId, onChange, readOnly = false, readOnlyReason, firstNameOnly = false }: {
  team: Teammate[]
  /** Just "Matt", for a tight header. */
  firstNameOnly?: boolean
  value: string | null
  meId?: string | null
  onChange: (id: string | null) => void
  /** Shows who has it without letting this person change it. */
  readOnly?: boolean
  readOnlyReason?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = team.find(u => u.id === value) || null
  setTeamColors(team)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const pick = (id: string | null) => { setOpen(false); if (id !== value) onChange(id) }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => { if (!readOnly) setOpen(o => !o) }}
        className={`inline-flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors ${readOnly ? 'cursor-default' : 'hover:bg-off-black/5'}`}
        title={readOnly ? (readOnlyReason || 'Who is fulfilling this order') : 'Who is fulfilling this order'}
      >
        <UserRound className="w-4 h-4 text-off-black/40" />
        {current ? (
          <>
            <Avatar user={current} />
            <span className="text-sm font-medium text-off-black">{firstNameOnly ? current.firstName : `${current.firstName} ${current.lastName}`}</span>
          </>
        ) : (
          <span className="text-sm text-off-black/40">Unassigned</span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-white border border-border-gray rounded-lg shadow-lg py-1">
          {team.map(u => (
            <button key={u.id} type="button" onClick={() => pick(u.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-subtle-gray">
              <Avatar user={u} size={22} />
              <span className="flex-1 truncate">{u.firstName} {u.lastName}{u.id === meId ? <span className="text-off-black/40"> (me)</span> : null}</span>
              {u.id === value && <Check className="w-4 h-4 text-off-black/50" />}
            </button>
          ))}
          <div className="border-t border-border-gray my-1" />
          <button type="button" onClick={() => pick(null)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-off-black/55 hover:bg-subtle-gray">
            <span className="w-[22px] h-[22px] rounded-full border border-dashed border-off-black/25" />
            <span className="flex-1">Unassigned</span>
            {!value && <Check className="w-4 h-4 text-off-black/50" />}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * "Current Team": who new orders in this view go to today. The regular, plus
 * anyone helping on a shift (with their last day). Admins also see each
 * person's share and open count. Set in Settings > Admin > Order Assignment.
 */
export type QueueMember = { userId: string; regular: boolean; until: string | null; share?: number; open?: number; races?: string[]; holding?: boolean }

export function QueuePill({ people, team, selected, onSelect, presence }: {
  people?: QueueMember[]
  team: Teammate[]
  /** Admin: the teammate whose orders are showing; clicking a face toggles it. */
  selected?: string
  onSelect?: (userId: string) => void
  presence?: Presence[]
}) {
  const shown = (people || []).map(p => ({ ...p, user: team.find(u => u.id === p.userId) })).filter(p => p.user)
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const faces: Face[] = shown.map(p => ({
    key: p.userId, userId: p.userId, user: p.user, name: p.user!.firstName, facts: p.open != null ? `${p.open} open` : undefined,
    detail: [
      p.open != null ? `${p.open} order${p.open === 1 ? '' : 's'}` : null,
      p.races?.length ? `all ${p.races.join(' and ')} orders` : null,
      p.until ? `helping until ${day(p.until)}` : p.regular ? 'regular: everything else' : p.holding ? 'assigned by hand (not getting new orders)' : null,
    ].filter(Boolean).join(' · '),
  }))
  return <TeamFaces label="Team" faces={faces} presence={presence} selected={selected} onSelect={onSelect} />
}

/**
 * "Team Member" filter above the order lists: whose orders are showing, as a
 * name with its avatar. '' is everyone, 'none' is unassigned.
 */
export function PersonFilter({ team, value, meId, onChange }: {
  team: Teammate[]
  value: string
  meId?: string | null
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  setTeamColors(team)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const current = team.find(u => u.id === value) || null
  const pick = (v: string) => { setOpen(false); onChange(v) }
  const row = 'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-subtle-gray'
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 pl-3 md:pl-4 pr-9 py-2.5 md:py-3 bg-subtle-gray border border-border-gray rounded-md text-sm text-off-black text-left focus:outline-none focus:ring-2 focus:ring-off-black/10"
      >
        {current ? <><Avatar user={current} size={20} /><span className="truncate">{current.firstName} {current.lastName}</span></>
          : <span className="truncate">{value === 'none' ? 'Unassigned' : 'Everyone'}</span>}
        <svg className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-off-black/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 min-w-[200px] bg-white border border-border-gray rounded-lg shadow-lg py-1">
          {team.map(u => (
            <button key={u.id} type="button" onClick={() => pick(u.id)} className={row}>
              <Avatar user={u} size={22} />
              <span className="flex-1 truncate">{u.firstName} {u.lastName}{u.id === meId ? <span className="text-off-black/40"> (me)</span> : null}</span>
              {u.id === value && <Check className="w-4 h-4 text-off-black/50" />}
            </button>
          ))}
          <div className="border-t border-border-gray my-1" />
          <button type="button" onClick={() => pick('')} className={row}>
            <span className="flex-1">Everyone</span>{!value && <Check className="w-4 h-4 text-off-black/50" />}
          </button>
          <button type="button" onClick={() => pick('none')} className={row}>
            <span className="w-[22px] h-[22px] rounded-full border border-dashed border-off-black/25" />
            <span className="flex-1">Unassigned</span>{value === 'none' && <Check className="w-4 h-4 text-off-black/50" />}
          </button>
        </div>
      )}
    </div>
  )
}

export type SentToday = { name: string; count: number; morning?: number; afternoon?: number; first?: string; last?: string }

const clockNY = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' AM', 'am').replace(' PM', 'pm')

/** "4 in the morning, 3 in the afternoon · 9:12am to 3:40pm" (New York time). */
function rhythm(s?: SentToday) {
  if (!s?.count || !s.first) return ''
  const split = [s.morning ? `${s.morning} in the morning` : '', s.afternoon ? `${s.afternoon} in the afternoon` : ''].filter(Boolean).join(', ')
  const span = s.last && clockNY(s.last) !== clockNY(s.first) ? `${clockNY(s.first)} to ${clockNY(s.last)}` : `at ${clockNY(s.first)}`
  return [split, span].filter(Boolean).join(' · ')
}

/**
 * The team on Standard Orders, in the same chip row as the other views'
 * Current Team: one chip per person with what they sent to production today
 * (since midnight New York) and what is still left for them, and the totals
 * in the label. Hovering shows the morning/afternoon split and the first and
 * last send. Clicking a person shows only their orders.
 */
export function TeamPanel({ team, sent, toApprove, selected, onSelect, presence }: {
  team: Teammate[]
  sent: SentToday[] | null
  toApprove: { userId: string; count: number }[]
  selected?: string
  onSelect?: (userId: string) => void
  presence?: Presence[]
}) {
  type Row = { key: string; user?: Teammate; name: string; userId?: string; sent: number; left: number; when?: SentToday }
  const rows: Row[] = []
  for (const p of toApprove) {
    const user = team.find(u => u.id === p.userId)
    rows.push({ key: `u-${p.userId}`, user, name: user?.firstName || 'Unassigned', userId: user ? p.userId : undefined, sent: 0, left: p.count })
  }
  for (const p of sent || []) {
    const row = rows.find(r => r.name === p.name)
    if (row) { row.sent += p.count; row.when = p }
    else { const user = team.find(u => u.firstName === p.name); rows.push({ key: `s-${p.name}`, user, userId: user?.id, name: p.name, sent: p.count, left: 0, when: p }) }
  }
  const sentTotal = rows.reduce((n, r) => n + r.sent, 0)
  const leftTotal = rows.reduce((n, r) => n + r.left, 0)
  const faces: Face[] = rows.map(r => ({ key: r.key, userId: r.userId, user: r.user, name: r.name, facts: `${r.left} left · ${r.sent} sent`, detail: [`${r.left} left to fulfill`, `${r.sent} sent to production today`, rhythm(r.when)].filter(Boolean).join(' · ') }))
  return <TeamFaces label={`Today · ${sentTotal} sent · ${leftTotal} left`} faces={faces} presence={presence} selected={selected} onSelect={onSelect} />
}
