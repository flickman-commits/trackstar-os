import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, CheckCircle2, ImagePlus } from 'lucide-react'
import PhotoCropper from '@/components/PhotoCropper'
import SiteFooter from '@/components/SiteFooter'
import { putUpload } from '../lib/putUpload'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * /photo/:token - "add photo after the race" (server/domain/orders/photoLater.js).
 * A pre-order customer paid for the photo at checkout and gets this link the
 * day after the race. They crop to the print's square here, the same crop the
 * storefront wizard gives, and the photo goes on the print with nobody in
 * between. Or they say they want it without one, which prints it now and
 * refunds the add-on.
 *
 * The upload is the storefront's own: a signed slot from photo-upload-url, a
 * PUT straight to storage, photo-verify on the bytes, then the verified path
 * is attached here.
 */

const T = { page: '#FFFFFF', card: '#F6F5F2', ink: '#1A1A1A', muted: '#666666', line: '#E0E0E0', accent: '#4600D6', font: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif" }

type Info = {
  state: 'waiting' | 'uploaded' | 'skipped' | 'closed'
  runnerName: string
  raceYear: number | null
  orderNumber: string
  firstName: string | null
  deadline: string | null
  refunded: boolean
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

async function postJson(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export default function PhotoLater() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<Info | null>(null)
  const [gone, setGone] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const cropExport = useRef<(() => Promise<File>) | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | 'skip' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmSkip, setConfirmSkip] = useState(false)

  useEffect(() => {
    document.title = 'Add your photo | Trackstar'
    fetch(`${API_BASE}/api/public/photo-later?token=${encodeURIComponent(token || '')}`)
      .then(async r => { if (!r.ok) throw new Error(); setInfo(await r.json()) })
      .catch(() => setGone(true))
  }, [token])

  // Done, skipped or closed is a short card: bring it into view, or a phone
  // is left looking at the footer below where the cropper was.
  const shown = info?.state
  useEffect(() => { if (shown && shown !== 'waiting') window.scrollTo({ top: 0, behavior: 'smooth' }) }, [shown])

  const upload = async () => {
    if (!file || !cropExport.current) return
    setBusy('upload'); setErr(null)
    try {
      const cropped = await cropExport.current()
      const slot = await postJson('/api/public/photo-upload-url', { filename: cropped.name, contentType: cropped.type || 'image/jpeg', size: cropped.size })
      if (!slot.ok) throw new Error(slot.data.message || 'We could not start the upload. Please try again.')
      const put = await putUpload(slot.data.uploadUrl, { headers: { 'Content-Type': cropped.type || 'image/jpeg', 'x-upsert': 'false' }, body: cropped })
      if (!put.ok) throw new Error('The photo did not upload. Please try again.')
      const verified = await postJson('/api/public/photo-verify', { path: slot.data.path, contentType: cropped.type || 'image/jpeg' })
      if (!verified.ok) throw new Error(verified.data.message || 'That photo did not work. Please try a different one.')
      const done = await postJson('/api/public/photo-later', { token, action: 'attach', path: verified.data.path })
      if (done.status === 409) { setInfo(i => i && { ...i, state: 'closed' }); return }
      if (!done.ok) throw new Error('We could not save the photo. Please try again.')
      setInfo(done.data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally { setBusy(null) }
  }

  const skip = async () => {
    setBusy('skip'); setErr(null)
    try {
      const done = await postJson('/api/public/photo-later', { token, action: 'skip' })
      if (!done.ok && done.status !== 409) throw new Error()
      setInfo(done.ok ? done.data : (i => i && { ...i, state: 'closed' }))
    } catch { setErr('Something went wrong. Please try again.') } finally { setBusy(null); setConfirmSkip(false) }
  }

  // A plain function, not a component: a component defined inside render is
  // a new type every render, which remounts the cropper and loses the crop.
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: T.page, fontFamily: T.font, letterSpacing: '-0.04em', color: T.ink }}>
      <header className="w-full max-w-xl mx-auto px-4 pt-6 pb-2 flex items-center justify-between gap-4">
        <img src="https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png" alt="Trackstar" className="shrink-0 h-6 w-auto" />
        {info && <span style={{ color: T.muted, fontSize: '16px', fontWeight: 500 }}>Order #{info.orderNumber}</span>}
      </header>
      <main className="w-full max-w-xl mx-auto px-4 py-4 flex-1">{children}</main>
      <SiteFooter />
    </div>
  )
  const card = (children: React.ReactNode, extra = '') => <div className={`p-6 ${extra}`} style={{ backgroundColor: T.card, borderRadius: 8 }}>{children}</div>

  if (gone) return shell(card(<><h1 className="text-xl font-bold mb-2">This link is no longer active</h1><p style={{ color: T.muted }}>Reply to your order email and we'll sort it out.</p></>))
  if (!info) return shell(<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#999' }} /></div>)

  if (info.state !== 'waiting') {
    const [title, body] = info.state === 'uploaded'
      ? ['Got it, thank you.', `Your photo is on ${info.runnerName}'s poster. We'll print it and send it your way.`]
      : info.state === 'skipped'
        ? ['No problem.', `We'll print ${info.runnerName}'s poster without a photo${info.refunded ? ' and have refunded the photo add-on' : ' and refund the photo add-on'}.`]
        : ['This poster is already on its way.', `${info.runnerName}'s poster has gone to print, so there's nothing more to do here. Questions? Reply to your order email.`]
    return shell(card(<div className="text-center py-4">
      <CheckCircle2 className="w-8 h-8 mx-auto mb-3" style={{ color: T.accent }} />
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p style={{ color: T.muted, fontSize: '17px' }}>{body}</p>
    </div>))
  }

  return shell(
    <>
      <div className="mb-4">
        <h1 className="text-2xl font-bold mb-2" style={{ lineHeight: 1.2 }}>{info.firstName ? `Hey ${info.firstName}, add` : 'Add'} your photo to {info.runnerName}'s poster</h1>
        <p style={{ color: T.muted, fontSize: '17px', lineHeight: 1.4 }}>
          Pick a photo, then drag and zoom so the part you want is inside the square. That square is exactly what prints.
          {info.deadline && ` Upload it by ${day(info.deadline)} and it goes straight to print.`}
        </p>
      </div>

      {card(
        <>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { setFile(e.target.files?.[0] || null); setErr(null) }} />
          {file ? (
            <>
              <PhotoCropper file={file} exportRef={cropExport} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={!!busy} className="mt-3 text-sm font-medium underline" style={{ color: T.muted }}>Choose a different photo</button>
            </>
          ) : (
            <button type="button" onClick={() => fileInput.current?.click()} className="w-full flex flex-col items-center justify-center gap-2 py-12" style={{ border: `1.5px dashed ${T.line}`, borderRadius: 8, backgroundColor: '#FFFFFF' }}>
              <ImagePlus className="w-7 h-7" style={{ color: T.accent }} />
              <span className="font-bold" style={{ fontSize: '17px' }}>Choose a photo</span>
              <span style={{ color: T.muted, fontSize: '14px' }}>JPG or PNG. The original from your phone works best, not a screenshot.</span>
            </button>
          )}
          {err && <p className="mt-3 text-sm" style={{ color: '#B42318' }}>{err}</p>}
          {file && (
            <button type="button" onClick={upload} disabled={!!busy} className="w-full mt-4 font-bold disabled:opacity-50" style={{ backgroundColor: T.accent, color: '#FFFFFF', borderRadius: 5, minHeight: 56, fontSize: '17px' }}>
              {busy === 'upload' ? <Loader2 className="w-5 h-5 animate-spin inline" /> : 'Use this photo'}
            </button>
          )}
        </>,
      )}

      <div className="mt-6 text-center">
        {confirmSkip ? (
          <div className="p-4" style={{ border: `1px solid ${T.line}`, borderRadius: 8 }}>
            <p className="mb-3" style={{ fontSize: '15px' }}>Print {info.runnerName}'s poster without a photo? We'll refund the photo add-on.</p>
            <div className="flex gap-2 justify-center">
              <button type="button" onClick={skip} disabled={!!busy} className="px-4 font-bold disabled:opacity-50" style={{ border: `1.5px solid ${T.ink}`, borderRadius: 5, minHeight: 44 }}>
                {busy === 'skip' ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Yes, print without a photo'}
              </button>
              <button type="button" onClick={() => setConfirmSkip(false)} disabled={!!busy} className="px-4" style={{ color: T.muted, minHeight: 44 }}>Keep the photo</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmSkip(true)} className="text-sm underline" style={{ color: T.muted }}>I'd rather print it without a photo</button>
        )}
      </div>
    </>,
  )
}
