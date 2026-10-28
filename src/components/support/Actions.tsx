import { useEffect, useState } from 'react'
import { Ban, BadgePercent, Palette, Repeat, Check, Copy, Image as ImageIcon, Link2, Loader2, MapPin, MessageSquareWarning, Pencil, Plus, Receipt, Ruler, Search, Star, Truck, X } from 'lucide-react'
import { reviewAsk, reviewLinkFor } from '@/lib/reviewLinks'
import { toast } from 'sonner'
import { newIdempotencyKey, supportApi } from '@/lib/supportApi'
import { useAuth } from '@/lib/auth'
import ConvertToCustomModal from '@/components/orders/ConvertToCustomModal'
import ActionModal from '@/components/ActionModal'
import { parseAddress } from '@/lib/parseAddress'
import { fieldLabel, modalCancel, modalChip, modalDanger, modalInput, modalPrimary } from '@/lib/ui'
import type { Address, CodeLookup, CustomerOrder, Mockup, ThreadDetail } from '@/types/support'

/**
 * The Actions list, in the dashboard's own style: purple text links with an
 * icon, one per line, under a small grey heading. Anything that needs typing
 * or several steps opens in an ActionModal, drawn like the global search.
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
/** Link-style buttons inside a modal ("Copy again", "Open in Artelo"). */
const modalLink = 'inline-flex items-center gap-1.5 text-sm font-medium text-[#4600D6] hover:underline underline-offset-2'
const note = 'rounded-xl bg-subtle-gray border border-border-gray p-3 text-off-black/70'
const warn = 'rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-800'
const bad = 'text-red-700'
const doneLine = 'inline-flex items-center gap-1.5 text-emerald-700 font-medium'
const Spin = () => <Loader2 className="w-4 h-4 animate-spin" />
const Loading = ({ children }: { children: React.ReactNode }) => <div className="text-off-black/50 inline-flex items-center gap-2"><Spin />{children}</div>
const ArteloIcon = () => <img src="/artelo-icon.png" alt="" className="w-4 h-4 rounded-[3px]" />

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <label className={`block min-w-0 ${className || ''}`}><span className={fieldLabel}>{label}</span>{children}</label>
}

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
      className={`${modalInput} resize-none bg-subtle-gray`} />
  )
}

/** The ship-to fields, shared by Edit shipping address and New Artelo order. */
function AddressFields({ a, setA, email, setEmail, phoneLabel = 'Phone (optional)' }: { a: Address; setA: (a: Address) => void; email?: string; setEmail?: (v: string) => void; phoneLabel?: string }) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setA({ ...a, [k]: e.target.value })
  return (
    <div className="space-y-3">
      <PasteAddress onParsed={p => setA({ ...a, ...p })} />
      <Field label="Name"><input className={modalInput} value={a.name} onChange={set('name')} /></Field>
      {setEmail && <Field label="Email (for Artelo's shipping notice)"><input className={modalInput} value={email} onChange={e => setEmail(e.target.value)} /></Field>}
      <Field label="Street"><input className={modalInput} value={a.address1} onChange={set('address1')} /></Field>
      <Field label="Apt, suite (optional)"><input className={modalInput} value={a.address2} onChange={set('address2')} /></Field>
      <div className="grid grid-cols-[1fr_88px_112px] gap-3">
        <Field label="City"><input className={modalInput} value={a.city} onChange={set('city')} /></Field>
        <Field label="State"><input className={modalInput} value={a.province} onChange={set('province')} /></Field>
        <Field label="ZIP"><input className={modalInput} value={a.zip} onChange={set('zip')} /></Field>
      </div>
      <div className="grid grid-cols-[88px_1fr] gap-3">
        <Field label="Country"><input className={modalInput} value={a.country} onChange={set('country')} placeholder="US" /></Field>
        <Field label={phoneLabel}><input className={modalInput} value={a.phone} onChange={set('phone')} /></Field>
      </div>
    </div>
  )
}

const blankAddress = (thread: ThreadDetail): Address => ({ name: thread.customerName || '', address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' })

type FormProps = { o: CustomerOrder; thread: ThreadDetail; onDone: () => void; onCancel: () => void }

/** The ship-to form, prefilled from Shopify (or Artelo's copy), then the hand-off to Artelo. */
function AddressForm({ o, thread, onDone, onCancel }: FormProps) {
  const [a, setA] = useState<Address>(o.shipTo || o.arteloAddress || blankAddress(thread))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<{ pasted: string; arteloUrl: string | null; taxNote?: string | null } | null>(null)
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
      <ActionModal icon={MapPin} title="Shipping address" sub={`#${o.number}`} onClose={onCancel}
        footer={<button onClick={onCancel} className={modalPrimary}>Done</button>}>
        <div className={doneLine}><Check className="w-4 h-4" />Changed in Shopify. Now paste it into Artelo:</div>
        <pre className={`${note} whitespace-pre-wrap font-sans`}>{saved.pasted}</pre>
        {saved.taxNote && <div className={warn}>{saved.taxNote}</div>}
        <div className="flex items-center gap-5">
          <button onClick={() => { navigator.clipboard.writeText(saved.pasted).then(() => toast.success('Copied')).catch(() => {}) }} className={modalLink}><Copy className="w-4 h-4" />Copy again</button>
          {saved.arteloUrl && <a href={saved.arteloUrl} target="_blank" rel="noopener noreferrer" className={modalLink}><ArteloIcon />Open in Artelo</a>}
        </div>
      </ActionModal>
    )
  }
  return (
    <ActionModal icon={MapPin} title="Edit shipping address" sub={`#${o.number}`} onClose={onCancel} busy={busy}
      hint="Saves to Shopify; you paste it into Artelo."
      footer={<>
        <button onClick={onCancel} disabled={busy} className={modalCancel}>Cancel</button>
        <button onClick={save} disabled={busy} className={modalPrimary}>{busy && <Spin />}Save</button>
      </>}>
      <AddressFields a={a} setA={setA} />
    </ActionModal>
  )
}

type Refundable = { number: string; availableCents: number; refundedCents: number; cancelled: boolean; fulfillment: string | null; limitCents: number; discountLimitPercent?: number; isAdmin: boolean }
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

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
function RefundForm({ o, thread, onDone, onCancel }: FormProps) {
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
    // Two clicks in the modal, not a browser dialog: a browser told to block dialogs answers "no" without showing one.
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
    <ActionModal icon={Receipt} title="Refund" sub={`#${o.number}`} onClose={onCancel} busy={busy}
      hint="No Shopify email; your reply tells them."
      footer={info && <>
        <button onClick={() => (confirming ? setConfirming(false) : onCancel())} disabled={busy} className={modalCancel}>{confirming ? 'Back' : 'Cancel'}</button>
        <button onClick={save} disabled={busy || cents <= 0 || !reason.trim() || over || tooMuch} className={confirming ? modalDanger : modalPrimary}>{busy && <Spin />}{confirming ? `Yes, refund ${dollars(cents)}` : `Refund ${cents > 0 ? dollars(cents) : ''}`}</button>
      </>}>
      {err ? <div className={bad}>{err}</div> : !info ? <Loading>Reading the order from Shopify</Loading> : (
        <>
          <div className="text-off-black/60">{dollars(info.availableCents)} left to refund{info.refundedCents ? ` (${dollars(info.refundedCents)} already refunded)` : ''}.</div>
          {/* Quick amounts: a share of what the order was paid (never more than is left), or type any amount. */}
          <Field label="Amount">
            <div className="flex flex-wrap items-center gap-2">
              {[10, 15, 100].map(pct => {
                const c = Math.min(info.availableCents, Math.round(((info.availableCents + (info.refundedCents || 0)) * pct) / 100))
                const value = (c / 100).toFixed(2)
                return <button key={pct} type="button" onClick={() => setAmount(value)} title={dollars(c)} className={modalChip(amount === value)}>{pct}%</button>
              })}
              <div className="relative w-32 ml-1">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-off-black/45">$</span>
                <input value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.00" className={`${modalInput} pl-7`} autoFocus />
              </div>
            </div>
          </Field>
          <Field label="Why (goes on the refund)"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Buy 2 promo missed" className={modalInput} /></Field>
          {over && <div className={bad}>Over {dollars(info.limitCents)} on one order{info.refundedCents ? ', counting what was already refunded,' : ''} is Matt's call. Slack Matt instead.</div>}
          {tooMuch && <div className={bad}>That is more than is left.</div>}
          {failed && <div className={bad}>{failed}</div>}
          {confirming && <div className={`${bad} font-medium`}>Refund {dollars(cents)} to the card they paid with? This cannot be undone.</div>}
        </>
      )}
    </ActionModal>
  )
}

/** Cancel and refund in full (scenario 14). Only with the customer's yes, only before production. */
function CancelForm({ o, thread, onDone, onCancel }: FormProps) {
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
      <ActionModal icon={Ban} title="Cancelled" sub={`#${o.number}`} onClose={onCancel}
        footer={<button onClick={onCancel} className={modalPrimary}>Done</button>}>
        <div className={doneLine}><Check className="w-4 h-4" />Cancelled in Shopify, {done.display} refunded, off the fulfillment queue.</div>
        <div className={warn}>Now cancel it in Artelo too, or it stays there.</div>
        {done.arteloUrl && <a href={done.arteloUrl} target="_blank" rel="noopener noreferrer" className={modalLink}><ArteloIcon />Open in Artelo</a>}
      </ActionModal>
    )
  }
  return (
    <ActionModal icon={Ban} title="Cancel and refund" sub={`#${o.number}`} onClose={onCancel} busy={busy}
      hint="Only with the customer's yes, only before production."
      footer={info && <>
        <button onClick={() => (confirming ? setConfirming(false) : onCancel())} disabled={busy} className={modalCancel}>Back</button>
        <button onClick={save} disabled={busy || !yes || over} className={modalDanger}>{busy && <Spin />}{busy ? 'Cancelling in Shopify' : confirming ? `Yes, cancel and refund ${dollars(info.availableCents)}` : `Cancel and refund ${dollars(info.availableCents)}`}</button>
      </>}>
      {err ? <div className={bad}>{err}</div> : !info ? <Loading>Reading the order from Shopify</Loading> : (
        <>
          <div className={note}>Cancels #{o.number} in Shopify and refunds {dollars(info.availableCents)}. They reorder if they want something different.</div>
          <Field label="Why"><input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Wrong frame, reordering" className={modalInput} autoFocus /></Field>
          <label className="flex items-center gap-2 cursor-pointer text-off-black/80">
            <input type="checkbox" checked={yes} onChange={e => setYes(e.target.checked)} className="w-4 h-4 accent-[#4600D6]" />
            The customer said yes to cancelling
          </label>
          {over && <div className={bad}>Over {dollars(info.limitCents)} is Matt's call. Slack Matt instead.</div>}
          {failed && <div className={bad}>{failed}</div>}
          {confirming && <div className={`${bad} font-medium`}>Cancel #{o.number} and refund {dollars(info.availableCents)}? This cannot be undone.</div>}
        </>
      )}
    </ActionModal>
  )
}

type Choice = { value: string; label: string }
type ClaimPrep = { number: string; arteloOrderId: string | null; to: string; photos: { messageId: string; index: number; filename: string; at: string }[] }

/**
 * Damaged in shipping: the customer's photos to Artelo support, who file a
 * report and make a free "-R" replacement (a New Artelo order is billed).
 * Their replacement then shows under Orders on its own.
 */
function DamageClaimForm({ o, thread, onDone, onCancel }: FormProps) {
  const [prep, setPrep] = useState<ClaimPrep | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [text, setText] = useState('')
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
      const out = await supportApi.arteloOrder<{ photos: number }>({ action: 'claim', id: thread.id, shopifyOrderId: o.shopifyOrderId, photos, note: text, idempotencyKey: pressKey })
      setSent(out.photos)
      toast.success(`Damage claim sent to Artelo support with ${out.photos} photo${out.photos === 1 ? '' : 's'}`)
      onDone()
    } catch (e) { setErr((e as Error).message); toast.error((e as Error).message) }
    finally { setBusy(false); setConfirming(false) }
  }
  if (sent != null) {
    return (
      <ActionModal icon={MessageSquareWarning} title="Damage claim sent" sub={`#${o.number}`} onClose={onCancel}
        footer={<button onClick={onCancel} className={modalPrimary}>Done</button>}>
        <div className={doneLine}><Check className="w-4 h-4" />Claim sent to {prep?.to} with {sent} photo{sent === 1 ? '' : 's'}.</div>
        <div className="text-off-black/60">Their answer comes into Support as its own conversation. The free replacement shows under Orders once Artelo makes it.</div>
      </ActionModal>
    )
  }
  return (
    <ActionModal icon={MessageSquareWarning} title="Damaged: claim with Artelo" sub={`#${o.number}`} onClose={onCancel} busy={busy}
      hint={confirming ? <span className={`${bad} font-medium`}>Send {picked.length} photo{picked.length === 1 ? '' : 's'} to Artelo support?</span> : undefined}
      footer={<>
        <button onClick={() => (confirming ? setConfirming(false) : onCancel())} disabled={busy} className={modalCancel}>{confirming ? 'Back' : 'Cancel'}</button>
        {prep && <button onClick={send} disabled={busy || !picked.length || !text.trim()} className={modalPrimary}>{busy && <Spin />}{confirming ? 'Yes, send it' : 'Send claim to Artelo'}</button>}
      </>}>
      {!prep && !err && <Loading>Finding the customer's photos</Loading>}
      {prep && (
        <>
          <div className={note}>Emails the photos to <b>{prep.to}</b> from the support inbox. Artelo files a report and makes a free replacement of #{prep.number}.</div>
          {prep.photos.length === 0
            ? <div className={warn}>No photos from the customer in this conversation yet. Ask them for photos of the damage and the box first.</div>
            : (
              <Field label="Photos to send">
                <div className="grid grid-cols-4 gap-2">
                  {prep.photos.map(p => {
                    const on = picked.includes(key(p))
                    return (
                      <button key={key(p)} type="button" onClick={() => setPicked(prev => on ? prev.filter(x => x !== key(p)) : [...prev, key(p)])} title={p.filename}
                        className={`relative aspect-square rounded-xl border-2 overflow-hidden bg-white ${on ? 'border-[#4600D6]' : 'border-transparent opacity-50 hover:opacity-80'}`}>
                        <img src={`/api/support/attachment?message=${encodeURIComponent(p.messageId)}&i=${p.index}`} alt={p.filename} className="w-full h-full object-cover" />
                        {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#4600D6] text-white flex items-center justify-center"><Check className="w-3.5 h-3.5" /></span>}
                      </button>
                    )
                  })}
                </div>
              </Field>
            )}
          <Field label="What is damaged"><textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="e.g. Frame cracked at the corner, glass shattered" className={modalInput} /></Field>
        </>
      )}
      {err && <div className={bad}>{err}</div>}
    </ActionModal>
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
function ArteloOrderForm({ o, thread, isAdmin, onDone, onCancel }: FormProps & { isAdmin: boolean }) {
  const [prep, setPrep] = useState<ReorderPrep | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  // Size and frame per print, starting as the original; a customer may want something new on the replacement.
  const [changes, setChanges] = useState<Record<string, { size: string; frame: string }>>({})
  // A new design file per print, for when the old one had a mistake.
  const [files, setFiles] = useState<Record<string, { ref: string; name: string }>>({})
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const uploadFor = async (orderId: string, f: File | undefined) => {
    if (!f) return
    if (!/^(application\/pdf|image\/(png|jpeg))$/.test(f.type)) { toast.error('A design file is a PDF, PNG or JPG'); return }
    setUploadingFor(orderId)
    try {
      const slot = await supportApi.uploadSlot(f.name, f.type, f.size)
      const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.type, 'x-upsert': 'false' }, body: f })
      if (!put.ok) throw new Error(`${f.name} did not upload`)
      setFiles(prev => ({ ...prev, [orderId]: { ref: slot.ref, name: slot.filename } }))
      setPicked(p => p.includes(orderId) ? p : [...p, orderId])
    } catch (e) { toast.error((e as Error).message) }
    finally { setUploadingFor(null) }
  }
  const [a, setA] = useState<Address>(o.shipTo || o.arteloAddress || blankAddress(thread))
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
  const create = async () => {
    if (!confirming) { setConfirming(true); setPressKey(newIdempotencyKey()); return }
    setBusy(true)
    try {
      const out = await supportApi.arteloOrder<{ orderId: string; url: string | null; test: boolean }>({ action: 'create', id: thread.id, shopifyOrderId: o.shopifyOrderId, orderIds: picked, changes, files: Object.fromEntries(Object.entries(files).filter(([id]) => picked.includes(id)).map(([id, f]) => [id, f.ref])), address: a, email, instructions, test: isAdmin && test, idempotencyKey: pressKey })
      setDone(out)
      toast.success(`${out.test ? 'Test order' : 'Artelo order'} ${out.orderId} created`)
      onDone()
    } catch (e) { setErr((e as Error).message); toast.error((e as Error).message) }
    finally { setBusy(false); setConfirming(false) }
  }
  if (done) {
    return (
      <ActionModal icon={Repeat} title="Artelo order created" sub={`#${o.number}`} onClose={onCancel}
        footer={<button onClick={onCancel} className={modalPrimary}>Done</button>}>
        <div className={doneLine}><Check className="w-4 h-4" />{done.test ? 'Test order' : 'Artelo order'} {done.orderId} created{done.test ? ' (not produced)' : ''}.</div>
        {done.url && <a href={done.url} target="_blank" rel="noopener noreferrer" className={modalLink}><ArteloIcon />Open in Artelo</a>}
      </ActionModal>
    )
  }
  return (
    <ActionModal icon={Repeat} title="New Artelo order" sub={`#${o.number}`} onClose={onCancel} busy={busy} size="lg"
      hint={confirming ? <span className={`${bad} font-medium`}>{test ? 'Create a test order in Artelo?' : `Send ${picked.length} print${picked.length === 1 ? '' : 's'} to production? Artelo charges for it.`}</span> : 'A reprint or replacement, $0 to the customer.'}
      footer={<>
        <button onClick={() => (confirming ? setConfirming(false) : onCancel())} disabled={busy} className={modalCancel}>{confirming ? 'Back' : 'Cancel'}</button>
        <button onClick={create} disabled={busy || !prep || !picked.length} className={modalPrimary}>{busy && <Spin />}{confirming ? (test ? 'Yes, create test order' : 'Yes, create it') : 'Create Artelo order'}</button>
      </>}>
      {!prep && !err && <Loading>Reading the order from Artelo</Loading>}
      {prep && (
        <>
          <div className="text-off-black/70">New order <b>{prep.nextOrderId}</b> in Artelo, $0, the same design:</div>
          <div className="space-y-3">
            {prep.items.map(i => {
              const on = picked.includes(i.orderId)
              const c = changes[i.orderId] || { size: i.size || '', frame: i.frame || 'Unframed' }
              const changed = c.size !== i.size || c.frame !== (i.frame || 'Unframed')
              const setC = (k: 'size' | 'frame', v: string) => setChanges(prev => ({ ...prev, [i.orderId]: { ...c, [k]: v } }))
              return (
                <div key={i.orderId} className="rounded-xl border border-border-gray p-3 space-y-2.5">
                  <label className={`flex items-start gap-2.5 ${i.copyable || files[i.orderId] ? 'cursor-pointer text-off-black' : 'text-off-black/40'}`} title={i.copyable ? `Design from ${i.designFrom}` : 'No approved render and no PDF named for this print in the Drive Orders folder. Upload a new file, or build this one in Artelo.'}>
                    <input type="checkbox" disabled={!i.copyable && !files[i.orderId]} checked={on} onChange={e => setPicked(p => e.target.checked ? [...p, i.orderId] : p.filter(x => x !== i.orderId))} className="mt-0.5 w-4 h-4 accent-[#4600D6]" />
                    <span className="min-w-0">
                      <span className="font-medium">{i.label}</span> <span className="text-off-black/45">· {i.productLabel}{i.copyable || files[i.orderId] ? '' : ' · no design to copy'}</span>
                      {files[i.orderId]
                        ? <span className="block text-xs text-[#4600D6]">Design: new file {files[i.orderId].name}</span>
                        : i.copyable && i.designFrom && <span className="block text-xs text-off-black/45">Design: {i.designFrom}</span>}
                    </span>
                  </label>
                  <div className="pl-6 flex items-center gap-4 text-xs">
                    {uploadingFor === i.orderId
                      ? <span className="inline-flex items-center gap-1 text-off-black/50"><Loader2 className="w-3 h-3 animate-spin" />Uploading</span>
                      : (
                        <label className="cursor-pointer font-medium text-[#4600D6] hover:underline underline-offset-2">
                          {files[i.orderId] ? 'Use a different file' : 'Use a new design file'}
                          <input type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={e => { void uploadFor(i.orderId, e.target.files?.[0]); e.target.value = '' }} />
                        </label>
                      )}
                    {files[i.orderId] && <button type="button" onClick={() => setFiles(({ [i.orderId]: _gone, ...rest }) => rest)} className="text-off-black/45 hover:text-off-black">Keep the original</button>}
                  </div>
                  {/* What the print is made as: the original unless the customer wants something new. */}
                  {on && (
                    <div className="pl-6 space-y-2">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Size">
                          <select className={modalInput} value={c.size} onChange={e => setC('size', e.target.value)}>
                            {!prep.sizes.some(s => s.value === c.size) && c.size && <option value={c.size}>{c.size.replace(/^x/, '')}</option>}
                            {prep.sizes.map(s => <option key={s.value} value={s.value}>{s.label}{s.value === i.size ? ' (original)' : ''}</option>)}
                          </select>
                        </Field>
                        <Field label="Frame">
                          <select className={modalInput} value={c.frame} onChange={e => setC('frame', e.target.value)}>
                            {!prep.frames.some(f => f.value === c.frame) && <option value={c.frame}>{c.frame}</option>}
                            {prep.frames.map(f => <option key={f.value} value={f.value}>{f.label}{f.value === (i.frame || 'Unframed') ? ' (original)' : ''}</option>)}
                          </select>
                        </Field>
                      </div>
                      {changed && <div className="text-xs text-amber-700">Changed from the original. A different shape (8x10 vs 12x18 or 16x24) needs a design file in that size; the order stops if the file does not fit.</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="pt-1 text-sm font-semibold text-off-black">Ship to</div>
          <AddressFields a={a} setA={setA} email={email} setEmail={setEmail} phoneLabel="Phone (needed outside the US)" />
          <Field label="Note for Artelo (optional)"><input className={modalInput} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="e.g. Replacement, frame arrived cracked" /></Field>
          {isAdmin && (
            <label className="flex items-center gap-2 cursor-pointer text-off-black/70" title="Artelo makes it with status Ignored: never printed, no charge">
              <input type="checkbox" checked={test} onChange={e => setTest(e.target.checked)} className="w-4 h-4 accent-[#4600D6]" />Test only (Artelo won't produce it)
            </label>
          )}
        </>
      )}
      {err && <div className={bad}>{err}</div>}
    </ActionModal>
  )
}

/**
 * Change a print's size or frame, before production: Shopify swaps the item,
 * the personalization goes into the order note, and any balance is invoiced.
 */
function ChangeItemForm({ o, thread, onDone, onCancel }: FormProps) {
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
    <ActionModal icon={Ruler} title="Change size or frame" sub={`#${o.number}`} onClose={onCancel} busy={busy}
      hint="Artelo follows Shopify."
      footer={<>
        <button onClick={onCancel} disabled={busy} className={modalCancel}>Cancel</button>
        {it && <button onClick={go} disabled={!changed || busy} className={modalPrimary}>{busy && <Spin />}Change it</button>}
      </>}>
      {err ? <div className={bad}>{err}</div> : !items ? <Loading>Reading the order from Shopify</Loading> : !items.length ? <div className="text-off-black/50">No print on this order to change.</div> : (
        <>
          {items.length > 1 && (
            <Field label="Print">
              <select value={pick} onChange={e => { const i = Number(e.target.value); setPick(i); setSize(items[i].size); setFrame(items[i].frame || '') }} className={modalInput}>
                {items.map((x, i) => <option key={x.lineItemId} value={i}>{x.title} ({[x.size, x.frame].filter(Boolean).join(' ')})</option>)}
              </select>
            </Field>
          )}
          <div className="text-off-black/60">Now {[it!.size, it!.frame].filter(Boolean).join(' ')}. Change to:</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Size"><select value={size} onChange={e => setSize(e.target.value)} className={modalInput}>{it!.sizes.map(x => <option key={x}>{x}</option>)}</select></Field>
            {it!.frames.length > 0 && <Field label="Frame"><select value={frame} onChange={e => setFrame(e.target.value)} className={modalInput}>{it!.frames.map(x => <option key={x}>{x}</option>)}</select></Field>}
          </div>
          <div className={note}>Swaps the item on the Shopify order, copies the personalization into the order note, and emails Shopify's invoice if the new one costs more.</div>
        </>
      )}
    </ActionModal>
  )
}

/** Fix the runner's name or the race year, before production. */
function FixPersonalizationForm({ o, thread, item, onDone, onCancel }: FormProps & { item: CustomerOrder['items'][number] }) {
  const [name, setName] = useState(item.runner || '')
  const [year, setYear] = useState(item.year ? String(item.year) : '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const out = await supportApi.action<{ what: string }>('fixPersonalization', { id: thread.id, orderId: item.orderId, runnerName: name, year: year || undefined })
      toast.success(`Changed ${out.what}`)
      onDone(); onCancel()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <ActionModal icon={Pencil} title="Fix name or year" sub={`#${o.number}`} onClose={onCancel} busy={busy}
      hint="Before production only. After that it is a reprint."
      footer={<>
        <button onClick={onCancel} disabled={busy} className={modalCancel}>Cancel</button>
        <button onClick={save} disabled={busy || !name.trim()} className={modalPrimary}>{busy && <Spin />}Save</button>
      </>}>
      <Field label="Runner's name"><input value={name} onChange={e => setName(e.target.value)} className={modalInput} autoFocus onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save() }} /></Field>
      <Field label="Race year"><input value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} inputMode="numeric" className={`${modalInput} w-32`} onKeyDown={e => { if (e.key === 'Enter' && name.trim()) save() }} /></Field>
    </ActionModal>
  )
}

/** One box of text and a send button: Note for fulfillment, Slack Matt. */
function TextForm({ icon, title, sub, label, start = '', placeholder, hint, action, onSend, onCancel }: {
  icon: typeof Truck; title: string; sub?: string; label: string; start?: string; placeholder?: string; hint: string; action: string
  onSend: (text: string) => Promise<void>; onCancel: () => void
}) {
  const [text, setText] = useState(start)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    try { await onSend(text.trim()); onCancel() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <ActionModal icon={icon} title={title} sub={sub} onClose={onCancel} busy={busy} hint={hint}
      footer={<>
        <button onClick={onCancel} disabled={busy} className={modalCancel}>Cancel</button>
        <button onClick={send} disabled={busy || !text.trim()} className={modalPrimary}>{busy && <Spin />}{action}</button>
      </>}>
      <Field label={label}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={placeholder} className={`${modalInput} resize-none`}
          autoFocus onFocus={e => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n) }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
      </Field>
    </ActionModal>
  )
}

/** A one-use code for the customer: the percent and the code's start, then it goes into the reply. */
function DiscountForm({ thread, first, isAdmin, onInsert, onDone, onCancel }: { thread: ThreadDetail; first: string; isAdmin: boolean; onInsert: (text: string) => void; onDone: () => void; onCancel: () => void }) {
  const [pct, setPct] = useState('15')
  // The code's prefix: the first name by default, anything the rep types instead (VIP, BOSTON).
  const defaultPrefix = (first || 'TRACKSTAR').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
  const [prefix, setPrefix] = useState(defaultPrefix)
  const [busy, setBusy] = useState(false)
  // A big code takes a second press, in the modal (browsers can block window.confirm).
  const [confirming, setConfirming] = useState(false)
  const cleanPrefix = prefix.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 20)
  const pctNum = Number(pct)
  // Over 25% is an admin's; the server holds the same line.
  const pctMax = isAdmin ? 100 : 25
  const pctOk = Number.isInteger(pctNum) && pctNum >= 1 && pctNum <= pctMax && cleanPrefix.length !== 1
  const create = async () => {
    if (!pctOk) return
    if (pctNum >= 50 && !confirming) { setConfirming(true); return }
    setBusy(true)
    try {
      const out = await supportApi.action<{ code: string; percent: number }>('discount15', { id: thread.id, percent: pctNum, prefix: cleanPrefix || defaultPrefix })
      onInsert(`Use code ${out.code} for ${out.percent}% off your next print (good for 30 days).`)
      toast.success(`${out.code} created (one use) and added to the reply`)
      onDone(); onCancel()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false); setConfirming(false) }
  }
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') create() }
  return (
    <ActionModal icon={BadgePercent} title="Discount code" sub={first || undefined} onClose={onCancel} busy={busy}
      hint={confirming ? <span className={`${bad} font-medium`}>A {pctNum}% code? That is a big one.</span> : `One use, 30 days: ${cleanPrefix || defaultPrefix}-${pctNum || '?'}. Added to your reply.`}
      footer={<>
        <button onClick={() => (confirming ? setConfirming(false) : onCancel())} disabled={busy} className={modalCancel}>{confirming ? 'Back' : 'Cancel'}</button>
        <button onClick={create} disabled={busy || !pctOk} className={confirming ? modalDanger : modalPrimary}>{busy && <Spin />}{confirming ? `Yes, create ${pctNum}% code` : `Create ${pctOk ? `${pctNum}% ` : ''}code`}</button>
      </>}>
      <Field label="Percent off">
        <div className="flex flex-wrap items-center gap-2">
          {[10, 15, 20].map(n => <button key={n} type="button" onClick={() => { setPct(String(n)); setConfirming(false) }} className={modalChip(pct === String(n))}>{n}%</button>)}
          <div className="relative w-24 ml-1">
            <input value={pct} onChange={e => { setPct(e.target.value.replace(/[^0-9]/g, '').slice(0, 3)); setConfirming(false) }} inputMode="numeric" className={`${modalInput} pr-8 text-right`} autoFocus onKeyDown={enter} />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-off-black/45">%</span>
          </div>
        </div>
      </Field>
      <Field label="Code starts with">
        <div className="flex items-center gap-2">
          <input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase().slice(0, 20))} onKeyDown={enter}
            className={`${modalInput} w-44 font-mono uppercase`} title="Their first name by default; type your own (VIP, BOSTON)." />
          <span className="font-mono text-off-black/60">-{pctNum || '?'}</span>
          {cleanPrefix !== defaultPrefix && <button type="button" onClick={() => setPrefix(defaultPrefix)} className="ml-auto text-sm text-off-black/45 hover:text-off-black">Use {defaultPrefix}</button>}
        </div>
      </Field>
      {pctNum > pctMax && <div className={bad}>Over {pctMax}% is Matt's call. Slack Matt instead.</div>}
    </ActionModal>
  )
}

function OrderActions({ o, thread, multiple, isAdmin, onInsert, onAttach, onChanged }: { o: CustomerOrder; thread: ThreadDetail; multiple: boolean; isAdmin: boolean; onInsert: (text: string) => void; onAttach: (m: Mockup) => void; onChanged: () => void }) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // The one modal open for this order, if any.
  const [open, setOpen] = useState<null | 'address' | 'change' | 'fix' | 'note' | 'claim' | 'reorder' | 'refund' | 'cancel'>(null)
  const close = () => setOpen(null)
  const form = { o, thread, onDone: onChanged, onCancel: close }
  const [converting, setConverting] = useState<string | null>(null)
  const [pickingConvert, setPickingConvert] = useState(false)
  const { can } = useAuth()
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
        {/* On every order, shipped or not: customers who love the design often
            say so before the print arrives, and that is a fine time to ask. */}
        {(() => {
          const it = o.items[0]
          const review = reviewLinkFor(it?.race || o.lineItems[0]?.title, it?.type)
          const delivered = o.tracking.map(t => t.deliveredAt).filter(Boolean).sort().pop() || null
          const sent = o.tracking[o.tracking.length - 1]?.at
          const when = delivered ? `delivered ${new Date(delivered).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
            : sent ? `shipped ${Math.max(0, Math.floor((Date.now() - new Date(sent).getTime()) / 86400000))}d ago, no delivery scan` : shipped ? 'shipped' : 'not shipped yet'
          const asked = thread.tags.includes('Review requested')
          if (!review) return <span className="self-start inline-flex items-center gap-1.5 text-xs text-off-black/40" title="Add it to src/lib/reviewLinks.ts"><Star className="w-3.5 h-3.5" />No Yotpo link for {it?.race || 'this product'}</span>
          return (
            <span className="self-start inline-flex items-baseline gap-1.5 flex-wrap">
              <ActionLink icon={Star} busy={busy === 'review'} title={`${review.name} review link. Only for a good experience.`} onClick={() => run('review', async () => {
                onInsert(reviewAsk(review.link))
                if (!asked) await supportApi.setTags(thread.id, [...thread.tags, 'Review requested'])
                return asked ? 'Review link added to the reply' : 'Review link added; tagged Review requested'
              })}>{asked ? 'Ask for a review again' : 'Ask for a review'}</ActionLink>
              <span className={`text-[11px] ${delivered ? 'text-emerald-700' : 'text-off-black/40'}`}>{when}</span>
            </span>
          )
        })()}
        {o.shopifyOrderId && !shipped && <ActionLink icon={MapPin} onClick={() => setOpen('address')} title={o.shipToLine || 'No address on file'}>Edit shipping address</ActionLink>}
        {o.shopifyOrderId && !shipped && editable.length > 0 && editable.length === o.items.length && <ActionLink icon={Ruler} onClick={() => setOpen('change')} title="Before production only: swaps the item in Shopify, keeps the personalization in the order note, invoices any difference">Change size or frame</ActionLink>}
        {editable[0] && <ActionLink icon={Pencil} onClick={() => setOpen('fix')} title="Before production only. After that it is a reprint.">Fix name or year</ActionLink>}
        {o.items[0] && <ActionLink icon={Plus} onClick={() => setOpen('note')}>Note for fulfillment</ActionLink>}
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
        {o.shopifyOrderId && o.items.length > 0 && shipped && <ActionLink icon={MessageSquareWarning} onClick={() => setOpen('claim')} title="Emails the customer's photos to Artelo support. Artelo files a report and makes a free replacement.">Damaged: claim with Artelo</ActionLink>}
        {/* A reprint or replacement: the same print to this customer, built in Artelo from here. */}
        {o.shopifyOrderId && o.items.length > 0 && <ActionLink icon={Repeat} onClick={() => setOpen('reorder')} title="The same print to this customer: a reprint or a replacement. Artelo bills us for it, so damage goes through the claim instead.">New Artelo order</ActionLink>}
        {o.shopifyOrderId && o.financialStatus !== 'REFUNDED' && <ActionLink icon={Receipt} onClick={() => setOpen('refund')} title="All or part, to the card they paid with. Over $150 is Matt's call.">Refund</ActionLink>}
        {/* Cancel only before anything is made or shipped. */}
        {o.shopifyOrderId && !shipped && !o.items.some(it => it.status === 'completed' || it.designStatus === 'sent_to_production') && o.financialStatus !== 'REFUNDED' && <ActionLink icon={Ban} onClick={() => setOpen('cancel')} title="Only after the customer says yes, and only before production">Cancel and refund</ActionLink>}
      </div>
      {open === 'address' && <AddressForm {...form} />}
      {open === 'change' && <ChangeItemForm {...form} />}
      {open === 'fix' && editable[0] && <FixPersonalizationForm {...form} item={editable[0]} />}
      {open === 'note' && o.items[0] && (
        <TextForm icon={Plus} title="Note for fulfillment" sub={`#${o.number}`} label="Note" start={first ? `${first} asked: ` : ''} action="Leave note"
          hint="Shows on the order for whoever fulfills it." onCancel={close}
          onSend={async text => { await supportApi.action('orderNote', { id: thread.id, orderId: o.items[0].orderId, text }); toast.success('Note left on the order'); onChanged() }} />
      )}
      {open === 'claim' && <DamageClaimForm {...form} />}
      {open === 'reorder' && <ArteloOrderForm {...form} isAdmin={isAdmin} />}
      {open === 'refund' && <RefundForm {...form} />}
      {open === 'cancel' && <CancelForm {...form} />}
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
  const first = (thread.customerName || '').trim().split(/\s+/)[0] || ''
  // Replacements exist only in Artelo: the actions work on the orders customers placed.
  const orders = thread.context.orders.filter(o => !o.replacement)
  const [open, setOpen] = useState<null | 'code' | 'slack'>(null)
  return (
    <div className="space-y-4">
      {orders.map(o => <OrderActions key={`${o.source}-${o.number}`} o={o} thread={thread} multiple={orders.length > 1} isAdmin={isAdmin} onInsert={onInsert} onAttach={onAttach} onChanged={onChanged} />)}
      <div>
        {orders.length > 1 && <div className={heading}>Customer</div>}
        <div className="flex flex-col items-stretch gap-1.5">
          <ActionLink icon={BadgePercent} title="One use, 30 days, named after them" onClick={() => setOpen('code')}>Create discount code for {first || 'them'}</ActionLink>
          <ActionLink icon={MessageSquareWarning} title="Posts to Slack with a link to this thread, and marks it escalated" onClick={() => setOpen('slack')}>Slack Matt</ActionLink>
        </div>
      </div>
      <CodeCheck />
      {open === 'code' && <DiscountForm thread={thread} first={first} isAdmin={isAdmin} onInsert={onInsert} onDone={onChanged} onCancel={() => setOpen(null)} />}
      {open === 'slack' && (
        <TextForm icon={MessageSquareWarning} title="Slack Matt" label="What should Matt know?" action="Send to Slack"
          hint="Goes to Slack with a link to this thread, and marks it escalated." onCancel={() => setOpen(null)}
          onSend={async text => { await supportApi.action('slackMatt', { id: thread.id, text }); toast.success('Matt pinged in Slack, thread escalated'); onChanged() }} />
      )}
    </div>
  )
}
