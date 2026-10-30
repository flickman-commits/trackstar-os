import { useEffect, useState } from 'react'
import { Loader2, Upload, X, Copy, ExternalLink, Send, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import PrintPicker, { type PrintOption } from '@/components/PrintPicker'
import { btnPrimary, btnSecondary, btnGhost, inputBase, fieldLabel } from '@/lib/ui'
import { useArmed } from '@/lib/useArmed'

/**
 * A bulk order's billing (server/domain/bulk/billing.js): the organization,
 * one race, what we agreed (standard or co-branded prints, the discount,
 * where it ships) and its Shopify invoice, all on the bulk order itself.
 */

const API_BASE = import.meta.env.VITE_API_URL || ''

type Address = { company: string; name: string; address1: string; address2: string; city: string; province: string; zip: string; country: string }
const blankAddress = (): Address => ({ company: '', name: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'US' })
type Line = { id?: string; raceName: string; raceYear: string; eventNote: string; quantity: string; productSize: string; frameType: string }
/** Race, year, event, quantity, size, frame, remove: the columns of a line, header and rows alike. */
const LINE_GRID = 'grid grid-cols-[minmax(0,1fr)_76px_72px_96px_190px_minmax(0,0.8fr)_32px] gap-2'
type CatalogPrint = PrintOption & { race: string }

const blankLine = (prev?: Line): Line => ({ raceName: prev?.raceName || '', raceYear: prev?.raceYear || String(new Date().getFullYear()), eventNote: '', quantity: '', productSize: prev?.productSize || '8x10', frameType: prev?.frameType || 'Unframed' })

export type Billing = {
  id: string; number: string; partnerName: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null
  raceName: string; raceYear: number; events: string | null; quantity: number; productSize: string; frameType: string; dueDate: string | null
  billingAddress: Address | null; printKind: 'standard' | 'cobranded'; discountKind: 'percent' | 'amount' | null; discountPercent: number | null; discountCents: number | null
  discountNote: string | null; shipping: 'runner' | 'organization'; shipToAddress: Address | null
  shopifyDraftId: string | null; shopifyDraftName: string | null; invoiceUrl: string | null; invoiceSentAt: string | null
  shopifyOrderName: string | null; paidAt: string | null; adminUrl?: string | null; notes: string | null
  /** Co-branded: the order's uploaded production file and its check. */
  template?: { uploadedAt: string | null; checkedAt: string | null; ok: boolean | null; problems: string[] } | null
}
type PastDetails = {
  partnerName: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; billingAddress: Address | null
  printKind: 'standard' | 'cobranded'; shipping: 'runner' | 'organization'; shipToAddress: Address | null
  discountKind?: 'percent' | 'amount' | null; discountPercent?: number | null; discountCents?: number | null; discountNote?: string | null
}
type Quote = { lines: { number: string; raceName: string; raceYear: number; quantity: number; productSize: string; frameType: string; unitCents?: number; subtotalCents?: number | null; missing?: string }[]; subtotalCents: number; discountCents: number; totalCents: number; missing: string[] }

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function billingApi<T>(body: Record<string, unknown>): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/bulk/billing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data as T
}

function AddressFields({ value, onChange, withCompany = false }: { value: Address; onChange: (a: Address) => void; withCompany?: boolean }) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {withCompany && <input className={`${inputBase} col-span-6`} value={value.company} onChange={set('company')} placeholder="Organization (on the invoice)" />}
      <input className={`${inputBase} col-span-6`} value={value.address1} onChange={set('address1')} placeholder="Street" />
      <input className={`${inputBase} col-span-6`} value={value.address2} onChange={set('address2')} placeholder="Suite, floor (optional)" />
      <input className={`${inputBase} col-span-3`} value={value.city} onChange={set('city')} placeholder="City" />
      <input className={`${inputBase} col-span-1`} value={value.province} onChange={set('province')} placeholder="ST" />
      <input className={`${inputBase} col-span-2`} value={value.zip} onChange={set('zip')} placeholder="ZIP" />
    </div>
  )
}

/**
 * New bulk order: who, the race, how many, when it ships, and the terms. With
 * `order`, the same form edits it; once the
 * invoice is out only the fulfillment date and the notes still change.
 */
export function OrderModal({ order, onClose, onCreated }: { order?: Billing; onClose: () => void; onCreated: (order: Billing) => void }) {
  // The discount is money: admins set it (api/bulk/deals.js ignores it from anyone else).
  const { isAdmin } = useAuth()
  const [opts, setOpts] = useState<{ events: string[]; sizes: string[]; frames: string[] }>({ events: ['Marathon', 'Half Marathon', '10 Miler', '10K', '8K', '5K'], sizes: ['8x10', '12x18', '16x24'], frames: ['Unframed', 'Natural Premium Oak', 'Black Premium Oak'] })
  const [f, setF] = useState(() => order ? {
    partnerName: order.partnerName, contactName: order.contactName || '', contactEmail: order.contactEmail || '', contactPhone: order.contactPhone || '',
    printKind: order.printKind, discountKind: order.discountKind || '', discountPercent: order.discountPercent != null ? String(order.discountPercent) : '',
    discountDollars: order.discountCents != null ? String(order.discountCents / 100) : '', discountNote: order.discountNote || '', shipping: order.shipping, notes: order.notes || '',
  } : { partnerName: '', contactName: '', contactEmail: '', contactPhone: '', printKind: 'standard', discountKind: '', discountPercent: '', discountDollars: '', discountNote: '', shipping: 'runner', notes: '' })
  const [billing, setBilling] = useState<Address>(() => ({ ...blankAddress(), ...(order?.billingAddress || {}) }))
  const [shipTo, setShipTo] = useState<Address>(() => ({ ...blankAddress(), ...(order?.shipToAddress || {}) }))
  const [lines, setLines] = useState<Line[]>(() => order
    ? [{ id: order.id, raceName: order.raceName, raceYear: String(order.raceYear), eventNote: order.events || '', quantity: String(order.quantity), productSize: order.productSize, frameType: order.frameType }]
    : [blankLine()])
  const [due, setDue] = useState(() => (order?.dueDate || '').slice(0, 10))
  const locked = Boolean(order && (order.invoiceSentAt || order.paidAt))
  // Start from an earlier order's details (same organization ordering again).
  const [past, setPast] = useState<PastDetails[]>([])
  useEffect(() => { if (!order) apiFetch(`${API_BASE}/api/bulk/billing?past=1`).then(r => r.json()).then(d => setPast(d.past || [])).catch(() => {}) }, [order])
  const applyPast = (p: PastDetails) => {
    setF(v => ({
      ...v, partnerName: p.partnerName, contactName: p.contactName || '', contactEmail: p.contactEmail || '', contactPhone: p.contactPhone || '',
      printKind: p.printKind, shipping: p.shipping,
      ...(p.discountKind !== undefined ? { discountKind: p.discountKind || '', discountPercent: p.discountPercent != null ? String(p.discountPercent) : '', discountDollars: p.discountCents != null ? String(p.discountCents / 100) : '', discountNote: p.discountNote || '' } : {}),
    }))
    setBilling({ ...blankAddress(), ...(p.billingAddress || {}) })
    setShipTo({ ...blankAddress(), ...(p.shipToAddress || {}) })
  }
  const [busy, setBusy] = useState(false)
  useEffect(() => { apiFetch(`${API_BASE}/api/bulk/billing?options=1`).then(r => r.json()).then(setOpts).catch(() => {}) }, [])
  const [catalog, setCatalog] = useState<CatalogPrint[] | null>(null)
  useEffect(() => { apiFetch(`${API_BASE}/api/bulk/billing?catalog=1`).then(r => r.json()).then(d => setCatalog(d.products || [])).catch(() => setCatalog([])) }, [])
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(v => ({ ...v, [k]: e.target.value }))
  const setLine = (i: number, k: keyof Line, v: string) => setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l))
  const units = lines.reduce((n, l) => n + (parseInt(l.quantity, 10) || 0), 0)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!locked && lines.some(l => !l.raceName)) { toast.error('Choose the race'); return }
    if (!due) { toast.error('Set the fulfillment date'); return }
    setBusy(true)
    try {
      const out = await billingApi<{ order: Billing }>({
        action: order ? 'update' : 'create', ...(order ? { id: order.id } : {}), ...f,
        discountKind: f.discountKind || null,
        billingAddress: { ...billing, company: billing.company || f.partnerName, name: f.contactName },
        shipToAddress: f.shipping === 'organization' ? { ...shipTo, company: f.partnerName, name: f.contactName } : null,
        ...(locked ? {} : { lines }),
        fulfillmentDate: due,
      })
      if (order) { toast.success(order.shopifyDraftId && !locked ? 'Saved. Update the invoice so it matches.' : 'Saved'); onCreated(out.order); return }
      toast.success(`${out.order.number} created`)
      onCreated(out.order)
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }

  const label = (t: string) => <span className={fieldLabel}>{t}</span>
  return (
    <div className="fixed inset-0 z-50 bg-off-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between"><h3 className="text-base font-semibold">{order ? `Edit ${order.number}` : 'New bulk order'}</h3><button type="button" onClick={onClose} className={btnGhost}><X className="w-4 h-4" /></button></div>

        {!order && past.length > 0 && (
          <label className="block">{label('Start from an earlier bulk order (optional)')}
            <select defaultValue="" onChange={e => { const p = past[Number(e.target.value)]; if (p) applyPast(p) }} className={`${inputBase} w-full`}>
              <option value="">New organization</option>
              {past.map((p, i) => <option key={i} value={i}>{p.partnerName}{p.contactName ? ` · ${p.contactName}` : ''}</option>)}
            </select>
          </label>
        )}
        {locked && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">The invoice has gone out, so only the fulfillment date and the notes change here.</p>}

        {/* When it ships: typed in, since an order can be for gifts long after the race. */}
        <label className="block max-w-xs">{label('Fulfillment date (when the prints ship)')}<input type="date" required value={due} onChange={e => setDue(e.target.value)} className={`${inputBase} w-full`} /></label>

        {!locked && <>
        {/* Who */}
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block">{label('Organization')}<input required value={f.partnerName} onChange={set('partnerName')} placeholder="American Heart Association, Philadelphia" className={`${inputBase} w-full`} /></label>
          <label className="block">{label('Contact')}<input value={f.contactName} onChange={set('contactName')} placeholder="Miles McCaskey" className={`${inputBase} w-full`} /></label>
          <label className="block">{label('Contact email (invoice goes here)')}<input type="email" value={f.contactEmail} onChange={set('contactEmail')} className={`${inputBase} w-full`} /></label>
          <div className="col-span-2">{label('Billing address')}<AddressFields value={billing} onChange={setBilling} /></div>
        </div>

        {/* What */}
        <div>
          {label('Prints')}
          <div className="grid grid-cols-2 gap-2">
            {(['standard', 'cobranded'] as const).map(k => (
              <label key={k} className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer ${f.printKind === k ? 'border-[#4600D6] bg-[#4600D6]/[0.04]' : 'border-border-gray'}`}>
                <input type="radio" name="printKind" checked={f.printKind === k} onChange={() => setF(v => ({ ...v, printKind: k }))} className="mt-1 accent-[#4600D6]" />
                <span className="text-sm"><span className="font-semibold">{k === 'standard' ? 'Standard' : 'Co-branded'}</span><span className="block text-xs text-off-black/55">{k === 'standard' ? 'Our race design, rendered automatically' : 'Their logo or design, made by the designer'}</span></span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">{label(`Race · ${units} print${units === 1 ? '' : 's'}`)}</div>
          <div className="space-y-1.5">
            <div className={`${LINE_GRID} text-[11px] font-semibold text-off-black/45 uppercase tracking-wider`}>
              <span>Race</span><span>Year</span><span>Qty</span><span>Size</span><span>Frame</span><span title="Internal: which events were sold. The lookup finds the race each runner ran.">Events (note)</span><span />
            </div>
            {lines.map((l, i) => (
              <div key={i} className={`${LINE_GRID} items-center`}>
                <PrintPicker<CatalogPrint> value={catalog?.find(c => c.race === l.raceName)?.title || null} options={catalog} placeholder={l.raceName || 'Choose the race'}
                  onChange={c => setLine(i, 'raceName', c.race)} />
                <input required value={l.raceYear} onChange={e => setLine(i, 'raceYear', e.target.value.replace(/\D/g, '').slice(0, 4))} className={inputBase} aria-label="Year" />
                <input required value={l.quantity} onChange={e => setLine(i, 'quantity', e.target.value.replace(/\D/g, ''))} placeholder="Qty" className={inputBase} aria-label="Quantity" />
                <select value={l.productSize} onChange={e => setLine(i, 'productSize', e.target.value)} className={inputBase} aria-label="Size">{opts.sizes.map(o => <option key={o}>{o}</option>)}</select>
                <select value={l.frameType} onChange={e => setLine(i, 'frameType', e.target.value)} className={inputBase} aria-label="Frame">{opts.frames.map(o => <option key={o}>{o}</option>)}</select>
                <input value={l.eventNote} onChange={e => setLine(i, 'eventNote', e.target.value)} placeholder="Full 5, Half 5, 10K 3" className={inputBase} aria-label="Events (internal note)" />
                <span />
              </div>
            ))}
          </div>
        </div>

        {/* The terms */}
        {isAdmin && <div className="grid grid-cols-2 gap-2">
          <label className="block">{label('Discount')}
            <select value={f.discountKind} onChange={set('discountKind')} className={`${inputBase} w-full`}>
              <option value="">None</option><option value="percent">Percent off</option><option value="amount">Dollars off the order</option>
            </select>
          </label>
          {f.discountKind === 'percent' && <label className="block">{label('Percent')}<input value={f.discountPercent} onChange={e => setF(v => ({ ...v, discountPercent: e.target.value.replace(/\D/g, '').slice(0, 3) }))} placeholder="15" className={`${inputBase} w-full`} /></label>}
          {f.discountKind === 'amount' && <label className="block">{label('Dollars off')}<input value={f.discountDollars} onChange={e => setF(v => ({ ...v, discountDollars: e.target.value.replace(/[^\d.]/g, '') }))} placeholder="100" className={`${inputBase} w-full`} /></label>}
          {f.discountKind && <label className="col-span-2 block">{label('Discount note (internal, never on the invoice)')}<input value={f.discountNote} onChange={set('discountNote')} placeholder="Why we gave it" className={`${inputBase} w-full`} /><span className="block text-[11px] text-off-black/45 mt-1">The customer sees "Bulk discount" on the invoice.</span></label>}
        </div>}

        <div>
          {label('Shipping')}
          <div className="grid grid-cols-2 gap-2">
            {(['runner', 'organization'] as const).map(k => (
              <label key={k} className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer ${f.shipping === k ? 'border-[#4600D6] bg-[#4600D6]/[0.04]' : 'border-border-gray'}`}>
                <input type="radio" name="shipping" checked={f.shipping === k} onChange={() => setF(v => ({ ...v, shipping: k }))} className="mt-1 accent-[#4600D6]" />
                <span className="text-sm"><span className="font-semibold">{k === 'runner' ? 'To each runner' : 'All to the organization'}</span><span className="block text-xs text-off-black/55">{k === 'runner' ? 'Their list needs names and addresses' : 'Their list needs names only'}</span></span>
              </label>
            ))}
          </div>
          {f.shipping === 'organization' && (
            <div className="mt-2">
              <div className="flex items-center justify-between">{label('Ship everything to')}<button type="button" onClick={() => setShipTo({ ...billing })} className="text-[11px] text-[#4600D6] hover:underline">Same as billing</button></div>
              <AddressFields value={shipTo} onChange={setShipTo} />
            </div>
          )}
        </div>

        </>}

        <label className="block">{label('Notes (internal)')}<textarea value={f.notes} onChange={set('notes')} rows={2} placeholder="Other markets interested for next year" className={`${inputBase} w-full`} /></label>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : order ? 'Save changes' : 'Create bulk order'}</button>
        </div>
      </form>
    </div>
  )
}

/** A co-branded order's production file: upload or replace it, and what the worker's check said. */
export function ProductionFile({ order, onChanged }: { order: Billing; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const t = order.template
  const upload = async (file: File) => {
    setBusy(true)
    try {
      const { path, uploadUrl } = await billingApi<{ path: string; uploadUrl: string }>({ action: 'template-upload', id: order.id, fileName: file.name })
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/postscript', 'x-upsert': 'true' }, body: file })
      if (!res.ok) throw new Error(`The upload failed (${res.status})`)
      await billingApi({ action: 'template-saved', id: order.id, path })
      toast.success('Uploaded. The render worker checks it on its next check-in.')
      onChanged()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  const status = !t ? { text: 'No file yet', cls: 'text-off-black/45' }
    : t.ok === null || !t.checkedAt ? { text: 'Waiting for the worker to check it', cls: 'text-amber-700' }
    : t.ok ? { text: 'Checked, ready to render', cls: 'text-emerald-700' }
    : { text: `Check found problems: ${t.problems.slice(0, 2).join('; ') || 'see Settings > Print Templates'}`, cls: 'text-red-600' }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-medium text-off-black min-w-0 truncate">{order.raceName} {order.raceYear}</span>
      <span className="font-mono text-[11px] text-off-black/40">{order.number}</span>
      <span className={`flex-1 min-w-0 truncate ${status.cls}`} title={status.text}>{status.text}</span>
      <label className={`${btnSecondary} cursor-pointer shrink-0 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}{t ? 'Replace .ai' : 'Upload .ai'}
        <input type="file" accept=".ai" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
      </label>
    </div>
  )
}

/**
 * Sidebar card: who is paying and the Shopify invoice (build, open, copy the
 * customer's link, email). The bulk order view loads `order` (its billing,
 * from /api/bulk/billing) and reloads after a change.
 */
export function InvoiceCard({ order, onChanged }: { order: Billing; onChanged: () => void }) {
  const { isAdmin } = useAuth()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { arm, isArmed } = useArmed()

  // Prices are admins' only.
  useEffect(() => {
    if (!isAdmin) return
    apiFetch(`${API_BASE}/api/bulk/billing?id=${encodeURIComponent(order.id)}&quote=1`).then(r => r.ok ? r.json() : null).then(setQuote).catch(() => setQuote(null))
  }, [order.id, order.shopifyDraftId, isAdmin])

  const buildInvoice = async () => {
    setBusy('invoice')
    try {
      const out = await billingApi<{ draftName: string; quote: Quote }>({ action: 'invoice', id: order.id })
      setQuote(out.quote)
      toast.success(`Shopify invoice ${out.draftName} is ready`)
      onChanged()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }
  const send = async () => {
    if (!order.contactEmail) { toast.error('Add the contact email first'); return }
    if (!arm('send')) return
    setBusy('send')
    try {
      const out = await billingApi<{ sentTo: string }>({ action: 'send-invoice', id: order.id })
      toast.success(`Invoice sent to ${out.sentTo}`)
      onChanged()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(null) }
  }

  const discount = order.discountKind === 'percent' ? `${order.discountPercent}% off` : order.discountKind === 'amount' ? `${money(order.discountCents || 0)} off` : 'No discount'
  const row = 'w-full inline-flex items-center justify-center gap-1.5'
  return (
    <div className="bg-subtle-gray border border-border-gray rounded-md p-3 space-y-3">
      <div>
        <div className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-0.5">Customer &amp; invoice</div>
        <div className="text-sm font-semibold text-off-black">{order.contactName || 'No contact yet'}</div>
        {order.contactEmail && <div className="text-xs text-off-black/60 break-all">{order.contactEmail}</div>}
      </div>
      {isAdmin && (
        <div className="text-xs space-y-0.5">
          <div className="text-off-black/70">{discount}{order.discountNote ? <span className="text-off-black/45"> · {order.discountNote}</span> : null}</div>
          {quote && (
            <>
              <div className="flex justify-between text-off-black/55"><span>Subtotal</span><span>{money(quote.subtotalCents)}</span></div>
              {quote.discountCents > 0 && <div className="flex justify-between text-off-black/55"><span>Discount</span><span>−{money(quote.discountCents)}</span></div>}
              <div className="flex justify-between font-bold text-off-black text-sm pt-0.5"><span>Total</span><span>{money(quote.totalCents)}</span></div>
              <div className="text-[11px] text-off-black/45">Free shipping, prices from Shopify</div>
            </>
          )}
          {quote && quote.missing.length > 0 && <p className="text-red-600">{quote.missing.join('; ')}</p>}
        </div>
      )}
      {isAdmin && !order.paidAt && quote && (
        <div className="space-y-1.5">
          {!order.invoiceSentAt && (
            <button onClick={buildInvoice} disabled={busy !== null || quote.missing.length > 0} className={`${order.shopifyDraftId ? btnSecondary : btnPrimary} ${row}`} title={quote.missing.join('; ') || undefined}>
              {busy === 'invoice' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Receipt className="w-3.5 h-3.5" />}{order.shopifyDraftId ? `Update invoice ${order.shopifyDraftName || ''}` : 'Build Shopify invoice'}
            </button>
          )}
          {order.invoiceUrl && <button onClick={send} disabled={busy !== null} className={`${order.invoiceSentAt ? btnSecondary : btnPrimary} ${row}`}>{busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{isArmed('send') ? `Click again: Shopify emails it to ${order.contactEmail}` : order.invoiceSentAt ? 'Email it again' : 'Email invoice'}</button>}
        </div>
      )}
      {(order.adminUrl || order.invoiceUrl) && isAdmin && (
        <div className="flex flex-col items-start gap-1">
          {order.adminUrl && <a href={order.adminUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2"><ExternalLink className="w-3.5 h-3.5" /> Open in Shopify</a>}
          {order.invoiceUrl && !order.paidAt && <button onClick={() => navigator.clipboard.writeText(order.invoiceUrl!).then(() => toast.success('Customer payment link copied'))} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2"><Copy className="w-3.5 h-3.5" /> Copy customer payment link</button>}
        </div>
      )}
      {!isAdmin && !order.paidAt && <p className="text-xs text-off-black/50">Matt handles the invoice.</p>}
      {order.invoiceSentAt && !order.paidAt && <p className="text-[11px] text-off-black/45">Emailed {new Date(order.invoiceSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Turns paid on its own once they pay.</p>}
      {order.paidAt && <p className="text-xs font-medium text-green-700">Paid{order.shopifyOrderName ? ` · ${order.shopifyOrderName}` : ''}</p>}
      {order.notes && <p className="text-xs text-off-black/60 whitespace-pre-wrap border-t border-border-gray pt-2">{order.notes}</p>}
    </div>
  )
}
