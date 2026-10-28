import { useEffect, useRef, useState } from 'react'
import { nameCase } from '@/lib/nameCase'
import { ArrowUpRight, Loader2, Mail, Paperclip, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi } from '@/lib/supportApi'
import { btnPrimary, btnSecondary } from '@/lib/ui'
import type { Mockup } from '@/types/support'

const chip = (on: boolean) => `px-2 py-0.5 rounded-full border text-[11px] ${on ? 'border-[#4600D6] bg-[#4600D6] text-white' : 'border-[#4600D6]/25 text-[#4600D6] hover:bg-[#4600D6]/5'}`

/**
 * "Email customer" from an order in TrackstarOS. Usually it is the
 * same note: we need one more detail (a bib number, the last name they
 * registered under, a finish time). It sends from fast@ through the support
 * mailbox, so the conversation and their reply live in Support. Or it sends
 * the design for them to approve, and the print waits on their answer.
 */
export interface EmailCustomerOrder {
  id: string
  /** The number the customer knows (Shopify's order name), not our row's id. */
  displayNumber: string
  customerEmail?: string | null
  customerName?: string | null
  runnerName?: string | null
  raceName?: string | null
  raceYear?: number | string | null
}

const ASK = '[what we need]'
// Each chip writes the whole email for that one ask; picking another replaces it.
type Pick = 'bib' | 'name' | 'time' | 'race' | 'mockup'
const ASKS: { id: Exclude<Pick, 'mockup'>; label: string; text: string }[] = [
  { id: 'bib', label: 'Bib number', text: "their bib number from the race. It's on the race app, the confirmation email, or the bib itself" },
  { id: 'name', label: 'Last name', text: 'the full name they registered under, exactly as on the results (a maiden name, a hyphenated name or a nickname is often why we cannot find them)' },
  { id: 'time', label: 'Finish time', text: 'their official finish time (chip time if you have it)' },
  { id: 'race', label: 'Which race', text: 'which race and year this print is for, and the distance they ran' },
]

function firstName(name?: string | null) {
  const f = String(name || '').trim().split(/\s+/)[0] || ''
  return f ? nameCase(f) : ''
}

function template(o: EmailCustomerOrder, rep: string, pick: Pick | null) {
  const who = firstName(o.customerName)
  const runner = String(o.runnerName || '').trim()
  const race = [o.raceName, o.raceYear].filter(Boolean).join(' ')
  const forWhat = runner && race ? `${runner}'s ${race} print` : race ? `your ${race} print` : 'your print'
  const hi = `Hey${who ? ` ${who}` : ''},`
  const bye = `Thanks,\n${rep} from Trackstar`
  if (pick === 'mockup') return `${hi}

Thanks so much for your order! Here's the design for ${forWhat}, attached. Before we send it to print, could you take a quick look and make sure everything is exactly how you want it: the name, the race and the details?

Just reply "looks good" and we'll send it to print, or tell us what to change.

${bye}`
  const ask = ASKS.find(a => a.id === pick)?.text || ASK
  return `${hi}

Thanks so much for your order! We're getting started on ${forWhat}, and we need one more thing from you before we can finish it: ${ask}.

Just reply to this email and we'll take it from there.

${bye}`
}

export default function EmailCustomerModal({ order, repName, onClose }: { order: EmailCustomerOrder; repName: string; onClose: () => void }) {
  const number = String(order.displayNumber).replace(/^#/, '')
  const subjects = { ask: `Trackstar Order ${number} (Action Required)`, mockup: `Trackstar Order ${number} (Please Approve Your Design)` }
  const rep = repName || 'The team'
  const [subject, setSubject] = useState(subjects.ask)
  const [pick, setPick] = useState<Pick | null>(null)
  const [text, setText] = useState(() => template(order, rep, null))
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ threadId: string; to: string; held?: boolean } | null>(null)
  // The design the customer would approve: the newest render, else the newest proof.
  const [mockup, setMockup] = useState<Mockup | null>(null)
  // Or a design made by hand: a file from the rep's computer, which replaces
  // the render for this email.
  const [ownFile, setOwnFile] = useState<{ ref: string; name: string; preview: string | null } | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const attachOwn = async (f: File | undefined) => {
    if (!f) return
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.type)) { toast.error('A mockup is a PNG, JPG or PDF'); return }
    setUploading(true)
    try {
      const slot = await supportApi.uploadSlot(f.name, f.type, f.size)
      const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.type, 'x-upsert': 'false' }, body: f })
      if (!put.ok) throw new Error(`${f.name} did not upload`)
      setOwnFile({ ref: slot.ref, name: slot.filename, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null })
    } catch (e) { toast.error((e as Error).message) }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = '' }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  useEffect(() => {
    let live = true
    supportApi.orderConversations(order.id).then(r => {
      const list = (r.mockups || []).filter(m => m.orderId === order.id)
      if (live) setMockup(list.find(m => m.kind === 'render') || list.find(m => m.kind === 'proof') || null)
    }).catch(() => {})
    return () => { live = false }
  }, [order.id])

  const unfilled = text.includes(ASK)
  const choose = (next: Pick) => {
    // Anything typed into the email since the last template would be lost.
    if (text !== template(order, rep, pick) && !window.confirm('Replace what you wrote with this template?')) return
    setPick(next)
    setText(template(order, rep, next))
    if (subject === subjects.ask || subject === subjects.mockup) setSubject(next === 'mockup' ? subjects.mockup : subjects.ask)
    box.current?.focus()
  }
  // What goes attached: a file made by hand wins over the render.
  const attached = pick === 'mockup' ? (ownFile ? { ref: ownFile.ref, label: ownFile.name, thumbUrl: ownFile.preview } : mockup) : null
  const send = async () => {
    setBusy(true)
    try {
      const out = await supportApi.emailCustomer(order.id, subject, text, attached ? attached.ref : null)
      setSent(out)
      toast.success(`Sent to ${out.to}`)
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onMouseDown={() => !busy && onClose()}>
      <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-border-gray" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-gray">
          <h2 className="text-sm font-semibold text-off-black inline-flex items-center gap-2"><Mail className="w-4 h-4" />Email customer</h2>
          <button onClick={onClose} disabled={busy} className="p-1 rounded text-off-black/50 hover:text-off-black"><X className="w-4 h-4" /></button>
        </div>
        {sent ? (
          <div className="px-5 py-6 space-y-3 text-sm">
            <p className="text-off-black">Sent from fast@ to <b>{sent.to}</b>. Their reply comes into Support, assigned to you, and the order has a comment saying it went out.</p>
            {sent.held && <p className="text-off-black">The print is held from production while we wait on their approval. Once they say yes, press <b>Send now</b> on the order.</p>}
            <div className="flex items-center gap-2 justify-end">
              <a href={`/support?thread=${encodeURIComponent(sent.threadId)}`} target="_blank" rel="noopener noreferrer" className={`${btnSecondary} inline-flex items-center gap-1.5`}>Open in Support<ArrowUpRight className="w-3.5 h-3.5" /></a>
              <button onClick={onClose} className={btnPrimary}>Done</button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-[56px_1fr] items-center gap-y-2 text-sm">
              <span className="text-off-black/50 text-xs">To</span>
              <span className="text-off-black truncate">{order.customerName ? `${order.customerName} · ` : ''}{order.customerEmail}</span>
              <span className="text-off-black/50 text-xs">Subject</span>
              <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-2.5 py-1.5 text-sm border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                <span className="text-[11px] text-off-black/50">We need:</span>
                {ASKS.map(a => (
                  <button key={a.id} onClick={() => choose(a.id)} className={chip(pick === a.id)}>{a.label}</button>
                ))}
                <button onClick={() => choose('mockup')} className={chip(pick === 'mockup')}
                  title={mockup ? `Attach ${mockup.label} for them to approve, and hold the print until they do` : 'Attach a mockup you made for them to approve'}>Approve mockup</button>
              </div>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={e => attachOwn(e.target.files?.[0])} />
              {pick === 'mockup' && (
                <div className="flex items-center gap-2 mb-1.5 text-[11px] text-off-black/60">
                  {attached ? (
                    <>
                      {attached.thumbUrl ? <img src={attached.thumbUrl} alt="" className="w-9 h-9 rounded border border-border-gray object-cover" /> : <Paperclip className="w-3.5 h-3.5" />}
                      <span className="min-w-0"><b className="text-off-black/80 font-medium break-all">{attached.label}</b> attached. Sending holds the print from production until they approve.</span>
                    </>
                  ) : (
                    <span>No design on this order yet. Attach the mockup you made.</span>
                  )}
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {ownFile && mockup && <button onClick={() => setOwnFile(null)} className="text-[#4600D6] hover:underline">Use {mockup.label.split(',')[0]}</button>}
                    <button onClick={() => fileInput.current?.click()} disabled={uploading} className="inline-flex items-center gap-1 text-[#4600D6] hover:underline disabled:opacity-50">
                      {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}{attached ? 'Use a file instead' : 'Attach a file'}
                    </button>
                  </span>
                </div>
              )}
              <textarea ref={box} value={text} onChange={e => setText(e.target.value)} rows={11}
                className="w-full px-3 py-2 text-sm leading-relaxed border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
              {unfilled && <p className="text-[11px] text-amber-700 mt-1">Pick what we need above, or replace {ASK} yourself.</p>}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <span className="text-[11px] text-off-black/45 mr-auto">Sends from fast@trackstar.art</span>
              <button onClick={onClose} disabled={busy} className={btnSecondary}>Cancel</button>
              <button onClick={send} disabled={busy || uploading || unfilled || !text.trim() || !subject.trim() || (pick === 'mockup' && !attached)} className={`${btnPrimary} inline-flex items-center gap-1.5 disabled:opacity-50`}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
