import { Link } from 'react-router-dom'
import { ArrowUpRight, Layers } from 'lucide-react'
import { printPath } from '@/components/orders/useSiblings'
import type { Order } from '@/components/orders/orderModel'
import { getStatusDisplay } from '@/components/orders/orderFormat'
import StatusPill from '@/components/orders/StatusPill'

/** The small "print 2 of 3" next to the order number in the header. */
export function SiblingsBadge({ count, position }: { count: number; position: number }) {
  if (count < 2) return null
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#4600D6]/[0.08] text-[#4600D6] text-[11px] font-semibold whitespace-nowrap" title={`This order has ${count} prints. This is print ${position}.`}>
      <Layers className="w-3 h-3" />print {position} of {count}
    </span>
  )
}

/**
 * The other prints, in the right-hand panel: one line each, the way Support
 * lists a customer's orders, so a rep sees the whole order and can step to
 * the next print.
 */
export function OtherPrints({ others, count }: { others: Order[]; count: number }) {
  if (!others.length) return null
  return (
    <div className="bg-subtle-gray border border-border-gray rounded-md p-3">
      <div className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5 inline-flex items-center gap-1.5">
        <Layers className="w-3 h-3" />Also in this order · {count} prints
      </div>
      <div className="space-y-1.5">
        {others.map(o => {
          const d = getStatusDisplay(o)
          return (
            <Link key={o.id} to={printPath(o)} className="group flex items-center gap-2 rounded-md border border-border-gray bg-white px-2.5 py-2 hover:border-off-black/30 transition-colors min-w-0">
              <span className="text-[11px] font-semibold text-off-black/50 shrink-0 tabular-nums">#{o.lineItemIndex + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-off-black truncate">{o.effectiveRunnerName || o.runnerName || 'Runner'}</span>
                <span className="block text-[11px] text-off-black/55 truncate">{[o.effectiveRaceName || o.raceName, o.effectiveRaceYear || o.raceYear, o.productSize].filter(Boolean).join(' · ')}</span>
              </span>
              <StatusPill size="xs" label={d.label} dot={d.dot} color={d.color} bg={d.bg} />
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0 text-off-black/30 group-hover:text-off-black/60" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
