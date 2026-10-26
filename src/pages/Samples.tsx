/**
 * Tools > Samples: send prints to people as real Shopify orders, free or at
 * cost, one or several prints at once. Shopify sends its usual order emails
 * and Artelo picks the order up like any other. Server: api/samples.js.
 */
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Gift, Loader2, Plus, Receipt, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { parseAddress } from '@/lib/parseAddress'
import PageHeader from '@/components/PageHeader'
import PrintPicker from '@/components/PrintPicker'
import GelatoSample from '@/components/samples/GelatoSample'
import { btnSecondary, pageShell, sectionLabel, infoCard, cardLabel } from '@/lib/ui'

interface Variant { variantId: string; size: string; frame: string | null; price: number }
interface Product { productId: string; title: string; label: string; race: string; edition: string | null; image: string | null; variants: Variant[] }
interface Line { key: number; product: Product | null; size: string; frame: string; quantity: number; runnerName: string; raceYear: string; bib: string; time: string; unitPrice: string }

const field = 'w-full px-3 py-2 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-off-black/10'
const shortTitle = (t: string) => t.replace(/\s*Personalized Race Print\s*$/i, '').replace(/^Personalized\s+/i, '')
const thumb = (url: string | null, cls = 'w-9 h-11') => url
  ? <img src={`${url}${url.includes('?') ? '&' : '?'}width=90`} alt="" className={`${cls} object-cover rounded bg-subtle-gray shrink-0`} />
  : <span className={`${cls} rounded bg-subtle-gray shrink-0`} />

let nextKey = 1
const blankLine = (): Line => ({ key: nextKey++, product: null, size: '12x18', frame: 'Black Oak', quantity: 1, runnerName: '', raceYear: String(new Date().getFullYear()), bib: '', time: '', unitPrice: '' })

export default function Samples() {
  const [products, setProducts] = useState<Product[] | null>(null)
  // Artelo ships from the US through Shopify; Gelato prints overseas from a finished PDF.
  const [provider, setProvider] = useState<'artelo' | 'gelato'>('artelo')
  const [gelatoProducts, setGelatoProducts] = useState<{ uid: string; label: string; size: string; frame: string }[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [paste, setPaste] = useState('')
  const [addr, setAddr] = useState({ address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' })
  const [lines, setLines] = useState<Line[]>([blankLine()])
  const [mode, setMode] = useState<'free' | 'cost'>('free')
  const [shipping, setShipping] = useState('')
  const [quoting, setQuoting] = useState(false)
  const [note, setNote] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ name: string; total: number; invoiced: boolean; adminUrl: string; costCents?: number | null } | null>(null)
  // What the prints cost us (Artelo production, shipping, branding), free or not.
  const [ourCost, setOurCost] = useState<number | null>(null)
  const [spend, setSpend] = useState<{ months: { month: string; count: number; costCents: number; chargedCents: number; netCents: number }[]; recent: { id: string; at: string; source: string; orderName: string | null; recipient: string; costCents: number; chargedCents: number }[] } | null>(null)
  const loadSpend = () => apiFetch('/api/samples?view=spend').then(r => r.ok ? r.json() : null).then(d => d && setSpend(d)).catch(() => {})
  useEffect(() => { loadSpend() }, [])

  useEffect(() => {
    apiFetch('/api/samples').then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load the store'); setProducts(d.products); setGelatoProducts(d.gelatoProducts || []) })
      .catch(e => setLoadErr((e as Error).message))
  }, [])

  const setLine = (key: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const variantOf = (l: Line) => l.product?.variants.find(v => v.size === l.size && (v.frame || '') === l.frame) || null
  const ready = lines.every(l => l.product && variantOf(l)) && /^\S+@\S+\.\S+$/.test(email) && name.trim() && addr.address1.trim() && addr.city.trim() && addr.zip.trim()

  // At cost: fill each print's price and the shipping from Artelo's costs.
  const fillCosts = async () => {
    const items = lines.filter(l => variantOf(l)).map(l => ({ variantId: variantOf(l)!.variantId, size: l.size, frame: l.frame, quantity: l.quantity }))
    if (!items.length) return
    setQuoting(true)
    try {
      const r = await apiFetch('/api/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'quote', items, address: addr.zip ? { name, ...addr } : null }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not get Artelo costs')
      setLines(ls => ls.map(l => { const q = d.lines.find((x: { variantId: string; unit: number }) => x.variantId === variantOf(l)?.variantId); return q ? { ...l, unitPrice: q.unit.toFixed(2) } : l }))
      setShipping(Number(d.shipping).toFixed(2))
    } catch (e) { toast.error((e as Error).message) } finally { setQuoting(false) }
  }
  useEffect(() => { if (mode === 'cost') fillCosts() }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const costKey = lines.map(l => `${l.size}|${l.frame}|${l.quantity}|${l.product ? 1 : 0}`).join(',') + `|${addr.zip}|${addr.country}`
  useEffect(() => {
    const items = lines.filter(l => l.product).map(l => ({ size: l.size, frame: l.frame, quantity: l.quantity }))
    if (!items.length) { setOurCost(null); return }
    const t = setTimeout(() => {
      apiFetch('/api/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cost', items, address: addr.zip ? { name, ...addr } : null }) })
        .then(r => r.ok ? r.json() : null).then(d => setOurCost(d ? d.totalCents / 100 : null)).catch(() => setOurCost(null))
    }, 400)
    return () => clearTimeout(t)
  }, [costKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => mode === 'free' ? 0 : lines.reduce((n, l) => n + (Number(l.unitPrice) || 0) * l.quantity, 0) + (Number(shipping) || 0), [mode, lines, shipping])

  const send = async () => {
    setSending(true)
    try {
      const [firstName, ...rest] = name.trim().split(/\s+/)
      const body = {
        action: 'send', mode, email: email.trim(), note, shipping: mode === 'cost' ? shipping : 0,
        address: { firstName, lastName: rest.join(' '), ...addr },
        items: lines.map(l => ({ variantId: variantOf(l)!.variantId, title: shortTitle(l.product!.title), size: l.size, frame: l.frame, quantity: l.quantity, runnerName: l.runnerName, raceYear: l.raceYear, bib: l.bib, time: l.time, unitPrice: mode === 'cost' ? l.unitPrice : 0 })),
      }
      const r = await apiFetch('/api/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Could not send the sample (server said ${r.status})`)
      setSent(d); setReviewing(false); loadSpend()
      toast.success(`Sample ${d.name} created${d.invoiced ? ' and invoiced' : ''}`)
    } catch (e) { toast.error((e as Error).message) } finally { setSending(false) }
  }
  const startOver = () => { setSent(null); setEmail(''); setName(''); setPaste(''); setAddr({ address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' }); setLines([blankLine()]); setNote(''); setShipping(''); setMode('free') }

  return (
    <div className={pageShell}>
      <div className="px-3 md:px-5 w-full flex flex-col h-full">
        <PageHeader title="Samples" subtitle="Send prints as Shopify orders" />
        <div className="pt-4 md:pt-5 pb-3 hidden md:flex items-center gap-3 flex-shrink-0">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
          <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Samples</h1>
          <span className="text-sm text-off-black/45 ml-2">Prints sent as Shopify orders, so they get the order emails and Artelo makes them as usual.</span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto pb-36 md:pb-8">
          <div className="mb-3 inline-flex rounded-md border border-border-gray bg-white p-0.5">
            {([['artelo', 'Artelo (US)'], ['gelato', 'Gelato (overseas)']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setProvider(k)} className={`px-3 py-1.5 text-sm font-medium rounded ${provider === k ? 'bg-dark-fill text-white' : 'text-off-black/60 hover:text-off-black'}`}>{l}</button>
            ))}
          </div>
          {provider === 'gelato' ? (
            <GelatoSample products={gelatoProducts} prints={products} onSent={loadSpend} />
          ) : sent ? (
            <div className="bg-white border border-border-gray rounded-lg p-6 max-w-xl">
              <div className="text-lg font-semibold text-off-black">Sample {sent.name} is in Shopify</div>
              <p className="text-sm text-off-black/60 mt-1">{sent.invoiced ? `Shopify emailed the invoice for $${sent.total.toFixed(2)}. Artelo makes it once it is paid.` : 'Free, marked paid. Shopify sent the order confirmation and Artelo picks it up as usual.'}</p>
              <div className="mt-4 flex gap-2">
                <a href={sent.adminUrl} target="_blank" rel="noopener noreferrer" className={btnSecondary}>Open in Shopify <ExternalLink className="w-3.5 h-3.5" /></a>
                <button onClick={startOver} className="inline-flex items-center gap-1.5 px-3 py-2 bg-dark-fill text-white text-sm font-medium rounded-md"><Plus className="w-4 h-4" />Send another</button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-border-gray rounded-lg p-4 md:p-6 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
              {/* Left: the prints. */}
              <div className="space-y-4 min-w-0">
                <div className="flex items-center justify-between">
                  <h2 className={sectionLabel}>Prints</h2>
                  <button onClick={() => setLines(ls => [...ls, blankLine()])} className={btnSecondary}><Plus className="w-3.5 h-3.5" />Add another print</button>
                </div>
                {loadErr && <div className="text-sm text-red-700">{loadErr}</div>}
                {lines.map((l, i) => {
                  const sizes = [...new Set((l.product?.variants || []).map(v => v.size))]
                  const frames = [...new Set((l.product?.variants || []).filter(v => v.size === l.size).map(v => v.frame || ''))]
                  return (
                    <div key={l.key} className={`${infoCard} space-y-2.5`}>
                      <div className="flex items-center justify-between">
                        <span className={cardLabel}>Print {i + 1}</span>
                        {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} className="text-off-black/40 hover:text-red-600" title="Remove this print"><Trash2 className="w-3.5 h-3.5" /></button>}
                      </div>
                      <PrintPicker value={l.product?.title || null} options={products} onChange={(p: Product) => {
                        const size = p.variants.some(v => v.size === l.size) ? l.size : p.variants[0]?.size || ''
                        const frame = p.variants.some(v => v.size === size && (v.frame || '') === l.frame) ? l.frame : p.variants.find(v => v.size === size)?.frame || ''
                        setLine(l.key, { product: p, size, frame, unitPrice: '' })
                      }} />
                      <div className="grid grid-cols-3 gap-2">
                        <select value={l.size} onChange={e => setLine(l.key, { size: e.target.value, unitPrice: '' })} className={field} disabled={!l.product}>{sizes.map(s => <option key={s}>{s}</option>)}</select>
                        <select value={l.frame} onChange={e => setLine(l.key, { frame: e.target.value, unitPrice: '' })} className={field} disabled={!l.product}>{frames.map(f => <option key={f} value={f}>{f || 'No frame option'}</option>)}</select>
                        <input type="number" min={1} max={10} value={l.quantity} onChange={e => setLine(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} className={field} title="Quantity" />
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input value={l.runnerName} onChange={e => setLine(l.key, { runnerName: e.target.value })} placeholder="Runner name" className={`${field} col-span-2`} />
                        <input value={l.raceYear} onChange={e => setLine(l.key, { raceYear: e.target.value })} placeholder="Year" inputMode="numeric" className={field} />
                        <input value={l.bib} onChange={e => setLine(l.key, { bib: e.target.value })} placeholder="Bib (optional)" className={field} />
                        <input value={l.time} onChange={e => setLine(l.key, { time: e.target.value })} placeholder="Time (optional, else looked up)" className={`${field} col-span-2 sm:col-span-4`} />
                      </div>
                      {mode === 'cost' && (
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-off-black/55">Price each</span>
                          <span className="text-off-black/40">$</span>
                          <input value={l.unitPrice} onChange={e => setLine(l.key, { unitPrice: e.target.value.replace(/[^0-9.]/g, '') })} placeholder={quoting ? '…' : '0.00'} className={`${field} w-28`} />
                          <span className="text-[11px] text-off-black/45">Artelo production cost</span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Right: who it goes to, and the price. */}
              <div className="space-y-4">
                <div>
                  <h2 className={sectionLabel}>Send to</h2>
                  <div className={`${infoCard} mt-2 space-y-2`}>
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className={field} />
                    <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (gets the Shopify emails)" type="email" className={field} />
                    <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={2} placeholder="Paste a full address to fill the fields" className={`${field} resize-none`}
                      onBlur={() => { if (!paste.trim()) return; const a = parseAddress(paste); if (a.name && !name) setName(a.name); setAddr(x => ({ ...x, ...Object.fromEntries(Object.entries(a).filter(([k, v]) => k !== 'name' && v)) })) }} />
                    <input value={addr.address1} onChange={e => setAddr({ ...addr, address1: e.target.value })} placeholder="Street" className={field} />
                    <input value={addr.address2} onChange={e => setAddr({ ...addr, address2: e.target.value })} placeholder="Apt / suite (optional)" className={field} />
                    <div className="grid grid-cols-[1fr_64px_88px] gap-2">
                      <input value={addr.city} onChange={e => setAddr({ ...addr, city: e.target.value })} placeholder="City" className={field} />
                      <input value={addr.province} onChange={e => setAddr({ ...addr, province: e.target.value.toUpperCase().slice(0, 3) })} placeholder="ST" className={field} />
                      <input value={addr.zip} onChange={e => setAddr({ ...addr, zip: e.target.value })} placeholder="ZIP" className={field} />
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className={sectionLabel}>Price</h2>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button onClick={() => setMode('free')} className={`p-3 rounded-md border text-left ${mode === 'free' ? 'border-off-black bg-off-black/[0.03]' : 'border-border-gray bg-white hover:border-off-black/30'}`}>
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-off-black"><Gift className="w-4 h-4" />Free</div>
                      <div className="text-[11px] text-off-black/50 mt-0.5">$0, shipping included</div>
                    </button>
                    <button onClick={() => setMode('cost')} className={`p-3 rounded-md border text-left ${mode === 'cost' ? 'border-off-black bg-off-black/[0.03]' : 'border-border-gray bg-white hover:border-off-black/30'}`}>
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-off-black"><Receipt className="w-4 h-4" />At cost</div>
                      <div className="text-[11px] text-off-black/50 mt-0.5">COGS + shipping, invoiced</div>
                    </button>
                  </div>
                  {mode === 'cost' && (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span className="text-off-black/55 w-20">Shipping</span><span className="text-off-black/40">$</span>
                      <input value={shipping} onChange={e => setShipping(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={quoting ? '…' : '0.00'} className={`${field} w-28`} />
                      <button onClick={fillCosts} disabled={quoting} className="text-xs text-[#4600D6] hover:underline">{quoting ? 'Getting costs' : 'Refresh costs'}</button>
                    </div>
                  )}
                  <div className="mt-3 flex items-baseline justify-between border-t border-border-gray pt-3">
                    <span className="text-sm text-off-black/60">They pay</span>
                    <span className="text-xl font-semibold text-off-black tabular-nums">${total.toFixed(2)}</span>
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between" title="Artelo production, shipping and branding">
                    <span className="text-sm text-off-black/60">Costs us</span>
                    <span className="text-sm font-semibold text-off-black tabular-nums">{ourCost == null ? '…' : `$${Math.max(0, ourCost - total).toFixed(2)}`}{ourCost != null && total > 0 && <span className="font-normal text-off-black/45"> (of ${ourCost.toFixed(2)})</span>}</span>
                  </div>
                </div>

                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Note on the order (optional), e.g. Creator sample for Rob" className={`${field} resize-none`} />
                <button onClick={() => setReviewing(true)} disabled={!ready} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 bg-dark-fill text-white text-sm font-medium rounded-md disabled:opacity-40">Review and send</button>
                {!ready && <p className="text-[11px] text-off-black/45 text-center">Needs a print, a name, an email and an address.</p>}
              </div>
            </div>
          )}

          {/* Sample spend by month: every sample from here, the MCP and creator samples. */}
          {spend && (
            <div className="mt-5 bg-white border border-border-gray rounded-lg p-4 md:p-6">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className={sectionLabel}>Sample spend</h2>
                <span className="text-xs text-off-black/45">Artelo production, shipping and branding, less what at-cost recipients paid</span>
              </div>
              {spend.months.length === 0 ? <p className="text-sm text-off-black/45">No samples recorded yet.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-off-black/50"><th className="py-1.5 font-medium">Month</th><th className="font-medium text-right">Samples</th><th className="font-medium text-right">Cost</th><th className="font-medium text-right">Paid back</th><th className="font-medium text-right">Spent</th></tr></thead>
                  <tbody className="divide-y divide-border-gray">
                    {spend.months.map(m => (
                      <tr key={m.month}>
                        <td className="py-2">{new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</td>
                        <td className="text-right tabular-nums">{m.count}</td>
                        <td className="text-right tabular-nums">${(m.costCents / 100).toFixed(2)}</td>
                        <td className="text-right tabular-nums text-off-black/55">{m.chargedCents ? `$${(m.chargedCents / 100).toFixed(2)}` : '-'}</td>
                        <td className="text-right tabular-nums font-semibold">${(m.netCents / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {reviewing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !sending && setReviewing(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-base font-semibold text-off-black">Send this sample?</div>
              <button onClick={() => setReviewing(false)} className="text-off-black/40 hover:text-off-black"><X className="w-4 h-4" /></button>
            </div>
            <div className="text-sm text-off-black/75 space-y-1.5">
              {lines.map(l => <div key={l.key} className="flex items-center gap-2">{thumb(l.product?.image || null, 'w-7 h-9')}<span>{l.quantity} × {shortTitle(l.product!.title)}, {l.size} {l.frame}{l.runnerName ? `, ${l.runnerName}` : ''}{mode === 'cost' ? ` · $${(Number(l.unitPrice) || 0).toFixed(2)}` : ''}</span></div>)}
              <div className="pt-2 border-t border-border-gray">To {name}, {email}<br />{[addr.address1, addr.address2, `${addr.city}, ${addr.province} ${addr.zip}`].filter(Boolean).join(', ')}</div>
              <div className="font-medium text-off-black">{mode === 'free' ? 'Free: a $0 order, marked paid.' : `At cost: $${total.toFixed(2)} including $${(Number(shipping) || 0).toFixed(2)} shipping. Shopify emails the invoice.`}</div>
              {ourCost != null && <div className="text-off-black/70">Costs us ${Math.max(0, ourCost - total).toFixed(2)}{total > 0 ? ` (production and shipping $${ourCost.toFixed(2)}, less the $${total.toFixed(2)} they pay)` : ' (Artelo production, shipping and branding)'}.</div>}
              <div className="text-xs text-off-black/50">Creates a real Shopify order. They get Shopify's order emails, and Artelo makes it like any other order.</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setReviewing(false)} disabled={sending} className="px-3 py-2 text-sm text-off-black/60">Back</button>
              <button onClick={send} disabled={sending} className="inline-flex items-center gap-1.5 px-4 py-2 bg-dark-fill text-white text-sm font-medium rounded-md disabled:opacity-50">{sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Create the order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
