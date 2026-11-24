import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, History, Loader2, Pin, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import HelpText from '../HelpText'
import { helpApi, type Article, type ArticleRow, type Question } from '@/lib/helpApi'
import { btnPrimary, btnSecondary, btnGhost, inputBase, segment, segmentGroup } from '@/lib/ui'

/**
 * Help > Manage, admins only: every question asked, the corrections reps sent
 * with a thumbs down, and the full articles under the cards (read by Ask and
 * by Claude's drafts). An article that may be out of date says why (not
 * confirmed in a while, a date in it has passed, wrong answers cited it);
 * Still right or a save starts the checks over.
 */
const when = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

export default function ManageTab({ onPending }: { onPending: (n: number) => void }) {
  const [view, setView] = useState<'questions' | 'articles'>('questions')
  const [articles, setArticles] = useState<ArticleRow[]>([])
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  useEffect(() => { helpApi.articles().then(r => setArticles(r.articles)).catch(e => toast.error((e as Error).message)) }, [])
  const stale = articles.filter(a => a.stale.length).length
  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-5 py-2.5 border-b border-border-gray flex items-center gap-3 shrink-0">
        <div className={segmentGroup}>
          <button className={segment(view === 'questions')} onClick={() => setView('questions')}>Questions</button>
          <button className={segment(view === 'articles')} onClick={() => setView('articles')}>Articles</button>
        </div>
        {stale > 0 && <button onClick={() => setView('articles')} className="ml-auto inline-flex items-center gap-1 text-xs text-amber-700 hover:underline"><AlertTriangle className="w-3 h-3" />{stale} may be out of date</button>}
      </div>
      <div className="flex-1 min-h-0">
        {view === 'questions'
          ? <QuestionsTab isAdmin onPending={onPending} onOpenArticle={slug => { setOpenSlug(slug); setView('articles') }} />
          : <ArticlesTab articles={articles} setArticles={setArticles} isAdmin openSlug={openSlug} setOpenSlug={setOpenSlug} />}
      </div>
    </div>
  )
}

function ArticlesTab({ articles, setArticles, isAdmin, openSlug, setOpenSlug }: {
  articles: ArticleRow[]; setArticles: (a: ArticleRow[]) => void; isAdmin: boolean; openSlug: string | null; setOpenSlug: (s: string | null) => void
}) {
  const [filter, setFilter] = useState('')
  const [hits, setHits] = useState<{ slug: string; title: string; excerpt: string }[] | null>(null)
  const [article, setArticle] = useState<Article | null>(null)
  const [editing, setEditing] = useState<{ slug?: string; title: string; group: string; body: string; pinned: boolean; reviewEveryDays: number } | null>(null)
  const [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!openSlug) { setArticle(null); return }
    setEditing(null); setHistory(false)
    helpApi.article(openSlug).then(r => setArticle(r.article)).catch(e => toast.error((e as Error).message))
  }, [openSlug])
  useEffect(() => {
    const t = filter.trim()
    if (t.length < 3) { setHits(null); return }
    const id = setTimeout(() => { helpApi.search(t).then(r => setHits(r.results)).catch(() => setHits(null)) }, 300)
    return () => clearTimeout(id)
  }, [filter])
  const groups = useMemo(() => {
    const m = new Map<string, ArticleRow[]>()
    for (const a of articles) { const g = a.pinned ? 'Pinned' : (a.group || 'Other'); if (!m.has(g)) m.set(g, []); m.get(g)!.push(a) }
    return [...m.entries()]
  }, [articles])
  const row = articles.find(a => a.slug === openSlug)
  const stillRight = async () => {
    if (!article) return
    setBusy(true)
    try { const r = await helpApi.reviewed(article.slug); setArticles(r.articles); setArticle(r.article); toast.success('Marked still right') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const save = async () => {
    if (!editing) return
    setBusy(true)
    try { const r = await helpApi.save(editing); setArticles(r.articles); setArticle(r.article); setOpenSlug(r.article.slug); setEditing(null); toast.success('Saved. Reps and Claude use it now.') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const restore = async (versionId: string) => {
    setBusy(true)
    try { const r = await helpApi.restore(versionId); setArticle(r.article); toast.success('Earlier version restored') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 border-r border-border-gray p-3 space-y-3 overflow-y-auto overscroll-contain">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-off-black/35" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search the playbook" className={`${inputBase} w-full pl-8 py-1.5 text-xs`} />
        </div>
        {isAdmin && <button onClick={() => { setOpenSlug(null); setEditing({ title: '', group: '', body: '', pinned: false, reviewEveryDays: 90 }) }} className={`${btnSecondary} w-full justify-center`}><Plus className="w-3.5 h-3.5" /> New article</button>}
        {hits ? (
          <div className="space-y-1">
            {hits.length === 0 && <div className="text-xs text-off-black/45 px-1">Nothing matches.</div>}
            {hits.map(h => (
              <button key={h.slug} onClick={() => setOpenSlug(h.slug)} className={`block w-full text-left px-2 py-1.5 rounded ${openSlug === h.slug ? 'bg-subtle-gray' : 'hover:bg-subtle-gray'}`}>
                <div className="text-xs font-medium text-off-black">{h.title}</div>
                <div className="text-[11px] text-off-black/50 line-clamp-2">{h.excerpt}</div>
              </button>
            ))}
          </div>
        ) : groups.map(([g, list]) => (
          <div key={g}>
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-off-black/40 inline-flex items-center gap-1">{g === 'Pinned' && <Pin className="w-3 h-3" />}{g}</div>
            {list.map(a => (
              <button key={a.slug} onClick={() => setOpenSlug(a.slug)} title={a.stale.length ? `May be out of date: ${a.stale.join('; ')}` : undefined}
                className={`w-full text-left px-2 py-1 rounded text-xs flex items-start gap-1.5 ${openSlug === a.slug ? 'bg-subtle-gray text-off-black font-medium' : 'text-off-black/75 hover:bg-subtle-gray'}`}>
                <span className="flex-1">{a.title}</span>{isAdmin && a.stale.length > 0 && <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-600" />}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0 p-5 overflow-y-auto overscroll-contain">
        {editing ? (
          <div className="space-y-2">
            <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Title" className={`${inputBase} w-full text-sm font-semibold`} />
            <input value={editing.group} onChange={e => setEditing({ ...editing, group: e.target.value })} placeholder="Group (e.g. Scenarios, Context, How we work)" className={`${inputBase} w-full text-xs`} />
            <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={20} className={`${inputBase} w-full font-mono text-xs leading-relaxed`} />
            <div className="flex items-center gap-4 text-xs text-off-black/65">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={editing.pinned} onChange={e => setEditing({ ...editing, pinned: e.target.checked, reviewEveryDays: e.target.checked ? Math.min(editing.reviewEveryDays, 30) : editing.reviewEveryDays })} className="accent-[#4600D6]" />
                Pinned (shown first, read by every answer and draft)
              </label>
              <label className="inline-flex items-center gap-1.5">Check it every
                <select value={editing.reviewEveryDays} onChange={e => setEditing({ ...editing, reviewEveryDays: Number(e.target.value) })} className="px-1.5 py-0.5 border border-border-gray rounded bg-white">
                  {[14, 30, 60, 90, 180].map(d => <option key={d} value={d}>{d} days</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-off-black/45">**bold**, - lists, [link](https://…). Every save is kept; History puts an old one back.</span>
              <span className="flex-1" />
              <button onClick={() => setEditing(null)} className={btnGhost}>Cancel</button>
              <button onClick={save} disabled={busy} className={btnPrimary}>{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save</button>
            </div>
          </div>
        ) : article ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-off-black">{article.title}</div>
                <div className="text-[11px] text-off-black/45">{article.pinned ? 'Pinned · ' : ''}{article.group} · updated {when(article.updatedAt)}{article.reviewedAt ? ` · confirmed ${when(article.reviewedAt)}` : ''}</div>
              </div>
              {isAdmin && (
                <>
                  <button onClick={() => setHistory(v => !v)} className={btnGhost}><History className="w-3.5 h-3.5" /> History</button>
                  <button onClick={() => setEditing({ slug: article.slug, title: article.title, group: article.group, body: article.body, pinned: article.pinned, reviewEveryDays: article.reviewEveryDays })} className={btnSecondary}>Edit</button>
                </>
              )}
            </div>
            {row && row.stale.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50/50 px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs text-off-black/75">May be out of date: {row.stale.join('; ')}.</div>
                {isAdmin && <button disabled={busy} onClick={stillRight} className={btnSecondary}><Check className="w-3.5 h-3.5" /> Still right</button>}
              </div>
            )}
            {history && (
              <ul className="rounded border border-border-gray divide-y divide-border-gray">
                {article.versions.map((v, i) => (
                  <li key={v.id} className="px-3 py-1.5 flex items-center text-xs">
                    <span className="flex-1 text-off-black/70">{when(v.createdAt)}{i === 0 ? ' · current' : ''}</span>
                    {i > 0 && <button disabled={busy} onClick={() => restore(v.id)} className="text-[#4600D6] hover:underline">Restore</button>}
                  </li>
                ))}
              </ul>
            )}
            <HelpText text={article.body} />
          </div>
        ) : (
          <div className="text-sm text-off-black/50">Pick an article to read or edit. Reps see the short cards in Playbook; these are the full details under them, and what Claude reads.</div>
        )}
      </div>
    </div>
  )
}

function QuestionsTab({ isAdmin, onPending, onOpenArticle }: { isAdmin: boolean; onPending: (n: number) => void; onOpenArticle: (slug: string) => void }) {
  const [log, setLog] = useState<{ recent: Question[]; pending: Question[] } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { helpApi.log().then(r => { setLog(r); onPending(r.pending.length) }).catch(e => toast.error((e as Error).message)) }, [onPending])
  const review = async (id: string, decision: 'approve' | 'dismiss') => {
    try { const r = await helpApi.review(id, decision); setLog(r); onPending(r.pending.length); toast.success(decision === 'approve' ? 'Added to Answers from the team' : 'Dismissed') }
    catch (e) { toast.error((e as Error).message) }
  }
  if (!log) return <div className="p-5"><Loader2 className="w-4 h-4 animate-spin text-off-black/40" /></div>
  return (
    <div className="p-5 space-y-5 h-full overflow-y-auto overscroll-contain">
      {isAdmin && log.pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-off-black">Corrections to review</div>
          {log.pending.map(q => (
            <div key={q.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-1.5">
              <div className="text-xs font-medium text-off-black">{q.question}</div>
              <div className="text-[11px] text-off-black/50">Help center said:</div>
              <div className="text-xs text-off-black/60 line-clamp-3">{q.answer}</div>
              <div className="text-[11px] text-off-black/50">{q.askedByName} says the right answer is:</div>
              <div className="text-xs text-off-black whitespace-pre-wrap">{q.correction}</div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => review(q.id, 'approve')} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Add to the playbook</button>
                <button onClick={() => review(q.id, 'dismiss')} className={btnGhost}><X className="w-3.5 h-3.5" /> Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <div className="text-[12px] font-semibold text-off-black">Recent questions</div>
        {log.recent.length === 0 && <div className="text-xs text-off-black/45">No questions yet.</div>}
        {log.recent.map(q => (
          <div key={q.id} className="border-b border-border-gray py-2">
            <button onClick={() => setOpen(open === q.id ? null : q.id)} className="w-full text-left flex items-start gap-2">
              <span className="flex-1 text-xs text-off-black">{q.question}</span>
              <span className="shrink-0 text-[11px] text-off-black/45">{q.askedByName} · {when(q.createdAt)}{q.feedback === 'helpful' ? ' · helpful' : q.feedback === 'wrong' ? ' · not right' : ''}</span>
            </button>
            {open === q.id && (
              <div className="mt-2 pl-2 border-l-2 border-border-gray space-y-2">
                <HelpText text={q.answer} />
                {q.sources?.articles?.length ? (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">{q.sources.articles.map(a => <button key={a.slug} onClick={() => onOpenArticle(a.slug)} className="px-2 py-0.5 rounded-full border border-border-gray text-off-black/70">{a.title}</button>)}</div>
                ) : null}
                {q.correction && <div className="text-xs"><span className="text-off-black/50">Correction: </span>{q.correction}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
