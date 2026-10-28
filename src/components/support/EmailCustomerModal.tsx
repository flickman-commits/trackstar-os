import { useEffect, useRef, useState } from 'react'
import { nameCase } from '@/lib/nameCase'
import { ArrowUpRight, Loader2, Mail, Paperclip, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi } from '@/lib/supportApi'
import { fieldLabel, modalCancel, modalChip, modalInput, modalPrimary } from '@/lib/ui'
import ActionModal from '@/components/ActionModal'
import { useArmed } from '@/lib/useArmed'
import type { Mockup } from '@/types/support'

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
  // Picking a template over typed text takes a second click (browsers can block window.confirm).
  const { arm, isArmed } = useArmed()
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
    if (text !== template(order, rep, pick) && !arm(`replace:${next}`)) return
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
    <ActionModal icon={Mail} title="Email customer" sub={`#${number}`} onClose={onClose} busy={busy} size="lg"
      hint={sent ? undefined : 'Sends from fast@trackstar.art'}
      footer={sent ? <>
        <a href={`/support?thread=${encodeURIComponent(sent.threadId)}`} target="_blank" rel="noopener noreferrer" className={modalCancel}>Open in Support<ArrowUpRight className="w-4 h-4" /></a>
        <button onClick={onClose} className={modalPrimary}>Done</button>
      </> : <>
        <button onClick={onClose} disabled={busy} className={modalCancel}>Cancel</button>
        <button onClick={send} disabled={busy || uploading || unfilled || !text.trim() || !subject.trim() || (pick === 'mockup' && !attached)} className={modalPrimary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send</button>
      </>}>
      {sent ? (
        <>
          <p>Sent from fast@ to <b>{sent.to}</b>. Their reply comes into Support, assigned to you, and the order has a comment saying it went out.</p>
          {sent.held && <p>The print is held from production while we wait on their approval. Once they say yes, press <b>Send now</b> on the order.</p>}
        </>
      ) : (
        <>
          <div>
            <span className={fieldLabel}>To</span>
            <div className="text-[15px] text-off-black truncate">{order.customerName ? `${order.customerName} · ` : ''}{order.customerEmail}</div>
          </div>
          <label className="block"><span className={fieldLabel}>Subject</span>
            <input value={subject} onChange={e => setSubject(e.target.value)} className={modalInput} />
          </label>
          <div>
            <span className={fieldLabel}>We need</span>
            <div className="flex flex-wrap items-center gap-2">
              {ASKS.map(a => (
                <button key={a.id} onClick={() => choose(a.id)} className={modalChip(pick === a.id)}>{a.label}</button>
              ))}
              <button onClick={() => choose('mockup')} className={modalChip(pick === 'mockup')}
                title={mockup ? `Attach ${mockup.label} for them to approve, and hold the print until they do` : 'Attach a mockup you made for them to approve'}>Approve mockup</button>
            </div>
            {[...ASKS.map(a => a.id), 'mockup' as Pick].some(id => isArmed(`replace:${id}`)) && <p className="mt-2 text-amber-700">Click it again to replace what you wrote with the template.</p>}
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={e => attachOwn(e.target.files?.[0])} />
          {pick === 'mockup' && (
            <div className="flex items-center gap-3 rounded-xl bg-subtle-gray border border-border-gray p-3 text-off-black/60">
              {attached ? (
                <>
                  {attached.thumbUrl ? <img src={attached.thumbUrl} alt="" className="w-11 h-11 rounded-lg border border-border-gray object-cover" /> : <Paperclip className="w-4 h-4" />}
                  <span className="min-w-0"><b className="text-off-black/80 font-medium break-all">{attached.label}</b> attached. Sending holds the print from production until they approve.</span>
                </>
              ) : (
                <span>No design on this order yet. Attach the mockup you made.</span>
              )}
              <span className="ml-auto flex items-center gap-3 shrink-0 text-sm">
                {ownFile && mockup && <button onClick={() => setOwnFile(null)} className="font-medium text-[#4600D6] hover:underline">Use {mockup.label.split(',')[0]}</button>}
                <button onClick={() => fileInput.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 font-medium text-[#4600D6] hover:underline disabled:opacity-50">
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{attached ? 'Use a file instead' : 'Attach a file'}
                </button>
              </span>
            </div>
          )}
          <label className="block"><span className={fieldLabel}>Email</span>
            <textarea ref={box} value={text} onChange={e => setText(e.target.value)} rows={11} className={`${modalInput} leading-relaxed`} />
          </label>
          {unfilled && <p className="text-amber-700">Pick what we need above, or replace {ASK} yourself.</p>}
        </>
      )}
    </ActionModal>
  )
}
