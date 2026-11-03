import { Inbox, Layers, Clock, AlertTriangle, Moon, Archive, Settings2, Zap, Filter, Lightbulb } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Avatar } from '@/components/AssigneePicker'
import type { InboxCounts, InboxView, Teammate } from '@/types/support'

/**
 * The views, Intercom's left column: All open (the team's shared list), Your inbox,
 * then the states a conversation can be parked in, then one row per
 * teammate with their open count. Clicking a row filters the list beside
 * it; the counts are live from the same request.
 */
type Row = { id: InboxView; label: string; icon: LucideIcon; count?: number; muted?: boolean }

function ViewRow({ row, active, onClick }: { row: Row; active: boolean; onClick: () => void }) {
  const Icon = row.icon
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors ${
        active ? 'bg-off-black/[0.07] text-off-black font-semibold' : 'text-off-black/70 hover:bg-off-black/[0.04] hover:text-off-black'
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-off-black' : 'text-off-black/45'}`} />
      <span className="flex-1 text-left truncate">{row.label}</span>
      {row.count !== undefined && row.count > 0 && <span className={`text-[11px] tabular-nums ${active ? 'text-off-black/70' : 'text-off-black/40'}`}>{row.count}</span>}
    </button>
  )
}

export default function ViewsColumn({ view, counts, team, me, onView, onMacros, onSettings, onRequestFeature, onHours }: {
  view: InboxView
  counts: InboxCounts | null
  team: Teammate[]
  me: Teammate | null
  onView: (v: InboxView) => void
  onMacros: () => void
  onSettings: () => void
  onRequestFeature: () => void
  /** Log and submit your own hours (people with the hours capability). */
  onHours?: () => void
}) {
  const c = counts
  const top: Row[] = [
    // The team works from one shared list; your own sits under it. (Mentions and Unassigned went 2026-10-18.)
    { id: 'all', label: 'All open', icon: Layers, count: c?.all },
    { id: 'inbox', label: 'Your inbox', icon: Inbox, count: c?.inbox },
  ]
  const states: Row[] = [
    { id: 'waiting', label: 'Waiting on customer', icon: Clock, count: c?.waiting },
    { id: 'escalated', label: 'Escalated', icon: AlertTriangle, count: c?.escalated },
    { id: 'snoozed', label: 'Snoozed', icon: Moon, count: c?.snoozed },
    { id: 'closed', label: 'Closed', icon: Archive },
    { id: 'filtered', label: 'Filtered', icon: Filter },
  ]
  return (
    <nav className="hidden lg:flex w-[168px] xl:w-[184px] shrink-0 flex-col border-r border-border-gray bg-subtle-gray/60 min-h-0 overflow-y-auto">
      <div className="px-2 pt-3 pb-1 space-y-0.5">
        {top.map(r => <ViewRow key={r.id} row={r} active={view === r.id} onClick={() => onView(r.id)} />)}
      </div>
      <div className="px-2 pt-3 pb-1 space-y-0.5">
        <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-off-black/40">States</div>
        {states.map(r => <ViewRow key={r.id} row={r} active={view === r.id} onClick={() => onView(r.id)} />)}
      </div>
      {team.length > 0 && (
        <div className="px-2 pt-3 pb-1 space-y-0.5">
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Teammates</div>
          {team.map(u => {
            const id: InboxView = `teammate:${u.id}`
            const active = view === id
            const n = c?.byAssignee?.[u.id] || 0
            return (
              <button key={u.id} onClick={() => onView(id)} className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors ${active ? 'bg-off-black/[0.07] text-off-black font-semibold' : 'text-off-black/70 hover:bg-off-black/[0.04] hover:text-off-black'}`}>
                <Avatar user={u} size={18} />
                <span className="flex-1 text-left truncate">{u.firstName}{me && u.id === me.id ? ' (you)' : ''}</span>
                {n > 0 && <span className={`text-[11px] tabular-nums ${active ? 'text-off-black/70' : 'text-off-black/40'}`}>{n}</span>}
              </button>
            )
          })}
        </div>
      )}
      <div className="mt-auto px-2 py-3 border-t border-border-gray">
        {onHours && (
          <button onClick={onHours} className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-off-black/70 hover:bg-off-black/[0.04] hover:text-off-black transition-colors">
            <Clock className="w-4 h-4 text-off-black/45" /><span className="flex-1 text-left">Hours</span>
          </button>
        )}
        <button onClick={onMacros} className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-off-black/70 hover:bg-off-black/[0.04] hover:text-off-black transition-colors">
          <Zap className="w-4 h-4 text-off-black/45" /><span className="flex-1 text-left">Macros</span>
        </button>
        <button onClick={onRequestFeature} className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-off-black/70 hover:bg-off-black/[0.04] hover:text-off-black transition-colors">
          <Lightbulb className="w-4 h-4 text-off-black/45" /><span className="flex-1 text-left">Request feature</span>
        </button>
        <button onClick={onSettings} className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] text-off-black/70 hover:bg-off-black/[0.04] hover:text-off-black transition-colors">
          <Settings2 className="w-4 h-4 text-off-black/45" /><span className="flex-1 text-left">Settings</span>
        </button>
      </div>
    </nav>
  )
}
