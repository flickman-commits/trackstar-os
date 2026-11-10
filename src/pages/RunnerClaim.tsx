import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, CheckCircle2 } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * One runner, their own print. A partner forwards this link to their team so
 * each person enters their own name and shipping address instead of the
 * partner collecting a spreadsheet. Nothing about the rest of the list is
 * shown here.
 */

const T = { page: '#F6F5F2', card: '#FFFFFF', line: '#E7E4DD', accent: '#4600D6', bar: '#242424', font: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif" }
const input = 'w-full px-3 py-2.5 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-[#4600D6]/30'
const inputStyle = { border: `1px solid ${T.line}`, backgroundColor: '#FFFFFF' }

export default function RunnerClaim() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<{ partnerName: string; raceName: string; raceYear: number; note: string | null; product: string } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'sent' | 'duplicate'>('loading')
  const [f, setF] = useState({ firstName: '', lastName: '', line1: '', line2: '', city: '', state: '', zip: '', country: 'United States' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/public/bulk-intake?kind=runner&token=${encodeURIComponent(token || '')}`)
      .then(async r => { if (!r.ok) throw new Error(); setInfo(await r.json()); setState('ready') })
      .catch(() => setState('gone'))
  }, [token])

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(v => ({ ...v, [k]: e.target.value }))
  const complete = f.firstName.trim() && f.lastName.trim() && f.line1.trim() && f.city.trim() && f.zip.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`${API_BASE}/api/public/bulk-intake`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, kind: 'runner', runners: [{ firstName: f.firstName, lastName: f.lastName, address: { line1: f.line1, line2: f.line2, city: f.city, state: f.state, zip: f.zip, country: f.country } }] }),
      })
      const data = await res.json()
      if (res.status === 409 && data.error === 'full') { setErr('This order already has every runner it was placed for. Ask your organizer to add you.'); return }
      if (!res.ok) throw new Error()
      if (data.rejected?.length) { setErr('Please check the address. Street, city and zip are required.'); return }
      setState(data.added === 0 ? 'duplicate' : 'sent')
    } catch { setErr('Something went wrong. Please try again in a moment.') } finally { setBusy(false) }
  }

  // A plain function, not a component: a component defined inside render is
  // a new type every keystroke, which remounts the form and drops focus.
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ backgroundColor: T.page, fontFamily: T.font }}>
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="flex items-center gap-3 pl-1.5 pr-4 py-1.5 mb-6" style={{ backgroundColor: T.bar, borderRadius: 24 }}>
          <span className="flex items-center justify-center shrink-0 overflow-hidden" style={{ backgroundColor: '#F3F3F3', borderRadius: 999, padding: '2px 10px' }}>
            <img src="/trackstar-logo.png" alt="Trackstar" className="h-8 w-auto" />
          </span>
          {info && <span style={{ color: '#FFFFFF', fontSize: '15px', fontWeight: 600 }}>{info.partnerName}</span>}
        </div>
        {children}
        <p className="mt-10 text-center" style={{ fontSize: '11px', color: '#999999', letterSpacing: '0.05em' }}>Trackstar - Celebrating athletic achievement.</p>
      </div>
    </div>
  )

  if (state === 'loading') return shell(<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#999' }} /></div>)
  if (state === 'gone' || !info) return shell(<div className="rounded-2xl p-8 text-center" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}><h1 className="text-lg font-bold mb-2">This link is no longer active</h1><p className="text-sm" style={{ color: '#666' }}>Check with your team for a fresh one.</p></div>)

  if (state === 'sent' || state === 'duplicate') return shell(
    <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
      <CheckCircle2 className="w-8 h-8 mx-auto mb-3" style={{ color: T.accent }} />
      <h1 className="text-xl font-bold mb-2">{state === 'duplicate' ? "You're already on the list." : 'Got it, thank you.'}</h1>
      <p className="text-sm" style={{ color: '#666' }}>
        Keep an eye on your mailbox after the race. There's nothing else you need to do.
      </p>
    </div>
  )

  return shell(
    <>
      <div className="rounded-2xl p-6 mb-4" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
        <span className="inline-flex items-center px-2.5 py-1 rounded-md mb-3" style={{ backgroundColor: T.accent, color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>A gift for you</span>
        <h1 className="text-xl font-bold" style={{ color: '#1A1A1A' }}>{info.raceName} {info.raceYear}</h1>
        <p className="text-sm mt-1" style={{ color: '#666' }}>
          {info.partnerName} is sending you a personalized gift after your marathon and needs your address. Please enter it below.
        </p>
        {info.note && <p className="text-sm mt-3 rounded-xl p-3" style={{ backgroundColor: 'rgba(70,0,214,0.05)', border: '1px solid rgba(70,0,214,0.15)', color: '#1A1A1A' }}>{info.note}</p>}
      </div>

      <form onSubmit={submit} className="rounded-2xl p-4 space-y-2" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
        <div className="grid grid-cols-2 gap-2">
          <input value={f.firstName} onChange={set('firstName')} placeholder="First name" className={input} style={inputStyle} autoComplete="given-name" />
          <input value={f.lastName} onChange={set('lastName')} placeholder="Last name" className={input} style={inputStyle} autoComplete="family-name" />
        </div>
        <input value={f.line1} onChange={set('line1')} placeholder="Street address" className={input} style={inputStyle} autoComplete="address-line1" />
        <input value={f.line2} onChange={set('line2')} placeholder="Apt / unit (optional)" className={input} style={inputStyle} autoComplete="address-line2" />
        <div className="grid grid-cols-3 gap-2">
          <input value={f.city} onChange={set('city')} placeholder="City" className={input} style={inputStyle} autoComplete="address-level2" />
          <input value={f.state} onChange={set('state')} placeholder="State" className={input} style={inputStyle} autoComplete="address-level1" />
          <input value={f.zip} onChange={set('zip')} placeholder="Zip" className={input} style={inputStyle} autoComplete="postal-code" />
        </div>
        <input value={f.country} onChange={set('country')} placeholder="Country" className={input} style={inputStyle} autoComplete="country-name" />
        {err && <p className="text-sm" style={{ color: '#DC2626' }}>{err}</p>}
        <button type="submit" disabled={busy || !complete} className="w-full py-3 mt-1 text-sm font-bold uppercase tracking-wide rounded-md disabled:opacity-40" style={{ backgroundColor: T.accent, color: '#fff' }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Send my details'}
        </button>
      </form>
    </>
  )
}
