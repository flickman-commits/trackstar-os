import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Download, Check, X, RefreshCw, ArrowUpRight, Send, Pause } from 'lucide-react'
import type { Design } from '@/lib/useDesign'
import { btnPrimary, btnGhost, inputBase } from '@/lib/ui'

/**
 * The automated print for a standard order, in three pieces the order view
 * places itself: the design card (the print, or what it is waiting on and a
 * Create Design button) where the order's preview sits, the review buttons
 * under it, and a thin row of design details beside the filename. One hook
 * (useDesign) holds the state all three read. "Create Design" queues a
 * render; a Mac with Illustrator (worker/) fills the race template and
 * uploads the PDF; nothing goes to Artelo without a person's approval.
 * Approve sends the print to production after a short hold
 * (server/domain/render/arteloSend.js); Approve only leaves it at Attach.
 */

function WorkerDot({ d, small = false }: { d: Design; small?: boolean }) {
  const online = d.state?.workersOnline || []
  // small: the dot alone, beside Re-render, with who is online on hover.
  if (small) return <span className={`w-2 h-2 rounded-full ${d.offline ? 'bg-red-500' : 'bg-green-500'}`} title={d.offline ? 'Renderer offline: no render worker has checked in for a minute and a half' : `Renderer online: ${online.join(', ')}`} aria-label={d.offline ? 'Renderer offline' : 'Renderer online'} />
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-off-black/55" title={d.offline ? 'No render worker has checked in for a minute and a half' : `Online: ${online.join(', ')}`}>
      <span className={`w-2 h-2 rounded-full ${d.offline ? 'bg-red-500' : 'bg-green-500'}`} aria-hidden />
      {d.offline ? 'Renderer offline' : online.join(', ')}
    </span>
  )
}

/** Sits where the order's preview goes: the finished print, or its status and a Create Design button. */
export function DesignCard({ d }: { d: Design }) {
  const [lightbox, setLightbox] = useState(false)
  if (d.reserved && !d.state) return <div className="w-full md:w-[347px] md:max-w-full aspect-[2/3] md:aspect-auto md:h-[520px] self-start rounded-md border border-border-gray bg-subtle-gray animate-pulse" />
  if (!d.visible || !d.state) return null
  const { job, state } = d

  if (job?.status === 'done' && job.previewUrl) {
    // The box takes the print's shape (8x10 is 4:5, the rest 2:3), so an 8x10 has no bands above and below.
    const m = /^(\d+)x(\d+)$/.exec(job.spec.size || '')
    const ratio = m ? `${m[1]} / ${m[2]}` : '2 / 3'
    return (
      <div className="self-start w-full md:w-auto flex flex-col items-center gap-2">
        <button onClick={() => setLightbox(true)} style={{ aspectRatio: ratio }} className="relative self-start w-full md:w-[347px] md:max-w-full rounded-md border border-border-gray bg-subtle-gray overflow-hidden" title="Open larger">
          <img src={job.previewUrl} alt={`Render of ${job.spec.file}`} className="w-full h-full object-contain block" />
          {job.review !== 'pending' && (
            <span className={`absolute top-2 left-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-semibold ${job.review === 'approved' ? 'bg-green-100 text-green-800' : job.review === 'closed' ? 'bg-off-black/10 text-off-black/70' : 'bg-red-100 text-red-800'}`}>
              {job.review === 'approved' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
              {job.review === 'approved' ? 'Approved' : job.review === 'closed' ? 'Closed' : 'Rejected'}
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {job.pdfUrl && (
            <a href={job.pdfUrl} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-off-black/60 hover:text-off-black hover:bg-off-black/5 transition-colors">
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          )}
          {d.canManage && (
            <button onClick={d.create} disabled={d.busy || !state.eligible} title={state.eligible ? 'Render this order again' : state.reasons.join('. ')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-off-black/60 hover:text-off-black hover:bg-off-black/5 disabled:opacity-40 transition-colors">
              {d.creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-render
            </button>
          )}
          {d.canManage && <WorkerDot d={d} small />}
        </div>
        {lightbox && (
          <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(false)}>
            <img src={job.previewUrl} alt="" className="max-h-full max-w-full rounded shadow-2xl" />
          </div>
        )}
      </div>
    )
  }

  const inFlight = job && (job.status === 'queued' || job.status === 'rendering')
  return (
    <div className="w-full md:w-[347px] md:max-w-full aspect-[2/3] md:aspect-auto md:h-[520px] self-start rounded-md border border-dashed border-border-gray bg-subtle-gray flex flex-col items-center justify-center gap-3 p-4 text-center">
      <span className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider">Design</span>
      {inFlight ? (
        <div className="flex flex-col items-center gap-2 text-sm text-off-black/70">
          <Loader2 className="w-5 h-5 animate-spin" />
          {job!.status === 'queued' ? (d.offline ? 'Waiting for a render worker' : 'Waiting in the queue') : 'Illustrator is rendering'}
        </div>
      ) : (
        <>
          {job?.status === 'failed' && <p className="text-xs text-red-600">Render failed: {job.error}</p>}
          {!job && !state.eligible && <p className="text-xs text-off-black/55">Waiting on: {state.reasons.join('. ')}.</p>}
          {d.canManage && (
            <button onClick={d.create} disabled={d.busy || !state.eligible} className={btnPrimary} title={state.eligible ? 'Fill the race template with this order and render the print' : state.reasons.join('. ')}>
              {d.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : job ? <RefreshCw className="w-3.5 h-3.5" /> : <Sparkles className="w-4 h-4" />}
              {job ? 'Try again' : 'Create Design'}
            </button>
          )}
        </>
      )}
      <WorkerDot d={d} />
      {d.err && <p className="text-xs text-red-600">{d.err}</p>}
    </div>
  )
}

/** Approve and Reject, large: reviewing the print is the main thing this view is for. */
// Remembered per render in this browser, so Mark as complete is still there
// after looking at another order. Storage can be unavailable; then it is per visit.
const attachKey = (jobId: string) => `trackstar:attach-opened:${jobId}`
function readOpened(jobId: string) { try { return localStorage.getItem(attachKey(jobId)) === '1' } catch { return false } }
function writeOpened(jobId: string) { try { localStorage.setItem(attachKey(jobId), '1') } catch { /* per visit only */ } }

// Words that point at the production file rather than the order's data. Only
// a first guess for the reject form's checkbox; the reviewer decides.
const FILE_WORDS = /overlap|spill|runs? (into|over)|cut ?off|clipp|font|kern|spacing|align|layer|artboard|template|logo|course|route|map\b|colou?r|bleed|photo window|too (big|small|close|long)|position|placement|margin|wrap/i
const DATA_WORDS = /wrong (name|bib|time|pace|date|year|race|weather|temp)|misspell|typo|spelled/i
function looksLikeFileProblem(note: string) {
  return FILE_WORDS.test(note) && !DATA_WORDS.test(note)
}

// For the first week Approve sends things to production, the first approval
// of the day in this browser asks once. Storage can be unavailable; then it asks every visit.
const CONFIRM_UNTIL = '2026-10-31'
const confirmKey = () => `trackstar:send-confirmed:${new Date().toLocaleDateString('en-CA')}`
function needsConfirm() {
  if (new Date().toLocaleDateString('en-CA') > CONFIRM_UNTIL) return false
  try { return localStorage.getItem(confirmKey()) !== '1' } catch { return true }
}
function rememberConfirm() { try { localStorage.setItem(confirmKey(), '1') } catch { /* asks again next visit */ } }

const clock = (t?: string | null) => t ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''

/** An approved print on its way to production: queued (Hold), waiting on the order's other prints, or sent. */
function SendStatus({ d, compact, onComplete }: { d: Design; compact: boolean; onComplete?: () => void }) {
  const s = d.job?.send
  if (!s || !['queued', 'waiting', 'sent'].includes(s.state)) return null
  const pad = compact ? 'py-3 text-[15px]' : 'py-3.5 text-base'
  return (
    <div className={`rounded-md border px-4 ${compact ? 'py-2.5' : 'py-3'} flex items-center gap-3 ${s.state === 'sent' ? 'border-green-200 bg-green-50' : 'border-[#4600D6]/25 bg-[#4600D6]/[0.04]'}`}>
      {s.state === 'sent' ? <Check className="w-5 h-5 text-green-700 shrink-0" /> : <Send className="w-5 h-5 text-[#4600D6] shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className={`font-semibold ${s.state === 'sent' ? 'text-green-800' : 'text-[#4600D6]'}`}>
          {s.state === 'sent' ? `Sent to production ${clock(s.at)}` : s.state === 'waiting' ? 'Uploaded, waiting on other prints' : `Sending to production at ${clock(s.at)}`}
        </p>
        <p className="text-xs text-off-black/60">
          {s.state === 'sent' ? 'Artelo has it as Received.' : s.state === 'waiting' ? 'Attached to its item in Artelo. The order goes to production once every print on it has its design.' : 'Attached to the Artelo order and sent. Hold it if something is wrong.'}
        </p>
      </div>
      {/* Send right away: skip the rest of the hold; the sender takes it within a minute. */}
      {s.state === 'queued' && d.canManage && (
        <button onClick={() => { void d.sendAction('send-now') }} disabled={d.busy} title="Skip the wait: it goes to Artelo within a minute" className={`inline-flex items-center gap-1.5 px-4 ${pad} rounded-md bg-[#4600D6] border-2 border-[#4600D6] text-white font-semibold hover:bg-[#3a00b3] disabled:opacity-50`}>
          {d.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send right away
        </button>
      )}
      {/* Its design is on the Artelo item, so it can be done here while the others catch up. */}
      {s.state === 'waiting' && onComplete && (
        <button onClick={onComplete} className={`inline-flex items-center gap-1.5 px-4 ${pad} rounded-md bg-green-600 border-2 border-green-600 text-white font-semibold hover:bg-green-700`}>
          <Check className="w-4 h-4" /> {compact ? 'Complete' : 'Mark as complete'}
        </button>
      )}
      {s.state === 'queued' && d.canManage && (
        <button onClick={() => { void d.sendAction('hold') }} disabled={d.busy} className={`inline-flex items-center gap-1.5 px-4 ${pad} rounded-md bg-white border-2 border-[#4600D6]/30 text-[#4600D6] font-semibold hover:bg-[#4600D6]/[0.04] disabled:opacity-50`}>
          {d.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />} Hold
        </button>
      )}
    </div>
  )
}

export function DesignReview({ d, arteloOrderUrl = null, onComplete, compact = false }: { d: Design; arteloOrderUrl?: string | null; onComplete?: () => void; compact?: boolean }) {
  // compact: the phone's bottom bar, shorter buttons in the same order.
  const pad = compact ? 'py-3 text-[15px]' : 'py-4 text-base'
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [fileProblem, setFileProblem] = useState<boolean | null>(null)
  const [confirming, setConfirming] = useState(false)
  const job = d.job
  const [opened, setOpened] = useState(false)
  useEffect(() => { setOpened(job ? readOpened(job.id) : false) }, [job?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  // A approves, R starts a rejection, while a design waits for review. The card
  // renders twice (phone bar and desktop), so only the one on screen listens,
  // or one key press would act twice. Typing in a field never triggers them.
  const approveRef = useRef<() => void>(() => {})
  const reviewable = Boolean(d.visible && d.canManage && job?.status === 'done' && job.review === 'pending')
  useEffect(() => {
    if (!reviewable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return
      if (window.matchMedia('(min-width: 768px)').matches === compact) return
      if (d.busy) return
      const k = e.key.toLowerCase()
      if (k === 'a') { e.preventDefault(); approveRef.current() }
      else if (k === 'r') { e.preventDefault(); setRejecting(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewable, compact, d.busy])
  // Once approved, A opens the Artelo order to attach the file (F then marks it
  // complete, from the order view: Dashboard.tsx).
  const onTheWay = ['queued', 'waiting', 'sent'].includes(job?.send?.state || '')
  const attachable = Boolean(d.visible && job?.status === 'done' && job.review === 'approved' && arteloOrderUrl && !onTheWay)
  const openArtelo = () => {
    if (!job || !arteloOrderUrl) return
    writeOpened(job.id); setOpened(true)
  }
  const openArteloRef = useRef(openArtelo)
  openArteloRef.current = openArtelo
  useEffect(() => {
    if (!attachable || !arteloOrderUrl) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return
      if (window.matchMedia('(min-width: 768px)').matches === compact) return
      if (e.key.toLowerCase() !== 'a') return
      e.preventDefault()
      window.open(arteloOrderUrl, '_blank', 'noopener,noreferrer')
      openArteloRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [attachable, arteloOrderUrl, compact])
  // Approved and on its way to production: its status, and Hold.
  if (d.visible && job?.status === 'done' && job.review === 'approved' && onTheWay) return <SendStatus d={d} compact={compact} onComplete={onComplete} />
  // Approved and not sent (Approve only, held, or Artelo would not take it):
  // Send to production, or attach the file in Artelo by hand. Mark as
  // complete appears beside Attach only once Attach has been clicked, and
  // Attach stays, because a click is not proof the attaching got done.
  if (d.visible && job?.status === 'done' && job.review === 'approved' && arteloOrderUrl) {
    const held = job.send?.state === 'held'
    // Expedited: the API only sends Standard shipping, so this one is attached by hand.
    const manual = job.send?.state === 'manual'
    return (
      <div className="space-y-2">
      {manual && (
        <div className="rounded-md border-2 border-red-300 bg-red-50 px-3 py-2.5 text-[13px] leading-snug text-red-800">
          <span className="font-semibold mr-1.5">Manually attach and add expedited shipping to this order.</span>
          It was not sent: Artelo only sends Standard shipping from here. Attach it in Artelo, change the shipping method, send it to production, then mark it complete.
        </div>
      )}
      {d.canManage && d.autoSend && !manual && (
        <>
          {held && <p className="text-xs text-amber-700">Held{job.send?.by ? ` by ${job.send.by}` : ''} {clock(job.send?.at)}. It stays approved until someone sends it.</p>}
          <button onClick={() => { void d.sendAction('send-now') }} disabled={d.busy} className={`w-full inline-flex items-center justify-center gap-2 ${pad} rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors`}>
            {d.busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />} {job.send?.state === 'blocked' ? 'Try sending again' : 'Send to production'}
          </button>
        </>
      )}
      <div className={`grid gap-3 ${opened && onComplete ? (compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2') : 'grid-cols-1'}`}>
        <a href={arteloOrderUrl} target="_blank" rel="noopener noreferrer" onClick={openArtelo}
          className={`flex items-center justify-center gap-2 ${pad} rounded-md font-semibold transition-opacity ${opened ? 'bg-white border-2 border-[#4600D6]/30 text-[#4600D6] hover:bg-[#4600D6]/[0.04]' : 'bg-[#4600D6] text-white hover:opacity-90'}`}>
          <img src="/artelo-icon.png" alt="" className="w-5 h-5 rounded-[4px]" /> {compact && opened ? 'Attach' : 'Attach in Artelo'} <ArrowUpRight className="w-4 h-4 opacity-70" />
          {!compact && <kbd className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] font-medium opacity-70 font-sans ${opened ? 'border-[#4600D6]/30' : 'border-white/30'}`}>A</kbd>}
        </a>
        {opened && onComplete && (
          <button onClick={onComplete} className={`inline-flex items-center justify-center gap-2 ${pad} rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 transition-colors`}>
            <Check className="w-5 h-5" /> {compact ? 'Complete' : 'Mark as complete'}
            {!compact && <kbd className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded border border-white/30 text-[11px] font-medium opacity-70 font-sans">F</kbd>}
          </button>
        )}
      </div>
      </div>
    )
  }
  if (!d.visible || !d.canManage || job?.status !== 'done' || job.review !== 'pending') return null
  if (rejecting) {
    // A problem in the file goes on Dan's Design Needs; wrong data does not.
    // The box follows the note until someone ticks or unticks it.
    const isFile = fileProblem ?? looksLikeFileProblem(note)
    const reject = () => d.review('rejected', note, isFile).then(ok => { if (ok) { setRejecting(false); setNote(''); setFileProblem(null) } })
    return (
      <div className="space-y-2">
        <div className={compact ? 'grid grid-cols-[1fr,auto] gap-2' : 'flex gap-2'}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="What is wrong with it?" className={`${inputBase} flex-1`} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && note.trim()) reject() }} />
          <button onClick={reject} disabled={d.busy || !note.trim()} className="px-5 py-3 rounded-md bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-40">{compact ? 'Reject' : 'Reject with note'}</button>
          <button onClick={() => { setRejecting(false); setNote(''); setFileProblem(null) }} className={`${btnGhost} ${compact ? 'col-span-2 justify-center' : ''}`}>Cancel</button>
        </div>
        <label className="flex items-start gap-2 text-xs text-off-black/70 cursor-pointer">
          <input type="checkbox" checked={isFile} onChange={e => setFileProblem(e.target.checked)} className="mt-0.5 accent-[#4600D6]" />
          <span><span className="font-medium text-off-black">Design file problem</span>: the layout, a layer or the artboard needs Dan. Goes on Settings &gt; Design Needs. Leave it off for wrong data (name, bib, time, date, weather).</span>
        </label>
      </div>
    )
  }
  // Approve records the decision; the Drive and Artelo uploads run after it on
  // the server, and a few minutes later the print goes to production (Hold
  // stops it). Approve only leaves it at Attach, for an order that needs work by hand.
  const approveAndSend = () => {
    if (d.autoSend && needsConfirm()) { setConfirming(true); return }
    void d.review('approved')
  }
  approveRef.current = confirming ? () => { rememberConfirm(); setConfirming(false); void d.review('approved') } : approveAndSend
  if (confirming) {
    return (
      <div className="rounded-md border-2 border-green-600/30 bg-green-50 p-4 space-y-3">
        <p className="text-sm text-green-900"><span className="font-semibold">New: Approve sends this print to production.</span> It is attached to the Artelo order and sent in a few minutes, and the order completes. You can Hold it until then.</p>
        <div className="flex flex-wrap gap-2">
          <button autoFocus onClick={() => { rememberConfirm(); setConfirming(false); void d.review('approved') }} disabled={d.busy} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
            <Send className="w-4 h-4" /> Approve &amp; send
          </button>
          <button onClick={() => { setConfirming(false); void d.review('approved', undefined, false, false) }} disabled={d.busy} className={btnGhost}>Approve only, don't send</button>
          <button onClick={() => setConfirming(false)} className={btnGhost}>Cancel</button>
        </div>
      </div>
    )
  }
  const approve = (
    <button key="a" onClick={approveAndSend} disabled={d.busy} className={`inline-flex items-center justify-center gap-2 ${pad} rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors`}>
      {d.busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />} {d.autoSend ? (compact ? 'Approve & send' : 'Approve & send to production') : 'Approve'}
      {!compact && <kbd className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded border border-white/30 text-[11px] font-medium opacity-70 font-sans">A</kbd>}
    </button>
  )
  const reject = (
    <button key="r" onClick={() => setRejecting(true)} disabled={d.busy} className={`inline-flex items-center justify-center gap-2 ${pad} rounded-md bg-white border-2 border-red-200 text-red-700 font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors`}>
      <X className="w-5 h-5" /> Reject
      {!compact && <kbd className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded border border-red-200 text-[11px] font-medium opacity-70 font-sans">R</kbd>}
    </button>
  )
  // On a phone Approve is the wide button on the right, under the thumb.
  return (
    <div className="space-y-1.5">
      <div className={`grid gap-3 ${compact ? 'grid-cols-[1fr,2fr]' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {compact ? [reject, approve] : [approve, reject]}
      </div>
      {d.autoSend && (
        <p className="text-[11px] text-off-black/50">
          Goes to Artelo production in a few minutes; you can Hold it until then.{' '}
          <button onClick={() => { void d.review('approved', undefined, false, false) }} disabled={d.busy} className="underline decoration-dotted underline-offset-2 hover:text-off-black disabled:opacity-40">Approve only, don't send</button>
        </p>
      )}
    </div>
  )
}

function fmt(t: string | null) {
  return t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
}

function Check2({ ok, label, title }: { ok: boolean | null; label: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 ${ok === false ? 'text-red-700 font-semibold' : ok ? 'text-green-700' : 'text-off-black/40'}`}>
      {ok === false ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}{label}
    </span>
  )
}

/**
 * Above the review buttons: what the print was made from, and what the PDF
 * measured (trim, bleed, color) so nobody has to open it to trust it.
 */
export function DesignDetails({ d }: { d: Design }) {
  const job = d.job
  if (!d.visible || !job || job.status !== 'done') return null
  const o = job.output
  const b = o?.bleedIn
  const bleedOk = b ? [b.left, b.right, b.top, b.bottom].every(v => Math.abs(v - 0.25) <= 0.01) : null
  const made = [
    `v${job.version}${job.requestedBy === 'system' ? ' auto' : ''}`,
    job.spec.template || null,
    job.spec.photoPath ? 'photo' : 'no photo',
    job.spec.noTime ? 'no time' : null,
    `made ${fmt(job.finishedAt || job.createdAt)}`,
  ].filter(Boolean).join(' · ')
  return (
    <div className="bg-subtle-gray border border-border-gray rounded-md px-3 py-2.5 space-y-1.5 text-xs">
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
        <span className="text-body-sm text-off-black/60">Design Details</span>
        <span className="text-off-black/55">{made}</span>
        <span className="ml-auto flex items-center gap-3">
          {job.spec.dateSourceUrl && <a href={job.spec.dateSourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" title={`Date verified (${job.spec.dateSource})`}>Date source ↗</a>}
          {job.pdfUrl && <a href={job.pdfUrl} className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Download className="w-3 h-3" /> PDF</a>}
          {d.canManage && (
            <button onClick={d.create} disabled={d.busy || !d.state?.eligible} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 disabled:opacity-40" title={d.state?.eligible ? 'Render this order again' : d.state?.reasons.join('. ')}>
              <RefreshCw className="w-3 h-3" /> Re-render
            </button>
          )}
        </span>
      </div>
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
        {o ? (
          <>
            <Check2 ok={o.trimIn ? o.trimIn === job.spec.size : null} label={`${o.trimIn || job.spec.size} trim`} title="Measured from the PDF's trim box" />
            <Check2 ok={bleedOk} label={b ? (bleedOk ? '0.25" bleed all sides' : `bleed ${b.left}/${b.right}/${b.top}/${b.bottom}"`) : 'bleed'} title="Measured from the PDF's bleed box" />
            <Check2 ok={o.color ? o.color === 'CMYK' : null} label={o.color || 'color'} title="Read from the PDF's color operators and images" />
          </>
        ) : (
          <span className="text-off-black/40">Not measured (made before the PDF check)</span>
        )}
        {job.review === 'approved' && (
          <span className="ml-auto flex items-center gap-3">
            <span className="text-off-black/55">Approved{job.reviewer ? ` by ${job.reviewer}` : ''} {fmt(job.reviewedAt)}</span>
            {job.deliveredAt
              ? <a href={job.deliveredPath || '#'} target="_blank" rel="noopener noreferrer" className="text-green-700 hover:underline">In Orders folder ↗</a>
              : <span className="text-red-700">Not in Drive: {job.deliveryError || 'retrying'}</span>}
            {job.arteloUploadedAt
              ? <a href={job.arteloUrl || '#'} target="_blank" rel="noopener noreferrer" className="text-green-700 hover:underline">In Artelo library ↗</a>
              : <span className="text-red-700">Not in Artelo: {job.arteloError || 'retrying'}</span>}
          </span>
        )}
      </div>
      {job.notes && <div className="text-amber-700">{job.notes}</div>}
      {job.reviewNote && <div className={job.review === 'closed' ? 'text-off-black/60' : 'text-red-700'}>{job.review === 'closed' ? 'Closed' : 'Rejected'}: {job.reviewNote}</div>}
      {d.err && <div className="text-red-600">{d.err}</div>}
    </div>
  )
}

/** A small tag, styled like the order's other chips. tone: green ok, red problem, purple Artelo, gray neutral. */
/** Where the approved print went, as one quiet line for under the filename. Nothing until a design is approved. */
export function DesignFileLinks({ d }: { d: Design }) {
  const job = d.job
  if (!d.visible || !job || job.status !== 'done' || job.review !== 'approved') return null
  const link = 'underline decoration-dotted underline-offset-2 hover:text-off-black'
  // Just approved: the uploads run after the click and land within seconds.
  const fresh = job.reviewedAt && Date.now() - new Date(job.reviewedAt).getTime() < 120000
  if (fresh && (!job.deliveredAt || !job.arteloUploadedAt) && !job.deliveryError && !job.arteloError) {
    return <p className="mt-1 text-[11px] text-off-black/50 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Sending to the Orders folder and the Artelo library…</p>
  }
  return (
    <p className="mt-1 text-[11px] text-off-black/50">
      This file is{' '}
      {job.deliveredAt
        ? <a href={job.deliveredPath || undefined} target="_blank" rel="noopener noreferrer" className={link}>in the Orders folder ↗</a>
        : <span className="text-red-600" title={job.deliveryError || undefined}>not in the Orders folder</span>}
      {' and '}
      {job.arteloUploadedAt
        ? <a href={job.arteloUrl || undefined} target="_blank" rel="noopener noreferrer" className={link}>in the Artelo library ↗</a>
        : <span className="text-red-600" title={job.arteloError || undefined}>not in the Artelo library</span>}
      .
    </p>
  )
}

function Tag({ tone = 'gray', children, href, title, onClick }: { tone?: 'green' | 'red' | 'purple' | 'gray' | 'blue'; children: React.ReactNode; href?: string | null; title?: string; onClick?: () => void }) {
  const cls = `inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium ${
    tone === 'green' ? 'bg-green-50 border-green-200 text-green-800'
    : tone === 'red' ? 'bg-red-50 border-red-200 text-red-700'
    : tone === 'purple' ? 'bg-[#4600D6]/[0.06] border-[#4600D6]/25 text-[#4600D6]'
    : tone === 'blue' ? 'bg-blue-50 border-blue-200 text-blue-700'
    : 'bg-white border-border-gray text-off-black/70'}`
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" title={title} className={`${cls} hover:opacity-80`}>{children}</a>
  if (onClick) return <button type="button" onClick={onClick} title={title} className={`${cls} hover:opacity-80 disabled:opacity-40`}>{children}</button>
  return <span title={title} className={cls}>{children}</span>
}

/**
 * Design Details for the right column: what the print was made from and what
 * its PDF measured, as tags, colored where it means something (green = checked
 * and fine, red = a problem, purple = in Artelo).
 */
export function DesignDetailsTags({ d }: { d: Design }) {
  const job = d.job
  if (!d.visible || !job || job.status !== 'done') return null
  const o = job.output
  const b = o?.bleedIn
  const bleedOk = b ? [b.left, b.right, b.top, b.bottom].every(v => Math.abs(v - 0.25) <= 0.01) : null
  const ok = (v: boolean | null) => v === null ? 'gray' : v ? 'green' : 'red'
  return (
    <div>
      <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Design Details</h4>
      <div className="flex flex-wrap gap-1.5">
        {/* The race, photo, approver and date source all show elsewhere on the order;
            what belongs here is the version and what the PDF measured. */}
        <Tag title={`${job.requestedBy === 'system' ? 'Rendered automatically' : 'Re-rendered by hand'}, ${fmt(job.createdAt)}`}>V{job.version}</Tag>
        {job.spec.noTime && <Tag tone="red">No time</Tag>}
        {o ? (
          <>
            <Tag tone={ok(o.trimIn ? o.trimIn === job.spec.size : null)} title="Measured from the PDF's trim box">{o.trimIn ? o.trimIn === job.spec.size ? '✓ ' : '✕ ' : ''}{o.trimIn || job.spec.size} trim</Tag>
            <Tag tone={ok(bleedOk)} title="Measured from the PDF's bleed box">{bleedOk === null ? '' : bleedOk ? '✓ ' : '✕ '}{b && !bleedOk ? `bleed ${b.left}/${b.right}/${b.top}/${b.bottom}"` : '0.25" bleed'}</Tag>
            <Tag tone={ok(o.color ? o.color === 'CMYK' : null)} title="Read from the PDF's color">{o.color === 'CMYK' ? '✓ ' : o.color ? '✕ ' : ''}{o.color || 'Color'}</Tag>
          </>
        ) : <Tag title="Made before the PDF check">Not measured</Tag>}
      </div>
      {/* "photo placed" is already the Photo placed tag above; the rest of the notes are worth a look. */}
      {(() => {
        const notes = (job.notes || '').split('; ').filter(n => n && n !== 'photo placed').join('; ')
        return notes ? <p className="mt-1.5 text-xs text-amber-700">{notes}</p> : null
      })()}
      {job.reviewNote && <p className="mt-1 text-xs text-red-700">{job.review === 'closed' ? 'Closed' : 'Rejected'}: {job.reviewNote}</p>}
      {d.err && <p className="mt-1 text-xs text-red-600">{d.err}</p>}
    </div>
  )
}
