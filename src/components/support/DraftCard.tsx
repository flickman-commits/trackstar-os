import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, GraduationCap, Loader2, RefreshCw, Sparkles, X, StickyNote } from 'lucide-react'
import { newIdempotencyKey, supportApi } from '@/lib/supportApi'
import { when } from '@/lib/supportDates'
import type { Address, Note, Proposal } from '@/types/support'

/**
 * Claude's draft in the timeline: the reply it would send, and its working
 * (what it found, what to check, which quick actions fit, whether Matt
 * should see it). Nothing goes anywhere until a person uses it and presses
 * Send. Every draft starts folded to one line, so the customer's message
 * stays readable; opened, the reply scrolls in a short box.
 */
/** Everything an approved action will do, spelled out for the second look. */
function proposalDetails(p: Proposal): string[] {
  const addressLines = (a?: Address) => a ? [a.name, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(' '), a.country, a.phone ? `Phone ${a.phone}` : ''].filter(Boolean) : []
  if (p.type === 'shippingAddress') return [`Order #${p.orderNumber}: the ship-to in Shopify becomes`, ...addressLines(p.address), 'Artelo still needs changing by hand.']
  if (p.type === 'changeItem') return [`Order #${p.orderNumber}: the print becomes ${[p.size, p.frame].filter(Boolean).join(' ')}.`, 'The personalization is copied to the Shopify order note.', 'If the new one costs more, Shopify emails the customer an invoice for the difference.']
  if (p.type === 'discount') return [`A ${p.percent}% code, one use, 30 days, made in Shopify now.`]
  if (p.type === 'orderNote') return ['Adds this to the order as a note:', p.text || '']
  return [p.label]
}

/**
 * One suggested action: what it would do, Approve to see exactly what will
 * happen, then Yes to run it, or dismiss it. The key is made when the
 * confirm step opens, so a double click on Yes runs it once.
 */
function ProposalRow({ p, onApprove, onDismiss }: { p: Proposal; onApprove: (p: Proposal, idempotencyKey: string) => Promise<void>; onDismiss: (p: Proposal) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  if (p.status) {
    return <div className={`flex items-start gap-1.5 text-xs ${p.status === 'done' ? 'text-emerald-700' : 'text-off-black/40 line-through'}`}>{p.status === 'done' ? <Check className="w-3.5 h-3.5 shrink-0 mt-px" /> : <X className="w-3.5 h-3.5 shrink-0 mt-px" />}<span>{p.label}{p.status === 'done' && p.by ? <span className="text-off-black/40"> · {p.by}</span> : null}</span></div>
  }
  const go = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  return (
    <div className="rounded-lg border border-[#4600D6]/20 bg-white px-2.5 py-2">
      <div className="flex items-start gap-2">
        <span className="flex-1 text-xs text-off-black/80 leading-snug">{p.type === 'orderNote' && <StickyNote className="inline w-3 h-3 mr-1 -mt-0.5 text-off-black/40" aria-label="Order note" />}{p.label}</span>
        {!confirmKey && <button disabled={busy} onClick={() => setConfirmKey(newIdempotencyKey())} className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[#4600D6] text-white hover:bg-[#3a00b3] disabled:opacity-50"><Check className="w-3 h-3" />Approve</button>}
        {!confirmKey && <button disabled={busy} onClick={() => go(() => onDismiss(p))} className="shrink-0 p-0.5 text-off-black/35 hover:text-off-black" title="Not this one"><X className="w-3.5 h-3.5" /></button>}
      </div>
      {confirmKey && (
        <div className="mt-2 pt-2 border-t border-[#4600D6]/15 space-y-1.5 text-xs">
          <div className="whitespace-pre-wrap break-words text-off-black/75 leading-snug">{proposalDetails(p).join('\n')}</div>
          <div className="text-red-700 font-medium">Run this now? It changes the order in Shopify{p.type === 'discount' || p.type === 'orderNote' ? '' : ' and cannot be undone from here'}.</div>
          <div className="flex items-center justify-end gap-2">
            <button disabled={busy} onClick={() => setConfirmKey(null)} className="px-2 py-1 text-xs text-off-black/50 hover:text-off-black">Back</button>
            <button disabled={busy} onClick={() => go(async () => { await onApprove(p, confirmKey); setConfirmKey(null) })} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[#4600D6] text-white hover:bg-[#3a00b3] disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Yes, do it</button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Teach Claude from this draft: say what was wrong, check the rules it writes
 * from that, and save them to the playbook. Then the draft is redone with them.
 */
function Teach({ noteId, onDone, onCancel }: { noteId: string; onDone: (feedback: string) => Promise<void>; onCancel: () => void }) {
  const [feedback, setFeedback] = useState('')
  const [lessons, setLessons] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong') } finally { setBusy(false) } }
  return (
    <div className="mt-2.5 rounded-lg border border-[#4600D6]/20 bg-white p-2.5 space-y-2">
      {!lessons ? (
        <>
          <textarea autoFocus value={feedback} onChange={e => setFeedback(e.target.value)} rows={2}
            placeholder="What was wrong? e.g. They are already emailing us, never send them to DM. We do have the Atlantic City half."
            className="w-full px-2 py-1.5 text-xs border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-[#4600D6]/30 resize-y" />
          <div className="flex items-center gap-2">
            <button disabled={busy || !feedback.trim()} onClick={() => run(async () => setLessons((await supportApi.proposeLessons(noteId, feedback)).lessons))} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[#4600D6] text-white disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GraduationCap className="w-3 h-3" />}Write the rule</button>
            <button onClick={onCancel} className="text-xs text-off-black/50">Cancel</button>
          </div>
        </>
      ) : (
        <>
          <div className="text-[11px] text-off-black/55">Adds to the playbook every draft reads. Edit before saving.</div>
          {lessons.map((l, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <textarea value={l} onChange={e => setLessons(ls => ls!.map((x, j) => j === i ? e.target.value : x))} rows={2} className="flex-1 px-2 py-1.5 text-xs border border-border-gray rounded resize-y focus:outline-none focus:ring-1 focus:ring-[#4600D6]/30" />
              <button onClick={() => setLessons(ls => ls!.filter((_, j) => j !== i))} className="p-1 text-off-black/35 hover:text-off-black" title="Leave this one out"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button disabled={busy || !lessons.some(l => l.trim())} onClick={() => run(async () => { await supportApi.saveLessons(lessons.filter(l => l.trim())); await onDone(feedback) })} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-[#4600D6] text-white disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Save to playbook and redraft</button>
            <button onClick={() => setLessons(null)} className="text-xs text-off-black/50">Back</button>
          </div>
        </>
      )}
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  )
}

export default function DraftCard({ n, latest, answered = false, verifiedNumbers = [], onUse, onRedraft, onApprove, onDismiss }: { n: Note; latest: boolean; /** Someone has replied since this draft: it folds to one quiet line. */ answered?: boolean; /** Order numbers on the conversation (under their email, or linked). */ verifiedNumbers?: string[]; onUse: (text: string) => void; onRedraft: (instruction: string) => Promise<void>; onApprove: (p: Proposal, idempotencyKey: string) => Promise<void>; onDismiss: (p: Proposal) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [showWork, setShowWork] = useState(false)
  const [asking, setAsking] = useState(false)
  const [teaching, setTeaching] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  // A reply went out (this draft or our own words): fold it away.
  useEffect(() => { if (answered) setOpen(false) }, [answered])
  const d = n.data || {}
  // Only actions that can be run from here; ideas with no button are left out.
  const proposals = (d.proposals || []).filter(p => p.status || (latest && !answered))
  const pending = proposals.filter(p => !p.status).length
  const active = latest && !answered
  const redraft = async () => {
    setBusy(true)
    try { await onRedraft(instruction.trim()); setAsking(false); setInstruction('') }
    finally { setBusy(false) }
  }
  const hasWork = !!(d.summary || d.needsInfo || d.keyFacts?.length || d.steps?.length)
  // The order was found by a number they quoted or by their name, not their
  // email. Anyone can quote an order number, so it stays flagged until a
  // person links the order to this customer.
  const foundBy = d.foundBy
  const unverified = !!foundBy && !(foundBy.orderNumbers || []).some(num => verifiedNumbers.includes(num))
  const unverifiedText = foundBy?.by === 'name'
    ? 'Matched by their name, not their email. Verify before sharing details.'
    : 'Matched by the order number they quoted, not their email. Verify before sharing details.'

  if (!open) {
    // Closed by default, so the customer's message stays the thing you read first.
    return (
      <div className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${active ? 'border-[#4600D6]/25 bg-[#4600D6]/[0.03]' : 'border-dashed border-[#4600D6]/20'}`}>
        <button onClick={() => setOpen(true)} title={d.scenario || undefined} className={`flex-1 min-w-0 flex items-center gap-2 text-left ${active ? 'text-[#4600D6]' : 'text-[#4600D6]/60 hover:text-[#4600D6]'}`}>
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span className={`truncate ${active ? 'font-semibold' : ''}`}>{active ? "Claude's draft" : answered ? "Claude's draft · replied" : 'Earlier draft'}</span>
          {active && pending > 0 && <span className="shrink-0 px-1.5 py-px rounded bg-[#4600D6]/10 text-[10px] font-medium text-[#4600D6]">{pending} to approve</span>}
          {active && d.escalate?.needed && <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded bg-red-50 border border-red-200 text-[10px] font-medium text-red-700"><AlertTriangle className="w-3 h-3" />Flag for Matt</span>}
          {active && unverified && <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded bg-amber-50 border border-amber-200 text-[10px] font-medium text-amber-800" title={unverifiedText}><AlertTriangle className="w-3 h-3" />Verify customer</span>}
          <ChevronDown className="w-3.5 h-3.5 ml-auto shrink-0" />
        </button>
        {active && <button onClick={() => onUse(n.body)} className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium bg-[#4600D6] text-white hover:bg-[#3a00b3]">Use</button>}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#4600D6]/25 bg-[#4600D6]/[0.03] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-[11px] text-[#4600D6]/80 mb-2">
        <button onClick={() => setOpen(false)} title={d.scenario || 'Collapse'} className="font-semibold inline-flex items-center gap-1.5 hover:underline underline-offset-2"><Sparkles className="w-3.5 h-3.5" />{active ? "Claude's draft" : answered ? "Claude's draft · replied" : 'Earlier draft'}</button>
        <span className="shrink-0 inline-flex items-center gap-1.5 tabular-nums text-off-black/40">{when(n.createdAt)}<button onClick={() => setOpen(false)} title="Collapse"><ChevronDown className="w-3.5 h-3.5 rotate-180" /></button></span>
      </div>
      {active && d.escalate?.needed && (
        <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800 inline-flex items-start gap-1.5 w-full">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span><b>Flag for Matt.</b> {d.escalate.reason}</span>
        </div>
      )}
      {unverified && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 inline-flex items-start gap-1.5 w-full">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /><span>{unverifiedText}</span>
        </div>
      )}
      <div className="max-h-48 overflow-y-auto text-[13px] whitespace-pre-wrap break-words leading-relaxed text-off-black bg-white border border-border-gray rounded-lg px-3 py-2">{n.body.replace(/\{\{rep\}\}/g, '…')}</div>
      {proposals.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {proposals.map(p => <ProposalRow key={p.id} p={p} onApprove={onApprove} onDismiss={onDismiss} />)}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        {active && <button onClick={() => onUse(n.body)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#4600D6] text-white hover:bg-[#3a00b3]">Use this draft</button>}
        {active && (asking ? (
          <div className="flex-1 min-w-[220px] flex items-center gap-1.5">
            <input autoFocus value={instruction} onChange={e => setInstruction(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') redraft(); if (e.key === 'Escape') setAsking(false) }}
              placeholder="What to change, e.g. they already sent the photos" className="flex-1 px-2 py-1 text-xs bg-white border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-[#4600D6]/30" />
            <button onClick={redraft} disabled={busy} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-[#4600D6]/30 text-[#4600D6] hover:bg-[#4600D6]/5 disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}Redraft</button>
          </div>
        ) : (
          <button onClick={() => setAsking(true)} className="inline-flex items-center gap-1 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2"><RefreshCw className="w-3 h-3" />Redraft</button>
        ))}
        {active && !asking && !teaching && (
          <button onClick={() => setTeaching(true)} className="inline-flex items-center gap-1 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2" title="Correct Claude so later drafts get it right"><GraduationCap className="w-3 h-3" />Teach</button>
        )}
        {hasWork && (
          <button onClick={() => setShowWork(v => !v)} className="ml-auto inline-flex items-center gap-1 text-[11px] text-off-black/45 hover:text-off-black">
            <ChevronDown className={`w-3 h-3 transition-transform ${showWork ? 'rotate-180' : ''}`} />Why
          </button>
        )}
      </div>
      {teaching && <Teach noteId={n.id} onCancel={() => setTeaching(false)} onDone={async (fb) => { setTeaching(false); await onRedraft(fb) }} />}
      {/* Claude's working, for when the draft needs checking. */}
      {showWork && (
        <div className="mt-2 pt-2 border-t border-[#4600D6]/15 grid gap-1.5 text-xs text-off-black/70">
          {d.summary && <div><span className="text-off-black/45">They want: </span>{d.summary}</div>}
          {d.needsInfo && <div><span className="text-off-black/45">Not sure about: </span>{d.needsInfo}</div>}
          {d.keyFacts && d.keyFacts.length > 0 && <ul className="list-disc pl-4 space-y-0.5">{d.keyFacts.map((f, i) => <li key={i}>{f}</li>)}</ul>}
          {d.steps && d.steps.length > 0 && <div><span className="text-off-black/45">Before you send: </span>{d.steps.join(' · ')}</div>}
        </div>
      )}
    </div>
  )
}
