import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Clock, Loader2, MapPin, Pencil } from 'lucide-react'

/**
 * /order/:order/:sig (and the older /ship link): Manage your order, from the
 * button in the Shopify order confirmation. The customer fixes the runner's
 * name, shows or hides the time, changes the frame, updates the address or
 * cancels, with nobody at Trackstar in between
 * (server/domain/orders/selfServeOrder.js). A quiet countdown at the top
 * says how long the window is open; after it the page points at support.
 * Styled like the approval portal: a white pinned bar, an off-white page,
 * white cards, Inter, 5px buttons.
 */
const API_BASE = import.meta.env.VITE_API_URL || ''
const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"
const LOGO = 'https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png'
const PURPLE = '#4600D6'

type Address = { name: string; address1: string; address2: string; city: string; province: string; zip: string; country: string; phone: string }
type Print = { id: string; race: string; runnerName: string; size: string | null; frame: string | null; noTime: boolean; standard: boolean; photo: 'on_print' | 'after_race' | 'none'; preorder: boolean }
type Info = { number: string | null; closesAt: string | null; windowHours: number; canChange: boolean; reason: string | null; support: string; prints: Print[]; shipTo: Address | null }
type FrameChoice = { frame: string; difference: number }

const EMPTY: Address = { name: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' }
const input = 'w-full rounded-[5px] border border-[#E0E0E0] bg-white px-3 py-3 text-[16px] text-[#1A1A1A] outline-none focus:border-[#4600D6]'
const label = 'block text-[14px] font-medium text-[#666666] mb-1'
const card = 'bg-white rounded-[14px] p-4 md:p-6'
const primary = 'min-h-[48px] px-5 rounded-[5px] bg-[#4600D6] text-white text-[16px] font-bold flex items-center justify-center gap-2 hover:bg-[#3A00B0] transition-colors disabled:opacity-50'
const secondary = 'min-h-[48px] px-5 rounded-[5px] bg-white text-[#1A1A1A] text-[16px] font-bold border border-[#1A1A1A] flex items-center justify-center gap-2 disabled:opacity-50'
const link = 'inline-flex items-center gap-1 text-[15px] font-semibold text-[#4600D6] hover:underline disabled:opacity-50'

const CLOSED: Record<string, string> = {
  window: 'The window for making changes online has closed.',
  in_production: 'Your print is already being made, so changes can no longer be made online.',
  shipped: 'This order has already shipped.',
  cancelled: 'This order was cancelled.',
}
const ERR: Record<string, string> = {
  needs_full_name: 'Please enter a first and last name.',
  bad_address: "That address didn't work. Check the street, city and zip.",
  rate_limited: 'Too many tries. Wait a minute and try again.',
  no_such_frame: "This print doesn't come in that frame.",
  same_frame: "That's the frame it already has.",
}
const money = (n: number) => `$${Math.abs(n).toFixed(n % 1 ? 2 : 0)}`

/** "1 day 4 hr", "45 min", or a date when it is further out than a week. */
function timeLeft(closesAt: string, now: number) {
  const ms = new Date(closesAt).getTime() - now
  if (ms <= 0) return null
  if (ms > 7 * 86400e3) return { date: new Date(closesAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) }
  const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3), m = Math.floor((ms % 3600e3) / 60e3)
  if (d) return { text: `${d} day${d === 1 ? '' : 's'} ${h} hr` }
  if (h) return { text: `${h} hr ${m} min` }
  return { text: `${m} min` }
}

export default function ManageOrder() {
  const { order, sig } = useParams<{ order: string; sig: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'bad' | 'cancelled'>('loading')
  const [refunded, setRefunded] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    document.title = 'Manage your order | Trackstar'
    fetch(`${API_BASE}/api/public/manage-order?order=${encodeURIComponent(order || '')}&sig=${encodeURIComponent(sig || '')}`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) { setState('bad'); return } setInfo(d); setState('ready') })
      .catch(() => setState('bad'))
  }, [order, sig])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(t) }, [])

  // One call shape for every change. A window that closed since the page
  // loaded comes back as a reason, and the page switches to the closed card.
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`${API_BASE}/api/public/manage-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, sig, ...body }) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) return d
    if (['too_late', 'in_production', 'shipped', 'cancelled'].includes(d.error) || (d.error === 'unavailable' && ['in_production', 'cancelled'].includes(d.detail))) {
      const reason = d.error === 'too_late' ? 'window' : d.error === 'unavailable' ? d.detail : d.error
      setInfo(i => i ? { ...i, canChange: false, reason } : i)
      throw new Error(CLOSED[reason] || CLOSED.window)
    }
    throw new Error(d.error === 'bad_address' && d.detail ? `That address didn't work: ${d.detail}` : ERR[d.detail] || ERR[d.error] || 'Something went wrong. Try again in a moment.')
  }
  const setPrint = (p: Print) => setInfo(i => i ? { ...i, prints: i.prints.map(x => x.id === p.id ? p : x) } : i)

  const left = info?.closesAt && info.canChange ? timeLeft(info.closesAt, now) : null
  const supportHref = `mailto:${info?.support || 'fast@trackstar.art'}?subject=${encodeURIComponent(`Order #${info?.number || ''}`)}`

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#F6F5F2', fontFamily: FONT, letterSpacing: '-0.04em' }}>
      <header className="sticky top-0 z-40 w-full bg-white" style={{ borderBottom: '1px solid #E0E0E0' }}>
        <div className="max-w-xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src={LOGO} alt="Trackstar" className="h-[18px] md:h-[22px] w-auto" />
            <span className="w-px h-5 md:h-6" style={{ backgroundColor: '#D6D6D6' }} aria-hidden />
            <span className="whitespace-nowrap text-[16px] md:text-[18px] font-semibold text-[#1A1A1A]">Manage your order</span>
          </div>
          {info?.number && <span className="text-[15px] md:text-[16px] font-medium text-[#666666]"><span className="hidden sm:inline">Order </span>#{info.number}</span>}
        </div>
        {left && (
          <div className="max-w-xl mx-auto px-4 pb-2 -mt-1 flex items-center gap-1.5 text-[13px] text-[#666666]">
            <Clock className="w-3.5 h-3.5" aria-hidden />
            {left.date ? <span>Changes can be made until {left.date}</span> : <span><span className="font-semibold text-[#1A1A1A]">{left.text}</span> left to make changes</span>}
          </div>
        )}
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-4 py-6 space-y-4">
        {state === 'loading' && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#999999]" /></div>}

        {state === 'bad' && (
          <div className={card}>
            <p className="text-[18px] text-[#1A1A1A]">This link isn't working.</p>
            <p className="text-[16px] text-[#666666] mt-2">Reply to your order confirmation email and we'll help.</p>
          </div>
        )}

        {state === 'cancelled' && (
          <div className={card}>
            <p className="flex items-center gap-2 text-[20px] font-bold text-[#1A1A1A]"><CheckCircle2 className="w-5 h-5 text-[#2E7D5B]" />Order cancelled</p>
            <p className="text-[16px] text-[#666666] mt-2">We've refunded {refunded} to your original payment. It can take a few days to show up.</p>
          </div>
        )}

        {state === 'ready' && info && !info.canChange && (
          <div className={card}>
            <p className="text-[18px] text-[#1A1A1A]">{CLOSED[info.reason || 'window'] || CLOSED.window}</p>
            {info.reason !== 'cancelled' && (
              <>
                <p className="text-[16px] text-[#666666] mt-2">Need something changed? Email us and we'll do what we can.</p>
                <a href={supportHref} className={`${primary} mt-4 w-full`}>Email {info.support}</a>
                <p className="text-[14px] text-[#666666] mt-3">Or reply to your order confirmation email.</p>
              </>
            )}
          </div>
        )}

        {state === 'ready' && info && info.canChange && (
          <>
            <p className="text-[18px] text-[#1A1A1A] leading-snug">Check the details below. Fix a name, change the frame or update your address, and we'll print it that way.</p>
            {info.prints.map(p => (
              <PrintCard key={p.id} print={p} post={post} onChange={setPrint} />
            ))}
            <AddressCard shipTo={info.shipTo} post={post} onSaved={a => setInfo(i => i ? { ...i, shipTo: a } : i)} />
            <CancelCard post={post} onCancelled={d => { setRefunded(d); setState('cancelled') }} />
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

type Post = (body: Record<string, unknown>) => Promise<Record<string, unknown> & { print?: Print; frames?: FrameChoice[]; shipTo?: Address; refunded?: string; owed?: number; invoiced?: boolean; now?: string }>

function Row({ title, value, children }: { title: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="py-3 flex items-start justify-between gap-3" style={{ borderTop: '1px solid #EFEDE8' }}>
      <div className="min-w-0">
        <p className="text-[14px] text-[#666666]">{title}</p>
        <p className="text-[16px] text-[#1A1A1A] font-medium">{value}</p>
      </div>
      <div className="shrink-0 pt-1">{children}</div>
    </div>
  )
}

function PrintCard({ print: p, post, onChange }: { print: Print; post: Post; onChange: (p: Print) => void }) {
  const [editing, setEditing] = useState<null | 'name' | 'frame'>(null)
  const [name, setName] = useState(p.runnerName)
  const [frames, setFrames] = useState<FrameChoice[] | null>(null)
  const [pick, setPick] = useState<FrameChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setSaved('')
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  const saveName = () => run(async () => {
    const d = await post({ action: 'name', printId: p.id, name })
    if (d.print) { onChange(d.print); setName(d.print.runnerName) }
    setEditing(null); setSaved(`The print will read ${d.print?.runnerName || name}.`)
  })
  const toggleTime = () => run(async () => {
    const d = await post({ action: 'time', printId: p.id, noTime: !p.noTime })
    if (d.print) onChange(d.print)
    setSaved(p.noTime ? 'The time and pace are back on the print.' : 'The time and pace will be left off the print.')
  })
  const openFrames = () => run(async () => {
    const d = await post({ action: 'frames', printId: p.id })
    setFrames(d.frames || []); setPick(null); setEditing('frame')
  })
  const saveFrame = () => run(async () => {
    if (!pick) return
    const d = await post({ action: 'frame', printId: p.id, frame: pick.frame })
    if (d.print) onChange(d.print)
    setEditing(null)
    setSaved(d.invoiced && d.owed ? `Changed to ${d.now}. We've emailed you an invoice for ${money(d.owed)}; the print goes ahead once it's paid.` : `Changed to ${d.now}.`)
  })

  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <p className="text-[18px] font-bold text-[#1A1A1A]">{p.race}</p>
          <p className="text-[14px] text-[#666666]">{[p.size, p.frame].filter(Boolean).join(' · ')}{p.photo === 'on_print' ? ' · with your photo' : p.photo === 'after_race' ? ' · photo coming after the race' : ''}</p>
        </div>
      </div>

      <Row title="Name on the print" value={editing === 'name' ? null : p.runnerName}>
        {editing !== 'name' && <button type="button" className={link} onClick={() => { setEditing('name'); setName(p.runnerName); setErr(''); setSaved('') }} disabled={busy}><Pencil className="w-3.5 h-3.5" />Edit</button>}
      </Row>
      {editing === 'name' && (
        <form onSubmit={e => { e.preventDefault(); saveName() }} className="pb-3 space-y-2">
          <input className={input} value={name} onChange={e => setName(e.target.value)} autoFocus maxLength={80} placeholder="First and last name" />
          <p className="text-[13px] text-[#666666]">Exactly as it should appear on the poster.</p>
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy || !name.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Save name</button>
            <button type="button" className={secondary} onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}

      {p.standard && (
        <Row title="Time and pace" value={p.noTime ? 'Left off the print' : p.preorder ? 'Added once results are posted' : 'Shown on the print'}>
          <button type="button" className={link} onClick={toggleTime} disabled={busy}>{p.noTime ? 'Show them' : 'Leave them off'}</button>
        </Row>
      )}

      {p.frame && (
        <Row title="Frame" value={editing === 'frame' ? null : p.frame}>
          {editing !== 'frame' && <button type="button" className={link} onClick={openFrames} disabled={busy}>{busy && !editing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}Change</button>}
        </Row>
      )}
      {editing === 'frame' && frames && (
        <div className="pb-3 space-y-2">
          {frames.length === 0 && <p className="text-[15px] text-[#666666]">No other frames are available at this size.</p>}
          {frames.map(f => (
            <button key={f.frame} type="button" onClick={() => setPick(f)} className="w-full flex items-center justify-between rounded-[5px] border px-4 py-3 text-left" style={{ borderColor: pick?.frame === f.frame ? PURPLE : '#E0E0E0', backgroundColor: pick?.frame === f.frame ? '#F6F3FF' : '#FFFFFF' }}>
              <span className="text-[16px] font-medium text-[#1A1A1A]">{f.frame}</span>
              <span className="text-[14px] text-[#666666]">{f.difference > 0 ? `+${money(f.difference)}` : f.difference < 0 ? `${money(f.difference)} less` : 'No extra cost'}</span>
            </button>
          ))}
          {pick && pick.difference > 0 && <p className="text-[13px] text-[#666666]">We'll email you an invoice for {money(pick.difference)}. The print goes ahead once it's paid.</p>}
          {pick && pick.difference < 0 && <p className="text-[13px] text-[#666666]">We'll refund the {money(pick.difference)} difference.</p>}
          <div className="flex gap-2">
            <button type="button" className={primary} onClick={saveFrame} disabled={busy || !pick}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Change frame</button>
            <button type="button" className={secondary} onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}

      {err && <p className="text-[14px] text-[#B42318] pt-1">{err}</p>}
      {saved && <p className="flex items-center gap-1.5 text-[14px] text-[#2E7D5B] pt-1"><CheckCircle2 className="w-4 h-4" />{saved}</p>}
    </div>
  )
}

function AddressCard({ shipTo, post, onSaved }: { shipTo: Address | null; post: Post; onSaved: (a: Address) => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Address>({ ...EMPTY, ...(shipTo || {}) })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const lines = (a: Address) => [a.name, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean)
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setSaved(false)
    try { const d = await post({ action: 'address', address: form }); if (d.shipTo) { onSaved(d.shipTo); setForm({ ...EMPTY, ...d.shipTo }) } setEditing(false); setSaved(true) }
    catch (x) { setErr(x instanceof Error ? x.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[16px] font-semibold text-[#1A1A1A]"><MapPin className="w-4 h-4 text-[#4600D6]" />Ship to</p>
          {!editing && (shipTo ? <p className="text-[16px] text-[#1A1A1A] mt-2 leading-snug">{lines(shipTo).map((l, i) => <span key={i} className="block">{l}</span>)}</p> : <p className="text-[16px] text-[#666666] mt-2">No address on file.</p>)}
        </div>
        {!editing && <button type="button" className={link} onClick={() => { setEditing(true); setSaved(false) }}><Pencil className="w-3.5 h-3.5" />Edit</button>}
      </div>
      {editing && (
        <form onSubmit={save} className="mt-3 space-y-3">
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
          {err && <p className="text-[14px] text-[#B42318]">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Update address</button>
            <button type="button" className={secondary} onClick={() => { setEditing(false); setForm({ ...EMPTY, ...(shipTo || {}) }) }} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
      {!editing && err && <p className="text-[14px] text-[#B42318] mt-2">{err}</p>}
      {saved && !editing && <p className="flex items-center gap-1.5 text-[14px] text-[#2E7D5B] mt-2"><CheckCircle2 className="w-4 h-4" />Address updated.</p>}
    </div>
  )
}

function CancelCard({ post, onCancelled }: { post: Post; onCancelled: (refunded: string) => void }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const cancel = async () => {
    setBusy(true); setErr('')
    try { const d = await post({ action: 'cancel' }); onCancelled(String(d.refunded || 'your payment')) }
    catch (x) { setErr(x instanceof Error ? x.message : 'Something went wrong.'); setBusy(false) }
  }
  return (
    <div className="pt-2 text-center">
      {!confirm ? (
        <button type="button" className="text-[14px] text-[#666666] underline" onClick={() => setConfirm(true)}>Need to cancel this order?</button>
      ) : (
        <div className={`${card} text-left`}>
          <p className="text-[16px] font-semibold text-[#1A1A1A]">Cancel and refund this order?</p>
          <p className="text-[15px] text-[#666666] mt-1">We'll refund the full amount to your original payment. It can take a few days to show up.</p>
          {err && <p className="text-[14px] text-[#B42318] mt-2">{err}</p>}
          <div className="flex gap-2 mt-3">
            <button type="button" className={secondary} onClick={cancel} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Yes, cancel my order</button>
            <button type="button" className={link} onClick={() => setConfirm(false)} disabled={busy}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  )
}
