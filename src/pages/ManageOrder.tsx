import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Clock, ImagePlus, Loader2, MapPin, Pencil } from 'lucide-react'
import PhotoCropper from '@/components/PhotoCropper'
import { putUpload } from '../lib/putUpload'
import { loadPublic, LoadError, OFFLINE } from '@/lib/publicLoad'

/**
 * /order/:order/:sig (and the older /ship link): Manage your order, from the
 * button in the Shopify order confirmation. The customer fixes the runner's
 * name, changes the size or frame, adds a photo ($20, invoiced by Shopify), updates
 * the address or cancels, with nobody at Trackstar in between
 * (server/domain/orders/selfServeOrder.js). A countdown with a bar at the top
 * says how long the window is open; after it the page points at support.
 *
 * Styled like the order confirmation email (shopify/order-confirmation): white
 * page, a thin rule under the header, a bordered card per print with the
 * product picture, the race name and year, size and frame chips, then the ink
 * footer panel. Big type: a lot of buyers are reading this on a phone.
 */
const API_BASE = import.meta.env.VITE_API_URL || ''
const FONT = "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif"
const LOGO = 'https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png'
const PURPLE = '#4600D6'

type Address = { name: string; address1: string; address2: string; city: string; province: string; zip: string; country: string; phone: string }
type Print = {
  id: string; raceName: string; year: number | null; runnerName: string; size: string | null; frame: string | null
  standard: boolean; photo: 'on_print' | 'after_race' | 'none'; preorder: boolean; image: string | null; photoUrl: string | null
}
type Info = { number: string | null; placedAt: string | null; closesAt: string | null; windowHours: number; canChange: boolean; reason: string | null; support: string; photoPrice: number; prints: Print[]; shipTo: Address | null }
type FrameChoice = { size: string; frame: string | null; difference: number }

const EMPTY: Address = { name: '', address1: '', address2: '', city: '', province: '', zip: '', country: 'US', phone: '' }
const input = 'w-full rounded-[5px] border border-[#E0E0E0] bg-white px-3 py-3 text-[17px] text-[#1A1A1A] outline-none focus:border-[#4600D6]'
const label = 'block text-[15px] font-medium text-[#666666] mb-1'
const card = 'bg-white rounded-[12px] border border-[#E0E0E0] p-4 md:p-5'
const primary = 'min-h-[52px] px-5 rounded-[5px] bg-[#4600D6] text-white text-[17px] font-bold flex items-center justify-center gap-2 hover:bg-[#3A00B0] transition-colors disabled:opacity-50'
const secondary = 'min-h-[52px] px-5 rounded-[5px] bg-white text-[#1A1A1A] text-[17px] font-bold border-[1.5px] border-[#1A1A1A] flex items-center justify-center gap-2 disabled:opacity-50'
const editBtn = 'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-[5px] border-[1.5px] border-[#4600D6] text-[16px] font-bold text-[#4600D6] bg-white disabled:opacity-50'
const chip = 'inline-block whitespace-nowrap rounded-[8px] border border-[#E0E0E0] px-3 py-1.5 text-[16px] font-bold text-[#1A1A1A]'
const REFUND_TIME = 'It can take 5 to 10 business days for the money to show up on your original payment method.'

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
  no_such_frame: "This print doesn't come in that size and frame.",
  same_frame: "That's the size and frame it already has.",
  still_saving: 'Your last change is still saving. Try again in a few minutes.',
  photo_failed: "We couldn't add the photo. Please try again, or reply to your order email.",
  has_photo: 'This print already has a photo.',
  no_photo: "This print doesn't have a photo to replace.",
  photo_changed: 'The photo was just changed. Reload the page to see it.',
}
/** The new address costs more sales tax: the server saved nothing and says how much. */
class TaxDue extends Error {
  constructor(public amount: number) { super('tax_due') }
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

/** How much of the window is left, 0 to 1, for the bar. */
function fractionLeft(placedAt: string | null, closesAt: string, now: number) {
  const end = new Date(closesAt).getTime()
  const start = placedAt ? new Date(placedAt).getTime() : end - 48 * 3600e3
  if (!(end > start)) return 0
  return Math.min(1, Math.max(0, (end - now) / (end - start)))
}

export default function ManageOrder() {
  const { order, sig } = useParams<{ order: string; sig: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'bad' | 'cancelled' | 'not_ready' | 'unavailable' | 'slow'>('loading')
  const [tries, setTries] = useState(0)
  const [refunded, setRefunded] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    document.title = 'Manage your order | Trackstar'
    // Only a link that is really wrong is "not working" (lib/publicLoad.ts); a busy
    // server or a dropped connection gets Try again.
    loadPublic<Info>(`${API_BASE}/api/public/manage-order?order=${encodeURIComponent(order || '')}&sig=${encodeURIComponent(sig || '')}`)
      .then(d => { setInfo(d); setState('ready') })
      .catch((e: LoadError) => setState(e.code === 'not_ready' ? 'not_ready' : e.gone ? 'bad' : 'unavailable'))
  }, [order, sig, tries])
  // A brand new order is still on its way in from Shopify: look again, a little
  // less often each time (30 s, 1, 2, then every 4 minutes), and stop after about
  // half an hour. A page left open used to poll every 30 seconds, use up its own
  // hourly limit, and then say the link was not working.
  useEffect(() => {
    if (state !== 'not_ready') return
    if (tries >= 10) { setState('slow'); return }
    const t = setTimeout(() => setTries(n => n + 1), 30e3 * Math.min(2 ** tries, 8))
    return () => clearTimeout(t)
  }, [state, tries])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30e3); return () => clearInterval(t) }, [])

  // One call shape for every change. A window that closed since the page
  // loaded comes back as a reason, and the page switches to the closed card.
  const post = async (body: Record<string, unknown>) => {
    let r: Response
    try {
      r = await fetch(`${API_BASE}/api/public/manage-order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, sig, ...body }) })
    } catch { throw new Error(OFFLINE) }
    const d = await r.json().catch(() => ({}))
    if (r.ok) return d
    if (['too_late', 'in_production', 'shipped', 'cancelled'].includes(d.error) || (d.error === 'unavailable' && ['in_production', 'cancelled'].includes(d.detail))) {
      const reason = d.error === 'too_late' ? 'window' : d.error === 'unavailable' ? d.detail : d.error
      setInfo(i => i ? { ...i, canChange: false, reason } : i)
      throw new Error(CLOSED[reason] || CLOSED.window)
    }
    if (d.error === 'tax_due') throw new TaxDue(Number(d.detail) || 0)
    throw new Error(d.error === 'bad_address' && d.detail ? `That address didn't work: ${d.detail}` : ERR[d.detail] || ERR[d.error] || 'Something went wrong. Try again in a moment.')
  }
  const setPrint = (p: Print) => setInfo(i => i ? { ...i, prints: i.prints.map(x => x.id === p.id ? { ...x, ...p, image: p.image || x.image } : x) } : i)

  const left = info?.closesAt && info.canChange ? timeLeft(info.closesAt, now) : null
  const frac = info?.closesAt ? fractionLeft(info.placedAt, info.closesAt, now) : 0
  // The order number goes in the subject and the first line, so support can find the order without asking.
  const supportHref = `mailto:${info?.support || 'fast@trackstar.art'}?subject=${encodeURIComponent(info?.number ? `Order #${info.number}` : 'My Trackstar order')}${info?.number ? `&body=${encodeURIComponent(`Order #${info.number}\n\n`)}` : ''}`

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#1A1A1A]" style={{ fontFamily: FONT, letterSpacing: '-0.04em' }}>
      <header className="w-full max-w-xl mx-auto px-5 pt-7 pb-4 flex items-center justify-between gap-4" style={{ borderBottom: '1px solid #E0E0E0' }}>
        <img src={LOGO} alt="Trackstar" className="h-[22px] md:h-[24px] w-auto" />
        {info?.number && <span className="text-[16px] font-medium text-[#666666]">Order #{info.number}</span>}
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-5 pt-6 pb-4 space-y-5">
        {state === 'loading' && <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#999999]" /></div>}

        {state === 'not_ready' && (
          <div className={card}>
            <p className="flex items-center gap-2 text-[20px] font-bold"><Loader2 className="w-5 h-5 animate-spin text-[#4600D6]" />We're setting up your order</p>
            <p className="text-[17px] text-[#666666] mt-2 leading-snug">Your order just came in. It takes a few minutes to get it ready to change here, so this page will refresh on its own. You can also come back to the link in your email any time in the next 48 hours.</p>
          </div>
        )}

        {state === 'unavailable' && (
          <div className={card}>
            <p className="text-[20px] font-bold">We couldn't load your order just now.</p>
            <p className="text-[17px] text-[#666666] mt-2">Check your connection and try again. Your link is fine.</p>
            <button onClick={() => window.location.reload()} className="mt-4 inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold" style={{ backgroundColor: '#1A1A1A', color: '#fff' }}>Try again</button>
          </div>
        )}

        {state === 'slow' && (
          <div className={card}>
            <p className="text-[20px] font-bold">Your order is taking longer than usual to set up.</p>
            <p className="text-[17px] text-[#666666] mt-2">Come back to the link in your email in a little while, or reply to that email and we'll help.</p>
            <button onClick={() => window.location.reload()} className="mt-4 inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold" style={{ backgroundColor: '#1A1A1A', color: '#fff' }}>Try again</button>
          </div>
        )}

        {state === 'bad' && (
          <div className={card}>
            <p className="text-[20px] font-bold">This link isn't working.</p>
            <p className="text-[17px] text-[#666666] mt-2">Reply to your order confirmation email and we'll help.</p>
          </div>
        )}

        {state === 'cancelled' && (
          <div className={card}>
            <p className="flex items-center gap-2 text-[22px] font-bold"><CheckCircle2 className="w-6 h-6 text-[#2E7D5B]" />Order cancelled</p>
            <p className="text-[17px] text-[#666666] mt-2 leading-snug">We've refunded {refunded}. {REFUND_TIME}</p>
          </div>
        )}

        {state === 'ready' && info && !info.canChange && (
          <>
            <h1 className="text-[30px] md:text-[34px] font-bold leading-[1.1]">Manage your order</h1>
            <div className={card}>
              <p className="text-[19px] leading-snug">{CLOSED[info.reason || 'window'] || CLOSED.window}</p>
              {info.reason !== 'cancelled' && (
                <>
                  <p className="text-[17px] text-[#666666] mt-2">Need something changed? Email us and we'll do what we can.</p>
                  <a href={supportHref} className={`${primary} mt-4 w-full`}>Email {info.support}</a>
                  <p className="text-[15px] text-[#666666] mt-3">Or reply to your order confirmation email.</p>
                </>
              )}
            </div>
            {/* After the 48 hours a photo can still be swapped until the print is made (a better photo, when we ask for one). */}
            {info.reason === 'window' && info.prints.filter(p => p.standard && p.photo === 'on_print').map(p => (
              <div key={p.id} className={card}>
                <p className="text-[15px] font-medium text-[#666666]">You can still replace the photo</p>
                <p className="text-[24px] font-bold leading-[1.1] mt-0.5 mb-2">{p.raceName}{p.year ? ` ${p.year}` : ''}</p>
                <ReplacePhotoRow print={p} post={post} onChange={setPrint} />
              </div>
            ))}
          </>
        )}

        {state === 'ready' && info && info.canChange && (
          <>
            {left && info.closesAt && (
              <div className="rounded-[12px] bg-[#F6F5F2] px-4 py-3.5">
                <p className="flex items-center gap-2 text-[18px] leading-snug">
                  <Clock className="w-5 h-5 shrink-0 text-[#4600D6]" aria-hidden />
                  {left.date ? <span>Changes can be made until <b>{left.date}</b></span> : <span><b>{left.text}</b> left to make changes</span>}
                </p>
                <div className="mt-2.5 h-2.5 w-full rounded-full bg-[#E0E0E0] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label="Time left to make changes">
                  <div className="h-full rounded-full bg-[#4600D6] transition-[width] duration-500" style={{ width: `${Math.max(3, frac * 100)}%` }} />
                </div>
              </div>
            )}
            <div>
              <h1 className="text-[30px] md:text-[34px] font-bold leading-[1.1]">Manage your order</h1>
              <p className="text-[18px] leading-snug mt-2">Fix a name, change the size or frame, add or replace a photo, or update your address. We'll print it exactly as it reads here.</p>
            </div>
            {info.prints.map(p => (
              <PrintCard key={p.id} print={p} photoPrice={info.photoPrice || 20} post={post} onChange={setPrint} />
            ))}
            <AddressCard shipTo={info.shipTo} post={post} onSaved={a => setInfo(i => i ? { ...i, shipTo: a } : i)} />
            <CancelCard post={post} onCancelled={d => { setRefunded(d); setState('cancelled'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
          </>
        )}
      </main>

      <footer className="w-full max-w-xl mx-auto px-5 pt-6 pb-8">
        <p className="text-[16px] text-[#666666] mb-6">Questions? <a href={supportHref} className="font-bold text-[#4600D6] underline underline-offset-4">Email us here</a></p>
        <div className="rounded-[18px] bg-[#1A1A1A] px-7 pt-8 pb-6">
          <img src="https://www.trackstar.art/cdn/shop/files/Trackstar_White_Logo_Cropped.png" alt="Trackstar" style={{ width: 140, height: 'auto', marginBottom: 12 }} />
          <p className="text-[19px] leading-snug text-[#E6E6E6] mb-5">Celebrating athletic achievement.</p>
          <a href="https://www.trackstar.art" className="inline-flex items-center min-h-[48px] px-6 rounded-[5px] bg-white text-[#1A1A1A] text-[16px] font-bold">Find their race</a>
          <p className="mt-6 pt-4 text-[14px] text-[#8A8A8A]" style={{ borderTop: '1px solid #3A3A3A' }}>&copy; {new Date().getFullYear()} Trackstar. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}

type Post = (body: Record<string, unknown>) => Promise<Record<string, unknown> & { print?: Print; choices?: FrameChoice[]; shipTo?: Address; refunded?: string | number; owed?: number; invoiced?: boolean; now?: string; price?: number }>

const priceNote = (d: number) => d > 0 ? `+${money(d)}` : d < 0 ? `${money(d)} less` : 'No extra cost'

/**
 * Size first, then the frame at that size, each with what it costs against
 * what they paid. 9777 wanted a bigger print and the page offered only
 * frames, so she picked Unframed by mistake: the size comes first now.
 */
function SizeFramePicker({ current, choices, size, pick, onSize, onPick }: {
  current: { size: string | null; frame: string | null }; choices: FrameChoice[]; size: string | null; pick: FrameChoice | null
  onSize: (s: string) => void; onPick: (c: FrameChoice) => void
}) {
  const sizes = [...new Set([...(current.size ? [current.size] : []), ...choices.map(c => c.size)])]
    .sort((a, b) => area(a) - area(b))
  const atSize = choices.filter(c => c.size === size)
  // What each size costs in the frame they have now. The cheapest option at a
  // size would read "12x18, $25 less" (unframed) to someone with a framed
  // print, the same trap as before.
  const sameFrame = (s: string) => choices.find(c => c.size === s && c.frame === current.frame) || null
  const sizeNote = (s: string) => {
    if (s === current.size) return 'Current'
    const same = sameFrame(s)
    if (same) return priceNote(same.difference)
    const ds = choices.filter(c => c.size === s).map(c => c.difference)
    return ds.length ? `from ${priceNote(Math.min(...ds))}` : ''
  }
  const pill = (on: boolean) => `min-h-[76px] px-2 py-3.5 rounded-[8px] border-[1.5px] text-center flex flex-col items-center justify-center gap-1 ${on ? '' : 'bg-white'}`
  return (
    <div className="mt-2 space-y-4">
      {sizes.length > 1 && (
        <div>
          <p className={label}>Size</p>
          {/* All on one line (three sizes today); a fourth would wrap to a second row of three. */}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${Math.min(sizes.length, 3)}, minmax(0, 1fr))` }}>
            {sizes.map(s => {
              const on = s === size
              return (
                <button key={s} type="button" onClick={() => { onSize(s); const same = sameFrame(s); if (same) onPick(same) }} className={pill(on)} style={{ borderColor: on ? PURPLE : '#E0E0E0', backgroundColor: on ? '#F6F3FF' : '#FFFFFF' }}>
                  <span className="text-[18px] font-bold leading-none">{s}</span>
                  <span className="text-[14px] text-[#666666] leading-tight whitespace-nowrap">{sizeNote(s)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div>
        <p className={label}>Frame</p>
        <div className="space-y-2">
          {size === current.size && current.frame && (
            <div className="w-full flex items-center justify-between rounded-[8px] border-[1.5px] border-[#E0E0E0] bg-[#F5F5F5] px-4 py-3.5">
              <span className="text-[17px] font-bold text-[#666666]">{current.frame}</span>
              <span className="text-[15px] text-[#666666]">Current</span>
            </div>
          )}
          {atSize.length === 0 && size !== current.size && <p className="text-[16px] text-[#666666]">No frames are available at this size.</p>}
          {atSize.map(c => {
            const on = pick?.size === c.size && pick?.frame === c.frame
            return (
              <button key={`${c.size}-${c.frame}`} type="button" onClick={() => onPick(c)} className="w-full flex items-center justify-between rounded-[8px] border-[1.5px] px-4 py-3.5 text-left" style={{ borderColor: on ? PURPLE : '#E0E0E0', backgroundColor: on ? '#F6F3FF' : '#FFFFFF' }}>
                <span className="text-[17px] font-bold">{c.frame || 'Print only'}</span>
                <span className="text-[15px] text-[#666666]">{priceNote(c.difference)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** "12x18" -> 216, for putting sizes smallest first; anything else sorts last. */
function area(s: string) {
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i)
  return m ? Number(m[1]) * Number(m[2]) : Infinity
}

function Row({ title, value, action, children }: { title: string; value: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="py-4" style={{ borderTop: '1px solid #E0E0E0' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] text-[#666666]">{title}</p>
          {value != null && <div className="text-[20px] font-bold leading-snug mt-0.5 break-words">{value}</div>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  )
}

/** The storefront's upload: a signed slot, the file, then photo-verify (which checks and cleans it). Returns the stored path. */
async function uploadPhoto(cropped: File): Promise<string> {
  const slot = await postJson('/api/public/photo-upload-url', { filename: cropped.name, contentType: cropped.type || 'image/jpeg', size: cropped.size })
  if (!slot.ok) throw new Error(slot.data.message || 'We could not start the upload. Please try again.')
  const put = await putUpload(slot.data.uploadUrl, { headers: { 'Content-Type': cropped.type || 'image/jpeg', 'x-upsert': 'false' }, body: cropped })
  if (!put.ok) throw new Error('The photo did not upload. Please try again.')
  const verified = await postJson('/api/public/photo-verify', { path: slot.data.path, contentType: cropped.type || 'image/jpeg' })
  if (!verified.ok) throw new Error(verified.data.message || 'That photo did not work. Please try a different one.')
  return verified.data.path
}

/** The photo on a print, with Replace: free, until the print is made. */
function ReplacePhotoRow({ print: p, post, onChange }: { print: Print; post: Post; onChange: (p: Print) => void }) {
  const [editing, setEditing] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const cropExport = useRef<(() => Promise<File>) | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')
  const close = () => { setEditing(false); setFile(null); setErr('') }
  const save = async () => {
    if (!file || !cropExport.current) return
    setBusy(true); setErr(''); setSaved('')
    try {
      const path = await uploadPhoto(await cropExport.current())
      const d = await post({ action: 'replace_photo', printId: p.id, path })
      if (d.print) onChange(d.print)
      close()
      setSaved("Photo replaced. We'll print it with your new photo.")
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  return (
    <Row title="Photo" value={null}
      action={!editing && <button type="button" className={editBtn} onClick={() => { setSaved(''); setEditing(true) }} disabled={busy}><ImagePlus className="w-4 h-4" />Replace</button>}>
      {!editing && (
        <div className="flex items-center gap-3 mt-2">
          {p.photoUrl && <img src={p.photoUrl} alt="Your photo for the print" className="w-[72px] h-[72px] rounded-[4px] border border-[#E0E0E0] object-cover" />}
          <p className="text-[18px] font-bold">On the print</p>
        </div>
      )}
      {editing && (
        <div className="mt-2 space-y-3">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { setFile(e.target.files?.[0] || null); setErr('') }} />
          {file ? (
            <>
              <PhotoCropper file={file} exportRef={cropExport} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="text-[15px] font-medium underline text-[#666666]">Choose a different photo</button>
            </>
          ) : (
            <button type="button" onClick={() => fileInput.current?.click()} className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-[8px] bg-[#F6F5F2]" style={{ border: '1.5px dashed #E0E0E0' }}>
              <ImagePlus className="w-7 h-7 text-[#4600D6]" />
              <span className="text-[18px] font-bold">Choose a new photo</span>
              <span className="text-[15px] text-[#666666] px-4 text-center">JPG or PNG. The original from your phone works best, not a screenshot. No extra charge.</span>
            </button>
          )}
          <div className="flex gap-2">
            {file && <button type="button" className={`${primary} flex-1`} onClick={save} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Use this photo</button>}
            <button type="button" className={file ? secondary : 'text-[15px] font-medium underline text-[#666666]'} onClick={close} disabled={busy}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="text-[15px] text-[#B42318] pt-2">{err}</p>}
      {saved && <p className="flex items-start gap-1.5 text-[16px] text-[#2E7D5B] pt-2 leading-snug"><CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />{saved}</p>}
    </Row>
  )
}

async function postJson(path: string, body: Record<string, unknown>) {
  let res: Response
  try { res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
  catch { return { ok: false, status: 0, data: { error: OFFLINE } } }
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

function PrintCard({ print: p, photoPrice, post, onChange }: { print: Print; photoPrice: number; post: Post; onChange: (p: Print) => void }) {
  const [editing, setEditing] = useState<null | 'name' | 'frame' | 'photo'>(null)
  const [name, setName] = useState(p.runnerName)
  const [frames, setFrames] = useState<FrameChoice[] | null>(null)
  const [pickSize, setPickSize] = useState<string | null>(null)
  const [current, setCurrent] = useState<{ size: string | null; frame: string | null }>({ size: null, frame: null })
  const [pick, setPick] = useState<FrameChoice | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [confirmPhoto, setConfirmPhoto] = useState(false)
  const cropExport = useRef<(() => Promise<File>) | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(''); setSaved('')
    try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.') } finally { setBusy(false) }
  }
  const close = () => { setEditing(null); setFile(null); setConfirmPhoto(false); setErr('') }
  const saveName = () => run(async () => {
    const d = await post({ action: 'name', printId: p.id, name })
    if (d.print) { onChange(d.print); setName(d.print.runnerName) }
    setEditing(null); setSaved(`The print will read ${d.print?.runnerName || name}.`)
  })
  const openFrames = () => run(async () => {
    const d = await post({ action: 'frames', printId: p.id })
    const cur = { size: (d.size as string) || p.size, frame: (d.frame as string) || p.frame }
    setFrames(d.choices || []); setCurrent(cur); setPickSize(cur.size); setPick(null); setEditing('frame')
  })
  const saveFrame = () => run(async () => {
    if (!pick) return
    const d = await post({ action: 'frame', printId: p.id, size: pick.size, frame: pick.frame })
    if (d.print) onChange(d.print)
    setEditing(null)
    const now = (d.now || '').replace(/^(\S+) /, '$1, ')
    setSaved(d.invoiced && d.owed ? `Changed to ${now}. We've emailed you an invoice for ${money(d.owed)}. Your print goes ahead once it's paid.`
      : d.refunded ? `Changed to ${now}. We've refunded ${money(Number(d.refunded))}. ${REFUND_TIME}`
      : `Changed to ${now}.`)
  })
  // Upload the storefront's way, then attach: the server adds the add-on and Shopify sends the invoice.
  const savePhoto = () => run(async () => {
    if (!file || !cropExport.current) return
    const path = await uploadPhoto(await cropExport.current())
    const d = await post({ action: 'photo', printId: p.id, path })
    if (d.print) onChange(d.print)
    close()
    setSaved(`Photo added. We've emailed you an invoice for ${money(Number(d.price || photoPrice))}. Your print goes ahead once it's paid.`)
  })

  const canPhoto = p.standard && p.photo === 'none'

  return (
    <div className={card}>
      <div className="flex items-start gap-4 pb-4">
        {p.image && <img src={p.image} alt="" className="w-[76px] md:w-[92px] h-auto rounded-[4px] shrink-0" />}
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-[#666666]">Order details</p>
          <p className="text-[24px] font-bold leading-[1.1] mt-0.5">{p.raceName}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {p.year && <span className={chip}>{p.year}</span>}
            {p.size && <span className={chip}>{p.size}</span>}
            {p.frame && <span className={`${chip} bg-[#1A1A1A] border-[#1A1A1A] text-white`}>{p.frame}</span>}
          </div>
        </div>
      </div>

      <Row
        title="Name on print"
        value={editing === 'name' ? null : p.runnerName}
        action={editing !== 'name' && <button type="button" className={editBtn} onClick={() => { close(); setEditing('name'); setName(p.runnerName); setSaved('') }} disabled={busy}><Pencil className="w-4 h-4" />Edit</button>}
      >
        {editing === 'name' && (
          <form onSubmit={e => { e.preventDefault(); saveName() }} className="mt-2 space-y-2">
            <input className={input} value={name} onChange={e => setName(e.target.value)} autoFocus maxLength={80} placeholder="First and last name" />
            <p className="text-[15px] text-[#666666]">Exactly as it should appear on the print.</p>
            <div className="flex gap-2">
              <button type="submit" className={`${primary} flex-1`} disabled={busy || !name.trim()}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Save name</button>
              <button type="button" className={secondary} onClick={close} disabled={busy}>Cancel</button>
            </div>
          </form>
        )}
      </Row>

      {(p.size || p.frame) && (
        <Row
          title="Size and frame"
          value={editing === 'frame' ? null : [p.size, p.frame].filter(Boolean).join(', ')}
          action={editing !== 'frame' && <button type="button" className={editBtn} onClick={() => { close(); openFrames() }} disabled={busy}>{busy && !editing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}Change</button>}
        >
          {editing === 'frame' && frames && (
            <SizeFramePicker current={current} choices={frames} size={pickSize} pick={pick}
              onSize={s => { setPickSize(s); setPick(null) }} onPick={setPick} />
          )}
          {editing === 'frame' && frames && (
            <div className="mt-3 space-y-2">
              {pick && pick.difference > 0 && <p className="text-[15px] text-[#666666]">We'll email you an invoice for {money(pick.difference)}. Your print goes ahead once it's paid.</p>}
              {pick && pick.difference < 0 && <p className="text-[15px] text-[#666666]">We'll refund the {money(pick.difference)} difference to your card right away.</p>}
              <div className="flex gap-2">
                <button type="button" className={`${primary} flex-1`} onClick={saveFrame} disabled={busy || !pick}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Save change</button>
                <button type="button" className={secondary} onClick={close} disabled={busy}>Cancel</button>
              </div>
            </div>
          )}
        </Row>
      )}

      {p.photo === 'on_print' && (p.standard
        ? <ReplacePhotoRow print={p} post={post} onChange={onChange} />
        : (
          <Row title="Photo" value={null}>
            <div className="flex items-center gap-3 mt-2">
              {p.photoUrl && <img src={p.photoUrl} alt="Your photo for the print" className="w-[72px] h-[72px] rounded-[4px] border border-[#E0E0E0] object-cover" />}
              <p className="text-[18px] font-bold">On the print</p>
            </div>
          </Row>
        ))}
      {p.photo === 'after_race' && (
        <Row title="Photo" value="Coming after the race">
          <p className="text-[16px] text-[#666666] mt-1">We'll email you a link to add it the day after race day.</p>
        </Row>
      )}
      {canPhoto && (
        <Row
          title="Photo"
          value={editing === 'photo' ? null : 'No photo'}
          action={editing !== 'photo' && <button type="button" className={editBtn} onClick={() => { close(); setSaved(''); setEditing('photo') }} disabled={busy}><ImagePlus className="w-4 h-4" />Add photo</button>}
        >
          {editing === 'photo' && (
            <div className="mt-2 space-y-3">
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { setFile(e.target.files?.[0] || null); setConfirmPhoto(false); setErr('') }} />
              {file ? (
                <>
                  <PhotoCropper file={file} exportRef={cropExport} />
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className="text-[15px] font-medium underline text-[#666666]">Choose a different photo</button>
                </>
              ) : (
                <button type="button" onClick={() => fileInput.current?.click()} className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-[8px] bg-[#F6F5F2]" style={{ border: '1.5px dashed #E0E0E0' }}>
                  <ImagePlus className="w-7 h-7 text-[#4600D6]" />
                  <span className="text-[18px] font-bold">Choose a photo</span>
                  <span className="text-[15px] text-[#666666] px-4 text-center">JPG or PNG. The original from your phone works best, not a screenshot.</span>
                </button>
              )}
              {file && !confirmPhoto && (
                <div className="flex gap-2">
                  <button type="button" className={`${primary} flex-1`} onClick={() => { setErr(''); setConfirmPhoto(true) }} disabled={busy}>Use this photo</button>
                  <button type="button" className={secondary} onClick={close} disabled={busy}>Cancel</button>
                </div>
              )}
              {!file && <button type="button" className="text-[15px] font-medium underline text-[#666666]" onClick={close}>Cancel</button>}
              {file && confirmPhoto && (
                <div className="rounded-[8px] border-[1.5px] border-[#4600D6] bg-[#F6F3FF] p-4">
                  <p className="text-[19px] font-bold">Adding a photo is {money(photoPrice)}</p>
                  <p className="text-[16px] leading-snug mt-1">We'll add the photo to your order and email you an invoice for {money(photoPrice)}. Your print goes ahead once it's paid.</p>
                  <div className="flex gap-2 mt-3">
                    <button type="button" className={`${primary} flex-1`} onClick={savePhoto} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Add photo for {money(photoPrice)}</button>
                    <button type="button" className={secondary} onClick={() => setConfirmPhoto(false)} disabled={busy}>Back</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Row>
      )}

      {err && <p className="text-[15px] text-[#B42318] pt-1">{err}</p>}
      {saved && <p className="flex items-start gap-1.5 text-[16px] text-[#2E7D5B] pt-1 leading-snug"><CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />{saved}</p>}
    </div>
  )
}

function AddressCard({ shipTo, post, onSaved }: { shipTo: Address | null; post: Post; onSaved: (a: Address) => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Address>({ ...EMPTY, ...(shipTo || {}) })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [taxDue, setTaxDue] = useState<number | null>(null)
  const [invoiced, setInvoiced] = useState<number | null>(null)
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  const lines = (a: Address) => [a.name, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean)
  // First try without accepting tax. If the new address costs more, the server
  // saves nothing and the form asks; "Accept and save" sends it again.
  const send = async (acceptTax: boolean) => {
    setBusy(true); setErr(''); setSaved(false)
    try {
      const d = await post({ action: 'address', address: form, acceptTax })
      if (d.shipTo) { onSaved(d.shipTo); setForm({ ...EMPTY, ...d.shipTo }) }
      setInvoiced(d.invoiced && Number(d.taxOwed) > 0 ? Number(d.taxOwed) : null)
      setTaxDue(null); setEditing(false); setSaved(true)
    } catch (x) {
      if (x instanceof TaxDue) setTaxDue(x.amount)
      else setErr(x instanceof Error ? x.message : 'Something went wrong.')
    } finally { setBusy(false) }
  }
  const save = (e: React.FormEvent) => { e.preventDefault(); send(false) }
  const edit = <K extends keyof Address>(k: K) => (e: React.ChangeEvent<HTMLInputElement>) => { setTaxDue(null); set(k)(e) }
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[20px] font-bold"><MapPin className="w-5 h-5 text-[#4600D6]" />Ship to</p>
          {!editing && (shipTo ? <p className="text-[18px] mt-2 leading-snug">{lines(shipTo).map((l, i) => <span key={i} className="block">{l}</span>)}</p> : <p className="text-[18px] text-[#666666] mt-2">No address on file.</p>)}
        </div>
        {!editing && <button type="button" className={editBtn} onClick={() => { setEditing(true); setSaved(false) }}><Pencil className="w-4 h-4" />Edit</button>}
      </div>
      {editing && (
        <form onSubmit={save} className="mt-3 space-y-3">
          <div><label className={label}>Full name</label><input className={input} value={form.name} onChange={edit('name')} autoComplete="shipping name" required /></div>
          <div><label className={label}>Street address</label><input className={input} value={form.address1} onChange={edit('address1')} autoComplete="shipping address-line1" required /></div>
          <div><label className={label}>Apartment, suite, etc. (optional)</label><input className={input} value={form.address2} onChange={edit('address2')} autoComplete="shipping address-line2" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>City</label><input className={input} value={form.city} onChange={edit('city')} autoComplete="shipping address-level2" required /></div>
            <div><label className={label}>State</label><input className={input} value={form.province} onChange={edit('province')} autoComplete="shipping address-level1" placeholder="NY" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>Zip</label><input className={input} value={form.zip} onChange={edit('zip')} autoComplete="shipping postal-code" required /></div>
            <div><label className={label}>Country</label><input className={input} value={form.country} onChange={edit('country')} autoComplete="shipping country" placeholder="US" required /></div>
          </div>
          <div><label className={label}>Phone (optional)</label><input className={input} value={form.phone} onChange={edit('phone')} autoComplete="shipping tel" inputMode="tel" /></div>
          {err && <p className="text-[15px] text-[#B42318]">{err}</p>}
          {taxDue !== null ? (
            <div className="rounded-[8px] border border-[#E0E0E0] bg-[#F6F5F2] p-4">
              <p className="text-[19px] font-bold leading-tight">This address adds {money(taxDue)} in sales tax</p>
              <p className="text-[17px] text-[#666666] mt-1.5 leading-snug">We collect sales tax in this state. If you save it, we'll email you a separate invoice for {money(taxDue)} to cover the tax.</p>
              <div className="flex gap-2 mt-4">
                <button type="button" className={`${primary} flex-1`} onClick={() => send(true)} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Accept and save</button>
                <button type="button" className={secondary} onClick={() => setTaxDue(null)} disabled={busy}>Back</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[15px] text-[#666666] leading-snug">If the new address is in a state where we collect sales tax, we'll tell you the amount before saving and email you an invoice for it.</p>
              <div className="flex gap-2">
                <button type="submit" className={`${primary} flex-1`} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Update address</button>
                <button type="button" className={secondary} onClick={() => { setEditing(false); setTaxDue(null); setForm({ ...EMPTY, ...(shipTo || {}) }) }} disabled={busy}>Cancel</button>
              </div>
            </>
          )}
        </form>
      )}
      {!editing && err && <p className="text-[15px] text-[#B42318] mt-2">{err}</p>}
      {saved && !editing && <p className="flex items-center gap-1.5 text-[16px] text-[#2E7D5B] mt-3"><CheckCircle2 className="w-5 h-5 shrink-0" />{invoiced ? `Address updated. Check your email for the ${money(invoiced)} sales tax invoice.` : 'Address updated.'}</p>}
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
    <div className="pt-1 text-center">
      {!confirm ? (
        <button type="button" className="text-[16px] text-[#666666] underline min-h-[44px]" onClick={() => setConfirm(true)}>Need to cancel this order?</button>
      ) : (
        <div className={`${card} text-left`}>
          <p className="text-[20px] font-bold">Cancel and refund this order?</p>
          <p className="text-[17px] text-[#666666] mt-1 leading-snug">We'll refund the full amount. {REFUND_TIME}</p>
          {err && <p className="text-[15px] text-[#B42318] mt-2">{err}</p>}
          <div className="flex gap-2 mt-4">
            <button type="button" className={`${secondary} flex-1`} onClick={cancel} disabled={busy}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}Yes, cancel my order</button>
            <button type="button" className="min-h-[52px] px-4 text-[17px] font-bold text-[#4600D6]" onClick={() => setConfirm(false)} disabled={busy}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  )
}
