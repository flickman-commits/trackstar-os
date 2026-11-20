import { useState } from 'react'
import { Loader2, MapPin, MessageSquareWarning, Repeat } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AddressForm, ArteloOrderForm, ArteloTicketForm, type ActionThread } from '@/components/support/Actions'
import type { CustomerOrder } from '@/types/support'
import type { Order } from '@/components/orders/orderModel'

type Kind = 'address' | 'ticket' | 'reorder'
const LINK = 'self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2 disabled:opacity-50'

/**
 * Support's actions about one order, on the Fulfillment order view (Eli,
 * 2026-11-20): Edit shipping address, Create Artelo ticket, New Artelo order.
 * The same forms as Support; each is logged on the customer's latest Support
 * conversation when there is one (server/domain/support/orderTarget.js).
 * Cancelling stays in Support: it is about the whole order.
 */
export default function OrderSupportActions({ order, onDone }: { order: Order; onDone: () => void }) {
  const { can, isAdmin } = useAuth()
  const [open, setOpen] = useState<Kind | null>(null)
  const [loading, setLoading] = useState<Kind | null>(null)
  const [ctx, setCtx] = useState<{ o: CustomerOrder; thread: ActionThread } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  if (!can('support') || order.source !== 'shopify') return null

  const start = async (kind: Kind) => {
    setErr(null)
    if (ctx) { setOpen(kind); return }
    setLoading(kind)
    try {
      const r = await apiFetch(`/api/orders/customer-order?orderId=${encodeURIComponent(order.id)}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load the order from Shopify')
      // The forms are Support's; they read the customer from the conversation, so they get one shaped from the order.
      const thread = { id: '', orderRowId: order.id, customerName: d.customer?.name || '', customerEmail: d.customer?.email || '', tags: [] } as unknown as ActionThread
      setCtx({ o: d.order, thread })
      setOpen(kind)
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load the order') } finally { setLoading(null) }
  }
  const close = () => setOpen(null)
  const done = () => { setCtx(null); onDone() }
  const shipped = Boolean(ctx?.o.fulfillmentStatus && ctx.o.fulfillmentStatus !== 'UNFULFILLED')
  const link = (kind: Kind, Icon: typeof MapPin, label: string, title: string) => (
    <button onClick={() => { void start(kind) }} disabled={Boolean(loading)} className={LINK} title={title}>
      {loading === kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />} {label}
    </button>
  )
  return (
    <>
      {order.status !== 'completed' && link('address', MapPin, 'Edit shipping address', 'Change the ship-to in Shopify, then paste it into Artelo')}
      {link('ticket', MessageSquareWarning, 'Create Artelo ticket', 'Email Artelo support about this order: damaged, lost, wrong print')}
      {link('reorder', Repeat, 'New Artelo order', 'The same print to this customer: a reprint or replacement, made in Artelo')}
      {err && <span className="text-[11px] text-red-600">{err}</span>}
      {ctx && open === 'address' && !shipped && <AddressForm o={ctx.o} thread={ctx.thread} onDone={done} onCancel={close} />}
      {ctx && open === 'address' && shipped && <span className="text-[11px] text-off-black/50">It has shipped, so the address cannot change. Use New Artelo order to send another.</span>}
      {ctx && open === 'ticket' && <ArteloTicketForm o={ctx.o} thread={ctx.thread} onDone={done} onCancel={close} />}
      {ctx && open === 'reorder' && <ArteloOrderForm o={ctx.o} thread={ctx.thread} isAdmin={isAdmin} onDone={done} onCancel={close} />}
    </>
  )
}
