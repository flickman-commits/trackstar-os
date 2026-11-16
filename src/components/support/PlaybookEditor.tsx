import { useEffect, useState } from 'react'
import { Check, History, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi, type PlaybookChange, type PlaybookReview, type PlaybookVersion } from '@/lib/supportApi'
import { useArmed } from '@/lib/useArmed'
import { wordDiff } from '@/lib/wordDiff'

/**
 * What Claude drafts from: the playbook, in plain text. Admins edit it
 * here; a change applies to the next draft, no deploy. Every save is kept:
 * History lists the versions (edits, taught lessons, the Monday review of
 * what the team sent) and Restore puts one back. Reset goes back to the
 * version condensed from the Notion page.
 *
 * The weekly review's changes that wait for a person (and every change of a
 * review run by hand) are listed one by one, each with what it changes in
 * the text, and approved or denied on its own.
 */
const SOURCE: Record<PlaybookVersion['source'], string> = { edit: 'Edited', lesson: 'Lesson taught', reset: 'Reset', weekly: 'Weekly review', restore: 'Restored' }
const when = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
export default function PlaybookEditor({ isAdmin }: { isAdmin: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const { arm, isArmed } = useArmed()
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<PlaybookVersion[]>([])
  const [history, setHistory] = useState(false)
  // The weekly review, run by hand: Claude reads the past week's replies next to its drafts.
  const [review, setReview] = useState<PlaybookReview | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [deciding, setDeciding] = useState<string | null>(null)
  const runReview = async () => {
    setReviewing(true); setReview(null)
    try {
      const r = await supportApi.previewPlaybookReview()
      if (r.status === 'proposal') setReview(r)
      else toast.message(r.status === 'unchanged' ? `${r.line || ''} Nothing worth changing.`.trim() : r.reason || 'Nothing to review yet')
    } catch (e) { toast.error((e as Error).message) } finally { setReviewing(false) }
  }
  const decide = async (c: PlaybookChange, decision: 'approve' | 'deny') => {
    setDeciding(c.id)
    try {
      const r = await supportApi.decidePlaybookChange(c.id, decision)
      setReview(r.review)
      if (r.playbook) {
        const pb = r.playbook
        // Unsaved typing in the box is left alone; Save would then write over the approved change.
        setText(t => (t === saved ? pb.text : t)); setSaved(pb.text); setEdited(pb.edited)
      }
      if (r.playbookVersions) setVersions(r.playbookVersions)
      toast.success(decision === 'approve' ? 'Approved; the next draft uses it' : 'Denied')
    } catch (e) { toast.error((e as Error).message) } finally { setDeciding(null) }
  }
  useEffect(() => {
    supportApi.settings().then(r => { if (r.playbook) { setText(r.playbook.text); setSaved(r.playbook.text); setEdited(r.playbook.edited) } setVersions(r.playbookVersions || []) }).catch(() => {})
    if (isAdmin) supportApi.heldPlaybookReview().then(r => { if (r.review) setReview(r.review) }).catch(() => {})
  }, [isAdmin])
  const waiting = review?.changes.filter(c => c.status === 'pending').length || 0
  const run = async (fn: () => Promise<{ playbook: { text: string; edited: boolean }; playbookVersions?: PlaybookVersion[] }>, msg: string) => {
    setBusy(true)
    try { const r = await fn(); setText(r.playbook.text); setSaved(r.playbook.text); setEdited(r.playbook.edited); if (r.playbookVersions) setVersions(r.playbookVersions); toast.success(msg) }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  if (text === null) return null
  return (
    <div className="border-b border-border-gray px-4 py-3 space-y-2">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between text-left">
        <span className="text-[12px] font-semibold text-off-black">Drafting playbook</span>
        <span className="text-[11px] text-off-black/45">{waiting > 0 && <span className="text-amber-700">{waiting} change{waiting === 1 ? '' : 's'} waiting · </span>}{versions[0] ? `${SOURCE[versions[0].source] || 'Edited'} ${when(versions[0].createdAt)}` : edited ? 'Edited' : 'From Notion, Oct 17'} · {open ? 'Hide' : 'Show'}</span>
      </button>
      <p className="text-[11px] text-off-black/50">What Claude follows when it drafts a reply: voice, facts, policy, when to flag Matt. The macros are its phrasing examples.</p>
      {isAdmin && (
        <div className="rounded border border-border-gray bg-subtle-gray/60 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11px] text-off-black/60">Every Monday Claude reads the past week's replies next to its drafts and updates this playbook. A change that adds a link or touches Escalate or a refund rule waits here for you. Run it now to see what it would change.</span>
            {!waiting && (
              <button disabled={reviewing || busy} onClick={runReview} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[#4600D6] hover:underline disabled:opacity-50">
                {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}{reviewing ? 'Reading the week (1 to 3 minutes)' : 'Run the review now'}
              </button>
            )}
          </div>
          {review && review.changes.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[11px] text-off-black/50">
                <span className="flex-1">{review.at ? `Review of ${new Date(review.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}. ` : ''}{review.line || ''} {waiting ? `${waiting} of ${review.changes.length} waiting.` : 'All decided.'}</span>
                {!waiting && <button onClick={() => setReview(null)} className="text-off-black/55 hover:text-off-black">Close</button>}
              </div>
              <ul className="space-y-1.5">
                {review.changes.map(c => <ChangeRow key={c.id} change={c} busy={deciding === c.id} disabled={Boolean(deciding) || busy} onDecide={d => decide(c, d)} />)}
              </ul>
            </div>
          )}
        </div>
      )}
      {open && (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} readOnly={!isAdmin} rows={16}
            className="w-full px-2.5 py-2 text-xs font-mono leading-relaxed bg-white border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
          {isAdmin && (
            <div className="flex items-center gap-2">
              {edited && <button disabled={busy} onClick={() => { if (arm('reset')) run(() => supportApi.resetPlaybook(), 'Playbook reset') }} className={`inline-flex items-center gap-1 text-xs ${isArmed('reset') ? 'text-red-600' : 'text-off-black/50 hover:text-off-black'}`}><RotateCcw className="w-3 h-3" />{isArmed('reset') ? 'Click again to go back to the Notion version' : 'Reset'}</button>}
              <span className="flex-1" />
              <button disabled={busy || text === saved} onClick={() => run(() => supportApi.savePlaybook(text), 'Playbook saved; the next draft uses it')} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-dark-fill text-white hover:bg-off-black/85 disabled:opacity-50">{busy && <Loader2 className="w-3 h-3 animate-spin" />}Save</button>
            </div>
          )}
          {versions.length > 0 && (
            <div className="pt-1">
              <button onClick={() => setHistory(v => !v)} className="inline-flex items-center gap-1 text-xs text-off-black/55 hover:text-off-black"><History className="w-3 h-3" />History ({versions.length}) · {history ? 'Hide' : 'Show'}</button>
              {history && (
                <ul className="mt-2 divide-y divide-border-gray border border-border-gray rounded">
                  {versions.map((v, i) => (
                    <li key={v.id} className="px-2.5 py-2 text-xs flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-off-black"><span className="font-medium">{SOURCE[v.source] || v.source}</span> <span className="text-off-black/45">{when(v.createdAt)}{i === 0 ? ' · current' : ''}</span></div>
                        {v.summary && <div className="mt-0.5 text-off-black/60 whitespace-pre-wrap">{v.summary}</div>}
                      </div>
                      {isAdmin && i > 0 && (
                        <button disabled={busy} onClick={() => { if (arm(`restore:${v.id}`)) run(() => supportApi.restorePlaybook(v.id), 'Earlier playbook restored') }}
                          className={`shrink-0 text-xs ${isArmed(`restore:${v.id}`) ? 'text-red-600' : 'text-[#4600D6] hover:underline'}`}>{isArmed(`restore:${v.id}`) ? 'Click again to restore' : 'Restore'}</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** One proposed change: what and why, what it does to the text, and Approve or Deny. */
function ChangeRow({ change: c, busy, disabled, onDecide }: { change: PlaybookChange; busy: boolean; disabled: boolean; onDecide: (d: 'approve' | 'deny') => void }) {
  const [full, setFull] = useState(false)
  return (
    <li className={`rounded border border-border-gray bg-white px-2.5 py-2 ${c.status === 'pending' ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-off-black">{c.what}</div>
          <div className="text-[11px] text-off-black/50">{c.why}</div>
          {c.warnings.length > 0 && <div className="text-[11px] text-amber-700">Needs you: it {c.warnings.join('; ')}.</div>}
        </div>
        {c.status === 'pending' ? (
          <div className="shrink-0 flex items-center gap-1.5">
            <button disabled={disabled} onClick={() => onDecide('approve')} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-dark-fill text-white hover:bg-off-black/85 disabled:opacity-50">{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}Approve</button>
            <button disabled={disabled} onClick={() => onDecide('deny')} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border border-border-gray text-off-black/70 hover:text-off-black disabled:opacity-50"><X className="w-3 h-3" />Deny</button>
          </div>
        ) : (
          <span className={`shrink-0 text-[11px] font-medium ${c.status === 'approved' ? 'text-green-700' : 'text-off-black/50'}`}>{c.status === 'approved' ? 'Approved' : 'Denied'}</span>
        )}
      </div>
      <div className="mt-1.5 space-y-1">
        {c.edits.map((e, i) => <EditDiff key={i} old={e.old} next={e.new} full={full} />)}
        <button onClick={() => setFull(v => !v)} className="text-[11px] text-off-black/45 hover:text-off-black">{full ? 'Show only the changes' : 'Show the whole passage'}</button>
      </div>
    </li>
  )
}

/** The words an edit removes (struck, red) and adds (green); long unchanged stretches are cut short unless `full`. */
function EditDiff({ old, next, full }: { old: string; next: string; full: boolean }) {
  const parts = wordDiff(old, next)
  const trim = (t: string, first: boolean, last: boolean) => {
    if (full) return t
    const w = t.split(/(\s+)/)
    if (w.length <= 24) return t
    if (first) return `… ${w.slice(-12).join('')}`
    if (last) return `${w.slice(0, 12).join('')} …`
    return `${w.slice(0, 12).join('')} … ${w.slice(-12).join('')}`
  }
  return (
    <div className="rounded bg-subtle-gray/50 px-2 py-1.5 text-[11px] leading-relaxed text-off-black/70 whitespace-pre-wrap break-words">
      {parts.map((p, i) => p.kind === 'same'
        ? <span key={i}>{trim(p.text, i === 0, i === parts.length - 1)}</span>
        : <span key={i} className={p.kind === 'del' ? 'bg-red-100 text-red-800 line-through' : 'bg-green-100 text-green-900'}>{p.text}</span>)}
    </div>
  )
}
