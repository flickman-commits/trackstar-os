import { useEffect, useState } from 'react'
import { ArrowUpRight, Hourglass, Inbox, Instagram, Loader2, Mail, MessageCircle } from 'lucide-react'
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
 * Each row says who spoke last. "They wrote" means an answer is owed;
 * "We wrote" means we are waiting on them (and the order shows Waiting on
 * customer). Mark waiting is the one status change kept here, for a
 * question sent from Support that was left open.
 */
export default function ConversationPanel({ orderId, enabled }: { orderId: string; enabled: boolean }) {
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
      setThreads(prev => (prev || []).map(t => t.id === id ? { ...t, status: 'waiting', snoozed: false } : t))
    } catch { /* Support has the same control */ } finally { setMarking(null) }
  }
  if (!enabled || !threads || threads.length === 0) return null
  const open = threads.filter(t => t.status !== 'closed')
  const closed = threads.filter(t => t.status === 'closed')
  const shown = showClosed ? threads : open
  // An answer owed to the customer is the thing to see first: the panel goes amber then.
  const owed = open.some(t => t.last === 'customer' && t.status !== 'waiting')
  const tone = owed ? { box: 'bg-amber-50 border-amber-300', head: 'text-amber-800', line: 'border-amber-200 hover:border-amber-400' } : { box: 'bg-white border-border-gray', head: 'text-off-black/50', line: 'border-border-gray hover:border-off-black/30' }
  if (!shown.length && !closed.length) return null
  return (
    <div className={`${tone.box} border rounded-md p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-[11px] font-semibold uppercase tracking-wider inline-flex items-center gap-1.5 ${tone.head}`}>
          <Inbox className="w-3.5 h-3.5" />Conversation{open.length !== 1 ? 's' : ''}{open.length ? ` · ${open.length} open` : ''}{owed ? ' · the customer is waiting on us' : ''}
        </div>
        {closed.length > 0 && (
          <button type="button" onClick={() => setShowClosed(v => !v)} className="text-[11px] font-medium text-off-black/50 hover:text-off-black">
            {showClosed ? 'Hide closed' : `Show closed (${closed.length})`}
          </button>
        )}
      </div>
      {!shown.length && <p className="text-xs text-off-black/50">No open conversation. {closed.length} closed.</p>}
      <div className="space-y-1.5">
        {shown.map(t => (
          <div key={t.id} className={`flex items-start gap-3 rounded-md border bg-white px-3 py-2 transition-colors ${tone.line} ${t.status === 'closed' ? 'opacity-70' : ''}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {t.channel === 'instagram' ? <Instagram className="w-3.5 h-3.5 shrink-0 text-off-black/50" /> : <Mail className="w-3.5 h-3.5 shrink-0 text-off-black/40" />}
                <span className="text-sm font-semibold text-off-black truncate">{t.subject}</span>
                <span className={`${chip} ${STATUS_TONE[t.status]} shrink-0`}>{t.snoozed ? 'Snoozed' : STATUS_LABEL[t.status]}</span>
              </div>
              {t.snippet && <p className="text-[13px] text-off-black/70 line-clamp-2 mt-0.5">{t.snippet}</p>}
              <div className="text-[11px] text-off-black/50 mt-0.5 inline-flex items-center gap-1.5 flex-wrap">
                {t.last && <span className={`inline-flex items-center gap-1 font-medium ${t.last === 'customer' && t.status !== 'closed' ? 'text-amber-800' : 'text-off-black/60'}`}><MessageCircle className="w-3 h-3" />{t.last === 'customer' ? 'They wrote last' : 'We wrote last'}</span>}
                <span>· {ago(t.lastMessageAt)}</span>
                {t.assignee && <span>· {t.assignee}</span>}
                {typeof t.messageCount === 'number' && <span>· {t.messageCount} message{t.messageCount === 1 ? '' : 's'}</span>}
              </div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              <a href={`/support?thread=${encodeURIComponent(t.id)}`} target="_blank" rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold ${owed && t.status !== 'closed' ? 'bg-amber-600 text-white hover:bg-amber-700' : 'border border-border-gray text-off-black hover:border-off-black/40'}`}>
                {t.status === 'closed' ? 'Read' : 'Open'} in Support <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
              {t.status === 'open' && t.last === 'us' && (
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
