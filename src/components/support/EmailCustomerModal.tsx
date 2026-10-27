import { useEffect, useRef, useState } from 'react'
import { nameCase } from '@/lib/nameCase'
import { ArrowUpRight, Loader2, Mail, Paperclip, X } from 'lucide-react'
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
  const box = useRef<HTMLTextAreaElement>(null)
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
  const withMockup = pick === 'mockup' && mockup
  const send = async () => {
    setBusy(true)
    try {
      const out = await supportApi.emailCustomer(order.id, subject, text, withMockup ? mockup.ref : null)
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
                <button onClick={() => choose('mockup')} disabled={!mockup} className={`${chip(pick === 'mockup')} disabled:opacity-40 disabled:cursor-not-allowed`}
                  title={mockup ? `Attach ${mockup.label} for them to approve, and hold the print until they do` : 'This order has no design yet'}>Approve mockup</button>
              </div>
              {withMockup && (
                <div className="flex items-center gap-2 mb-1.5 text-[11px] text-off-black/60">
                  {mockup.thumbUrl ? <img src={mockup.thumbUrl} alt="" className="w-9 h-9 rounded border border-border-gray object-cover" /> : <Paperclip className="w-3.5 h-3.5" />}
                  <span><b className="text-off-black/80 font-medium">{mockup.label}</b> attached. Sending holds the print from production until they approve.</span>
                </div>
              )}
              <textarea ref={box} value={text} onChange={e => setText(e.target.value)} rows={11}
                className="w-full px-3 py-2 text-sm leading-relaxed border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
              {unfilled && <p className="text-[11px] text-amber-700 mt-1">Pick what we need above, or replace {ASK} yourself.</p>}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <span className="text-[11px] text-off-black/45 mr-auto">Sends from fast@trackstar.art</span>
              <button onClick={onClose} disabled={busy} className={btnSecondary}>Cancel</button>
              <button onClick={send} disabled={busy || unfilled || !text.trim() || !subject.trim()} className={`${btnPrimary} inline-flex items-center gap-1.5 disabled:opacity-50`}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Send</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
