import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { Order } from '@/components/orders/orderModel'

/**
 * The other prints on the same Shopify or Etsy order. A support rep opening
 * one print could not tell it was one of three; the table marks it (2/3) but
 * the order view did not. Read from the server, not the open queue: a
 * sibling that is already complete is not in the queue.
 */
// Each order's prints, kept for the session: stepping back to an order shows its list at once,
// and the request after only refreshes it.
const cache = new Map<string, Order[]>()

export function useSiblings(order: Order | null, loaded: Order[] = []) {
  // A bulk order's runners are one list of eighty, not "other prints": no badge, no list.
  const parent = order && order.trackstarOrderType !== 'bulk' ? order.parentOrderNumber || null : null
  const type = order?.trackstarOrderType || null
  const key = parent ? `${parent}|${type || ''}` : null
  // Rows are tagged with the order they belong to. Switching orders used to keep showing the
  // last order's prints until the new request came back, and a slow earlier request could
  // land after a later one: the panel lagged and listed the wrong prints (2026-11-17).
  const [state, setState] = useState<{ key: string | null; rows: Order[] }>(() => ({ key, rows: key ? cache.get(key) || [] : [] }))
  useEffect(() => {
    if (!key || !parent) return
    if (cache.has(key)) setState({ key, rows: cache.get(key)! })
    let live = true
    apiFetch(`/api/orders?number=${encodeURIComponent(parent)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => {
        const rows = ((d.orders || []) as Order[])
          .filter(o => o.parentOrderNumber === parent && (o.trackstarOrderType || null) === type)
          .sort((a, b) => a.lineItemIndex - b.lineItemIndex)
        cache.set(key, rows)
        if (live) setState({ key, rows })
      })
      .catch(() => { /* keep what is shown; the next open retries */ })
    return () => { live = false }
  }, [key, parent, type, order?.status])
  // Until this order's own list arrives, the prints the page already holds (the open queue)
  // stand in, so the panel fills at once instead of after the request.
  const known = useMemo(() => !key || !parent ? [] : loaded
    .filter(o => o.parentOrderNumber === parent && (o.trackstarOrderType || null) === type)
    .sort((a, b) => a.lineItemIndex - b.lineItemIndex), [key, parent, type, loaded])
  const rows = key && state.key === key ? state.rows : known
  const position = order ? Math.max(1, rows.findIndex(r => r.id === order.id) + 1) : 0
  return { rows, count: rows.length, position, others: rows.filter(r => r.id !== order?.id) }
}

/** Where a print opens: /orders/5038 for the first, /orders/5038-2 for the next. */
export const printPath = (o: Order) => `/orders/${o.displayOrderNumber || o.parentOrderNumber}${o.lineItemIndex > 0 ? `-${o.lineItemIndex + 1}` : ''}`

