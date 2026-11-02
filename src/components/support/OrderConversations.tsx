import { useEffect, useState } from 'react'
import { ArrowUpRight, Hourglass, Inbox, Instagram, Loader2 } from 'lucide-react'
import { supportApi, type OrderConversation } from '@/lib/supportApi'
import { STATUS_LABEL, STATUS_TONE } from '@/lib/supportStatus'
import { ago } from '@/lib/supportDates'
import { chip } from '@/lib/ui'

/**
 * Under an order's actions in TrackstarOS: the customer's Support
 * conversations that are still going, each opening in Support. Shows
 * nothing when there are none, or for someone without Support.
 */
export default function OrderConversations({ orderId, enabled, variant = 'list' }: { orderId: string; enabled: boolean; variant?: 'list' | 'alert' }) {
  const [threads, setThreads] = useState<OrderConversation[]>([])
  useEffect(() => {
    if (!enabled) return
    let live = true
    setThreads([])
    supportApi.orderConversations(orderId).then(r => { if (live) setThreads(r.threads) }).catch(() => {})
    return () => { live = false }
  }, [orderId, enabled])
  const [marking, setMarking] = useState<string | null>(null)
  // We asked the customer something from Support: park it until they answer.
  const markWaiting = async (id: string) => {
    setMarking(id)
    try {
      await supportApi.setStatus(id, 'waiting')
      setThreads(prev => prev.map(t => t.id === id ? { ...t, status: 'waiting', snoozed: false } : t))
    } catch { /* the button stays; Support has the same control */ } finally { setMarking(null) }
  }
  const waitButton = (t: OrderConversation, cls: string) => t.status === 'open' && (
    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); markWaiting(t.id) }} disabled={marking === t.id} className={cls}>
      {marking === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hourglass className="w-3.5 h-3.5" />} Mark waiting on customer
    </button>
  )
  if (!enabled || threads.length === 0) return null
  // Above the design, amber: a customer writing in is often asking to change
  // something on the print, so it is seen before anyone approves.
  if (variant === 'alert') {
    return (
      <div className="bg-amber-50 border border-amber-300 rounded-md p-3 space-y-2">
        <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider inline-flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5" />The customer is talking to Support{threads.length > 1 ? ` · ${threads.length} conversations` : ''}
        </div>
        {threads.map(t => (
          <div key={t.id} className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                {t.channel === 'instagram' && <Instagram className="w-3.5 h-3.5 shrink-0 text-amber-800/70" />}
                <span className="text-sm font-semibold text-amber-950 truncate">{t.subject}</span>
                <span className={`${chip} ${STATUS_TONE[t.status]} shrink-0`}>{t.snoozed ? 'Snoozed' : STATUS_LABEL[t.status]}</span>
              </div>
              {t.snippet && <p className="text-[13px] text-amber-900/80 line-clamp-2 mt-0.5">{t.snippet}</p>}
              <div className="text-[11px] text-amber-800/60 mt-0.5">{t.assignee ? `${t.assignee} · ` : ''}{ago(t.lastMessageAt)}</div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-1.5">
              <a href={`/support?thread=${encodeURIComponent(t.id)}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">
                Open in Support <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
              {waitButton(t, 'inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-amber-400 bg-white text-amber-900 text-xs font-semibold hover:bg-amber-100 disabled:opacity-50')}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="pt-3">
      <div className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5 inline-flex items-center gap-1.5">
        <Inbox className="w-3 h-3" />Talking to Support · {threads.length}
      </div>
      <div className="space-y-1.5">
        {threads.map(t => (
          <a key={t.id} href={`/support?thread=${encodeURIComponent(t.id)}`} target="_blank" rel="noopener noreferrer"
            className="group block rounded-md border border-border-gray bg-white px-3 py-2 hover:border-off-black/30 transition-colors">
            <div className="flex items-center gap-2 min-w-0">
              {t.channel === 'instagram' && <Instagram className="w-3.5 h-3.5 shrink-0 text-off-black/50" />}
              <span className="text-sm font-medium text-off-black truncate">{t.subject}</span>
              <ArrowUpRight className="w-3.5 h-3.5 ml-auto shrink-0 text-off-black/30 group-hover:text-off-black/60" />
            </div>
            {t.snippet && <div className="text-xs text-off-black/55 truncate mt-0.5">{t.snippet}</div>}
            <div className="flex items-center gap-1.5 mt-1 text-[11px] text-off-black/45">
              <span className={`${chip} ${STATUS_TONE[t.status]}`}>{t.snoozed ? 'Snoozed' : STATUS_LABEL[t.status]}</span>
              {t.assignee && <span>{t.assignee}</span>}
              <span className="ml-auto tabular-nums">{ago(t.lastMessageAt)}</span>
            </div>
            {waitButton(t, 'mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-off-black/60 hover:text-off-black disabled:opacity-50')}
          </a>
        ))}
      </div>
    </div>
  )
}
