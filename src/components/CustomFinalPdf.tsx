import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, ExternalLink, Loader2, Pause, RotateCw, Send, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnGhost } from '@/lib/ui'
import { putUpload } from '../lib/putUpload'

/**
 * The end of a custom order. Once the customer approves, the designer uploads
 * the final PDF here; the server saves it to the Drive Orders folder and the
 * Artelo library (server/domain/orders/customFinal.js), and a few minutes
 * later attaches it to the Artelo order and sends it to production, which
 * completes the order (server/domain/render/arteloSend.js). Until then anyone
 * can Hold it. Held, refused by Artelo, or with sending switched off, an
 * admin sends it from here or attaches it in Artelo by hand and marks it
 * complete; Mark complete shows once Attach has been opened.
 */
type Send = { state: 'queued' | 'held' | 'waiting' | 'blocked' | 'manual' | 'sent'; at?: string | null; by?: string | null; reason?: string; next?: string | null }
type FinalPdf = {
  id: string; fileName: string; uploadedAt: string; pdfUrl: string | null
  driveUrl: string | null; driveError: string | null; inArtelo: boolean; arteloError: string | null
  send: Send | null
}
const clock = (t?: string | null) => t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''

const openedKey = (id: string) => `custom-final-attach:${id}`
function readOpened(id: string) { try { return localStorage.getItem(openedKey(id)) === '1' } catch { return false } }
function writeOpened(id: string) { try { localStorage.setItem(openedKey(id), '1') } catch { /* per visit only */ } }

export default function CustomFinalPdf({ orderId, displayOrderNumber, fileName, designStatus, arteloOrderUrl, canAttach, onUploaded, onComplete }: {
  orderId: string
  displayOrderNumber: string
  /** The shop's filename for this print, without .pdf */
  fileName: string
  designStatus: string
  arteloOrderUrl?: string | null
  /** Admins attach in Artelo and complete; a designer's part ends at the upload. */
  canAttach: boolean
  onUploaded: () => void
  onComplete: () => void
}) {
  const [finalPdf, setFinalPdf] = useState<FinalPdf | null | undefined>(undefined)
  const [busy, setBusy] = useState<'upload' | 'retry' | 'send' | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [opened, setOpened] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const orderNo = displayOrderNumber.startsWith('#') ? displayOrderNumber : `#${displayOrderNumber}`

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/orders/final-pdf?orderId=${encodeURIComponent(orderId)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the final PDF')
      setFinalPdf(data.finalPdf)
    } catch (e) { setFinalPdf(null); toast.error((e as Error).message) }
  }, [orderId])
  useEffect(() => { load() }, [load])
  // On its way to production: look again every 15 seconds, and refresh the order once it is sent.
  const sendState = finalPdf?.send?.state
  useEffect(() => {
    if (sendState !== 'queued' && sendState !== 'waiting') return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [sendState, load])
  const wasSending = useRef(false)
  useEffect(() => {
    if (sendState === 'sent' && wasSending.current) onUploaded()
    wasSending.current = sendState === 'queued' || sendState === 'waiting'
  }, [sendState])  // eslint-disable-line react-hooks/exhaustive-deps

  const sendAction = async (action: 'hold' | 'send-now') => {
    setBusy('send')
    try {
      const res = await apiFetch('/api/orders/artelo-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, orderId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'That did not work')
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  useEffect(() => { setOpened(finalPdf ? readOpened(finalPdf.id) : false) }, [finalPdf?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (body: Record<string, unknown>) => {
    const res = await apiFetch('/api/orders/final-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, ...body }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'That did not work')
    return data
  }

  const upload = async (file: File) => {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { toast.error('Upload the final design as a PDF'); return }
    setBusy('upload')
    try {
      const slot = await post({ action: 'upload-url' })
      const put = await putUpload(slot.uploadUrl, { headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: file })
      if (!put.ok) throw new Error(`Storage said ${put.status}. Try again.`)
      const data = await post({ action: 'record', path: slot.path, fileName })
      setFinalPdf(data.finalPdf)
      setReplacing(false)
      const fp = data.finalPdf as FinalPdf | null
      if (fp?.send?.state === 'queued') toast.success(`Saved. It goes to Artelo production at ${clock(fp.send.at)} unless someone holds it.`)
      else if (fp?.driveUrl && fp.inArtelo) toast.success('Saved to Drive and the Artelo library. Matt has been pinged to send it to production.')
      else toast.warning('Uploaded, but not everywhere yet. See below.')
      onUploaded()
    } catch (e) { toast.error((e as Error).message) } finally {
      setBusy(null)
      if (input.current) input.current.value = ''
    }
  }

  const retry = async () => {
    setBusy('retry')
    try { setFinalPdf((await post({ action: 'retry' })).finalPdf) } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  const picker = (
    <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden"
      onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
  )

  if (finalPdf === undefined) {
    return <div className="flex items-center gap-2 text-xs text-off-black/50 py-3"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
  }

  // Step 1: the customer approved, so the final PDF comes next.
  if (!finalPdf || replacing) {
    return (
      <div className="space-y-2">
        {picker}
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] leading-snug text-off-black">
          <span className="font-semibold text-emerald-700 mr-1.5">{replacing ? 'Upload a different PDF.' : 'Customer approved. Upload the final PDF.'}</span>
          Export the print-ready PDF and upload it here. It is saved to the Drive Orders folder and the Artelo library as <span className="font-mono">{fileName}.pdf</span>.
        </div>
        <button onClick={() => input.current?.click()} disabled={busy !== null}
          className="w-full flex items-center justify-center gap-2 py-4 text-base rounded-md bg-dark-fill text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
          {busy === 'upload' ? <><Loader2 className="w-5 h-5 animate-spin" /> Uploading, then saving to Drive and Artelo…</> : <><Upload className="w-5 h-5" /> Upload final PDF</>}
        </button>
        {replacing && <button onClick={() => setReplacing(false)} className={`${btnGhost} w-full justify-center`}>Cancel</button>}
        {/* An order moved to Final PDF Uploaded under the old flow has no file here. */}
        {!replacing && canAttach && designStatus === 'final_pdf_uploaded' && (
          <button onClick={onComplete} className={`${btnGhost} w-full justify-center`}>Already attached in Artelo and sent to production? Mark complete</button>
        )}
      </div>
    )
  }

  // Step 2: in the library. Where the file went, for everyone.
  const placed = Boolean(finalPdf.driveUrl && finalPdf.inArtelo)
  const where = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {finalPdf.driveUrl
        ? <a href={finalPdf.driveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-green-700 hover:underline"><Check className="w-3 h-3" />Saved to Drive <ExternalLink className="w-3 h-3" /></a>
        : <span className="inline-flex items-center gap-1 text-red-700 font-semibold" title={finalPdf.driveError || undefined}><X className="w-3 h-3" />Not in Drive{finalPdf.driveError ? `: ${finalPdf.driveError}` : ''}</span>}
      {finalPdf.inArtelo
        ? <span className="inline-flex items-center gap-1 text-green-700"><Check className="w-3 h-3" />In the Artelo library</span>
        : <span className="inline-flex items-center gap-1 text-red-700 font-semibold" title={finalPdf.arteloError || undefined}><X className="w-3 h-3" />Not in Artelo{finalPdf.arteloError ? `: ${finalPdf.arteloError}` : ''}</span>}
      {finalPdf.pdfUrl && <a href={finalPdf.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-off-black/55 hover:text-off-black">Open PDF <ExternalLink className="w-3 h-3" /></a>}
      {!placed && (
        <button onClick={retry} disabled={busy !== null} className="inline-flex items-center gap-1 text-off-black/70 hover:text-off-black font-medium disabled:opacity-50">
          {busy === 'retry' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />} Try again
        </button>
      )}
    </div>
  )

  // On its way: queued (Hold), attached and waiting on the order's other prints, or sent.
  const send = finalPdf.send
  if (send && ['queued', 'waiting', 'sent'].includes(send.state)) {
    return (
      <div className="space-y-2">
        {picker}
        <div className={`rounded-md border px-3 py-2.5 text-[13px] leading-snug text-off-black space-y-2 ${send.state === 'sent' ? 'border-green-200 bg-green-50' : 'border-[#4600D6]/30 bg-[#4600D6]/[0.04]'}`}>
          <div className="flex items-center gap-3">
            <p className="flex-1">
              <span className={`font-semibold mr-1.5 ${send.state === 'sent' ? 'text-green-700' : 'text-[#4600D6]'}`}>
                {send.state === 'sent' ? `Sent to production ${clock(send.at)}.` : send.state === 'waiting' ? 'Attached in Artelo.' : `Sending to production at ${clock(send.at)}.`}
              </span>
              {send.state === 'sent' ? 'Artelo has it as Received.' : send.state === 'waiting' ? 'The Artelo order goes once every print on it is ready.' : <><span className="font-mono">{finalPdf.fileName}</span> is attached to the Artelo order and sent. Hold it if something is wrong.</>}
            </p>
            {send.state === 'queued' && (
              <button onClick={() => sendAction('hold')} disabled={busy !== null} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-white border-2 border-[#4600D6]/30 text-[#4600D6] font-semibold hover:bg-[#4600D6]/[0.04] disabled:opacity-50">
                {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />} Hold
              </button>
            )}
          </div>
          {where}
        </div>
        {send.state === 'queued' && <button onClick={() => setReplacing(true)} disabled={busy !== null} className={`${btnGhost} w-full justify-center`}>Upload a different PDF</button>}
      </div>
    )
  }
  // Held, or Artelo would not take it: say so, and (for whoever can) Send to production.
  const sendBar = send && (send.state === 'manual' ? (
    <div className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2.5 text-[13px] leading-snug text-red-800">
      <span className="font-semibold mr-1.5">Manually attach and add expedited shipping to this order.</span>
      It was not sent: Artelo only sends Standard shipping from here. Attach it in Artelo, change the shipping method, send it to production, then mark it complete.
    </div>
  ) : (
    <div className="space-y-2">
      <div className={`rounded-md border px-3 py-2.5 text-[13px] leading-snug ${send.state === 'blocked' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
        <span className="font-semibold mr-1.5">{send.state === 'blocked' ? 'Artelo would not take it.' : 'Held.'}</span>
        {send.state === 'blocked' ? `${send.reason}.${send.next ? ' The tool tries again on its own.' : ''}` : `Held${send.by ? ` by ${send.by}` : ''} ${clock(send.at)}. It does not go to production until someone sends it.`}
      </div>
      <button onClick={() => sendAction('send-now')} disabled={busy !== null} className="w-full inline-flex items-center justify-center gap-2 py-4 text-base rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
        {busy === 'send' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} {send.state === 'blocked' ? 'Try sending again' : 'Send to production'}
      </button>
    </div>
  ))

  // A designer's part is done: Matt attaches it in Artelo and sends it through.
  if (!canAttach) {
    return (
      <div className="space-y-2">
        {picker}
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] leading-snug text-off-black space-y-2">
          <p>
            <span className="font-semibold text-emerald-700 mr-1.5">Final PDF uploaded.</span>
            {send ? 'It has not gone to production yet; see below.' : <>Matt has been pinged on Slack. He attaches <span className="font-mono">{finalPdf.fileName}</span> to the Artelo order and sends it to production. Nothing else to do here.</>}
          </p>
          {where}
        </div>
        {sendBar}
        <button onClick={() => setReplacing(true)} disabled={busy !== null} className={`${btnGhost} w-full justify-center`}>Upload a different PDF</button>
      </div>
    )
  }

  // An admin: attach it to the Artelo order, send it through, mark it complete.
  return (
    <div className="space-y-2">
      {picker}
      <div className="rounded-md border border-[#4600D6]/30 bg-[#4600D6]/[0.04] px-3 py-2.5 text-[13px] leading-snug text-off-black space-y-2">
        <p>
          <span className="font-semibold text-[#4600D6] mr-1.5">Attach in Artelo.</span>
          Open the Artelo order and check it is order <span className="font-semibold">{orderNo}</span>. Attach <span className="font-mono">{finalPdf.fileName}</span> from the Orders folder of the library to the item, send it to production, then mark the order complete here.
        </p>
        {where}
      </div>
      {sendBar || (
        // Uploaded before Approve sent things, or with sending off: send it from here.
        <button onClick={() => sendAction('send-now')} disabled={busy !== null} className="w-full inline-flex items-center justify-center gap-2 py-4 text-base rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
          {busy === 'send' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} Send to production
        </button>
      )}

      <div className={`grid gap-3 ${opened || !arteloOrderUrl ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
        {arteloOrderUrl ? (
          <a href={arteloOrderUrl} target="_blank" rel="noopener noreferrer" onClick={() => { writeOpened(finalPdf.id); setOpened(true) }}
            className={`flex items-center justify-center gap-2 py-4 text-base rounded-md font-semibold transition-opacity ${opened ? 'bg-white border-2 border-[#4600D6]/30 text-[#4600D6] hover:bg-[#4600D6]/[0.04]' : 'bg-[#4600D6] text-white hover:opacity-90'}`}>
            <img src="/artelo-icon.png" alt="" className="w-5 h-5 rounded-[4px]" /> Attach in Artelo <ArrowUpRight className="w-4 h-4 opacity-70" />
          </a>
        ) : (
          <div className="flex items-center justify-center text-center px-3 py-3 rounded-md border border-border-gray bg-subtle-gray text-xs text-off-black/60">
            No Artelo order is linked. Find order {orderNo} in Artelo and attach the file there.
          </div>
        )}
        {(opened || !arteloOrderUrl) && (
          <button onClick={onComplete} className="inline-flex items-center justify-center gap-2 py-4 text-base rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 transition-colors">
            <Check className="w-5 h-5" /> Sent to production, mark complete
          </button>
        )}
      </div>
      <button onClick={() => setReplacing(true)} disabled={busy !== null} className={`${btnGhost} w-full justify-center`}>Upload a different PDF</button>
    </div>
  )
}
