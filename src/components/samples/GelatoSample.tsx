/**
 * Tools > Samples, overseas: a finished PDF printed and shipped by Gelato near
 * the recipient. Make the print from the race results (SampleDesigner) or
 * upload a PDF, fill in who it goes to, get Gelato's price and shipping, send.
 * Server: api/samples.js (gelato-*, design-*), server/domain/samples/gelato.js.
 */
import { useState } from 'react'
import { ExternalLink, FileText, Loader2, Plus, Send, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { parseAddress } from '@/lib/parseAddress'
import { useArmed } from '@/lib/useArmed'
import { btnPrimary, btnSecondary, sectionLabel, infoCard, segment, segmentGroup } from '@/lib/ui'
import SampleDesigner, { type DesignPrint } from './SampleDesigner'

const field = 'w-full px-3 py-2 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-off-black/10'
const usd = (c: number) => `$${(c / 100).toFixed(2)}`

type Quote = { product: { label: string }; printCents: number; country: string; shipping: { uid: string; name: string; cents: number; minDays: number; maxDays: number }[] }

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const r = await apiFetch('/api/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d as T
}

type GelatoProduct = { uid: string; label: string; size: string; frame: string }

export default function GelatoSample({ products, prints, onSent }: { products: GelatoProduct[]; prints: DesignPrint[] | null; onSent: () => void }) {
  const [size, setSize] = useState('12x18')
  // Ordering costs money: a second click, in the page (Arc blocks window.confirm).
  const { arm, isArmed } = useArmed(8000)
  const [frame, setFrame] = useState('Black Premium Oak')
  const sizes = [...new Set(products.map(p => p.size))]
  const frames = products.filter(p => p.size === size).map(p => p.frame)
  const productUid = (products.find(p => p.size === size && p.frame === frame) || products.find(p => p.size === size) || products[0])?.uid || ''
  const [source, setSource] = useState<'design' | 'upload'>('design')
  // A new key starts the designer over after a send.
  const [round, setRound] = useState(0)
  const [file, setFile] = useState<{ name: string; url: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [paste, setPaste] = useState('')
  const [addr, setAddr] = useState({ address1: '', address2: '', city: '', province: '', zip: '', country: '', phone: '' })
  const [title, setTitle] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [method, setMethod] = useState('')
  const [busy, setBusy] = useState<'quote' | 'send' | null>(null)
  const [sent, setSent] = useState<{ reference: string; costCents: number; country: string; shipping: { name: string } } | null>(null)

  const payload = () => ({ productUid, fileUrl: file?.url, name, email, title, address: addr })
  const ready = file && name.trim() && /^\S+@\S+\.\S+$/.test(email) && addr.address1.trim() && addr.city.trim() && addr.zip.trim() && /^[A-Za-z]{2}$/.test(addr.country.trim())

  const upload = async (f: File) => {
    setUploading(true)
    try {
      const { uploadUrl, fileUrl } = await post<{ uploadUrl: string; fileUrl: string }>({ action: 'gelato-upload', fileName: f.name })
      const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: f })
      if (!res.ok) throw new Error(`The upload failed (${res.status})`)
      setFile({ name: f.name, url: fileUrl }); setQuote(null)
      if (!title) setTitle(f.name.replace(/\.pdf$/i, ''))
    } catch (e) { toast.error((e as Error).message) } finally { setUploading(false) }
  }
  const getQuote = async () => {
    setBusy('quote')
    try { const q = await post<Quote>({ action: 'gelato-quote', ...payload() }); setQuote(q); setMethod(q.shipping[0]?.uid || '') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const send = async () => {
    const m = quote?.shipping.find(s => s.uid === method)
    if (!quote || !m) return
    if (!arm(`send:${method}`)) return
    setBusy('send')
    try { setSent(await post({ action: 'gelato-send', ...payload(), shipmentMethodUid: method })); onSent() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const reset = () => { setSent(null); setFile(null); setName(''); setEmail(''); setPaste(''); setAddr({ address1: '', address2: '', city: '', province: '', zip: '', country: '', phone: '' }); setTitle(''); setQuote(null); setRound(n => n + 1) }

  if (sent) return (
    <div className="bg-white border border-border-gray rounded-lg p-6 max-w-xl">
      <div className="text-lg font-semibold text-off-black">Sample {sent.reference} is with Gelato</div>
      <p className="text-sm text-off-black/60 mt-1">Printed in or near {sent.country} and shipped by {sent.shipping.name}. Cost {usd(sent.costCents)}, logged in sample spend.</p>
      <div className="mt-4 flex gap-2">
        <a href="https://dashboard.gelato.com/orders" target="_blank" rel="noopener noreferrer" className={btnSecondary}>Open Gelato <ExternalLink className="w-3.5 h-3.5" /></a>
        <button onClick={reset} className={btnPrimary}><Plus className="w-4 h-4" />Send another</button>
      </div>
    </div>
  )

  return (
    <div className="bg-white border border-border-gray rounded-lg p-4 md:p-6 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="space-y-4 min-w-0">
        <h2 className={sectionLabel}>The print</h2>
        <div className={`${infoCard} space-y-3`}>
          <div className={segmentGroup}>
            {([['design', 'Make the design'], ['upload', 'Upload a PDF']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSource(k)} className={segment(source === k)}>{l}</button>
            ))}
          </div>
          {file && source === 'design' && (
            <div className="flex items-center gap-2 text-sm"><FileText className="w-4 h-4 text-emerald-700" /><span className="font-medium text-off-black truncate">{file.name}</span><span className="text-off-black/50 shrink-0">is the print</span></div>
          )}
          <div className={source === 'design' ? '' : 'hidden'}>
            <SampleDesigner key={round} prints={prints} onUse={(f, t) => { setFile(f); setQuote(null); setTitle(t) }} />
          </div>
          {source === 'upload' && (
            <label className={`flex items-center gap-3 rounded-md border-2 border-dashed px-4 py-5 cursor-pointer ${file ? 'border-emerald-300 bg-emerald-50/40' : 'border-border-gray hover:border-off-black/30'}`}>
              {uploading ? <Loader2 className="w-5 h-5 animate-spin text-off-black/50" /> : file ? <FileText className="w-5 h-5 text-emerald-700" /> : <Upload className="w-5 h-5 text-off-black/40" />}
              <span className="text-sm">{file ? <><span className="font-medium text-off-black">{file.name}</span> <span className="text-off-black/50">· click to replace</span></> : <span className="text-off-black/60">Upload the print-ready PDF (12x18 with bleed, like our Artelo files)</span>}</span>
              <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f) }} />
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <select value={size} onChange={e => { setSize(e.target.value); setQuote(null) }} className={field} title="Size">{sizes.map(x => <option key={x}>{x}</option>)}</select>
            <select value={frame} onChange={e => { setFrame(e.target.value); setQuote(null) }} className={field} title="Frame">{frames.map(x => <option key={x}>{x}</option>)}</select>
          </div>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What it is, for sample spend (e.g. Berlin Marathon, Anna)" className={field} />
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className={sectionLabel}>Send to</h2>
          <div className={`${infoCard} mt-2 space-y-2`}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={field} />
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" className={field} />
            <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2} placeholder="Paste a full address to fill the fields" className={`${field} resize-none`}
              onBlur={() => { if (!paste.trim()) return; const a = parseAddress(paste); if (a.name && !name) setName(a.name); setAddr(x => ({ ...x, ...Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'name' && v)) })) }} />
            <input value={addr.address1} onChange={e => setAddr({ ...addr, address1: e.target.value })} placeholder="Street" className={field} />
            <input value={addr.address2} onChange={e => setAddr({ ...addr, address2: e.target.value })} placeholder="Apt / suite (optional)" className={field} />
            <div className="grid grid-cols-[1fr_88px] gap-2">
              <input value={addr.city} onChange={e => setAddr({ ...addr, city: e.target.value })} placeholder="City" className={field} />
              <input value={addr.zip} onChange={e => setAddr({ ...addr, zip: e.target.value })} placeholder="Postal code" className={field} />
            </div>
            <div className="grid grid-cols-[1fr_88px] gap-2">
              <input value={addr.province} onChange={e => setAddr({ ...addr, province: e.target.value })} placeholder="State / region (if any)" className={field} />
              <input value={addr.country} onChange={e => { setAddr({ ...addr, country: e.target.value.toUpperCase().slice(0, 2) }); setQuote(null) }} placeholder="DE" className={field} title="Two-letter country code" />
            </div>
            <input value={addr.phone} onChange={e => setAddr({ ...addr, phone: e.target.value })} placeholder="Phone (helps the carrier)" className={field} />
          </div>
        </div>

        <div>
          <h2 className={sectionLabel}>Price</h2>
          {!quote ? (
            <button onClick={getQuote} disabled={!ready || busy !== null} className={`${btnSecondary} mt-2 w-full justify-center`}>{busy === 'quote' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Get Gelato's price</button>
          ) : (
            <div className={`${infoCard} mt-2 space-y-2 text-sm`}>
              <div className="flex justify-between"><span className="text-off-black/60">Print ({quote.product.label})</span><span>{usd(quote.printCents)}</span></div>
              {quote.shipping.map(s => (
                <label key={s.uid} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="gelato-ship" checked={method === s.uid} onChange={() => setMethod(s.uid)} className="accent-[#4600D6]" />
                  <span className="flex-1">{s.name} <span className="text-off-black/45">· {s.minDays === s.maxDays ? s.minDays : `${s.minDays}-${s.maxDays}`} days</span></span>
                  <span>{usd(s.cents)}</span>
                </label>
              ))}
              <div className="flex justify-between font-semibold border-t border-border-gray pt-2"><span>Total, from {quote.country}</span><span>{usd(quote.printCents + (quote.shipping.find(s => s.uid === method)?.cents || 0))}</span></div>
              <button onClick={send} disabled={!ready || busy !== null} className={`${btnPrimary} w-full justify-center`}>{busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}{isArmed(`send:${method}`) ? 'Click again to order it' : 'Send with Gelato'}</button>
              {isArmed(`send:${method}`) && (() => { const m = quote?.shipping.find(s => s.uid === method); return quote && m ? <p className="text-xs text-red-600">Orders this sample from Gelato for {usd(quote.printCents + m.cents)} ({m.name}) to {name} in {addr.country.toUpperCase()}. Gelato charges the account on file.</p> : null })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
