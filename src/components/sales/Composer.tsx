import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Command, RefreshCw, Loader2, Send, Paperclip, ChevronDown, CheckCircle2, AlertCircle, X, FileText, Image as ImageIcon, Sparkles, ExternalLink, LayoutTemplate, Clock, BookmarkPlus, StickyNote } from 'lucide-react'
import { MotionTag } from './Queue'
import { salesApi, type LibraryTemplate, type OutreachTemplate, type TemplateFill, type TemplateMotion } from '@/lib/salesApi'
import { toast } from 'sonner'
import { menuFor } from '@/lib/salesTemplates'
import { TIPS, wordCount, isThreadReply, subjectWords, isBestDay, pastFollowUps } from '@/lib/coldEmailTips'
import { whenLabel } from '@/lib/salesDates'

/** The saved templates and their fill values, loaded once by the page. */
export interface TemplateLibrary { templates: LibraryTemplate[]; fill: TemplateFill }
import { btnPrimary, btnSecondary, btnGhost, inputBase, cardLabel } from '@/lib/ui'
import type { Asset, Deal, DraftResult, Person, Variant } from '@/types/sales'
import { safeSignature } from './safeSignature'

/** "today", "yesterday", "3 days ago", "2 weeks ago", "4 months ago". */
function sinceLabel(iso: string) {
  const then = new Date(iso); then.setHours(0, 0, 0, 0)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.max(0, Math.round((today.getTime() - then.getTime()) / 864e5))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30.4)} months ago`
}

/** What a library card carries when dragged. */
export const ASSET_DRAG_TYPE = 'application/x-trackstar-asset'

/**
 * The middle column: the email, and what to do with it.
 *
 * Subject and body are editable in place and checked against the house
 * rules when you click away. Attachments are chips under the body: drop a
 * card from the library on the right, or click one. A "change it" line asks
 * the model to rewrite to an instruction ("shorter", "mention their Boston
 * team") without losing the rest. Send goes through your Gmail after the
 * undo window; Skip is one key and lives at the other end of the row so it
 * cannot be hit by accident. Closing a deal out is done in Attio.
 */
export default function Composer({
  deal, person, draft, variants, index, drafting, writing, gmailConnected, canSend, capReached, aiActive,
  problems, checking, onCheck,
  attachments, onAttach, onDetach,
  onChange, onPrev, onNext, onRewrite, onRevise, onSend, onSkip, onRemove, adhoc, signature, library, onSchedule, onUnskip, onTemplateSaved, onAttachIds,
}: {
  deal: Deal | null
  person: Person | null
  draft: DraftResult | null
  variants: Variant[]
  index: number
  drafting: boolean
  /** The model is writing (Rewrite), as opposed to a template being filled in. */
  writing?: boolean
  gmailConnected: boolean
  canSend: boolean
  capReached: boolean
  aiActive: boolean
  problems: string[] | null
  checking: boolean
  onCheck: () => void
  attachments: Asset[]
  onAttach: (asset: Asset) => void
  /** Attach library files by id, for a template that carries images. */
  onAttachIds?: (ids: string[]) => void
  onDetach: (id: string) => void
  onChange: (v: Variant) => void
  onPrev: () => void
  onNext: () => void
  onRewrite: () => void
  onRevise: (instruction: string) => Promise<void>
  onSend: () => void
  onSkip: (reason?: string) => void
  /** Take this one out for good (Lost in Attio; PR: Not interested). */
  onRemove?: (reason?: string) => void
  /** Written from New email, outside the queue: any stage is fine, Skip means close. */
  adhoc?: boolean
  /** Your signature HTML, shown where it will sit in the sent email. */
  signature?: string
  /** The saved templates, for the Templates menu. Null until loaded. */
  library: TemplateLibrary | null
  /** Send later: keep it and send it from your Gmail at this time. */
  onSchedule?: (at: Date) => void
  /** Undo "Skip today" for this deal. */
  onUnskip?: () => void
  /** A template was saved from the composer; reload the list. */
  onTemplateSaved?: () => void
}) {
  const [skipOpen, setSkipOpen] = useState(false)
  const [skipReason, setSkipReason] = useState('')
  const [removeOpen, setRemoveOpen] = useState(false)
  const [removeReason, setRemoveReason] = useState('')
  const [instruction, setInstruction] = useState('')
  const [revising, setRevising] = useState(false)
  const [over, setOver] = useState(false)

  if (!deal) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center text-sm text-off-black/40 min-h-[320px]">
        Pick someone on the left.
      </div>
    )
  }

  const kbd = 'inline-flex h-5 items-center gap-0.5 rounded border border-white/30 bg-white/10 px-1.5 text-[10px] font-medium'
  const who = person ? person.fullName || `${person.firstName} ${person.lastName}`.trim() : 'Nobody to email'

  // Past Reached Out, a person is talking. That happens in Gmail and Attio.
  if (!adhoc && !['Not Contacted', 'Needs Enrichment', 'Reached Out'].includes(String(deal.stage))) {
    return (
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-6 py-4 border-b border-border-gray">
          <div className="text-lg font-bold text-off-black">{who} <span className="text-off-black/45 font-normal">· {deal.name}</span></div>
          <div className="text-xs text-success-green mt-0.5">{deal.stage}. The sequence is done here.</div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-off-black/65 max-w-[40ch]">This one is a conversation now. Write to them from Gmail and keep the deal current in Attio.</p>
          {deal.webUrl && <a href={deal.webUrl} target="_blank" rel="noopener noreferrer" className={`${btnPrimary} px-5 py-2.5 text-sm`}>Open in Attio <ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
      </div>
    )
  }

  const current = variants[index]
  const imageRequired = deal.pipeline === 'CHARITY' && draft?.touchNumber === 1
  const hasImage = attachments.some(a => a.kind === 'image')
  const missingRequired = imageRequired && !hasImage
  const blocked = Boolean(problems && problems.length)
  const sendDisabled = !current || drafting || !person?.email || missingRequired || !canSend || blocked || (deal.exhausted && !adhoc)
  const sendTitle = blocked ? (problems as string[])[0]
    : deal.exhausted && !adhoc ? 'The sequence has run out. Decide the stage on the right.'
    : !gmailConnected ? 'Connect Gmail in Settings to send'
    : capReached ? 'Today\'s cap is reached. Raise it in Settings if you mean to.'
    : missingRequired ? 'A charity first touch has to carry a co-branded example'
    : !person?.email ? 'No email on this person in Attio'
    : 'Send through your Gmail'

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false)
    const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE)
    if (!raw) return
    try { onAttach(JSON.parse(raw) as Asset) } catch { /* not ours */ }
  }
  const revise = async () => {
    const text = instruction.trim()
    if (!text || !current) return
    setRevising(true)
    try { await onRevise(text); setInstruction('') } finally { setRevising(false) }
  }

  return (
    <div
      className={`flex-1 min-w-0 flex flex-col min-h-0 transition-colors ${over ? 'bg-subtle-gray/60' : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-border-gray flex-shrink-0">
        <div className="min-w-0">
          <div className="text-lg font-bold text-off-black truncate flex items-center gap-2">
            <span className="truncate">{who} <span className="text-off-black/45 font-normal">· {deal.name}</span></span>
            <MotionTag motion={deal.motion} />
          </div>
          <div className="text-xs text-off-black/55 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{person?.email || <span className="text-red-600">{deal.genericOnly ? 'Only a generic inbox in Attio. Find a person.' : 'No email in Attio'}</span>}</span>
            {adhoc && <span className="px-2 py-0.5 rounded bg-off-black/10 text-off-black/60 font-medium">{deal.id.startsWith('adhoc:') ? 'One-off, no deal' : `Outside the queue · ${deal.stage}`}</span>}
            {draft && (
              <>
                {!adhoc && <span className="px-2 py-0.5 rounded bg-off-black/10 text-off-black/60 font-medium">
                  Touch {draft.touchNumber}
                </span>}
                {!adhoc && pastFollowUps(draft.touchNumber) && (
                  <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-100 text-amber-800 font-medium" title={`Cold email works best with ${TIPS.maxFollowUps} follow-ups at most`}>
                    Past {TIPS.maxFollowUps} follow-ups: consider stopping here
                  </span>
                )}
              </>
            )}
            {!adhoc && deal.lastSentAt && (
              <span className="px-2 py-0.5 rounded bg-off-black/10 text-off-black/60 font-medium" title={new Date(deal.lastSentAt).toLocaleString()}>
                Last emailed {sinceLabel(deal.lastSentAt)}
              </span>
            )}
          </div>
        </div>
      </div>
      {!adhoc && deal.skippedUntil && (
        <div className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-md border border-border-gray bg-subtle-gray px-3 py-2 text-sm text-off-black/70 flex-shrink-0">
          <span>You skipped this today. It comes back on its own tomorrow.</span>
          {onUnskip && <button onClick={onUnskip} className={btnSecondary}>Bring back</button>}
        </div>
      )}

      {drafting ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-off-black/50 min-h-[300px]">
          <Loader2 className="w-5 h-5 animate-spin" /> {writing ? 'Writing…' : 'Loading the draft…'}
        </div>
      ) : !current ? (
        <div className="flex-1 flex items-center justify-center text-sm text-off-black/40 px-6 text-center min-h-[300px]">
          {person?.email ? 'No draft yet. Press Rewrite.' : 'Add a person with an email to this deal in Attio first.'}
        </div>
      ) : (
        <>
          {/* Labels sit above their field so the text gets the pane's full width.
              Subject and body text both start 8px in, so they line up. */}
          <div className="px-6 pt-3 pb-2.5 border-b border-border-gray flex-shrink-0">
            <span className="flex items-center justify-between px-2 mb-0.5">
              <span className={cardLabel}>Subject</span>
              <SubjectHint subject={current.subject} />
            </span>
            <input value={current.subject} onChange={e => onChange({ ...current, subject: e.target.value })} onBlur={onCheck} className={`${inputBase} w-full border-transparent bg-transparent px-[7px] font-medium focus:bg-white focus:border-border-gray`} />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
          <BodyEditor body={current.body} signature={signature} onChange={body => onChange({ ...current, body })} onBlur={onCheck} />

          {/* Change it: one instruction, the model does the rest. */}
          {aiActive && (
            <div className="flex items-center gap-2 px-8 pb-2">
              <Sparkles className="w-3.5 h-3.5 text-off-black/40 shrink-0" />
              <form className="flex-1 flex items-center gap-2" onSubmit={e => { e.preventDefault(); revise() }}>
                <input value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="Change it: shorter, warmer, mention their Boston team…" className={`${inputBase} flex-1`} disabled={revising} />
                <button type="submit" disabled={revising || !instruction.trim()} className={btnSecondary}>{revising ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Apply'}</button>
              </form>
            </div>
          )}

          <EmailHints body={current.body} />
          <div className="px-8 pb-2 text-xs">
            {checking ? (
              <span className="inline-flex items-center gap-1.5 text-off-black/45"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking the house rules…</span>
            ) : problems === null ? (
              <span className="text-off-black/40">Edits are checked against the house rules when you click away.</span>
            ) : problems.length === 0 ? (
              <span className="inline-flex items-center gap-1.5 text-success-green"><CheckCircle2 className="w-3.5 h-3.5" /> Passes the house rules</span>
            ) : (
              <ul className="space-y-1">
                {problems.map((p, i) => <li key={i} className="flex items-start gap-1.5 text-red-700"><AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{p}</span></li>)}
              </ul>
            )}
          </div>

          {/* Attachments */}
          <div className={`mx-8 mb-4 rounded-md border border-dashed px-3 py-2.5 text-xs flex flex-wrap items-center gap-2 ${over ? 'border-dark-fill bg-white' : missingRequired ? 'border-red-300 bg-red-50/40' : 'border-border-gray bg-subtle-gray'}`}>
            <Paperclip className={`w-3.5 h-3.5 ${missingRequired ? 'text-red-600' : 'text-off-black/40'}`} />
            {attachments.map(a => (
              <span key={a.id} className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded border border-border-gray bg-white font-medium">
                {a.kind === 'image' && a.previewUrl ? <img src={a.previewUrl} alt="" className="h-5 w-auto rounded" /> : a.kind === 'image' ? <ImageIcon className="w-3.5 h-3.5 text-off-black/50" /> : <FileText className="w-3.5 h-3.5 text-off-black/50" />}
                <span className="max-w-[160px] truncate">{a.name}</span>
                <button onClick={() => onDetach(a.id)} className="text-off-black/40 hover:text-off-black" title="Remove"><X className="w-3 h-3" /></button>
              </span>
            ))}
            {attachments.length === 0 && (
              <span className={missingRequired ? 'text-red-600' : 'text-off-black/45'}>{missingRequired ? 'A charity first touch needs a co-branded example. Drag one in from the library.' : 'Drag a deck or image here from the library. Images show at the end of the email.'}</span>
            )}
          </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-3 border-t border-border-gray flex-shrink-0 [&_button]:whitespace-nowrap">
        <div className="flex flex-wrap items-center gap-2 relative">
          {adhoc ? <button onClick={() => onSkip()} className={btnSecondary} title="Back to the queue (S)">Close</button> : <button onClick={() => { setRemoveOpen(false); setSkipOpen(o => !o) }} className={btnSecondary} title="Hide until tomorrow (S)">Skip today</button>}
          {skipOpen && !adhoc && (
            <form
              className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-border-gray bg-white shadow-lg p-3 flex flex-col gap-2 z-10"
              onSubmit={e => { e.preventDefault(); onSkip(skipReason.trim() || undefined); setSkipOpen(false); setSkipReason('') }}
            >
              <span className="text-xs text-off-black/60">Moves to tomorrow. Does not count as a touch. A reason becomes a note on the deal.</span>
              <input autoFocus value={skipReason} onChange={e => setSkipReason(e.target.value)} placeholder="Why? (optional)" className={`${inputBase} w-full`} onKeyDown={e => { if (e.key === 'Escape') { setSkipOpen(false); setSkipReason('') } }} />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setSkipOpen(false); setSkipReason('') }} className={btnGhost}>Cancel</button>
                <button type="submit" className={`${btnPrimary} px-3 py-1.5 text-xs`}>Skip</button>
              </div>
            </form>
          )}
          {onRemove && !deal.id.startsWith('adhoc:') && (
            <button onClick={() => { setSkipOpen(false); setRemoveOpen(o => !o) }} className={`${btnGhost} text-off-black/45 hover:text-red-700`} title="Stop working this one: it leaves every list">Remove</button>
          )}
          {removeOpen && onRemove && (
            <form
              className="absolute bottom-full left-0 mb-2 w-80 rounded-lg border border-border-gray bg-white shadow-lg p-3 flex flex-col gap-2 z-10"
              onSubmit={e => { e.preventDefault(); onRemove(removeReason.trim() || undefined); setRemoveOpen(false); setRemoveReason('') }}
            >
              <span className="text-sm font-medium text-off-black">Remove {deal.name}?</span>
              <span className="text-xs text-off-black/60 leading-snug">
                {deal.motion === 'PR' ? 'Sets them to Not interested in the PR Pipeline' : 'Moves the deal to Lost in Attio'}, so it stops showing up here. A reason goes on it as a note. You can undo right after.
              </span>
              <input autoFocus value={removeReason} onChange={e => setRemoveReason(e.target.value)} placeholder="Why? (optional, e.g. not a fit)" className={`${inputBase} w-full`} onKeyDown={e => { if (e.key === 'Escape') { setRemoveOpen(false); setRemoveReason('') } }} />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setRemoveOpen(false); setRemoveReason('') }} className={btnGhost}>Cancel</button>
                <button type="submit" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700">Remove</button>
              </div>
            </form>
          )}
          <TemplateMenu deal={deal} person={person} disabled={drafting || !current} onRewrite={onRewrite} aiActive={aiActive} library={library}
            onPick={t => { if (!current) return; onChange({ ...current, subject: t.subject ?? current.subject, body: t.body }); if (t.assetIds?.length) onAttachIds?.(t.assetIds) }} />
          {current && <SaveTemplateButton deal={deal} person={person} current={current} assetIds={attachments.map(a => a.id)} disabled={drafting} onSaved={onTemplateSaved} />}
          {aiActive && (
            <button onClick={onRewrite} disabled={drafting || !person} className={btnSecondary} title="Write it again">
              <RefreshCw className={`w-3.5 h-3.5 ${drafting ? 'animate-spin' : ''}`} /> Rewrite
            </button>
          )}
          {variants.length > 1 && (
            <span className="flex items-center gap-1 ml-2 text-xs text-off-black/45">
              <button onClick={onPrev} disabled={index === 0} className={btnGhost} title="Previous version"><ArrowLeft className="w-3.5 h-3.5" /></button>
              {index + 1} of {variants.length}
              <button onClick={onNext} disabled={index >= variants.length - 1} className={btnGhost} title="Next version"><ArrowRight className="w-3.5 h-3.5" /></button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {onSchedule && (
            <SendLater
              disabled={!current || drafting || !person?.email || missingRequired || !gmailConnected || blocked || (deal.exhausted && !adhoc)}
              title={blocked ? (problems as string[])[0] : !gmailConnected ? 'Connect Gmail in Settings first' : missingRequired ? 'A charity first touch has to carry a co-branded example' : 'Send it from your Gmail at a time you pick'}
              onPick={onSchedule}
            />
          )}
          <button onClick={onSend} disabled={sendDisabled} className={`${btnPrimary} px-5 py-2.5 text-sm`} title={sendTitle}>
            <Send className="w-4 h-4" /> Send <kbd className={kbd}><Command className="w-3 h-3" />↵</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The Templates button: the saved templates from Settings, filled in for
 * this person (this deal's motion first), plus the sequence's copy for this touch. Picking one
 * replaces the body; a template marked "stay on the thread" keeps the subject.
 */
/**
 * The email as a reusable template: this person's first name back to
 * [First Name], the deal's name back to [Race Name] or [Org Name], and a
 * reply subject ("re: ...") saved as "reply on the thread".
 */
function asTemplate(v: Variant, deal: Deal, person: Person | null) {
  const swap = (text: string) => {
    let t = text
    const first = (person?.firstName || '').trim()
    if (first.length > 1) t = t.replace(new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '[First Name]')
    const name = (deal.name || '').trim()
    if (name.length > 2 && !deal.id.startsWith('adhoc:')) t = t.split(name).join(deal.motion === 'Race' ? '[Race Name]' : '[Org Name]')
    return t
  }
  const subject = /^\s*re:/i.test(v.subject) ? null : swap(v.subject)
  return { subject, body: swap(v.body) }
}

/** "Save as template", beside the Templates menu. */
function SaveTemplateButton({ deal, person, current, assetIds, disabled, onSaved }: { deal: Deal; person: Person | null; current: Variant; assetIds: string[]; disabled: boolean; onSaved?: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={disabled} className={btnSecondary} title="Save this email to your templates">
        <BookmarkPlus className="w-3.5 h-3.5" /> Save as template
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-[340px] rounded-lg border border-border-gray bg-white shadow-lg z-20 overflow-hidden" onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
          <SaveAsTemplate deal={deal} person={person} current={current} assetIds={assetIds} onDone={ok => { setOpen(false); if (ok) onSaved?.() }} />
        </div>
      )}
    </div>
  )
}

/** The save form: a name and who it is for. */
function SaveAsTemplate({ deal, person, current, assetIds, onDone }: { deal: Deal; person: Person | null; current: Variant; assetIds: string[]; onDone: (saved: boolean) => void }) {
  const motions: TemplateMotion[] = ['Race', 'Charity', 'PR', 'Any']
  const [name, setName] = useState('')
  const [motion, setMotion] = useState<TemplateMotion>(motions.includes(deal.motion as TemplateMotion) ? deal.motion as TemplateMotion : 'Any')
  const [saving, setSaving] = useState(false)
  const t = asTemplate(current, deal, person)
  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await salesApi.saveLibraryTemplate({ name: name.trim(), motion, subject: t.subject, body: t.body, assetIds })
      toast.success(`Saved "${name.trim()}" to your templates`)
      onDone(true)
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <form className="px-4 py-3 space-y-2" onSubmit={e => { e.preventDefault(); save() }}>
      <span className={cardLabel}>Save this email as a template</span>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Name it, e.g. Brand activation pitch" className={`${inputBase} w-full`} />
      <div className="flex items-center gap-2">
        <select value={motion} onChange={e => setMotion(e.target.value as TemplateMotion)} className={`${inputBase} text-xs`}>
          {motions.map(m => <option key={m} value={m}>{m === 'Any' ? 'Any deal' : m}</option>)}
        </select>
        <button type="button" onClick={() => onDone(false)} className={`${btnGhost} ml-auto`}>Cancel</button>
        <button type="submit" disabled={saving || !name.trim()} className={btnPrimary}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}</button>
      </div>
      <p className="text-[11px] text-off-black/45 leading-snug">
        {person?.firstName ? `${person.firstName} becomes [First Name]` : 'Saved as written'}{deal.name && !deal.id.startsWith('adhoc:') ? `, ${deal.name} becomes ${deal.motion === 'Race' ? '[Race Name]' : '[Org Name]'}` : ''}{t.subject === null ? ', and it replies on the thread' : ''}.
      </p>
    </form>
  )
}

function TemplateMenu({ deal, person, disabled, onPick, onRewrite, aiActive, library }: {
  deal: Deal
  person: Person | null
  disabled: boolean
  onPick: (t: { subject: string | null; body: string; assetIds?: string[] }) => void
  onRewrite: () => void
  aiActive: boolean
  library: TemplateLibrary | null
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])

  // Loaded with the page and filled here from the person on screen: no wait.
  const [showAll, setShowAll] = useState(false)
  useEffect(() => { setShowAll(false) }, [deal.id])
  const items = library ? menuFor(library.templates, deal, person, library.fill, showAll) : []
  const hidden = library ? library.templates.length - items.length : 0
  const groups = items.reduce<Record<string, OutreachTemplate[]>>((acc, t) => {
    (acc[t.group] = acc[t.group] || []).push(t); return acc
  }, {})

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={disabled} className={btnSecondary} title="Choose a template">
        <LayoutTemplate className="w-3.5 h-3.5" /> Templates <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-[380px] max-h-[60vh] overflow-y-auto overflow-x-hidden whitespace-normal break-words [&_button]:!whitespace-normal rounded-lg border border-border-gray bg-white shadow-lg z-20">
          {!aiActive && (
            <button onClick={() => { onRewrite(); setOpen(false) }} className="w-full text-left px-4 py-3 border-b border-border-gray hover:bg-subtle-gray">
              <span className="block text-sm font-medium text-off-black">This touch in the sequence</span>
              <span className="block text-xs text-off-black/50 mt-0.5">The template this deal's sequence uses for this touch.</span>
            </button>
          )}
          {!library && <div className="px-4 py-4 text-xs text-off-black/50 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the templates…</div>}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div className="px-4 py-2 bg-subtle-gray border-b border-border-gray text-[10px] font-semibold text-off-black/50 uppercase tracking-wider">{group}</div>
              {items.map(t => (
                <button key={t.id} onClick={() => { onPick(t); setOpen(false) }} className="w-full text-left px-4 py-3 border-b border-border-gray last:border-b-0 hover:bg-subtle-gray">
                  <span className="block text-sm font-medium text-off-black">{t.title}</span>
                  {t.useFor && <span className="block text-xs text-off-black/55 mt-0.5 leading-snug">{t.useFor}</span>}
                  {(t.notes?.length ?? 0) > 0 && (() => {
                    const last = t.notes![t.notes!.length - 1]
                    return (
                      <span className="flex items-start gap-1 mt-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-1 leading-snug" title={t.notes!.map(n => `${n.from ? `${n.from}: ` : ''}${n.text}`).join('\n\n')}>
                        <StickyNote className="w-3 h-3 mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{last.from ? <span className="font-medium">{last.from}: </span> : null}{last.text}{t.notes!.length > 1 ? <span className="text-amber-700/70"> (+{t.notes!.length - 1} more)</span> : null}</span>
                      </span>
                    )
                  })()}
                  <span className="block text-[11px] text-off-black/40 mt-1 truncate">{t.subject ? `Subject: ${t.subject}` : 'Replies on the thread, keeps the subject'}</span>
                </button>
              ))}
            </div>
          ))}
          {library && items.length === 0 && <div className="px-4 py-3 text-xs text-off-black/50">No saved templates yet.</div>}
          {library && (hidden > 0 || showAll) && (
            <button onClick={() => setShowAll(v => !v)} className="w-full text-left px-4 py-2.5 border-t border-border-gray text-xs text-blue-600 hover:text-blue-700 hover:bg-subtle-gray">
              {showAll ? `Only ${deal.motion || 'this motion'} templates` : `Show all templates (${hidden} more)`}
            </button>
          )}
          {library && (
            <div className="px-4 py-2.5 border-t border-border-gray text-[11px] text-off-black/45 flex items-center justify-between">
              <span>Templates and sequences have their own pages.</span>
              <Link to="/sales/templates" className="text-blue-600 hover:text-blue-700" onClick={() => setOpen(false)}>Edit templates</Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** A pasted address, if that is all the clipboard holds. */
function asUrl(text: string) {
  const t = text.trim()
  if (/^(https?:\/\/|mailto:)\S+$/i.test(t)) return t
  if (/^www\.\S+\.\S+$/i.test(t)) return `https://${t}`
  return null
}

/** What was typed in the link box, made into an address a mail app will open. */
function normalizeUrl(raw: string) {
  const t = raw.trim()
  if (!t) return ''
  if (/^(https?:\/\/|mailto:)/i.test(t)) return t
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return `mailto:${t}`
  return `https://${t.replace(/^\/+/, '')}`
}

/**
 * Links Matt adds often, one click away in the ⌘⇧K box. Instagram handles and
 * pages are taken from trackstar.art and flickmanmedia.com; change them here.
 */
const QUICK_LINKS: { label: string; text: string; url: string }[] = [
  { label: 'Trackstar IG', text: 'Instagram', url: 'https://www.instagram.com/trackstar_art/' },
  { label: 'My IG', text: 'Instagram', url: 'https://www.instagram.com/flickman/' },
  { label: 'Homepage', text: 'Trackstar', url: 'https://trackstar.art' },
  { label: 'Marathons', text: 'our marathon prints', url: 'https://trackstar.art/collections/marathons' },
]

/** What the ⌘⇧K box is editing: the selected words, or a link the caret is in. */
type LinkTarget = { text: string; url: string; existing: boolean; top: number; left: number }

/** The ⌘⇧K box: compact, with the usual links one click away. */
function LinkBox({ target, onSave, onRemove, onCancel }: { target: LinkTarget; onSave: (text: string, url: string) => void; onRemove: () => void; onCancel: () => void }) {
  const [text, setText] = useState(target.text)
  const [url, setUrl] = useState(target.url)
  const ok = Boolean(text.trim() && normalizeUrl(url))
  const small = 'px-2 py-1 text-xs bg-white border border-border-gray rounded focus:outline-none focus:ring-2 focus:ring-off-black/10 placeholder:text-off-black/35'
  // With words selected, a quick link goes straight in; otherwise it fills the box.
  const quick = (q: typeof QUICK_LINKS[number]) => {
    if (text.trim()) onSave(text.trim(), q.url)
    else { setText(q.text); setUrl(q.url) }
  }
  return (
    <form
      style={{ top: target.top, left: target.left }}
      className="absolute z-20 w-[420px] max-w-full rounded-lg border border-border-gray bg-white shadow-lg p-2 space-y-1.5"
      onSubmit={e => { e.preventDefault(); if (ok) onSave(text.trim(), normalizeUrl(url)) }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <input value={text} onChange={e => setText(e.target.value)} placeholder="Text" className={`${small} w-28 shrink-0`} autoFocus={!target.text} />
        <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Paste or type a link" className={`${small} flex-1 min-w-0`} autoFocus={Boolean(target.text)} />
        <button type="submit" disabled={!ok} className={`${btnPrimary} px-2.5 py-1`}>{target.existing ? 'Save' : 'Add'}</button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {QUICK_LINKS.map(q => (
          <button key={q.label} type="button" onClick={() => quick(q)} title={q.url} className="px-2 py-0.5 rounded border border-border-gray bg-subtle-gray text-[11px] font-medium text-off-black/70 hover:bg-off-black/5">
            {q.label}
          </button>
        ))}
        {target.existing && <button type="button" onClick={onRemove} className="ml-auto text-[11px] text-red-700 hover:text-red-800">Remove link</button>}
        <button type="button" onClick={onCancel} className={`${target.existing ? '' : 'ml-auto'} text-[11px] text-off-black/45 hover:text-off-black`}>Esc</button>
      </div>
    </form>
  )
}

// ── The rich text box ───────────────────────────────────────────────────────
// The draft stays one plain string with links written [text](url), which is
// what the server, templates and Send later all read. The box shows that
// string with real, blue, underlined links and turns edits back into it.

const MD_LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g
const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The draft string as the box's HTML: one <div> per line, links as <a>. */
function toEditorHtml(md: string) {
  if (!md) return ''
  return md.split('\n').map(line => {
    let out = ''
    let last = 0
    for (const m of line.matchAll(MD_LINK)) {
      out += escHtml(line.slice(last, m.index))
      out += `<a href="${escHtml(m[2])}" title="${escHtml(m[2])}">${escHtml(m[1])}</a>`
      last = (m.index || 0) + m[0].length
    }
    out += escHtml(line.slice(last))
    return `<div>${out || '<br>'}</div>`
  }).join('')
}

const BLOCKS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3'])

/** The box's HTML back to the draft string. Lines are blocks; a <br> inside a line breaks it. */
function fromEditor(root: HTMLElement) {
  const lines: string[] = []
  let cur = ''
  let open = false
  const flush = () => { lines.push(cur); cur = ''; open = false }
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { cur += (node.nodeValue || '').replace(/\u00a0/g, ' '); open = true; return }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === 'BR') {
      // A <br> alone at the end of a line is the browser's placeholder, not a new line.
      if (node.nextSibling || !node.parentElement || node.parentElement === root) flush()
      else open = true
      return
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || ''
      const text = (node.textContent || '').replace(/\u00a0/g, ' ')
      cur += /^(https?:\/\/|mailto:)/i.test(href) && text ? `[${text}](${href})` : text
      open = true
      return
    }
    if (BLOCKS.has(node.tagName)) {
      if (open) flush()
      node.childNodes.forEach(walk)
      flush()
      return
    }
    node.childNodes.forEach(walk)
  }
  root.childNodes.forEach(walk)
  if (open) flush()
  return lines.join('\n').replace(/\n+$/, '')
}

/**
 * One editable block of the email. Links show as blue underlined words; ⌘⇧K
 * (Ctrl+Shift+K; ⌘K is the global search) adds one on the selection or edits the one under the caret, and
 * pasting an address over selected words links them. ⌘-click opens a link.
 * Paste is always plain text, so nothing arrives with someone else's fonts.
 */
export function RichBox({ value, onChange, onBlur, placeholder, minHeight, boxRef }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; minHeight: number
  boxRef?: React.RefObject<HTMLDivElement>
}) {
  const own = useRef<HTMLDivElement>(null)
  const ref = boxRef || own
  const shown = useRef<string | null>(null)
  const saved = useRef<Range | null>(null)
  const anchor = useRef<HTMLAnchorElement | null>(null)
  const [link, setLink] = useState<LinkTarget | null>(null)

  // Draw the draft when it changes from outside (a template, a reset); never while typing.
  useEffect(() => {
    const el = ref.current
    if (!el || value === shown.current) return
    el.innerHTML = toEditorHtml(value)
    shown.current = value
  }, [value, ref])

  const emit = () => {
    const el = ref.current
    if (!el) return
    const md = fromEditor(el)
    shown.current = md
    onChange(md)
  }

  const wrap = useRef<HTMLDivElement>(null)
  /** Where the box goes: just under the selected words, kept inside the editor. */
  const spot = (range: Range) => {
    const box = wrap.current?.getBoundingClientRect()
    let r = range.getBoundingClientRect()
    if (!r.width && !r.height) {
      // A bare caret has no box of its own; measure a one-character range around it.
      const probe = range.cloneRange()
      const node = probe.startContainer
      if (node.nodeType === Node.TEXT_NODE && (node.nodeValue || '').length) {
        const at = Math.min(probe.startOffset, (node.nodeValue || '').length - 1)
        probe.setStart(node, Math.max(0, at)); probe.setEnd(node, Math.max(0, at) + 1)
        r = probe.getBoundingClientRect()
      } else if (node instanceof HTMLElement) r = node.getBoundingClientRect()
    }
    if (!box) return { top: 0, left: 0 }
    const width = Math.min(420, box.width)
    return { top: r.bottom - box.top + 6, left: Math.max(0, Math.min(r.left - box.left, box.width - width)) }
  }

  const openLink = () => {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount || !ref.current?.contains(sel.anchorNode)) return
    const range = sel.getRangeAt(0)
    const at = spot(range)
    const inLink = (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer as HTMLElement)?.closest('a')
    if (inLink && ref.current.contains(inLink)) {
      anchor.current = inLink
      const whole = document.createRange(); whole.selectNodeContents(inLink)
      saved.current = whole
      setLink({ text: inLink.textContent || '', url: inLink.getAttribute('href') || '', existing: true, ...at })
    } else {
      anchor.current = null
      saved.current = range.cloneRange()
      setLink({ text: range.toString(), url: '', existing: false, ...at })
    }
  }

  const restore = () => {
    const el = ref.current
    if (!el || !saved.current) return null
    el.focus()
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(saved.current)
    return sel
  }

  const saveLink = (text: string, url: string) => {
    setLink(null)
    if (anchor.current) {
      anchor.current.setAttribute('href', url)
      anchor.current.setAttribute('title', url)
      anchor.current.textContent = text
      anchor.current = null
    } else if (restore()) {
      // insertHTML keeps the browser's undo history (⌘Z) working.
      document.execCommand('insertHTML', false, `<a href="${escHtml(url)}" title="${escHtml(url)}">${escHtml(text)}</a>`)
    }
    emit()
    requestAnimationFrame(() => ref.current?.focus())
  }

  const removeLink = () => {
    setLink(null)
    const a = anchor.current
    if (a) { a.replaceWith(document.createTextNode(a.textContent || '')); anchor.current = null; emit() }
    requestAnimationFrame(() => ref.current?.focus())
  }

  return (
    <div ref={wrap} className="relative">
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={emit}
        onBlur={onBlur}
        onKeyDown={e => {
          // ⌘K is the global search; the link box (saved links) is ⌘⇧K. Pasting
          // an address over selected words links them without it.
          if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink() }
        }}
        onClick={e => {
          const a = (e.target as HTMLElement).closest('a')
          if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); window.open(a.getAttribute('href') || '', '_blank', 'noopener') }
        }}
        onPaste={e => {
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          const sel = window.getSelection()
          const url = asUrl(text)
          if (url && sel && !sel.isCollapsed) {
            const words = sel.toString()
            document.execCommand('insertHTML', false, `<a href="${escHtml(url)}" title="${escHtml(url)}">${escHtml(words)}</a>`)
          } else {
            document.execCommand('insertText', false, text)
          }
          emit()
        }}
        className={`block w-full text-sm leading-relaxed text-off-black bg-transparent px-1 focus:outline-none whitespace-pre-wrap break-words
          [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 [&_a]:cursor-text
          ${value ? '' : 'before:content-[attr(data-placeholder)] before:text-off-black/30 before:pointer-events-none'}`}
      />
      {link && <LinkBox target={link} onSave={saveLink} onRemove={removeLink} onCancel={() => { setLink(null); anchor.current = null; restore() }} />}
    </div>
  )
}

/** Subject length, with the cold email nudges. Quiet for a reply on the thread. */
function SubjectHint({ subject }: { subject: string }) {
  if (isThreadReply(subject)) return null
  const chars = subject.trim().length
  const words = subjectWords(subject)
  const long = chars > TIPS.maxSubjectChars
  const tip = long
    ? `Under ${TIPS.maxSubjectChars} characters opens best; one word opens best of all`
    : words === 1 ? 'One word: the best open rate' : `One-word subjects get the best open rate`
  return (
    <span className={`text-[10px] ${long ? 'text-amber-700' : 'text-off-black/35'}`} title={tip}>
      {chars} / {TIPS.maxSubjectChars}{long ? ` · ${tip}` : words === 1 ? ' · one word' : ''}
    </span>
  )
}

/** Body length and send day, as suggestions under the email. */
function EmailHints({ body }: { body: string }) {
  const words = wordCount(body)
  const long = words > TIPS.maxWords
  const goodDay = isBestDay()
  return (
    <div className="px-8 pb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
      <span className={long ? 'text-amber-700' : 'text-off-black/40'} title={`Emails under ${TIPS.maxWords} words got a ${TIPS.replyRate} reply rate`}>
        {words} words{long ? ` · under ${TIPS.maxWords} got a ${TIPS.replyRate} reply rate` : ''}
      </span>
      {!goodDay && <span className="text-amber-700" title="Cold email gets the best replies on Tuesday and Wednesday">Tuesday or Wednesday sends best · use Send later</span>}
    </div>
  )
}

/** Where a P.S. starts: a paragraph that opens with "P.S.", as composeHtml splits it on send. */
const PS_START = /(^|\n[ \t]*\n)(?=[ \t]*p\.?s\.?[\s:.-])/i
const IS_PS = /^\s*p\.?s\.?[\s:.-]/i

function splitBody(body: string) {
  const m = PS_START.exec(body)
  if (!m) return { main: body, ps: '' }
  const at = m.index + m[1].length
  return { main: body.slice(0, at).replace(/\s+$/, ''), ps: body.slice(at).trim() }
}

/**
 * The email as one page: what you write, your signature where it will sit,
 * and room under it for a P.S. It stays one string underneath; on send the
 * server puts anything from "P.S." on below the signature, so text typed
 * under the signature gets a "P.S." if it does not start with one.
 * Attachments are not in here: they are chips below and go at the very end.
 * Local text is kept while typing so nothing jumps under the cursor.
 */
export function BodyEditor({ body, signature, onChange, onBlur, boxRef, minHeight = 176, bare = false }: {
  body: string; signature?: string; onChange: (body: string) => void; onBlur: () => void
  /** The main box, for a caller that inserts at the cursor (the template editor's variables). */
  boxRef?: React.RefObject<HTMLDivElement>
  minHeight?: number
  /** No label row or outer padding: the caller frames it. */
  bare?: boolean
}) {
  const [parts, setParts] = useState(() => splitBody(body))
  const emitted = useRef(body)
  useEffect(() => {
    if (body !== emitted.current) { setParts(splitBody(body)); emitted.current = body }
  }, [body])
  const update = (main: string, ps: string) => {
    setParts({ main, ps })
    const extra = ps.trim()
    const next = extra ? `${main.replace(/\s+$/, '')}\n\n${IS_PS.test(extra) ? extra : `P.S. ${extra}`}` : main
    emitted.current = next
    onChange(next)
  }
  return (
    <div className={bare ? 'relative' : 'px-6 pt-3 pb-2 relative'}>
      {!bare && (
        <span className="flex items-center justify-between px-2 mb-0.5">
          <span className={cardLabel}>Body</span>
          <span className="text-[10px] text-off-black/35">Select words and paste a link · ⌘⇧K for saved links</span>
        </span>
      )}
      <div className="rounded-md px-1 py-1 focus-within:bg-subtle-gray/50 transition-colors">
        <RichBox boxRef={boxRef} value={parts.main} onChange={v => update(v, parts.ps)} onBlur={onBlur} minHeight={minHeight} />
        <div className="px-1 pt-3 pb-2 text-sm text-off-black" title="Your signature, added on send. Change it in Settings, under Me.">
          {signature
            ? <div dangerouslySetInnerHTML={{ __html: safeSignature(signature) }} />
            : <span className="text-xs text-off-black/40">No signature yet. Add one in Settings, under Me.</span>}
        </div>
        <RichBox value={parts.ps} onChange={v => update(parts.main, v)} onBlur={onBlur} minHeight={24} placeholder="P.S. (optional)" />
      </div>
    </div>
  )
}


/** 9:15 AM on the given day, local time. The sender runs every 15 minutes, so an email goes out within 15 minutes of its time. */
function at915(d: Date) { const x = new Date(d); x.setHours(9, 15, 0, 0); return x }

/** Up to the next 5-minute mark, so a custom time is the time it actually goes. */
function toFiveMinutes(d: Date) { const x = new Date(d); x.setSeconds(0, 0); const m = x.getMinutes(); if (m % 5) x.setMinutes(m + (5 - (m % 5))); return x }

/** The quick picks: this morning if it is still early on a weekday, the next weekday morning, and next Monday. */
function presets(now = new Date()) {
  const out: { label: string; at: Date }[] = []
  const weekday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6
  const today = at915(now)
  if (weekday(now) && today.getTime() > now.getTime() + 60_000) out.push({ label: 'This morning', at: today })
  const next = new Date(now); next.setDate(next.getDate() + 1)
  while (!weekday(next)) next.setDate(next.getDate() + 1)
  out.push({ label: next.getDay() === 1 ? 'Monday morning' : 'Tomorrow morning', at: at915(next) })
  const monday = new Date(now); monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7))
  if (!out.some(p => p.at.getTime() === at915(monday).getTime())) out.push({ label: 'Monday morning', at: at915(monday) })
  // Tuesday and Wednesday get the best replies, so offer the next of each.
  for (const [day, name] of [[2, 'Tuesday'], [3, 'Wednesday']] as const) {
    const d = new Date(now); d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7))
    if (at915(d).getTime() <= now.getTime() + 60_000) d.setDate(d.getDate() + 7)
    const at = at915(d)
    const existing = out.find(p => p.at.getTime() === at.getTime())
    if (existing) existing.label = `${existing.label} (${name}, best day)`
    else out.push({ label: `${name} morning (best day)`, at })
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/** "2026-09-28T09:15" for a datetime-local input, in local time. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Send later: quick picks, or any date and time. */
function SendLater({ disabled, title, onPick }: { disabled: boolean; title: string; onPick: (at: Date) => void }) {
  const [open, setOpen] = useState(false)
  const picks = open ? presets() : []
  const [custom, setCustom] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    setCustom(localInput(presets()[0].at))
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown); window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  const customAt = custom ? toFiveMinutes(new Date(custom)) : null
  const customOk = Boolean(customAt && !Number.isNaN(customAt.getTime()) && customAt.getTime() > Date.now() + 60_000)
  const pick = (at: Date) => { setOpen(false); onPick(at) }

  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(o => !o)} disabled={disabled} className={`${btnSecondary} px-4 py-2.5 text-sm`} title={title}>
        <Clock className="w-4 h-4" /> Send later
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-[300px] rounded-lg border border-border-gray bg-white shadow-lg z-20 overflow-hidden">
          {picks.map(p => (
            <button key={p.label} onClick={() => pick(p.at)} className="w-full text-left px-4 py-3 border-b border-border-gray hover:bg-subtle-gray">
              <span className="block text-sm font-medium text-off-black">{p.label}</span>
              <span className="block text-xs text-off-black/50 mt-0.5">{whenLabel(p.at)}</span>
            </button>
          ))}
          <form className="px-4 py-3 space-y-2" onSubmit={e => { e.preventDefault(); if (customOk && customAt) pick(customAt) }}>
            <span className={cardLabel}>Pick a time</span>
            <input type="datetime-local" step={300} value={custom} onChange={e => setCustom(e.target.value)} className={`${inputBase} w-full`} />
            <button type="submit" disabled={!customOk} className={`${btnPrimary} w-full`}>{customOk && customAt ? `Schedule for ${whenLabel(customAt)}` : 'Pick a time in the future'}</button>
          </form>
          <p className="px-4 pb-3 text-[11px] text-off-black/45 leading-snug">Goes from your Gmail at that time (times are on 5-minute marks). If they reply or the deal moves first, it waits for you instead.</p>
        </div>
      )}
    </div>
  )
}
