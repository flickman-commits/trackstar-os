import { useEffect, useState } from 'react'
import { ArrowUpRight, Hourglass, Inbox, Instagram, Loader2, Mail, MessageCircle, X } from 'lucide-react'
import { supportApi, type OrderConversation } from '@/lib/supportApi'
import { STATUS_LABEL, STATUS_TONE } from '@/lib/supportStatus'
import { ago } from '@/lib/supportDates'
import { chip } from '@/lib/ui'

/**
 * The order's Conversation panel: every Support thread with this customer,
 * newest first, so the team sees where things stand without hunting through
 * Support. Nothing shows when there is no conversation. Closed threads sit
 * behind Show closed. Reading only: writing happens in Support, where the
 * whole thread and the playbook are, so this links there.
 *
 * Each row says who spoke last. "They wrote" means an answer is owed.
 * A conversation whose last email from us asked something is "Waiting on
 * their reply" and keeps the order under Waiting, even once closed
 * (compose.js threadWaiting); it shows with the open ones. Not waiting
 * undoes a wrong guess, Mark waiting covers a request with no question mark.
 */
export default function ConversationPanel({ orderId, enabled, onChanged }: { orderId: string; enabled: boolean; onChanged?: () => void }) {
  const [threads, setThreads] = useState<OrderConversation[] | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let live = true
    setThreads(null); setShowClosed(false)
    supportApi.orderConversations(orderId, true).then(r => { if (live) setThreads(r.threads) }).catch(() => { if (live) setThreads([]) })
    return () => { live = false }
  }, [orderId, enabled])
  const [marking, setMarking] = useState<string | null>(null)
  const markWaiting = async (id: string) => {
    setMarking(id)
    try {
      await supportApi.setStatus(id, 'waiting')
      setThreads(prev => (prev || []).map(t => t.id === id ? { ...t, status: 'waiting', snoozed: false, waiting: true } : t))
      onChanged?.()
    } catch { /* Support has the same control */ } finally { setMarking(null) }
  }
  const notWaiting = async (id: string) => {
    setMarking(id)
    try {
      await supportApi.notWaiting(id)
      setThreads(prev => (prev || []).map(t => t.id === id ? { ...t, status: t.status === 'waiting' ? 'open' : t.status, waiting: false } : t))
      onChanged?.()
    } catch { /* Support has the same control */ } finally { setMarking(null) }
  }
  if (!enabled || !threads || threads.length === 0) return null
  // A closed conversation still waiting on their answer is live work: it shows with the open ones.
  const open = threads.filter(t => t.status !== 'closed' || t.waiting)
  const closed = threads.filter(t => t.status === 'closed' && !t.waiting)
  const shown = showClosed ? threads : open
  // An answer owed to the customer is the thing to see first: the panel goes amber then.
  const bounced = open.some(t => t.bounced)
  const owed = open.some(t => t.last === 'customer' && t.status !== 'waiting')
  // A bounce is red: the customer never got our email. An answer owed is amber.
  const tone = bounced ? { box: 'bg-red-50 border-red-300', head: 'text-red-800', line: 'border-red-200 hover:border-red-400' }
    : owed ? { box: 'bg-amber-50 border-amber-300', head: 'text-amber-800', line: 'border-amber-200 hover:border-amber-400' } : { box: 'bg-white border-border-gray', head: 'text-off-black/50', line: 'border-border-gray hover:border-off-black/30' }
  if (!shown.length && !closed.length) return null
  // All closed and folded: one quiet line, no card. Nothing is owed, so nothing should pull the eye.
  if (!open.length && !showClosed) {
    return (
      <button type="button" onClick={() => setShowClosed(true)} className="group flex items-center gap-2 px-1 text-[12px] text-off-black/45 hover:text-off-black">
        <Inbox className="w-3.5 h-3.5" />
        <span>{closed.length === 1 ? '1 closed conversation' : `${closed.length} closed conversations`} with this customer</span>
        <span className="font-medium text-off-black/55 group-hover:text-off-black group-hover:underline">Show</span>
      </button>
    )
  }
  return (
    <div className={`${tone.box} border rounded-md p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-[11px] font-semibold uppercase tracking-wider inline-flex items-center gap-1.5 ${tone.head}`}>
          <Inbox className="w-3.5 h-3.5" />Conversation{open.length !== 1 ? 's' : ''}{open.length ? ` · ${open.length} open` : ''}{bounced ? ' · our email bounced' : owed ? ' · the customer is waiting on us' : ''}
        </div>
        {closed.length > 0 && (
          <button type="button" onClick={() => setShowClosed(v => !v)} className="text-[11px] font-medium text-off-black/50 hover:text-off-black">
            {showClosed ? 'Hide closed' : `Show closed (${closed.length})`}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {shown.map(t => (
          <div key={t.id} className={`flex items-start gap-3 rounded-md border bg-white px-3 py-2 transition-colors ${tone.line} ${t.status === 'closed' && !t.waiting ? 'opacity-70' : ''}`}>
            <a href={`/support?thread=${encodeURIComponent(t.id)}`} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 rounded hover:bg-subtle-gray/60 -m-1 p-1">
              <div className="flex items-center gap-2 min-w-0">
                {t.channel === 'instagram' ? <Instagram className="w-3.5 h-3.5 shrink-0 text-off-black/50" /> : <Mail className="w-3.5 h-3.5 shrink-0 text-off-black/40" />}
                <span className="text-sm font-semibold text-off-black truncate">{t.subject}</span>
                <span className={`${chip} ${STATUS_TONE[t.status]} shrink-0`}>{t.snoozed ? 'Snoozed' : STATUS_LABEL[t.status]}</span>
                {t.waiting && t.status !== 'waiting' && <span className={`${chip} bg-blue-50 text-blue-800 shrink-0`} title="Our last email asked them something and they have not answered: the order waits on them">Waiting on their reply</span>}
                {t.bounced && <span className={`${chip} bg-red-100 text-red-800 shrink-0`} title="Our last email came back undeliverable">Email bounced</span>}
              </div>
              {t.snippet && <p className="text-[13px] text-off-black/70 line-clamp-2 mt-0.5">{t.snippet}</p>}
              <div className="text-[11px] text-off-black/50 mt-0.5 inline-flex items-center gap-1.5 flex-wrap">
                {t.last && <span className={`inline-flex items-center gap-1 font-medium ${t.last === 'customer' && t.status !== 'closed' ? 'text-amber-800' : 'text-off-black/60'}`}><MessageCircle className="w-3 h-3" />{t.last === 'customer' ? 'They wrote last' : 'We wrote last'}</span>}
                <span>· {ago(t.lastMessageAt)}</span>
                {t.assignee && <span>· {t.assignee}</span>}
                {typeof t.messageCount === 'number' && <span>· {t.messageCount} message{t.messageCount === 1 ? '' : 's'}</span>}
              </div>
            </a>
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              <a href={`/support?thread=${encodeURIComponent(t.id)}`} target="_blank" rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold ${owed && t.status !== 'closed' ? 'bg-amber-600 text-white hover:bg-amber-700' : 'border border-border-gray text-off-black hover:border-off-black/40'}`}>
                {t.status === 'closed' ? 'Read' : 'Open'} in Support <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
              {t.waiting && (
                <button type="button" onClick={() => notWaiting(t.id)} disabled={marking === t.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border-gray bg-white text-off-black/70 text-[11px] font-medium hover:bg-subtle-gray disabled:opacity-50" title="Our last email did not need an answer: take the order out of Waiting on customer until we write again">
                  {marking === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />} Not waiting
                </button>
              )}
              {!t.waiting && t.status !== 'closed' && t.last === 'us' && (
                <button type="button" onClick={() => markWaiting(t.id)} disabled={marking === t.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border-gray bg-white text-off-black/70 text-[11px] font-medium hover:bg-subtle-gray disabled:opacity-50" title="We asked them something: park the order under Waiting on customer until they answer">
                  {marking === t.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hourglass className="w-3 h-3" />} Mark waiting
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
