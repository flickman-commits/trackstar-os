import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { Order } from '@/components/orders/orderModel'

/**
 * The other prints on the same Shopify or Etsy order. A support rep opening
 * one print could not tell it was one of three; the table marks it (2/3) but
 * the order view did not. Read from the server, not the open queue: a
 * sibling that is already complete is not in the queue.
 */
export function useSiblings(order: Order | null) {
  const parent = order?.parentOrderNumber || null
  const [rows, setRows] = useState<Order[]>([])
  useEffect(() => {
    if (!parent) { setRows([]); return }
    let live = true
    apiFetch(`/api/orders?number=${encodeURIComponent(parent)}`)
      .then(r => r.json())
      .then(d => { if (live) setRows(((d.orders || []) as Order[]).filter(o => o.trackstarOrderType === order?.trackstarOrderType || (!o.trackstarOrderType && !order?.trackstarOrderType)).sort((a, b) => a.lineItemIndex - b.lineItemIndex)) })
      .catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [parent, order?.trackstarOrderType, order?.status])
  const position = order ? Math.max(1, rows.findIndex(r => r.id === order.id) + 1) : 0
  return { rows, count: rows.length, position, others: rows.filter(r => r.id !== order?.id) }
}

/** Where a print opens: /orders/5038 for the first, /orders/5038-2 for the next. */
export const printPath = (o: Order) => `/orders/${o.displayOrderNumber || o.parentOrderNumber}${o.lineItemIndex > 0 ? `-${o.lineItemIndex + 1}` : ''}`

