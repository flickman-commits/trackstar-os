import { useState } from 'react'
import { toast } from 'sonner'
import { Check, ExternalLink, Loader2, RotateCcw, X } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { postRefund as post, usd, toCents, dollars, day, type Refund, type RefundState } from '@/lib/bulkRefunds'
import { useAuth } from '@/lib/auth'
import { modalCancel, modalChip, modalInput, modalPrimary, modalDanger, fieldLabel, btnGhost } from '@/lib/ui'

/**
 * Refunds on a bulk order (server/domain/bulk/refunds.js): ask for one here,
 * and an admin approves it. A Shopify-paid order refunds through Shopify on
 * approval; a Stripe one is refunded in Stripe by the admin, then marked done.
 * Amounts are admins' only: anyone else asks by prints.
 */

const KIND_LABEL = { full: 'Full refund', unfilled: 'Prints with no runner', custom: 'Amount' }
const STATUS: Record<Refund['status'], { label: string; cls: string }> = {
  requested: { label: 'Waiting for an admin', cls: 'bg-amber-50 border-amber-200 text-amber-800' },
  approved: { label: 'Approved: refund it in Stripe', cls: 'bg-[#4600D6]/[0.05] border-[#4600D6]/25 text-[#4600D6]' },
  refunded: { label: 'Refunded', cls: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  declined: { label: 'Declined', cls: 'bg-subtle-gray border-border-gray text-off-black/55' },
  failed: { label: 'Shopify refused it', cls: 'bg-red-50 border-red-200 text-red-700' },
}

/** Ask for a refund: the whole order, the prints with no runner, or (admins) an amount. */
export function RefundModal({ state, stripeInvoiceUrl, onClose, onDone }: { state: RefundState; stripeInvoiceUrl?: string | null; onClose: () => void; onDone: (s: RefundState) => void }) {
  const { isAdmin } = useAuth()
  const [kind, setKind] = useState<Refund['kind']>(state.unfilled > 0 ? 'unfilled' : 'full')
  const [paid, setPaid] = useState(dollars(state.paidCents))
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState(state.unfilled > 0 ? `${state.unfilled} of the ${state.quantity} prints paid for have no runner${state.dnf ? ` (${state.dnf} did not finish)` : ''}.` : '')
  const [busy, setBusy] = useState(false)
  // Re-worked as the paid figure changes, the same way the server works it out.
  const paidCents = toCents(paid) ?? state.paidCents ?? null
  const left = paidCents == null ? null : Math.max(0, paidCents - (state.refundedCents || 0))
  const suggested = kind === 'full' ? left : kind === 'unfilled' && paidCents != null && state.quantity ? Math.min(left ?? 0, Math.round(paidCents * state.unfilled / state.quantity)) : null
  const amountCents = toCents(amount) ?? suggested ?? undefined
  const submit = async () => {
    setBusy(true)
    try {
      const out = await post({ action: 'request', id: state.bulkOrderId, kind, reason, ...(isAdmin ? { amountCents, paidCents: toCents(paid) } : {}) })
      toast.success(isAdmin ? 'Refund asked for. Approve it below to pay it back.' : 'Refund asked for. An admin approves it.')
      onDone(out)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <ActionModal icon={RotateCcw} title="Refund" sub={state.number} onClose={onClose} busy={busy} size="md"
      description={`${state.quantity} prints paid for, ${state.making} being made${state.dnf ? `, ${state.dnf} did not finish` : ''}. An admin approves every refund before any money moves.`}
      hint={state.via === 'shopify' ? 'Paid through Shopify: approving refunds it there.' : 'Paid through Stripe: approving leaves it for you to refund in Stripe.'}
      footer={<><button onClick={onClose} className={modalCancel}>Cancel</button><button onClick={submit} disabled={busy || !reason.trim() || (isAdmin && !amountCents)} className={modalPrimary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Ask for the refund</button></>}>
      <div>
        <span className={fieldLabel}>What to refund</span>
        <div className="flex flex-wrap gap-1.5">
          {state.unfilled > 0 && <button onClick={() => setKind('unfilled')} className={modalChip(kind === 'unfilled')}>{state.unfilled} prints with no runner</button>}
          <button onClick={() => setKind('full')} className={modalChip(kind === 'full')}>The whole order</button>
          {isAdmin && <button onClick={() => setKind('custom')} className={modalChip(kind === 'custom')}>An amount</button>}
        </div>
      </div>
      {isAdmin && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabel}>They paid</span>
            <input value={paid} onChange={e => setPaid(e.target.value)} inputMode="decimal" className={modalInput} disabled={state.paidFrom === 'shopify'} />
            <span className="block mt-1 text-[11px] text-off-black/45">
              {state.paidFrom === 'shopify' ? 'From the Shopify order' : state.paidFrom === 'entered' ? 'As given on an earlier refund' : state.paidFrom === 'estimate' ? <>An estimate from today's price. Check the {stripeInvoiceUrl ? <a href={stripeInvoiceUrl} target="_blank" rel="noopener noreferrer" className="underline">Stripe invoice</a> : 'Stripe invoice'} and type what they paid.</> : <>Type the total from the {stripeInvoiceUrl ? <a href={stripeInvoiceUrl} target="_blank" rel="noopener noreferrer" className="underline">Stripe invoice</a> : 'Stripe invoice'}.</>}
              {state.refundedCents ? ` ${usd(state.refundedCents)} already refunded.` : ''}
            </span>
          </label>
          <label className="block">
            <span className={fieldLabel}>Refund</span>
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder={suggested != null ? dollars(suggested) : 'amount'} inputMode="decimal" className={modalInput} />
            <span className="block mt-1 text-[11px] text-off-black/45">
              {kind === 'unfilled' && paidCents != null ? `${state.unfilled} of ${state.quantity} prints: ${usd(suggested)}, about ${usd(Math.round(paidCents / state.quantity))} a print with the discount and tax.` : kind === 'full' ? `Everything left: ${usd(left)}.` : 'Type the amount.'}
            </span>
          </label>
        </div>
      )}
      <label className="block">
        <span className={fieldLabel}>Why</span>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className={modalInput} placeholder="They could not get addresses for the rest of their runners" />
      </label>
    </ActionModal>
  )
}

/** The order's refunds, with the admin's Approve, Decline and Mark refunded. Nothing shows until one is asked for. */
export function RefundsCard({ state, stripeInvoiceUrl, onChanged }: { state: RefundState; stripeInvoiceUrl?: string | null; onChanged: (s: RefundState) => void }) {
  const { isAdmin } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const [amount, setAmount] = useState<Record<string, string>>({})
  if (!state.refunds.length) return null
  const act = async (refund: Refund, action: string, ok: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${refund.id}:${action}`)
    try { onChanged(await post({ action, refundId: refund.id, ...extra })); toast.success(ok) } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  return (
    <div>
      <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Refunds</h4>
      <div className="space-y-2">
        {state.refunds.map(r => {
          const st = STATUS[r.status]
          const a = amount[r.id] ?? dollars(r.amountCents)
          const amountCents = toCents(a)
          return (
            <div key={r.id} className={`rounded-md border p-3 text-xs space-y-1.5 ${st.cls}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{KIND_LABEL[r.kind]}{r.prints ? ` · ${r.prints} prints` : ''}</span>
                {isAdmin && r.amountCents != null && <span className="font-bold tabular-nums">{usd(r.amountCents)}</span>}
              </div>
              <p className="text-off-black/70">{r.reason}</p>
              <p className="text-off-black/45">{st.label} · asked by {r.requestedBy || 'someone'} {day(r.createdAt)}{r.decidedBy && r.status !== 'requested' ? ` · ${r.status === 'declined' ? 'declined' : 'approved'} by ${r.decidedBy}` : ''}{r.refundedAt ? ` · refunded ${day(r.refundedAt)}` : ''}</p>
              {r.error && <p className="text-red-700">{r.error}</p>}
              {isAdmin && (r.status === 'requested' || r.status === 'failed') && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-off-black/60">$</span>
                  <input value={a} onChange={e => setAmount(p => ({ ...p, [r.id]: e.target.value }))} placeholder="amount" inputMode="decimal" className="w-24 px-2 py-1 rounded-md border border-border-gray bg-white text-right text-xs" aria-label="Refund amount" />
                  <button onClick={() => act(r, 'approve', r.via === 'shopify' ? 'Refunded through Shopify' : 'Approved. Refund it in Stripe, then mark it refunded.', { amountCents })} disabled={!!busy || !amountCents} className={`${modalDanger} !py-1 !px-2.5 !text-xs`}>
                    {busy === `${r.id}:approve` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} {r.via === 'shopify' ? `Approve & refund ${amountCents ? usd(amountCents) : ''}` : 'Approve'}
                  </button>
                  <button onClick={() => act(r, 'decline', 'Declined')} disabled={!!busy} className={`${btnGhost} !text-xs`}><X className="w-3.5 h-3.5" /> Decline</button>
                </div>
              )}
              {isAdmin && r.status === 'approved' && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {stripeInvoiceUrl && <a href={stripeInvoiceUrl} target="_blank" rel="noopener noreferrer" className={`${btnGhost} !text-xs`}><ExternalLink className="w-3.5 h-3.5" /> Stripe invoice</a>}
                  <button onClick={() => act(r, 'refunded', 'Marked refunded')} disabled={!!busy} className={`${modalPrimary} !py-1 !px-2.5 !text-xs`}>{busy === `${r.id}:refunded` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Refunded {usd(r.amountCents)} in Stripe</button>
                  <button onClick={() => act(r, 'decline', 'Called off')} disabled={!!busy} className={`${btnGhost} !text-xs`}>Call off</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
