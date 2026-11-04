import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Loader2, MapPin } from 'lucide-react'

/**
 * /ship/:order/:sig - the customer fixes their own shipping address from the
 * link in the Shopify order confirmation ("Shipped it to the wrong place?").
 * Open for CHANGE_WINDOW_HOURS after the order and only until a print goes to
 * production (server/domain/orders/selfServeAddress.js); after that it only
 * says it is too late. Styled like the approval portal: a white pinned bar,
 * an off-white page, white cards, Inter, 5px buttons.
 */
const API_BASE = import.meta.env.VITE_API_URL || ''
const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"
const LOGO = 'https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png'

type Address = { name: string; address1: string; address2: string; city: string; province: string; zip: string; country: string; phone: string }
type Info = { number: string | null; prints: string[]; shipTo: Address | null; canChange: boolean; reason: string | null; windowHours: number; closesAt: string | null }

const EMPTY: Address = { name: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' }
const input = 'w-full rounded-[5px] border border-[#E0E0E0] bg-white px-3 py-3 text-[16px] text-[#1A1A1A] outline-none focus:border-[#4600D6]'
const label = 'block text-[14px] font-medium text-[#666666] mb-1'

const TOO_LATE: Record<string, string> = {
  window: "It's too late to change the address on this order online.",
  in_production: "Your print is already being made, so it's too late to change the address online.",
  shipped: 'This order has already shipped.',
  cancelled: 'This order was cancelled.',
}

export default function UpdateAddress() {
  const { order, sig } = useParams<{ order: string; sig: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'bad' | 'done'>('loading')
  const [form, setForm] = useState<Address>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/api/public/ship-address?order=${encodeURIComponent(order || '')}&sig=${encodeURIComponent(sig || '')}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) { setState('bad'); return }
        setInfo(d); setForm({ ...EMPTY, ...(d.shipTo || {}) }); setState('ready')
      })
      .catch(() => setState('bad'))
  }, [order, sig])

  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const r = await fetch(`${API_BASE}/api/public/ship-address`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, sig, address: form }) })
      const d = await r.json().catch(() => ({}))
      if (r.ok) { setState('done'); return }
      if (d.error === 'too_late' || d.error === 'in_production' || d.error === 'shipped' || d.error === 'cancelled') { setInfo(i => i ? { ...i, canChange: false, reason: d.error === 'too_late' ? 'window' : d.error } : i); return }
      if (d.error === 'bad_address') { setError(d.detail ? `That address didn't work: ${d.detail}` : "That address didn't work. Check the street, city and zip."); return }
      if (d.error === 'rate_limited') { setError('Too many tries. Wait a minute and try again.'); return }
      setError(d.error && d.error.length > 20 ? d.error : 'Something went wrong. Try again in a moment.')
    } catch { setError('Could not reach us. Check your connection and try again.') }
    finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F6F5F2', fontFamily: FONT, letterSpacing: '-0.04em' }}>
      <header className="sticky top-0 z-40 w-full bg-white" style={{ borderBottom: '1px solid #E0E0E0' }}>
        <div className="max-w-xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={LOGO} alt="Trackstar" className="h-[18px] md:h-[22px] w-auto" />
            <span className="w-px h-5 md:h-6" style={{ backgroundColor: '#D6D6D6' }} aria-hidden />
            <span className="whitespace-nowrap text-[16px] md:text-[18px] font-semibold text-[#1A1A1A]">Shipping address</span>
          </div>
          {info?.number && <span className="text-[15px] md:text-[16px] font-medium text-[#666666]"><span className="hidden sm:inline">Order </span>#{info.number}</span>}
        </div>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-4 py-6 space-y-4">
        {state === 'loading' && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#999999]" /></div>}

        {state === 'bad' && (
          <div className="bg-white rounded-[14px] p-6">
            <p className="text-[18px] text-[#1A1A1A]">This link isn't working.</p>
            <p className="text-[16px] text-[#666666] mt-2">Reply to your order confirmation email and we'll help.</p>
          </div>
        )}

        {state === 'done' && (
          <div className="bg-white rounded-[14px] p-6">
            <p className="flex items-center gap-2 text-[20px] font-bold text-[#1A1A1A]"><CheckCircle2 className="w-5 h-5 text-[#2E7D5B]" />Address updated</p>
            <p className="text-[16px] text-[#666666] mt-2">Your order{info?.number ? ` #${info.number}` : ''} will ship to:</p>
            <p className="text-[16px] text-[#1A1A1A] mt-2 leading-snug">{[form.name, form.address1, form.address2, [form.city, form.province, form.zip].filter(Boolean).join(' '), form.country].filter(Boolean).map((l, i) => <span key={i} className="block">{l}</span>)}</p>
          </div>
        )}

        {state === 'ready' && info && !info.canChange && (
          <div className="bg-white rounded-[14px] p-6">
            <p className="text-[18px] text-[#1A1A1A]">{TOO_LATE[info.reason || 'window'] || TOO_LATE.window}</p>
          </div>
        )}

        {state === 'ready' && info && info.canChange && (
          <>
            <p className="text-[18px] text-[#1A1A1A] leading-snug">Shipped it to the wrong place? Fix the address below and we'll send it there instead. You can change it for {info.windowHours} hours after ordering.</p>
            {info.prints.length > 0 && (
              <div className="bg-white rounded-[14px] p-4">
                <p className="text-[14px] text-[#666666]">Your order</p>
                {info.prints.map((p, i) => <p key={i} className="text-[16px] text-[#1A1A1A]">{p}</p>)}
              </div>
            )}
            <form onSubmit={save} className="bg-white rounded-[14px] p-4 md:p-6 space-y-3">
              <p className="flex items-center gap-2 text-[16px] font-semibold text-[#1A1A1A]"><MapPin className="w-4 h-4 text-[#4600D6]" />Ship to</p>
              <div><label className={label}>Full name</label><input className={input} value={form.name} onChange={set('name')} autoComplete="shipping name" required /></div>
              <div><label className={label}>Street address</label><input className={input} value={form.address1} onChange={set('address1')} autoComplete="shipping address-line1" required /></div>
              <div><label className={label}>Apartment, suite, etc. (optional)</label><input className={input} value={form.address2} onChange={set('address2')} autoComplete="shipping address-line2" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>City</label><input className={input} value={form.city} onChange={set('city')} autoComplete="shipping address-level2" required /></div>
                <div><label className={label}>State</label><input className={input} value={form.province} onChange={set('province')} autoComplete="shipping address-level1" placeholder="NY" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Zip</label><input className={input} value={form.zip} onChange={set('zip')} autoComplete="shipping postal-code" required /></div>
                <div><label className={label}>Country</label><input className={input} value={form.country} onChange={set('country')} autoComplete="shipping country" placeholder="US" required /></div>
              </div>
              <div><label className={label}>Phone (optional)</label><input className={input} value={form.phone} onChange={set('phone')} autoComplete="shipping tel" inputMode="tel" /></div>
              {error && <p className="text-[14px] text-[#B42318]">{error}</p>}
              <button type="submit" disabled={saving} className="w-full min-h-[52px] rounded-[5px] bg-[#4600D6] text-white text-[16px] font-bold flex items-center justify-center gap-2 hover:bg-[#3A00B0] transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Update address
              </button>
            </form>
          </>
        )}
      </main>

      <footer className="w-full mt-10" style={{ backgroundColor: '#1A1A1A' }}>
        <div className="max-w-xl mx-auto px-4 py-10">
          <img src="https://www.trackstar.art/cdn/shop/files/Trackstar_White_Logo_Cropped.png" alt="Trackstar" style={{ width: 130, height: 'auto', marginBottom: 10 }} />
          <p style={{ color: '#E6E6E6', fontSize: '18px', lineHeight: 1.3, margin: '0 0 24px' }}>Celebrating athletic achievement.</p>
          <p style={{ borderTop: '1px solid #3A3A3A', paddingTop: 16, margin: 0, color: '#8A8A8A', fontSize: '14px' }}>&copy; {new Date().getFullYear()} Trackstar. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
