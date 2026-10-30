import { useEffect, useState } from 'react'
import { History, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi, type PlaybookReview, type PlaybookVersion } from '@/lib/supportApi'
import { useArmed } from '@/lib/useArmed'

/**
 * What Claude drafts from: the playbook, in plain text. Admins edit it
 * here; a change applies to the next draft, no deploy. Every save is kept:
 * History lists the versions (edits, taught lessons, the Monday review of
 * what the team sent) and Restore puts one back. Reset goes back to the
 * version condensed from the Notion page.
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
  const runReview = async () => {
    setReviewing(true); setReview(null)
    try {
      const r = await supportApi.previewPlaybookReview()
      if (r.status === 'proposal') setReview(r)
      else toast.message(r.status === 'unchanged' ? `${r.line || ''} Nothing worth changing.`.trim() : r.reason || 'Nothing to review yet')
    } catch (e) { toast.error((e as Error).message) } finally { setReviewing(false) }
  }
  useEffect(() => {
    supportApi.settings().then(r => { if (r.playbook) { setText(r.playbook.text); setSaved(r.playbook.text); setEdited(r.playbook.edited) } setVersions(r.playbookVersions || []) }).catch(() => {})
  }, [])
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
        <span className="text-[11px] text-off-black/45">{versions[0] ? `${SOURCE[versions[0].source] || 'Edited'} ${when(versions[0].createdAt)}` : edited ? 'Edited' : 'From Notion, Oct 17'} · {open ? 'Hide' : 'Show'}</span>
      </button>
      <p className="text-[11px] text-off-black/50">What Claude follows when it drafts a reply: voice, facts, policy, when to flag Matt. The macros are its phrasing examples.</p>
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
          {isAdmin && (
            <div className="rounded border border-border-gray bg-subtle-gray/60 px-2.5 py-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] text-off-black/60">Every Monday Claude reads the past week's replies next to its drafts and updates this playbook on its own. Run it now to see what it would change.</span>
                <button disabled={reviewing || busy} onClick={runReview} className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[#4600D6] hover:underline disabled:opacity-50">
                  {reviewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}{reviewing ? 'Reading the week (1 to 3 minutes)' : 'Run the review now'}
                </button>
              </div>
              {review && (
                <div className="space-y-1.5">
                  {review.line && <div className="text-[11px] text-off-black/50">{review.line}</div>}
                  <ul className="space-y-1">
                    {review.changes.map((c, i) => <li key={i} className="text-xs text-off-black"><span className="font-medium">{c.what}</span> <span className="text-off-black/50">({c.why})</span></li>)}
                  </ul>
                  <div className="flex items-center gap-3 pt-1">
                    <button disabled={busy} onClick={() => run(() => supportApi.applyPlaybookReview(review), 'Playbook updated; the next draft uses it').then(() => setReview(null))} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-dark-fill text-white hover:bg-off-black/85 disabled:opacity-50">Apply these changes</button>
                    <button onClick={() => setReview(null)} className="text-xs text-off-black/55 hover:text-off-black">Discard</button>
                  </div>
                </div>
              )}
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
