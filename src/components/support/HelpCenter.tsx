import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, Check, GraduationCap, History, Loader2, Pin, Plus, Search, Sparkles, ThumbsUp, X } from 'lucide-react'
import { toast } from 'sonner'
import ActionModal from '@/components/ActionModal'
import HelpText from './HelpText'
import { helpApi, type Article, type ArticleRow, type AskAnswer, type Question } from '@/lib/helpApi'
import { btnPrimary, btnSecondary, btnGhost, inputBase, segment, segmentGroup } from '@/lib/ui'

/**
 * Support > Help (server/domain/support/helpCenter.js): ask a question and
 * get an answer from the playbook, the articles and past cases; read and
 * search the articles; see every question asked. Admins edit articles and
 * approve the corrections reps send with Not right. This is the one place
 * the support playbook is edited; Notion is no longer updated.
 *
 * Pinned articles (current policies and numbers) sit first and go with every
 * answer and draft. An article that may be out of date says why (not
 * confirmed in a while, a date in it has passed, Not right answers cited it);
 * Still right or a save starts the checks over.
 */
type Tab = 'ask' | 'articles' | 'questions' | 'onboarding'
const when = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

export default function HelpCenter({ threadId, onOpenThread, onClose }: { threadId: string | null; onOpenThread: (id: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('ask')
  const [articles, setArticles] = useState<ArticleRow[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    helpApi.articles().then(r => { setArticles(r.articles); setIsAdmin(r.isAdmin) }).catch(e => toast.error((e as Error).message))
    helpApi.log().then(r => setPending(r.pending.length)).catch(() => {})
  }, [])
  const openArticle = (slug: string) => { setOpenSlug(slug); setTab('articles') }
  return (
    <ActionModal icon={BookOpen} title="Help" size="xl" bare onClose={onClose}
      description="Ask anything about handling a customer, read the playbook, and see what the team has asked.">
      <div className="px-5 pt-3 pb-2 border-b border-border-gray flex items-center gap-3">
        <div className={segmentGroup}>
          <button className={segment(tab === 'ask')} onClick={() => setTab('ask')}>Ask</button>
          <button className={segment(tab === 'articles')} onClick={() => setTab('articles')}>Playbook ({articles.length})</button>
          <button className={segment(tab === 'questions')} onClick={() => setTab('questions')}>Questions{isAdmin && pending ? ` · ${pending} to review` : ''}</button>
          <button className={segment(tab === 'onboarding')} onClick={() => setTab('onboarding')}>Onboarding</button>
        </div>
        {isAdmin && articles.some(a => a.stale.length) && (
          <button onClick={() => setTab('articles')} className="ml-auto inline-flex items-center gap-1 text-[11px] text-amber-700 hover:underline"><AlertTriangle className="w-3 h-3" />{articles.filter(a => a.stale.length).length} may be out of date</button>
        )}
      </div>
      <div className="min-h-[60vh] max-h-[72vh] overflow-y-auto">
        {tab === 'ask' && <AskTab threadId={threadId} onOpenArticle={openArticle} onOpenThread={id => { onClose(); onOpenThread(id) }} />}
        {tab === 'articles' && <ArticlesTab articles={articles} setArticles={setArticles} isAdmin={isAdmin} openSlug={openSlug} setOpenSlug={setOpenSlug} />}
        {tab === 'questions' && <QuestionsTab isAdmin={isAdmin} onPending={setPending} onOpenArticle={openArticle} />}
        {tab === 'onboarding' && (
          <div className="p-10 flex flex-col items-center text-center gap-2">
            <GraduationCap className="w-8 h-8 text-off-black/30" />
            <div className="text-sm font-semibold text-off-black">Onboarding: coming soon</div>
            <p className="max-w-md text-xs text-off-black/55">A guided path through the playbook for new reps: the articles to read first, the tools to set up, and a few practice cases, with progress you can check. Until then, new reps start with Start here in the Playbook tab.</p>
          </div>
        )}
      </div>
    </ActionModal>
  )
}

function AskTab({ threadId, onOpenArticle, onOpenThread }: { threadId: string | null; onOpenArticle: (slug: string) => void; onOpenThread: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [aboutThread, setAboutThread] = useState(Boolean(threadId))
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [asked, setAsked] = useState('')
  const [fixing, setFixing] = useState(false)
  const [correction, setCorrection] = useState('')
  const [rated, setRated] = useState<'helpful' | 'wrong' | null>(null)
  const go = async () => {
    if (q.trim().length < 4 || busy) return
    setBusy(true); setAnswer(null); setRated(null); setFixing(false); setCorrection('')
    try { const r = await helpApi.ask(q.trim(), aboutThread ? threadId : null); setAnswer(r); setAsked(q.trim()) }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const helpful = async () => { if (!answer) return; try { await helpApi.helpful(answer.id); setRated('helpful') } catch (e) { toast.error((e as Error).message) } }
  const sendFix = async () => {
    if (!answer) return
    try { await helpApi.notRight(answer.id, correction); setRated('wrong'); setFixing(false); toast.success('Thanks. An admin will add it to the playbook.') }
    catch (e) { toast.error((e as Error).message) }
  }
  return (
    <div className="p-5 space-y-4">
      <div className="space-y-2">
        <textarea value={q} onChange={e => setQ(e.target.value)} rows={3} autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go() }}
          placeholder="e.g. The customer wants a different frame but the order is already in production. What do I do?"
          className={`${inputBase} text-sm leading-relaxed`} />
        <div className="flex items-center gap-3">
          {threadId && (
            <label className="inline-flex items-center gap-1.5 text-xs text-off-black/60 cursor-pointer">
              <input type="checkbox" checked={aboutThread} onChange={e => setAboutThread(e.target.checked)} className="accent-[#4600D6]" />
              About the conversation I have open
            </label>
          )}
          <span className="flex-1" />
          <button onClick={go} disabled={busy || q.trim().length < 4} className={btnPrimary}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{busy ? 'Looking it up' : 'Ask'}
          </button>
        </div>
      </div>
      {answer && (
        <div className="rounded-lg border border-border-gray bg-white p-4 space-y-3">
          <div className="text-[11px] text-off-black/45">{asked}</div>
          {!answer.covered && <div className="text-[11px] text-amber-700">The playbook doesn't cover this clearly. Check with Matt before acting.</div>}
          <HelpText text={answer.answer} />
          {(answer.articles.length > 0 || answer.cases.length > 0) && (
            <div className="pt-2 border-t border-border-gray space-y-1.5">
              {answer.articles.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-off-black/45">From the playbook:</span>
                  {answer.articles.map(a => <button key={a.slug} onClick={() => onOpenArticle(a.slug)} className="px-2 py-0.5 rounded-full border border-border-gray hover:border-off-black/30 text-off-black/75">{a.title}</button>)}
                </div>
              )}
              {answer.cases.length > 0 && (
                <div className="space-y-1 text-[11px]">
                  <div className="text-off-black/45">Past cases like this:</div>
                  {answer.cases.map(c => (
                    <button key={c.id} onClick={() => onOpenThread(c.id)} className="block w-full text-left px-2 py-1 rounded hover:bg-subtle-gray">
                      <span className="text-off-black/80">{c.summary}</span> <span className="text-off-black/45">({c.outcomeLabel})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            {rated === 'helpful' && <span className="text-[11px] text-green-700 inline-flex items-center gap-1"><Check className="w-3 h-3" /> Marked helpful</span>}
            {rated === 'wrong' && <span className="text-[11px] text-off-black/55">Sent for review</span>}
            {!rated && !fixing && (
              <>
                <button onClick={helpful} className={btnSecondary}><ThumbsUp className="w-3.5 h-3.5" /> Helpful</button>
                <button onClick={() => setFixing(true)} className={btnGhost}><X className="w-3.5 h-3.5" /> Not right</button>
              </>
            )}
          </div>
          {fixing && (
            <div className="space-y-2">
              <textarea value={correction} onChange={e => setCorrection(e.target.value)} rows={3} placeholder="What's the right answer? Matt approves it into the playbook, so the next person gets it."
                className={`${inputBase} text-sm`} />
              <div className="flex justify-end gap-2">
                <button onClick={() => setFixing(false)} className={btnGhost}>Cancel</button>
                <button onClick={sendFix} disabled={correction.trim().length < 5} className={btnPrimary}>Send</button>
              </div>
            </div>
          )}
        </div>
      )}
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
    <div className="flex min-h-[60vh]">
      <div className="w-64 shrink-0 border-r border-border-gray p-3 space-y-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-off-black/35" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search the playbook" className={`${inputBase} pl-8 py-1.5 text-xs`} />
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
      <div className="flex-1 min-w-0 p-5">
        {editing ? (
          <div className="space-y-2">
            <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Title" className={`${inputBase} text-sm font-semibold`} />
            <input value={editing.group} onChange={e => setEditing({ ...editing, group: e.target.value })} placeholder="Group (e.g. Scenarios, Context, How we work)" className={`${inputBase} text-xs`} />
            <textarea value={editing.body} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={20} className={`${inputBase} font-mono text-xs leading-relaxed`} />
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
          <div className="text-sm text-off-black/50">Pick an article, or search. This is the support playbook: how we handle every kind of customer message.</div>
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
    <div className="p-5 space-y-5">
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
