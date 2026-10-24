import { useEffect, useState } from 'react'
import { Ban, BadgePercent, Palette, Repeat, Check, Copy, Image as ImageIcon, Link2, Loader2, MapPin, MessageSquareWarning, Pencil, Plus, Receipt, Ruler, Search, Star, Truck, X } from 'lucide-react'
import { reviewAsk, reviewLinkFor } from '@/lib/reviewLinks'
import { toast } from 'sonner'
import { newIdempotencyKey, supportApi } from '@/lib/supportApi'
import { useAuth } from '@/lib/auth'
import ConvertToCustomModal from '@/components/orders/ConvertToCustomModal'
import { parseAddress } from '@/lib/parseAddress'
import type { Address, CodeLookup, CustomerOrder, Mockup, ThreadDetail } from '@/types/support'

/**
 * The Actions list, in the dashboard's own style: purple text links with an
 * icon, one per line, under a small grey heading.
 *
 * Per order: drop Artelo's tracking link (Artelo fulfills through Shopify,
 * so its tracking is on the Shopify fulfillment it creates) or the approval
 * link into the reply; change the ship-to (Shopify and our rows, then the
 * address copied for Artelo, which has no API to edit an order); fix the
 * name or year before production; a note for fulfillment; refund all or
 * part (over $150 is Matt's); cancel and refund before production, with the
 * customer's yes, then cancel it in Artelo by hand. For the customer: a 15% code, Slack
 * Matt. Last and small: check a code they pasted. Every one is a person's
 * press, an event in the thread and an audit line.
 */
const linkCls = 'self-start max-w-full inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2 disabled:opacity-50 disabled:no-underline text-left'

function ActionLink({ icon: Icon, onClick, href, busy, title, children }: { icon: typeof Truck; onClick?: () => void; href?: string; busy?: boolean; title?: string; children: React.ReactNode }) {
  const icon = busy ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <Icon className="w-3.5 h-3.5 shrink-0" />
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" className={linkCls} title={title}>{icon}{children}</a>
  return <button onClick={onClick} disabled={busy} className={linkCls} title={title}>{icon}{children}</button>
}

const heading = 'text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5'
const field = 'w-full min-w-0 px-2 py-1 text-xs bg-white border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20'

/** Paste a whole address from the customer's email; it fills the fields below. */
function PasteAddress({ onParsed }: { onParsed: (a: Partial<Address>) => void }) {
  const [v, setV] = useState('')
  const fill = (text: string) => {
    const parsed = parseAddress(text)
    const found = Object.entries(parsed).filter(([, x]) => x)
    if (!found.length) { toast.error('Could not read an address in that'); return }
    onParsed(Object.fromEntries(found) as Partial<Address>)
    setV('')
    toast.success('Filled in. Check it before saving.')
  }
  return (
    <textarea value={v} rows={2} placeholder="Paste a whole address here to fill it in"
      onChange={e => setV(e.target.value)}
      onPaste={e => { const t = e.clipboardData.getData('text/plain'); if (t.includes('\n') || /\d{5}/.test(t)) { e.preventDefault(); fill(t) } }}
      onBlur={() => { if (v.trim()) fill(v) }}
      className={`${field} resize-none placeholder:text-off-black/40`} />
  )
}

/** The ship-to form, prefilled from Shopify (or Artelo's copy), then the hand-off to Artelo. */
function AddressForm({ o, thread, onDone, onCancel }: { o: CustomerOrder; thread: ThreadDetail; onDone: () => void; onCancel: () => void }) {
  const start: Address = o.shipTo || o.arteloAddress || { name: thread.customerName || '', address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' }
  const [a, setA] = useState<Address>(start)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<{ pasted: string; arteloUrl: string | null; taxNote?: string | null } | null>(null)
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setA({ ...a, [k]: e.target.value })
  const save = async () => {
    setBusy(true)
    try {
      const out = await supportApi.action<{ pasted: string; arteloUrl: string | null; taxNote?: string | null }>('shippingAddress', { id: thread.id, shopifyOrderId: o.shopifyOrderId, address: a })
      try { await navigator.clipboard.writeText(out.pasted) } catch { /* the button below copies too */ }
      setSaved(out)
      toast.success(`#${o.number} updated in Shopify. Address copied for Artelo.`)
      onDone()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  if (saved) {
    return (
      <div className="w-full bg-subtle-gray border border-border-gray rounded-md p-2.5 space-y-1.5 text-xs">
        <div className="inline-flex items-center gap-1.5 text-emerald-700 font-medium"><Check className="w-3.5 h-3.5" />Changed in Shopify. Now paste it into Artelo:</div>
        <pre className="whitespace-pre-wrap font-sans text-off-black/75 bg-white border border-border-gray rounded p-2">{saved.pasted}</pre>
        {saved.taxNote && <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{saved.taxNote}</div>}
        <div className="flex items-center gap-3">
          <button onClick={() => { navigator.clipboard.writeText(saved.pasted).then(() => toast.success('Copied')).catch(() => {}) }} className={linkCls}><Copy className="w-3.5 h-3.5" />Copy again</button>
          {saved.arteloUrl && <a href={saved.arteloUrl} target="_blank" rel="noopener noreferrer" className={linkCls}><img src="/artelo-icon.png" alt="" className="w-3.5 h-3.5 rounded-[3px]" />Open in Artelo</a>}
          <button onClick={onCancel} className="ml-auto text-off-black/45 hover:text-off-black">Done</button>
        </div>
      </div>
    )
  }
  return (
    <div className="w-full bg-subtle-gray border border-border-gray rounded-md p-2.5 space-y-1.5">
      <PasteAddress onParsed={p => setA({ ...a, ...p })} />
      <input className={field} value={a.name} onChange={set('name')} placeholder="Name" />
      <input className={field} value={a.address1} onChange={set('address1')} placeholder="Street" />
      <input className={field} value={a.address2} onChange={set('address2')} placeholder="Apt, suite (optional)" />
      <div className="grid grid-cols-[1fr_56px_72px] gap-1.5">
        <input className={field} value={a.city} onChange={set('city')} placeholder="City" />
        <input className={field} value={a.province} onChange={set('province')} placeholder="State" />
        <input className={field} value={a.zip} onChange={set('zip')} placeholder="ZIP" />
      </div>
      <div className="grid grid-cols-[56px_1fr] gap-1.5">
        <input className={field} value={a.country} onChange={set('country')} placeholder="US" />
        <input className={field} value={a.phone} onChange={set('phone')} placeholder="Phone (optional)" />
      </div>
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-[11px] text-off-black/45 flex-1">Saves to Shopify; you paste it into Artelo.</span>
        <button onClick={onCancel} className="px-2 py-1 text-xs text-off-black/50 hover:text-off-black">Cancel</button>
        <button onClick={save} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-dark-fill text-white hover:bg-off-black/85 disabled:opacity-50">{busy && <Loader2 className="w-3 h-3 animate-spin" />}Save</button>
      </div>
    </div>
  )
}

type Refundable = { number: string; availableCents: number; refundedCents: number; cancelled: boolean; fulfillment: string | null; limitCents: number; discountLimitPercent?: number; isAdmin: boolean }
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
const formBox = 'w-full bg-subtle-gray border border-border-gray rounded-md p-2.5 space-y-1.5 text-xs'

/** What is left to refund on the order, read from Shopify when a form opens. */
function useRefundable(thread: ThreadDetail, o: CustomerOrder) {
  const [info, setInfo] = useState<Refundable | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = () => {
    setErr(null)
    supportApi.action<Refundable>('refundable', { id: thread.id, shopifyOrderId: o.shopifyOrderId }).then(setInfo).catch(e => setErr((e as Error).message))
  }
  return { info, err, load }
}

/** Money back, all or part (scenarios 5 and 15). Over $150 needs an admin, and the server checks too. */
function RefundForm({ o, thread, onDone, onCancel }: { o: CustomerOrder; thread: ThreadDetail; onDone: () => void; onCancel: () => void }) {
  const { info, err, load } = useRefundable(thread, o)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // One key per confirmed press: a second click on Yes, or a retry, is the same refund and the server refuses it.
  const [pressKey, setPressKey] = useState('')
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cents = Math.round(Number(amount) * 100) || 0
  // The $150 line is per order: earlier refunds on it count.
  const over = info ? (info.refundedCents || 0) + cents > info.limitCents && !info.isAdmin : false
  const tooMuch = info ? cents > info.availableCents : false
  const save = async () => {
    // Two clicks in the panel, not a browser dialog: a browser told to block dialogs answers "no" without showing one.
    if (!confirming) { setConfirming(true); setPressKey(newIdempotencyKey()); setFailed(null); return }
    setBusy(true)
    try {
      const out = await supportApi.action<{ display: string; leftCents: number }>('refund', { id: thread.id, shopifyOrderId: o.shopifyOrderId, cents, reason, idempotencyKey: pressKey })
      toast.success(`Refunded ${out.display} on #${o.number}`)
      onDone(); onCancel()
    } catch (e) { setFailed((e as Error).message); toast.error((e as Error).message) }
    finally { setBusy(false); setConfirming(false) }
  }
  return (
    <div className={formBox}>
      {err ? <div className="text-red-700">{err}</div> : !info ? <div className="text-off-black/50 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the order from Shopify</div> : (
        <>
          <div className="text-off-black/60">{dollars(info.availableCents)} left to refund{info.refundedCents ? ` (${dollars(info.refundedCents)} already refunded)` : ''}.</div>
          {/* Quick amounts: a share of what the order was paid (never more than is left), or type any amount. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[10, 15, 100].map(pct => {
              const cents = Math.min(info.availableCents, Math.round(((info.availableCents + (info.refundedCents || 0)) * pct) / 100))
              const value = (cents / 100).toFixed(2)
              return (
                <button key={pct} type="button" onClick={() => setAmount(value)} title={dollars(cents)}
                  className={`px-2 py-1 rounded-md border text-xs font-medium ${amount === value ? 'border-[#4600D6] bg-[#4600D6]/10 text-[#4600D6]' : 'border-border-gray bg-white text-off-black/70 hover:border-off-black/30'}`}>
                  {pct}%
                </button>
              )
            })}
            <span className="text-off-black/50 ml-1">$</span>
            <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" className={`${field} w-24`} autoFocus />
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why (goes on the refund), e.g. Buy 2 promo missed" className={field} />
          {over && <div className="text-red-700">Over {dollars(info.limitCents)} on one order{info.refundedCents ? ', counting what was already refunded,' : ''} is Matt's call. Slack Matt instead.</div>}
          {tooMuch && <div className="text-red-700">That is more than is left.</div>}
          {failed && <div className="text-red-700">{failed}</div>}
          {confirming && <div className="text-red-700 font-medium">Refund {dollars(cents)} to the card they paid with? This cannot be undone.</div>}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="text-[11px] text-off-black/45 flex-1">No Shopify email; your reply tells them.</span>
            <button onClick={() => (confirming ? setConfirming(false) : onCancel())} className="px-2 py-1 text-xs text-off-black/50 hover:text-off-black">{confirming ? 'Back' : 'Cancel'}</button>
            <button onClick={save} disabled={busy || cents <= 0 || !reason.trim() || over || tooMuch} className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-white disabled:opacity-50 ${confirming ? 'bg-red-600 hover:bg-red-700' : 'bg-dark-fill hover:bg-off-black/85'}`}>{busy && <Loader2 className="w-3 h-3 animate-spin" />}{confirming ? `Yes, refund ${dollars(cents)}` : `Refund ${cents > 0 ? dollars(cents) : ''}`}</button>
          </div>
        </>
      )}
    </div>
  )
}

/** Cancel and refund in full (scenario 14). Only with the customer's yes, only before production. */
function CancelForm({ o, thread, onDone, onCancel }: { o: CustomerOrder; thread: ThreadDetail; onDone: () => void; onCancel: () => void }) {
  const { info, err, load } = useRefundable(thread, o)
  const [reason, setReason] = useState('')
  const [yes, setYes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ display: string; arteloUrl: string | null } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pressKey, setPressKey] = useState('')
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(load, []) // eslint-disable-line react-hooks/exhaustive-deps
  const over = info ? (info.refundedCents || 0) + info.availableCents > info.limitCents && !info.isAdmin : false
  const save = async () => {
    if (!info) return
    if (!confirming) { setConfirming(true); setPressKey(newIdempotencyKey()); setFailed(null); return }
    setBusy(true)
    try {
      const out = await supportApi.action<{ display: string; arteloUrl: string | null }>('cancelOrder', { id: thread.id, shopifyOrderId: o.shopifyOrderId, reason, customerConfirmed: yes, idempotencyKey: pressKey })
      setDone(out)
      toast.success(`#${o.number} cancelled and ${out.display} refunded`)
      onDone()
    } catch (e) { setFailed((e as Error).message); toast.error((e as Error).message) }
    finally { setBusy(false); setConfirming(false) }
  }
  if (done) {
    return (
      <div className={formBox}>
        <div className="inline-flex items-center gap-1.5 text-emerald-700 font-medium"><Check className="w-3.5 h-3.5" />Cancelled in Shopify, {done.display} refunded, off the fulfillment queue.</div>
        <div className="text-off-black/70">Now cancel it in Artelo too, or it stays there.</div>
        <div className="flex items-center gap-3">
          {done.arteloUrl && <a href={done.arteloUrl} target="_blank" rel="noopener noreferrer" className={linkCls}><img src="/artelo-icon.png" alt="" className="w-3.5 h-3.5 rounded-[3px]" />Open in Artelo</a>}
          <button onClick={onCancel} className="ml-auto text-off-black/45 hover:text-off-black">Done</button>
        </div>
      </div>
    )
  }
  return (
    <div className={formBox}>
      {err ? <div className="text-red-700">{err}</div> : !info ? <div className="text-off-black/50 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the order from Shopify</div> : (
        <>
          <div className="text-off-black/70">Cancels #{o.number} in Shopify and refunds {dollars(info.availableCents)}. They reorder if they want something different.</div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why, e.g. Wrong frame, reordering" className={field} />
          <label className="flex items-start gap-1.5 cursor-pointer text-off-black/80">
            <input type="checkbox" checked={yes} onChange={e => setYes(e.target.checked)} className="mt-0.5 accent-[#4600D6]" />
            The customer said yes to cancelling
          </label>
          {over && <div className="text-red-700">Over {dollars(info.limitCents)} is Matt's call. Slack Matt instead.</div>}
          {failed && <div className="text-red-700">{failed}</div>}
          {confirming && <div className="text-red-700 font-medium">Cancel #{o.number} and refund {dollars(info.availableCents)}? This cannot be undone.</div>}
          <div className="flex items-center gap-2 pt-0.5">
            <span className="flex-1" />
            <button onClick={() => (confirming ? setConfirming(false) : onCancel())} className="px-2 py-1 text-xs text-off-black/50 hover:text-off-black">Back</button>
            <button onClick={save} disabled={busy || !yes || over} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{busy && <Loader2 className="w-3 h-3 animate-spin" />}{busy ? 'Cancelling in Shopify' : confirming ? `Yes, cancel and refund ${dollars(info.availableCents)}` : `Cancel and refund ${dollars(info.availableCents)}`}</button>
          </div>
        </>
      )}
    </div>
  )
}

type Choice = { value: string; label: string }
type ClaimPrep = { number: string; arteloOrderId: string | null; to: string; photos: { messageId: string; index: number; filename: string; at: string }[] }

/**
 * Damaged in shipping: the customer's photos to Artelo support, who file a
 * report and make a free "-R" replacement (a New Artelo order is billed).
 * Their replacement then shows under Orders on its own.
 */
function DamageClaimForm({ o, thread, onDone, onCancel }: { o: CustomerOrder; thread: ThreadDetail; onDone: () => void; onCancel: () => void }) {
  const [prep, setPrep] = useState<ClaimPrep | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [pressKey, setPressKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<number | null>(null)
  const key = (p: { messageId: string; index: number }) => `${p.messageId}:${p.index}`
  useEffect(() => {
    supportApi.arteloOrder<ClaimPrep>({ action: 'claimPrep', id: thread.id, shopifyOrderId: o.shopifyOrderId })
      .then(r => { setPrep(r); setPicked(r.photos.slice(0, 8).map(key)) })
      .catch(e => setErr((e as Error).message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!confirming) { setConfirming(true); setPressKey(newIdempotencyKey()); setErr(null); return }
    setBusy(true)
    try {
      const photos = (prep?.photos || []).filter(p => picked.includes(key(p))).map(p => ({ messageId: p.messageId, index: p.index }))
      const out = await supportApi.arteloOrder<{ photos: number }>({ action: 'claim', id: thread.id, shopifyOrderId: o.shopifyOrderId, photos, note, idempotencyKey: pressKey })
      setSent(out.photos)
      toast.success(`Damage claim sent to Artelo support with ${out.photos} photo${out.photos === 1 ? '' : 's'}`)
      onDone()
    } catch (e) { setErr((e as Error).message); toast.error((e as Error).message) }
    finally { setBusy(false); setConfirming(false) }
  }
  if (sent != null) {
    return (
      <div className={formBox}>
        <div className="inline-flex items-center gap-1.5 text-emerald-700 font-medium"><Check className="w-3.5 h-3.5" />Claim sent to {prep?.to} with {sent} photo{sent === 1 ? '' : 's'}.</div>
        <div className="text-off-black/55">Their answer comes into Support as its own conversation. The free replacement shows under Orders once Artelo makes it.</div>
        <div className="flex"><button onClick={onCancel} className="ml-auto text-off-black/45 hover:text-off-black">Done</button></div>
      </div>
    )
  }
  return (
    <div className={formBox}>
      {!prep && !err && <div className="text-off-black/50 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Finding the customer's photos</div>}
      {prep && (
        <>
          <div className="text-off-black/70">Emails the photos to <b>{prep.to}</b> from the support inbox. Artelo files a report and makes a free replacement of #{prep.number}.</div>
          {prep.photos.length === 0
            ? <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">No photos from the customer in this conversation yet. Ask them for photos of the damage and the box first.</div>
            : (
              <div className="grid grid-cols-4 gap-1.5">
                {prep.photos.map(p => {
                  const on = picked.includes(key(p))
                  return (
                    <button key={key(p)} type="button" onClick={() => setPicked(prev => on ? prev.filter(x => x !== key(p)) : [...prev, key(p)])} title={p.filename}
                      className={`relative aspect-square rounded border-2 overflow-hidden bg-white ${on ? 'border-[#4600D6]' : 'border-transparent opacity-50 hover:opacity-80'}`}>
                      <img src={`/api/support/attachment?message=${encodeURIComponent(p.messageId)}&i=${p.index}`} alt={p.filename} className="w-full h-full object-cover" />
                      {on && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[#4600D6] text-white flex items-center justify-center"><Check className="w-3 h-3" /></span>}
                    </button>
                  )
                })}
              </div>
            )}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="What is damaged, e.g. Frame cracked at the corner, glass shattered" className={field} />
          {err && <div className="text-red-700">{err}</div>}
          <div className="flex items-center gap-3">
            <button onClick={send} disabled={busy || !picked.length || !note.trim()} className={`${linkCls} ${confirming ? 'text-red-700' : ''}`}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquareWarning className="w-3.5 h-3.5" />}
              {confirming ? `Send ${picked.length} photo${picked.length === 1 ? '' : 's'} to Artelo support?` : 'Send claim to Artelo'}
            </button>
            <button onClick={onCancel} className="ml-auto text-off-black/45 hover:text-off-black">Cancel</button>
          </div>
        </>
      )}
      {!prep && err && <div className="flex items-center gap-3"><span className="text-red-700">{err}</span><button onClick={onCancel} className="ml-auto text-off-black/45 hover:text-off-black">Close</button></div>}
    </div>
  )
}

type ReorderPrep = {
  number: string; nextOrderId: string; sizes: Choice[]; frames: Choice[]
  items: { orderId: string; label: string; productLabel: string; designFrom: string | null; copyable: boolean; size: string | null; frame: string | null }[]
}

/**
 * A new Artelo order for this customer: the same print, their address and
 * email, $0. For a reprint or a replacement. "Test only" makes an Artelo test
 * order that is never produced, to try it first.
 */
function ArteloOrderForm({ o, thread, isAdmin, onDone, onCancel }: { o: CustomerOrder; thread: ThreadDetail; isAdmin: boolean; onDone: () => void; onCancel: () => void }) {
  const [prep, setPrep] = useState<ReorderPrep | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  // Size and frame per print, starting as the original; a customer may want something new on the replacement.
  const [changes, setChanges] = useState<Record<string, { size: string; frame: string }>>({})
  const [a, setA] = useState<Address>(o.shipTo || o.arteloAddress || { name: thread.customerName || '', address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' })
  const [email, setEmail] = useState(thread.customerEmail || '')
  const [instructions, setInstructions] = useState('')
  const [test, setTest] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pressKey, setPressKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ orderId: string; url: string | null; test: boolean } | null>(null)
  useEffect(() => {
    supportApi.arteloOrder<ReorderPrep>({ action: 'prep', id: thread.id, shopifyOrderId: o.shopifyOrderId })
      .then(r => { setPrep(r); setPicked(r.items.filter(i => i.copyable).map(i => i.orderId)); setChanges(Object.fromEntries(r.items.map(i => [i.orderId, { size: i.size || '', frame: i.frame || 'Unframed' }]))) })
      .catch(e => setErr((e as Error).message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setA({ ...a, [k]: e.target.value })
  const create = async () => {
    if (!confirming) { setConfirming(true); setPressKey(newIdempotencyKey()); return }
    setBusy(true)
    try {
      const out = await supportApi.arteloOrder<{ orderId: string; url: string | null; test: boolean }>({ action: 'create', id: thread.id, shopifyOrderId: o.shopifyOrderId, orderIds: picked, changes, address: a, email, instructions, test: isAdmin && test, idempotencyKey: pressKey })
      setDone(out)
      toast.success(`${out.test ? 'Test order' : 'Artelo order'} ${out.orderId} created`)
      onDone()
    } catch (e) { setErr((e as Error).message); toast.error((e as Error).message) }
    finally { setBusy(false); setConfirming(false) }
  }
  if (done) {
    return (
      <div className={formBox}>
        <div className="inline-flex items-center gap-1.5 text-emerald-700 font-medium"><Check className="w-3.5 h-3.5" />{done.test ? 'Test order' : 'Artelo order'} {done.orderId} created{done.test ? ' (not produced)' : ''}.</div>
        <div className="flex items-center gap-3">
          {done.url && <a href={done.url} target="_blank" rel="noopener noreferrer" className={linkCls}><img src="/artelo-icon.png" alt="" className="w-3.5 h-3.5 rounded-[3px]" />Open in Artelo</a>}
          <button onClick={onCancel} className="ml-auto text-off-black/45 hover:text-off-black">Done</button>
        </div>
      </div>
    )
  }
  return (
    <div className={formBox}>
      {!prep && !err && <div className="text-off-black/50 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the order from Artelo</div>}
      {prep && (
        <>
          <div className="text-off-black/70">New order <b>{prep.nextOrderId}</b> in Artelo, $0, the same design:</div>
          {prep.items.map(i => (
            <label key={i.orderId} className={`flex items-start gap-1.5 ${i.copyable ? 'cursor-pointer text-off-black/80' : 'text-off-black/40'}`} title={i.copyable ? `Design from ${i.designFrom}` : 'No approved render and no PDF named for this print in the Drive Orders folder. Build this one in Artelo.'}>
              <input type="checkbox" disabled={!i.copyable} checked={picked.includes(i.orderId)} onChange={e => setPicked(p => e.target.checked ? [...p, i.orderId] : p.filter(x => x !== i.orderId))} className="mt-0.5 accent-[#4600D6]" />
              <span>{i.label} <span className="text-off-black/45">· {i.productLabel}{i.copyable ? '' : ' · no design to copy'}</span>{i.copyable && i.designFrom && <span className="block text-[11px] text-off-black/45">Design: {i.designFrom}</span>}</span>
            </label>
          ))}
          {/* What each picked print is made as: the original unless the customer wants something new. */}
          {prep.items.filter(i => picked.includes(i.orderId)).map(i => {
            const c = changes[i.orderId] || { size: i.size || '', frame: i.frame || 'Unframed' }
            const changed = c.size !== i.size || c.frame !== (i.frame || 'Unframed')
            const setC = (k: 'size' | 'frame', v: string) => setChanges(prev => ({ ...prev, [i.orderId]: { ...c, [k]: v } }))
            return (
              <div key={`p-${i.orderId}`} className="pl-5 space-y-1">
                {prep.items.length > 1 && <div className="text-[11px] text-off-black/50">{i.label}</div>}
                <div className="grid grid-cols-2 gap-1.5">
                  <select className={field} value={c.size} onChange={e => setC('size', e.target.value)} aria-label="Size">
                    {!prep.sizes.some(s => s.value === c.size) && c.size && <option value={c.size}>{c.size.replace(/^x/, '')}</option>}
                    {prep.sizes.map(s => <option key={s.value} value={s.value}>{s.label}{s.value === i.size ? ' (original)' : ''}</option>)}
                  </select>
                  <select className={field} value={c.frame} onChange={e => setC('frame', e.target.value)} aria-label="Frame">
                    {!prep.frames.some(f => f.value === c.frame) && <option value={c.frame}>{c.frame}</option>}
                    {prep.frames.map(f => <option key={f.value} value={f.value}>{f.label}{f.value === (i.frame || 'Unframed') ? ' (original)' : ''}</option>)}
                  </select>
                </div>
                {changed && <div className="text-[11px] text-amber-700">Changed from the original. A different shape (8x10 vs 12x18 or 16x24) needs a design file in that size; the order stops if the file does not fit.</div>}
              </div>
            )
          })}
          <div className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Ship to</div>
          <PasteAddress onParsed={p => setA({ ...a, ...p })} />
          <input className={field} value={a.name} onChange={set('name')} placeholder="Name" />
          <input className={field} value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (for Artelo's shipping notice)" />
          <input className={field} value={a.address1} onChange={set('address1')} placeholder="Street" />
          <input className={field} value={a.address2} onChange={set('address2')} placeholder="Apt, suite (optional)" />
          <div className="grid grid-cols-[1fr_56px_72px] gap-1.5">
            <input className={field} value={a.city} onChange={set('city')} placeholder="City" />
            <input className={field} value={a.province} onChange={set('province')} placeholder="State" />
            <input className={field} value={a.zip} onChange={set('zip')} placeholder="ZIP" />
          </div>
          <div className="grid grid-cols-[56px_1fr] gap-1.5">
            <input className={field} value={a.country} onChange={set('country')} placeholder="US" />
            <input className={field} value={a.phone} onChange={set('phone')} placeholder="Phone (needed outside the US)" />
          </div>
          <input className={field} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Note for Artelo (optional), e.g. Replacement, frame arrived cracked" />
          {isAdmin && (
            <label className="flex items-center gap-1.5 cursor-pointer text-off-black/70" title="Artelo makes it with status Ignored: never printed, no charge">
              <input type="checkbox" checked={test} onChange={e => setTest(e.target.checked)} className="accent-[#4600D6]" />Test only (Artelo won't produce it)
            </label>
          )}
        </>
      )}
      {err && <div className="text-red-700">{err}</div>}
      {confirming && <div className="text-red-700 font-medium">{test ? 'Create a test order in Artelo?' : `Send ${picked.length} print${picked.length === 1 ? '' : 's'} to production in Artelo? Artelo charges for it.`}</div>}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="flex-1" />
        <button onClick={() => (confirming ? setConfirming(false) : onCancel())} className="px-2 py-1 text-xs text-off-black/50 hover:text-off-black">{confirming ? 'Back' : 'Cancel'}</button>
        <button onClick={create} disabled={busy || !prep || !picked.length} className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded text-white disabled:opacity-50 ${confirming ? 'bg-[#4600D6] hover:bg-[#3a00b3]' : 'bg-dark-fill hover:bg-off-black/85'}`}>{busy && <Loader2 className="w-3 h-3 animate-spin" />}{confirming ? (test ? 'Yes, create test order' : 'Yes, create it') : 'Create Artelo order'}</button>
      </div>
    </div>
  )
}

/**
 * Change a print's size or frame, before production: Shopify swaps the item,
 * the personalization goes into the order note, and any balance is invoiced.
 */
function ChangeItemForm({ o, thread, onDone, onCancel }: { o: CustomerOrder; thread: ThreadDetail; onDone: () => void; onCancel: () => void }) {
  type Item = { lineItemId: string; title: string; size: string; frame: string | null; sizes: string[]; frames: string[] }
  const [items, setItems] = useState<Item[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pick, setPick] = useState(0)
  const [size, setSize] = useState('')
  const [frame, setFrame] = useState('')
  const [busy, setBusy] = useState(false)
  // One key per attempt: a double click before the button disables is the same change.
  const [pressKey, setPressKey] = useState(newIdempotencyKey)
  useEffect(() => {
    supportApi.action<{ items: Item[] }>('changeItemPrep', { id: thread.id, shopifyOrderId: o.shopifyOrderId })
      .then(d => { setItems(d.items); if (d.items[0]) { setSize(d.items[0].size); setFrame(d.items[0].frame || '') } })
      .catch(e => setErr((e as Error).message))
  }, [o.shopifyOrderId, thread.id])
  const it = items?.[pick]
  const changed = it && (size !== it.size || (frame || '') !== (it.frame || ''))
  const go = async () => {
    if (!it) return
    setBusy(true)
    try {
      const out = await supportApi.action<{ number: string; now: string; invoiced: boolean; owed: number }>('changeItem', { id: thread.id, shopifyOrderId: o.shopifyOrderId, lineItemId: it.lineItemId, size, frame, idempotencyKey: pressKey })
      toast.success(`#${out.number} is now ${out.now}${out.invoiced ? `; invoice sent for $${out.owed.toFixed(2)}` : ''}`)
      onDone(); onCancel()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false); setPressKey(newIdempotencyKey()) }
  }
  return (
    <div className={formBox}>
      {err ? <div className="text-red-700">{err}</div> : !items ? <div className="text-off-black/50 inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading the order from Shopify</div> : !items.length ? <div className="text-off-black/50">No print on this order to change.</div> : (
        <>
          {items.length > 1 && (
            <select value={pick} onChange={e => { const i = Number(e.target.value); setPick(i); setSize(items[i].size); setFrame(items[i].frame || '') }} className={field}>
              {items.map((x, i) => <option key={x.lineItemId} value={i}>{x.title} ({[x.size, x.frame].filter(Boolean).join(' ')})</option>)}
            </select>
          )}
          <div className="text-off-black/60">Now {[it!.size, it!.frame].filter(Boolean).join(' ')}. Change to:</div>
          <div className="flex gap-1.5">
            <select value={size} onChange={e => setSize(e.target.value)} className={field}>{it!.sizes.map(x => <option key={x}>{x}</option>)}</select>
            {it!.frames.length > 0 && <select value={frame} onChange={e => setFrame(e.target.value)} className={field}>{it!.frames.map(x => <option key={x}>{x}</option>)}</select>}
          </div>
          <div className="text-[11px] text-off-black/50">Swaps the item on the Shopify order, copies the personalization into the order note, and emails Shopify's invoice if the new one costs more. Artelo follows Shopify.</div>
          <div className="flex items-center gap-2 justify-end">
            <button onClick={onCancel} className="text-off-black/60 px-2">Cancel</button>
            <button onClick={go} disabled={!changed || busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-dark-fill text-white font-medium disabled:opacity-40">{busy && <Loader2 className="w-3 h-3 animate-spin" />}Change it</button>
          </div>
        </>
      )}
    </div>
  )
}

function OrderActions({ o, thread, multiple, isAdmin, onInsert, onAttach, onChanged }: { o: CustomerOrder; thread: ThreadDetail; multiple: boolean; isAdmin: boolean; onInsert: (text: string) => void; onAttach: (m: Mockup) => void; onChanged: () => void }) {
  const [picking, setPicking] = useState(false)
  const [money, setMoney] = useState<null | 'refund' | 'cancel'>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editingAddress, setEditingAddress] = useState(false)
  const [reordering, setReordering] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [converting, setConverting] = useState<string | null>(null)
  const [pickingConvert, setPickingConvert] = useState(false)
  const { can } = useAuth()
  const [changing, setChanging] = useState(false)
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key)
    try { const msg = await fn(); if (msg) toast.success(msg); onChanged() }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(null) }
  }
  // Artelo's fulfillment first, the newest one: a reprint ships with fresh tracking.
  const tracking = [...o.tracking].reverse().find(t => t.fromArtelo && t.url) || [...o.tracking].reverse().find(t => t.url) || o.tracking[o.tracking.length - 1] || null
  const approval = o.items.find(it => it.approvalUrl)?.approvalUrl || null
  const editable = o.items.filter(it => it.status !== 'completed' && it.designStatus !== 'sent_to_production')
  const shipped = o.fulfillmentStatus === 'FULFILLED' || o.tracking.length > 0
  const first = (thread.customerName || '').split(/\s+/)[0] || ''
  return (
    <div>
      {multiple && <div className={heading}>#{o.number}{o.items[0] ? ` · ${o.items[0].race}` : ''}</div>}
      <div className="flex flex-col items-stretch gap-1.5">
        {tracking
          ? <ActionLink icon={Truck} title={`${tracking.company || 'Carrier'} ${tracking.number || ''}`} onClick={() => onInsert(tracking.url ? `Here's your tracking link: ${tracking.url}` : `Your ${tracking.company || ''} tracking number is ${tracking.number}.`.replace('  ', ' '))}>Insert {tracking.fromArtelo ? 'Artelo ' : ''}tracking link</ActionLink>
          : <span className="self-start inline-flex items-center gap-1.5 text-xs text-off-black/40"><Truck className="w-3.5 h-3.5" />No tracking from Artelo yet</span>}
        {o.mockups.length > 0 && (o.mockups.length === 1
          ? <ActionLink icon={ImageIcon} title={o.mockups[0].label} onClick={() => { onAttach(o.mockups[0]); toast.success('Mockup attached to the reply') }}>Attach mockup</ActionLink>
          : <ActionLink icon={ImageIcon} onClick={() => setPicking(v => !v)}>Attach mockup <span className="text-off-black/40 font-normal">({o.mockups.length})</span></ActionLink>)}
        {picking && o.mockups.length > 1 && (
          <div className="flex flex-wrap gap-1.5 pl-5">
            {o.mockups.map(m => (
              <button key={m.ref} onClick={() => { onAttach(m); toast.success(`${m.label} attached`) }} className="w-16 text-left group" title={`Attach ${m.label}`}>
                <span className="block w-16 h-16 rounded border border-border-gray bg-white overflow-hidden group-hover:border-[#4600D6]">
                  {m.thumbUrl ? <img src={m.thumbUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-5 h-5 m-auto mt-5 text-off-black/25" />}
                </span>
                <span className="block text-[10px] text-off-black/55 leading-tight mt-0.5 truncate">{m.label}</span>
              </button>
            ))}
          </div>
        )}
        {approval && <ActionLink icon={Link2} onClick={() => onInsert(`You can view your design options here: ${approval}`)}>Insert approval link</ActionLink>}
        {/* Only once it has shipped: a review is for someone holding the print. */}
        {shipped && (() => {
          const it = o.items[0]
          const review = reviewLinkFor(it?.race || o.lineItems[0]?.title, it?.type)
          const delivered = o.tracking.map(t => t.deliveredAt).filter(Boolean).sort().pop() || null
          const sent = o.tracking[o.tracking.length - 1]?.at
          const when = delivered ? `delivered ${new Date(delivered).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
            : sent ? `shipped ${Math.max(0, Math.floor((Date.now() - new Date(sent).getTime()) / 86400000))}d ago, no delivery scan` : 'shipped'
          const asked = thread.tags.includes('Review requested')
          if (!review) return <span className="self-start inline-flex items-center gap-1.5 text-xs text-off-black/40" title="Add it to src/lib/reviewLinks.ts"><Star className="w-3.5 h-3.5" />No Yotpo link for {it?.race || 'this product'}</span>
          return (
            <span className="self-start inline-flex items-baseline gap-1.5 flex-wrap">
              <ActionLink icon={Star} busy={busy === 'review'} title={`${review.name} review link. Only for a good experience, after they have the print.`} onClick={() => run('review', async () => {
                onInsert(reviewAsk(review.link))
                if (!asked) await supportApi.setTags(thread.id, [...thread.tags, 'Review requested'])
                return asked ? 'Review link added to the reply' : 'Review link added; tagged Review requested'
              })}>{asked ? 'Ask for a review again' : 'Ask for a review'}</ActionLink>
              <span className={`text-[11px] ${delivered ? 'text-emerald-700' : 'text-off-black/40'}`}>{when}</span>
            </span>
          )
        })()}
        {o.shopifyOrderId && !shipped && (editingAddress
          ? <AddressForm o={o} thread={thread} onDone={onChanged} onCancel={() => setEditingAddress(false)} />
          : <ActionLink icon={MapPin} onClick={() => setEditingAddress(true)} title={o.shipToLine || 'No address on file'}>Edit shipping address</ActionLink>)}
        {o.shopifyOrderId && !shipped && editable.length > 0 && editable.length === o.items.length && (changing
          ? <ChangeItemForm o={o} thread={thread} onDone={onChanged} onCancel={() => setChanging(false)} />
          : <ActionLink icon={Ruler} onClick={() => setChanging(true)} title="Before production only: swaps the item in Shopify, keeps the personalization in the order note, invoices any difference">Change size or frame</ActionLink>)}
        {editable[0] && (
          <ActionLink icon={Pencil} busy={busy === 'fix'} title="Before production only. After that it is a reprint." onClick={() => {
            const it = editable[0]
            const name = window.prompt(`Runner's name on #${o.number}`, it.runner)
            if (name === null) return
            const year = window.prompt('Race year', String(it.year))
            if (year === null) return
            run('fix', async () => { const out = await supportApi.action<{ what: string }>('fixPersonalization', { id: thread.id, orderId: it.orderId, runnerName: name, year: year || undefined }); return `Changed ${out.what}` })
          }}>Fix name or year</ActionLink>
        )}
        {o.items[0] && (
          <ActionLink icon={Plus} busy={busy === 'note'} onClick={() => {
            const text = window.prompt(`Note for fulfillment on #${o.number}`, first ? `${first} asked: ` : '')
            if (!text) return
            run('note', async () => { await supportApi.action('orderNote', { id: thread.id, orderId: o.items[0].orderId, text }); return 'Note left on the order' })
          }}>Note for fulfillment</ActionLink>
        )}
        {/* A runner who ran a race we do not carry: design it instead of refunding. */}
        {can('orders.render') && (() => {
          const convertible = o.items.filter(it => it.type === 'standard' && it.status !== 'completed')
          if (!convertible.length) return null
          const label = (it: typeof convertible[number]) => `${it.race || 'Print'}${it.year ? ` ${it.year}` : ''}, ${it.runner || 'runner'}`
          return (
            <>
              <ActionLink icon={Palette} title="A runner who ran a race we do not carry: design it instead of refunding. Shopify is not changed."
                onClick={() => convertible.length === 1 ? setConverting(convertible[0].orderId) : setPickingConvert(v => !v)}>Convert to custom order</ActionLink>
              {pickingConvert && convertible.length > 1 && (
                <div className="flex flex-col items-start gap-1 pl-5">
                  {convertible.map(it => (
                    <button key={it.orderId} onClick={() => { setPickingConvert(false); setConverting(it.orderId) }} className="text-xs text-left text-off-black/70 hover:text-[#4600D6]">{label(it)}</button>
                  ))}
                </div>
              )}
              {converting && (() => {
                const it = convertible.find(x => x.orderId === converting)
                if (!it) return null
                return (
                  <ConvertToCustomModal
                    order={{ id: it.orderId, displayOrderNumber: `#${o.number}`, runnerName: it.runner, effectiveRaceName: it.race, effectiveRaceYear: it.year }}
                    onClose={() => setConverting(null)}
                    onDone={msg => { setConverting(null); toast.success(msg); onChanged() }}
                  />
                )
              })()}
            </>
          )
        })()}
        {/* Damaged in shipping: Artelo replaces it free once its support has the photos. */}
        {o.shopifyOrderId && o.items.length > 0 && shipped && (claiming
          ? <DamageClaimForm o={o} thread={thread} onDone={onChanged} onCancel={() => setClaiming(false)} />
          : <ActionLink icon={MessageSquareWarning} onClick={() => setClaiming(true)} title="Emails the customer's photos to Artelo support. Artelo files a report and makes a free replacement.">Damaged: claim with Artelo</ActionLink>)}
        {/* A reprint or replacement: the same print to this customer, built in Artelo from here. */}
        {o.shopifyOrderId && o.items.length > 0 && (reordering
          ? <ArteloOrderForm o={o} thread={thread} isAdmin={isAdmin} onDone={onChanged} onCancel={() => setReordering(false)} />
          : <ActionLink icon={Repeat} onClick={() => setReordering(true)} title="The same print to this customer: a reprint or a replacement. Artelo bills us for it, so damage goes through the claim instead.">New Artelo order</ActionLink>)}
        {o.shopifyOrderId && o.financialStatus !== 'REFUNDED' && (money === 'refund'
          ? <RefundForm o={o} thread={thread} onDone={onChanged} onCancel={() => setMoney(null)} />
          : <ActionLink icon={Receipt} onClick={() => setMoney('refund')} title="All or part, to the card they paid with. Over $150 is Matt's call.">Refund</ActionLink>)}
        {/* Cancel only before anything is made or shipped. */}
        {o.shopifyOrderId && !shipped && !o.items.some(it => it.status === 'completed' || it.designStatus === 'sent_to_production') && o.financialStatus !== 'REFUNDED' && (money === 'cancel'
          ? <CancelForm o={o} thread={thread} onDone={onChanged} onCancel={() => setMoney(null)} />
          : <ActionLink icon={Ban} onClick={() => setMoney('cancel')} title="Only after the customer says yes, and only before production">Cancel and refund</ActionLink>)}
      </div>
    </div>
  )
}

/** Check a code the customer pasted: one line, the answer under it. */
function CodeCheck() {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [lookup, setLookup] = useState<CodeLookup | null>(null)
  const check = async () => {
    const c = code.trim()
    if (!c) return
    setBusy(true)
    try { setLookup(await supportApi.action<CodeLookup>('lookupCode', { code: c })) }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  const ok = lookup?.found && /^Valid/.test(lookup.verdict)
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs">
        <Search className="w-3.5 h-3.5 text-off-black/35 shrink-0" />
        <input value={code} onChange={e => { setCode(e.target.value); setLookup(null) }} onKeyDown={e => { if (e.key === 'Enter') check() }} placeholder="Check a discount code" className="flex-1 min-w-0 bg-transparent border-b border-dashed border-off-black/20 focus:border-off-black/50 focus:outline-none py-0.5 placeholder:text-off-black/35" />
        {code && <button onClick={check} disabled={busy} className="text-[#4600D6] font-medium hover:underline underline-offset-2">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Check'}</button>}
        {lookup && <button onClick={() => { setLookup(null); setCode('') }} className="text-off-black/35 hover:text-off-black"><X className="w-3 h-3" /></button>}
      </div>
      {lookup && (
        <div className={`mt-1 ml-5 text-[11px] ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
          {lookup.verdict}
          {lookup.found && <span className="text-off-black/50"> {lookup.value}{lookup.fromKlaviyo ? ' · Klaviyo' : ''}</span>}
        </div>
      )}
    </div>
  )
}

export default function Actions({ thread, onInsert, onAttach, onChanged }: { thread: ThreadDetail; onInsert: (text: string) => void; onAttach: (m: Mockup) => void; onChanged: () => void }) {
  const { isAdmin } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)
  const first = (thread.customerName || '').trim().split(/\s+/)[0] || ''
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key)
    try { const msg = await fn(); if (msg) toast.success(msg); onChanged() }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(null) }
  }
  // Replacements exist only in Artelo: the actions work on the orders customers placed.
  const orders = thread.context.orders.filter(o => !o.replacement)
  const [codeOpen, setCodeOpen] = useState(false)
  const [pct, setPct] = useState('15')
  // The code's prefix: the first name by default, anything the rep types instead (VIP, BOSTON).
  const defaultPrefix = (first || 'TRACKSTAR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
  const [prefix, setPrefix] = useState(defaultPrefix)
  useEffect(() => { setPrefix(defaultPrefix) }, [thread.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const cleanPrefix = prefix.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20)
  const pctNum = Number(pct)
  // Over 25% is an admin's; the server holds the same line.
  const pctMax = isAdmin ? 100 : 25
  const pctOk = Number.isInteger(pctNum) && pctNum >= 1 && pctNum <= pctMax && cleanPrefix.length !== 1
  const createCode = () => {
    if (!pctOk) return
    if (pctNum >= 50 && !window.confirm(`A ${pctNum}% code? That is a big one.`)) return
    run('code', async () => {
      const out = await supportApi.action<{ code: string; percent: number }>('discount15', { id: thread.id, percent: pctNum, prefix: cleanPrefix || defaultPrefix })
      onInsert(`Use code ${out.code} for ${out.percent}% off your next print (good for 30 days).`)
      setCodeOpen(false)
      return `${out.code} created (one use) and added to the reply`
    })
  }
  return (
    <div className="space-y-4">
      {orders.map(o => <OrderActions key={`${o.source}-${o.number}`} o={o} thread={thread} multiple={orders.length > 1} isAdmin={isAdmin} onInsert={onInsert} onAttach={onAttach} onChanged={onChanged} />)}
      <div>
        {orders.length > 1 && <div className={heading}>Customer</div>}
        <div className="flex flex-col items-stretch gap-1.5">
          {codeOpen ? (
            <div className={formBox}>
              <div className="flex items-center gap-1.5">
                <input value={pct} onChange={e => setPct(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" className={`${field} w-14 text-right`} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') createCode() }} />
                <span className="text-off-black/60">% off</span>
                {[10, 15, 20].map(n => <button key={n} onClick={() => setPct(String(n))} className={`px-1.5 py-0.5 rounded border ${pct === String(n) ? 'border-[#4600D6] text-[#4600D6]' : 'border-border-gray text-off-black/55 hover:text-off-black'}`}>{n}%</button>)}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-off-black/60 shrink-0">Code</span>
                <input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase().slice(0, 20))} onKeyDown={e => { if (e.key === 'Enter') createCode() }}
                  className={`${field} w-28 font-mono uppercase`} title="The start of the code. Their first name by default; type your own (VIP, BOSTON)." />
                <span className="font-mono text-off-black/60">-{pctNum || '?'}</span>
                {cleanPrefix !== defaultPrefix && <button onClick={() => setPrefix(defaultPrefix)} className="text-[11px] text-off-black/45 hover:text-off-black">Use {defaultPrefix}</button>}
              </div>
              <div className="text-[11px] text-off-black/45">One use, 30 days: {cleanPrefix || defaultPrefix}-{pctNum || '?'}. Added to your reply.</div>
              {pctNum > pctMax && <div className="text-red-700">Over {pctMax}% is Matt's call. Slack Matt instead.</div>}
              <div className="flex items-center gap-2">
                <span className="flex-1" />
                <button onClick={() => setCodeOpen(false)} className="px-2 py-1 text-xs text-off-black/50 hover:text-off-black">Cancel</button>
                <button onClick={createCode} disabled={busy === 'code' || !pctOk} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-dark-fill text-white hover:bg-off-black/85 disabled:opacity-50">{busy === 'code' && <Loader2 className="w-3 h-3 animate-spin" />}Create {pctOk ? `${pctNum}% ` : ''}code</button>
              </div>
            </div>
          ) : (
            <ActionLink icon={BadgePercent} title="One use, 30 days, named after them" onClick={() => setCodeOpen(true)}>Create discount code for {first || 'them'}</ActionLink>
          )}
          <ActionLink icon={MessageSquareWarning} busy={busy === 'slack'} title="Posts to Slack with a link to this thread, and marks it escalated" onClick={() => {
            const text = window.prompt('What should Matt know? (goes to Slack with a link to this thread)', '')
            if (text === null) return
            run('slack', async () => { await supportApi.action('slackMatt', { id: thread.id, text }); return 'Matt pinged in Slack, thread escalated' })
          }}>Slack Matt</ActionLink>
        </div>
      </div>
      <CodeCheck />
    </div>
  )
}
