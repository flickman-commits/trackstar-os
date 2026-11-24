import type { CustomerOrder, OrderItem } from '@/types/support'

/** Where one print is: in production, being designed, or waiting. */
export function itemStage(it: OrderItem): { label: string; cls: string } {
  if (it.status === 'completed' || it.designStatus === 'sent_to_production') return { label: 'In production', cls: 'bg-blue-50 border-blue-200 text-blue-700' }
  if (it.designStatus && it.designStatus !== 'not_started') return { label: it.designStatus === 'approved_by_customer' ? 'Approved, not yet printed' : 'Being designed', cls: 'bg-purple-50 border-purple-200 text-purple-700' }
  return { label: 'Not sent to production yet', cls: 'bg-white border-border-gray text-off-black/60' }
}

/**
 * Where the order is, in one chip: shipped, in production, being designed,
 * or waiting. With several prints, the one furthest behind sets it.
 */
export function stage(o: CustomerOrder): { label: string; cls: string } | null {
  if (o.replacement) {
    const st = o.replacement.stage
    return { label: st, cls: st === 'Canceled' ? 'bg-red-50 border-red-200 text-red-700' : st === 'Delivered' || st === 'Shipped' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800' }
  }
  if (o.financialStatus === 'REFUNDED') return { label: 'Refunded', cls: 'bg-red-50 border-red-200 text-red-700' }
  if (o.fulfillmentStatus === 'FULFILLED' || o.tracking.length) return { label: 'Shipped', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' }
  if (!o.items.length) return o.imported ? null : { label: 'Not imported yet', cls: 'bg-white border-border-gray text-off-black/55' }
  const order = ['Not sent to production yet', 'Being designed', 'Approved, not yet printed', 'In production']
  return o.items.map(itemStage).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))[0]
}
