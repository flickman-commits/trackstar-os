import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Mail, Users } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Order } from '@/components/orders/orderModel'
import type { SameRunnerOrder } from '@/components/orders/sameRunnerEmail'

/**
 * Above the design on a standard print: this runner's print has been ordered
 * more than once, as separate orders. A runner buying their own while a
 * parent or partner buys it for them is the usual case; the team checks with
 * the customer before both go out. Notify customer opens the Email customer
 * modal with that message written.
 */
export default function SameRunnerAlert({ order, canEmail, onNotify }: { order: Order; canEmail: boolean; onNotify: (others: SameRunnerOrder[]) => void }) {
  const [others, setOthers] = useState<SameRunnerOrder[]>([])
  useEffect(() => {
    if (order.trackstarOrderType && order.trackstarOrderType !== 'standard') { setOthers([]); return }
    let live = true
    setOthers([])
    apiFetch(`/api/orders/same-runner?orderId=${encodeURIComponent(order.id)}`).then(r => r.json()).then(d => { if (live) setOthers(d.others || []) }).catch(() => {})
    return () => { live = false }
  }, [order.id, order.trackstarOrderType, order.effectiveRunnerName, order.effectiveRaceYear])
  if (!others.length) return null
  const runner = order.effectiveRunnerName || order.runnerName || 'This runner'
  const mine = others.every(o => o.sameBuyer)
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-md p-3 space-y-2">
      <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider inline-flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" />{runner} is getting {others.length + 1} Trackstar prints
      </div>
      <p className="text-[13px] text-amber-900/85 leading-snug">
        {mine
          ? 'The same customer ordered this print more than once. Check whether they meant to.'
          : 'This print was also ordered as a separate order, by someone else. One is probably a gift: check with the customer before both go out.'}
      </p>
      <div className="space-y-1">
        {others.map(o => (
          <Link key={o.id} to={`/orders/${o.displayOrderNumber}${o.lineItemIndex > 0 ? `-${o.lineItemIndex + 1}` : ''}`} className="group flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5 text-[13px] hover:border-amber-400 transition-colors min-w-0">
            <span className="font-semibold text-off-black shrink-0">#{o.displayOrderNumber}</span>
            <span className="text-off-black/65 truncate flex-1">{o.customerName || o.customerEmail || 'Unknown buyer'}{o.sameBuyer ? ' (same buyer)' : ''} · {new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{o.size ? ` · ${o.size}` : ''}</span>
            <span className={`text-[11px] shrink-0 ${o.status === 'completed' ? 'text-off-black/45' : 'text-amber-800 font-medium'}`}>{o.status === 'completed' ? 'Sent to print' : 'Open'}</span>
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-off-black/30 group-hover:text-off-black/60" />
          </Link>
        ))}
      </div>
      {canEmail && order.customerEmail && (
        <button type="button" onClick={() => onNotify(others)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">
          <Mail className="w-3.5 h-3.5" /> Notify customer
        </button>
      )}
    </div>
  )
}
