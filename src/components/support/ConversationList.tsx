import { ChevronDown, Instagram, Loader2, Mail, Moon, UserRound } from 'lucide-react'
import { ago, waitingFor } from '@/lib/supportDates'
import { customerColor, initials } from '@/lib/supportStatus'
import type { InboxSort, ThreadRow } from '@/types/support'

/**
 * The conversation list, Intercom's second column: an avatar, the name in
 * bold until you have read it, the subject, the latest line, who has it,
 * and how long the customer has been waiting. Sorted by whatever the
 * dropdown at the top says; waiting longest is the default because the
 * oldest unanswered customer is always next.
 */
export function CustomerAvatar({ name, email, size = 32 }: { name: string; email: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 select-none"
      style={{ width: size, height: size, backgroundColor: customerColor(email || name), fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {initials(name, email)}
    </span>
  )
}

const SORT_LABEL: Record<InboxSort, string> = { waiting: 'Waiting longest', newest: 'Newest', oldest: 'Oldest', priority: 'Priority first' }

/** The channel's mark: nothing for email, the Instagram glyph for a DM. */
export function ChannelMark({ channel, className = 'w-3 h-3' }: { channel: ThreadRow['channel']; className?: string }) {
  if (channel !== 'instagram') return null
  return <Instagram className={`${className} shrink-0 text-pink-600`} aria-label="Instagram DM" />
}

function Row({ t, active, onClick }: { t: ThreadRow; active: boolean; onClick: () => void }) {
  const ig = t.channel === 'instagram'
  const who = t.customerName || (ig && t.igUsername ? `@${t.igUsername}` : '') || t.customerEmail || 'Unknown sender'
  // Until Meta shares their name, the name is the @handle; say it once.
  const line = ig ? (t.igUsername && who !== `@${t.igUsername}` ? `@${t.igUsername} · Instagram` : 'Instagram DM') : (t.subject || '(no subject)')
  const wait = t.status === 'open' ? waitingFor(t.lastInboundAt, t.lastOutboundAt) : null
  const snoozed = t.snoozedUntil && new Date(t.snoozedUntil) > new Date()
  const bold = t.unread && t.status !== 'closed'
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 border-b border-border-gray/80 transition-colors ${active ? 'bg-off-black/[0.05]' : 'hover:bg-subtle-gray'}`}
    >
      <div className="relative shrink-0 mt-0.5">
        <CustomerAvatar name={t.customerName} email={t.customerEmail || t.igUsername} />
        {bold && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-white" aria-label="Unread" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ChannelMark channel={t.channel} />
          <span className={`text-[13px] truncate ${bold ? 'font-semibold text-off-black' : 'font-medium text-off-black/85'}`}>{who}</span>
          {/* Just the badge: why it is a priority is a note in the conversation. */}
          {t.priority && <span className="shrink-0 px-1.5 py-px rounded-full bg-amber-100 border border-amber-300 text-[10px] font-semibold text-amber-800">Priority</span>}
          {t.bouncedAt && <span className="shrink-0 px-1.5 py-px rounded-full bg-red-100 border border-red-300 text-[10px] font-semibold text-red-800">Bounced</span>}
          <span className="ml-auto shrink-0 text-[11px] text-off-black/40 tabular-nums">{ago(t.lastMessageAt)}</span>
        </div>
        <div className={`text-[13px] truncate ${bold ? 'text-off-black' : 'text-off-black/70'}`}>{line}</div>
        <div className="mt-0.5 flex items-center gap-2 min-w-0">
          <span className="text-xs text-off-black/50 truncate flex-1">{t.snippet || ' '}</span>
          <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] text-off-black/45">
            {wait && wait !== 'just now' && <span className={/d$/.test(wait) ? 'text-red-600 font-medium' : ''} title="Waiting on us">{wait}</span>}
            {snoozed && <Moon className="w-3 h-3" />}
            {/* A grey name pill, not a coloured dot: blue dots mean unread. */}
            {t.assignee
              ? <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full border border-border-gray bg-white text-[10px] font-medium text-off-black/60 max-w-[72px]" title={`Assigned to ${t.assignee.firstName} ${t.assignee.lastName}`.trim()}><UserRound className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{t.assignee.firstName}</span></span>
              : <span className="inline-flex items-center px-1.5 py-px rounded-full border border-dashed border-off-black/20 text-[10px] text-off-black/40" title="Nobody has it">Unassigned</span>}
          </span>
        </div>
        {t.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {t.tags.slice(0, 3).map(tag => <span key={tag} className="px-1.5 py-px rounded bg-off-black/[0.06] text-[10px] text-off-black/60">{tag}</span>)}
            {t.tags.length > 3 && <span className="text-[10px] text-off-black/40">+{t.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </button>
  )
}

export default function ConversationList({ title, threads, selectedId, onSelect, loading, emptyLabel, sort, onSort, width }: {
  title: string
  threads: ThreadRow[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading: boolean
  emptyLabel: string
  sort: InboxSort
  onSort: (s: InboxSort) => void
  /** A width the person dragged to, on wide screens. */
  width?: number
}) {
  return (
    <div style={width ? { width } : undefined} className="w-full lg:w-[264px] xl:w-[288px] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-border-gray min-h-0 flex-1 lg:flex-none">
      <div className="px-4 py-2.5 border-b border-border-gray flex items-center justify-between gap-2 shrink-0">
        <span className="text-sm font-semibold text-off-black truncate">{title}<span className="ml-1.5 text-off-black/40 font-normal tabular-nums">{threads.length}</span></span>
        <label className="relative inline-flex items-center text-[11px] text-off-black/55 hover:text-off-black cursor-pointer">
          <select value={sort} onChange={e => onSort(e.target.value as InboxSort)} className="appearance-none bg-transparent pr-4 cursor-pointer focus:outline-none">
            {(Object.keys(SORT_LABEL) as InboxSort[]).map(s => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-0 pointer-events-none" />
        </label>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-off-black/50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin mx-auto text-off-black/30" /> : <><Mail className="w-6 h-6 mx-auto mb-2 text-off-black/25" />{emptyLabel}</>}
          </div>
        ) : threads.map(t => <Row key={t.id} t={t} active={t.id === selectedId} onClick={() => onSelect(t.id)} />)}
      </div>
    </div>
  )
}
