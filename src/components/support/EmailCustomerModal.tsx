import { useEffect, useRef, useState } from 'react'
import { nameCase } from '@/lib/nameCase'
import { ArrowUpRight, Loader2, Mail, Paperclip, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi } from '@/lib/supportApi'
import { fieldLabel, modalCancel, modalChip, modalInput, modalPrimary } from '@/lib/ui'
import ActionModal from '@/components/ActionModal'
import { useArmed } from '@/lib/useArmed'
import type { Address, Mockup } from '@/types/support'
import { putUpload } from '../../lib/putUpload'

/**
 * "Email customer" from an order in TrackstarOS. Usually it is the
 * same note: we need one more detail (a bib number, the last name they
 * registered under, a finish time). It sends from fast@ through the support
 * mailbox, so the conversation and their reply live in Support. Or it sends
 * the design for them to approve, and the print waits on their answer. Or
 * it asks them to confirm the ship-to when Artelo could not verify it. Or
 * it tells them they made the Trackstar Hall of Fame, with the $50 gift card
 * made in Shopify from here (Create gift card fills the code in).
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
type Pick = 'bib' | 'name' | 'time' | 'race' | 'mockup' | 'address' | 'hof'
const ASKS: { id: Exclude<Pick, 'mockup' | 'address' | 'hof'>; label: string; text: string }[] = [
  { id: 'bib', label: 'Bib number', text: 'The bib number (it\'s on the race app or confirmation email)' },
  { id: 'name', label: 'Last name', text: 'The full name they registered under, exactly as it shows in the results' },
  { id: 'time', label: 'Finish time', text: 'The official finish time' },
  { id: 'race', label: 'Which race', text: 'Which race, year and distance this is for' },
]
/** "Gracie Wendels" -> "Gracie Wendels'", "Jo Smith" -> "Jo Smith's". */
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`)
// The Hall of Fame email waits on the gift card; Send stays off until Create gift card fills this in.
const GIFT_CODE = '[gift card code]'

function firstName(name?: string | null) {
  const f = String(name || '').trim().split(/\s+/)[0] || ''
  return f ? nameCase(f) : ''
}

// Written in when the order has no address we can show; Send stays off until it is replaced.
const NO_ADDRESS = '[the address on the order]'
function addressBlock(a: Address | null) {
  if (!a) return NO_ADDRESS
  return [a.name, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(' '), a.country].filter(Boolean).join('\n')
}

function template(o: EmailCustomerOrder, rep: string, pick: Pick | null, shipTo: Address | null = null, code: string | null = null) {
  const who = firstName(o.customerName)
  const runner = String(o.runnerName || '').trim()
  const race = [o.raceName, o.raceYear].filter(Boolean).join(' ')
  const forWhat = runner && race ? `${possessive(runner)} ${race} print` : race ? `your ${race} print` : 'your print'
  const hi = `Hey${who ? ` ${who}` : ''},`
  const bye = `Thanks,\n${rep} from Trackstar`
  if (pick === 'hof') {
    const runnerFirst = firstName(runner) || 'your runner'
    const raceOnly = o.raceName || 'race'
    return `${who || 'Hey'},

I was just fulfilling your order for ${runner || 'your print'} and was so impressed by ${runnerFirst}'s ${raceOnly} time.

We have a tradition at Trackstar called the Trackstar Hall of Fame, where we celebrate the 5 fastest male and female runners who have ordered Trackstar prints with a $50 Trackstar Gift Card to help build out your collection.

I've sent a Trackstar gift card to your email (you can also use this code: ${code || GIFT_CODE}).

Congrats to you and ${runnerFirst}!

Matt, Owner of Trackstar`
  }
  if (pick === 'mockup') return `${hi}

Here's the design for ${forWhat} (attached). Does everything look right?

Reply "looks good" and we'll print it, or tell us what to change.

${bye}`
  if (pick === 'address') return `${hi}

Our shipping partner couldn't verify the address for ${forWhat}:

${addressBlock(shipTo)}

Is that right? If not, reply with the correct address (include any apt or unit number).

${bye}`
  // The ask on its own line in bold (**…** is bold in the sent email), so it is the first thing they see.
  const ask = ASKS.find(a => a.id === pick)?.text || ASK
  return `${hi}

We're working on ${forWhat} and need one thing from you:

**${ask}**

Just reply to this email with that info and we'll get your order processed as soon as we hear back.

${bye}`
}

/** A message the caller has already written (the duplicate-runner check); the rep can still edit it. */
export type EmailPreset = { subject: string; text: string }

export default function EmailCustomerModal({ order, repName, onClose, preset }: { order: EmailCustomerOrder; repName: string; onClose: () => void; preset?: EmailPreset | null }) {
  const number = String(order.displayNumber).replace(/^#/, '')
  const subjects = { ask: `Trackstar Order ${number} (Action Required)`, mockup: `Trackstar Order ${number} (Please Approve Your Design)`, address: `Trackstar Order ${number} (Please Confirm Your Address)`, hof: 'Trackstar Hall of Fame' }
  const rep = repName || 'The team'
  const [subject, setSubject] = useState(preset?.subject || subjects.ask)
  const [pick, setPick] = useState<Pick | null>(null)
  const [text, setText] = useState(() => preset?.text || template(order, rep, null))
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ threadId: string; to: string; held?: boolean } | null>(null)
  // The design the customer would approve: the newest render, else the newest proof.
  const [mockup, setMockup] = useState<Mockup | null>(null)
  // Where the order ships (Artelo's copy first), for the address check.
  const [shipTo, setShipTo] = useState<Address | null>(null)
  // The Hall of Fame gift card for this order, once made (one per order).
  const [card, setCard] = useState<{ code: string; last4: string; customerAssigned: boolean } | null>(null)
  const [making, setMaking] = useState(false)
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
      const put = await putUpload(slot.uploadUrl, { headers: { 'Content-Type': f.type, 'x-upsert': 'false' }, body: f })
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
      if (!live) return
      setMockup(list.find(m => m.kind === 'render') || list.find(m => m.kind === 'proof') || null)
      setShipTo(r.shipTo || null)
    }).catch(() => {})
    return () => { live = false }
  }, [order.id])

  const unfilled = text.includes(ASK) || text.includes(NO_ADDRESS) || text.includes(GIFT_CODE)
  const choose = (next: Pick) => {
    // Anything typed into the email since the last template would be lost.
    if (text !== template(order, rep, pick, shipTo, card?.code) && !arm(`replace:${next}`)) return
    setPick(next)
    setText(template(order, rep, next, shipTo, card?.code))
    if (Object.values(subjects).includes(subject)) setSubject(next === 'mockup' || next === 'address' || next === 'hof' ? subjects[next] : subjects.ask)
    box.current?.focus()
  }
  // Makes the $50 card in Shopify (or returns the one already made) and puts its code in the email.
  const makeCard = async () => {
    setMaking(true)
    try {
      const { card: c } = await supportApi.hallOfFameCard(order.id)
      setCard(c)
      setText(t => t.split(GIFT_CODE).join(c.code))
      toast.success(c.already ? `This order already has a Hall of Fame card (ending ${c.last4})` : `$50 gift card made (ending ${c.last4})`)
    } catch (e) { toast.error((e as Error).message) }
    finally { setMaking(false) }
  }
  // What goes attached: a file made by hand wins over the render.
  const attached = pick === 'mockup' ? (ownFile ? { ref: ownFile.ref, label: ownFile.name, thumbUrl: ownFile.preview } : mockup) : null
  const send = async () => {
    setBusy(true)
    try {
      const out = await supportApi.emailCustomer(order.id, subject, text, attached ? attached.ref : null, pick !== 'hof')
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
              <button onClick={() => choose('address')} className={modalChip(pick === 'address')}
                title="Ask them to confirm the ship-to when Artelo says the address does not exist">Confirm address</button>
              <button onClick={() => choose('hof')} className={modalChip(pick === 'hof')}
                title="They made the Trackstar Hall of Fame: a $50 gift card and a note from Matt">Hall of Fame</button>
            </div>
            {[...ASKS.map(a => a.id), 'mockup' as Pick, 'address' as Pick, 'hof' as Pick].some(id => isArmed(`replace:${id}`)) && <p className="mt-2 text-amber-700">Click it again to replace what you wrote with the template.</p>}
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={e => attachOwn(e.target.files?.[0])} />
          {pick === 'hof' && (
            <div className="flex items-center gap-3 rounded-xl bg-subtle-gray border border-border-gray p-3 text-off-black/60">
              <span className="min-w-0">{card
                ? <>$50 gift card made, ending <b className="text-off-black/80 font-medium">{card.last4}</b>.{card.customerAssigned ? ' Shopify emailed it to them too.' : ' They have no Shopify account, so the code in this email is how they get it.'}</>
                : <>Only for the top 5 men or women (official result from November 2025 on). This makes a real $50 gift card in Shopify, once per order.</>}</span>
              {!card && <button onClick={makeCard} disabled={making} className="ml-auto shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[#4600D6] hover:underline disabled:opacity-50">
                {making && <Loader2 className="w-4 h-4 animate-spin" />}Create gift card
              </button>}
            </div>
          )}
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
          {unfilled && <p className="text-amber-700">{text.includes(GIFT_CODE) ? <>Create the gift card above to fill in its code.</> : text.includes(NO_ADDRESS) ? <>This order has no address we can show. Replace {NO_ADDRESS} with it.</> : <>Pick what we need above, or replace {ASK} yourself.</>}</p>}
        </>
      )}
    </ActionModal>
  )
}
