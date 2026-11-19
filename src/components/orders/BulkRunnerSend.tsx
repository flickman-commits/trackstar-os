import { useState } from 'react'
import { ArrowUpRight, Loader2, MapPin, Pause, Send } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import ActionModal from '@/components/ActionModal'
import { modalCancel, modalInput, modalPrimary } from '@/lib/ui'
import type { Order } from '@/components/orders/orderModel'

type Done = (msg: string) => void | Promise<void>
type Fail = (msg: string) => void

/** One bulk action on this runner (api/_routes/bulk/index.js), keyed by the runner's order number. */
async function bulkAction(order: Order, body: Record<string, unknown>) {
  const r = await apiFetch('/api/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: order.bulkSend?.bulkOrderId, orderNumber: order.orderNumber, ...body }) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'That did not work')
  return d
}

const when = (d: string) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const linkBtn = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors disabled:opacity-50'

/**
 * Where a bulk runner's print stands with Artelo (server/domain/bulk/send.js),
 * with what a person can do about it: Hold one that is about to go, Send now
 * one that is held or stopped, Add address when that is what it waits on.
 */
export function BulkSendLine({ order, onDone, onError }: { order: Order; onDone: Done; onError: Fail }) {
  const b = order.bulkSend
  const [busy, setBusy] = useState<string | null>(null)
  const [addressOpen, setAddressOpen] = useState(false)
  const state = b?.state || (order.status === 'completed' ? 'sent' : 'not_ready')
  const sent = state === 'sent'
  const text = sent ? `Sent to Artelo${b?.sentAt ? ` ${when(b.sentAt)}` : ''}`
    : state === 'queued' ? `Going to Artelo ${b?.sendAfter && new Date(b.sendAfter).getTime() > Date.now() ? `at ${when(b.sendAfter)}` : 'within 2 minutes'}${b?.reason ? ` (last try: ${b.reason})` : ''}`
    : state === 'held' ? `${b?.reason}. It will not go to Artelo until someone presses Send now.`
    : state === 'error' ? `Stopped: ${b?.reason}`
    : state === 'ready' ? 'Ready for Artelo'
    : `Not going to Artelo yet: ${b?.reason || 'waiting on the print'}`
  const run = async (key: string, body: Record<string, unknown>, msg: string) => {
    setBusy(key)
    try { await bulkAction(order, body); await onDone(msg) } catch (e) { onError(e instanceof Error ? e.message : 'That did not work') } finally { setBusy(null) }
  }
  const needsAddress = !sent && b && !b.addressComplete
  const canSend = !sent && (state === 'held' || state === 'error' || state === 'ready')
  return (
    <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 rounded-md border border-border-gray bg-white">
      <span className={`flex-1 text-sm ${sent ? 'text-green-700 font-medium' : state === 'error' ? 'text-red-600' : state === 'held' ? 'text-amber-700' : 'text-off-black/60'}`}>{text}</span>
      {needsAddress && b?.bulkOrderId && (
        <button onClick={() => setAddressOpen(true)} className={linkBtn}><MapPin className="w-4 h-4" /> Add address</button>
      )}
      {state === 'queued' && (
        <button disabled={!!busy} onClick={() => run('hold', { action: 'hold-runner' }, 'Held. It stays approved and goes when someone presses Send now.')} className={linkBtn}>
          {busy === 'hold' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />} Hold
        </button>
      )}
      {canSend && !needsAddress && (
        <button disabled={!!busy} onClick={() => run('send', { action: 'send-runner' }, 'Queued for Artelo. It goes within 2 minutes.')} className={`${linkBtn} !bg-dark-fill !text-white !border-dark-fill`}>
          {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send now
        </button>
      )}
      {sent && order.arteloUrl && (
        <a href={order.arteloUrl} target="_blank" rel="noopener noreferrer" className={linkBtn} title="Open this runner's order in Artelo">
          <img src="/artelo-icon.png" alt="" className="w-4 h-4 rounded-[3px]" /> Artelo <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
        </a>
      )}
      {addressOpen && <BulkAddressModal order={order} onClose={() => setAddressOpen(false)} onDone={onDone} onError={onError} />}
    </div>
  )
}

/** The Actions link: add or fix the address a bulk runner's print ships to, until it has gone to Artelo. */
export function BulkAddressAction({ order, onDone, onError }: { order: Order; onDone: Done; onError: Fail }) {
  const [open, setOpen] = useState(false)
  const b = order.bulkSend
  if (!b?.bulkOrderId || b.state === 'sent') return null
  return (
    <>
      <button onClick={() => setOpen(true)} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2"
        title="Where this runner's print ships">
        <MapPin className="w-3.5 h-3.5" /> {b.addressComplete ? 'Edit address' : 'Add address'}
      </button>
      {open && <BulkAddressModal order={order} onClose={() => setOpen(false)} onDone={onDone} onError={onError} />}
    </>
  )
}

function BulkAddressModal({ order, onClose, onDone, onError }: { order: Order; onClose: () => void; onDone: Done; onError: Fail }) {
  const a = order.bulkSend?.address || {}
  const [f, setF] = useState({ line1: a.line1 || '', line2: a.line2 || '', city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || 'United States' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(v => ({ ...v, [k]: e.target.value }))
  const ok = f.line1.trim() && f.city.trim() && f.zip.trim()
  const save = async () => {
    setBusy(true)
    try {
      await bulkAction(order, { action: 'update-runner', address: f })
      onClose()
      await onDone('Address saved. If the print is approved, it goes to Artelo within 2 minutes.')
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not save the address') } finally { setBusy(false) }
  }
  return (
    <ActionModal icon={MapPin} title="Shipping address" sub={order.effectiveRunnerName || order.runnerName || order.orderNumber} onClose={onClose} busy={busy}
      footer={<><button onClick={onClose} className={modalCancel}>Cancel</button><button onClick={save} disabled={busy || !ok} className={modalPrimary}>{busy ? 'Saving…' : 'Save address'}</button></>}>
      <div className="space-y-2.5">
        <input className={modalInput} placeholder="Street address" value={f.line1} onChange={set('line1')} autoFocus />
        <input className={modalInput} placeholder="Apt, suite (optional)" value={f.line2} onChange={set('line2')} />
        <div className="grid grid-cols-[1fr_5rem_6.5rem] gap-2">
          <input className={modalInput} placeholder="City" value={f.city} onChange={set('city')} />
          <input className={modalInput} placeholder="State" value={f.state} onChange={set('state')} />
          <input className={modalInput} placeholder="Zip" value={f.zip} onChange={set('zip')} />
        </div>
        <input className={modalInput} placeholder="Country" value={f.country} onChange={set('country')} />
      </div>
    </ActionModal>
  )
}
