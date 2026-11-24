import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import HelpText from '../HelpText'
import { helpApi, type Article, type Topic } from '@/lib/helpApi'
import { modalCancel, modalPrimary } from '@/lib/ui'
import { Steps } from './AskTab'
import ReplyCard from './ReplyCard'
import { fillNames } from './reply'

/**
 * Help > Playbook: a short list of the messages customers send, and one
 * screen for each (server/domain/support/helpTopics.js): what to do, what to
 * say, the exceptions. The long articles are folded under Full details. The
 * list and the card scroll on their own.
 */
const PRICES = 'current-policies-and-numbers'
type Hit = { slug: string; title: string; excerpt: string }
type Names = { first?: string | null; rep?: string | null }

export default function PlaybookTab({ topics, onTopics, isAdmin, names, onUseReply }: { topics: Topic[] | null; onTopics: (t: Topic[]) => void; isAdmin: boolean; names: Names; onUseReply?: (body: string) => void }) {
  // On the phone the list and the card take turns, so nothing is open to start with.
  const [open, setOpen] = useState<string | null>(() => (window.innerWidth >= 768 ? PRICES : null))
  const [filter, setFilter] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  useEffect(() => {
    const t = filter.trim()
    if (t.length < 3) { setHits([]); return }
    let live = true
    const id = setTimeout(() => { helpApi.search(t).then(r => { if (live) setHits(r.results) }).catch(() => {}) }, 300)
    return () => { live = false; clearTimeout(id) }
  }, [filter])
  const t = filter.trim().toLowerCase()
  const list = useMemo(() => {
    const all = [{ slug: PRICES, title: 'Prices and policies', text: 'price prices policy shipping delivery size sizes discount code refund' }, ...(topics || []).map(x => ({ slug: x.slug, title: x.title, text: x.body.toLowerCase() }))]
    return t ? all.filter(x => x.title.toLowerCase().includes(t) || x.text.includes(t)) : all
  }, [topics, t])
  const more = hits.filter(h => h.slug !== PRICES && !(topics || []).some(x => x.slug === h.slug))
  const topic = topics?.find(x => x.slug === open)
  const item = (slug: string, title: string) => (
    <button key={slug} onClick={() => setOpen(slug)} className={`block w-full text-left px-3 py-2.5 md:py-2 rounded-lg text-[15px] md:text-sm transition-colors ${open === slug ? 'bg-off-black/[0.06] text-off-black font-medium' : 'text-off-black/70 hover:bg-off-black/[0.03] hover:text-off-black'}`}>{title}</button>
  )
  return (
    <div className="h-full min-h-0 flex">
      <nav aria-label="Playbook" className={`${open ? 'hidden md:flex' : 'flex'} w-full md:w-60 shrink-0 flex-col min-h-0 md:border-r border-border-gray`}>
        <div className="p-3 pb-2 shrink-0 relative">
          <Search className="w-4 h-4 absolute left-6 top-1/2 -translate-y-1/2 mt-0.5 text-off-black/35" />
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search" aria-label="Search the playbook" className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-off-black/[0.04] focus:outline-none focus:ring-2 focus:ring-off-black/10 placeholder:text-off-black/40" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-4">
          {!topics && <Loader2 className="w-4 h-4 m-3 animate-spin text-off-black/30" />}
          {topics && list.map(x => item(x.slug, x.title))}
          {t && more.length > 0 && <div className="px-3 pt-4 pb-1 text-xs text-off-black/40">More details</div>}
          {t && more.map(h => item(h.slug, plain(h.title)))}
          {t && topics && !list.length && !more.length && <div className="px-3 py-2 text-sm text-off-black/45">Nothing matches. Try Ask.</div>}
        </div>
      </nav>
      <div className={`${open ? 'block' : 'hidden md:block'} flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain`} key={open || 'none'}>
        <div className="max-w-[640px] px-5 md:px-8 py-5 md:py-7">
          <button onClick={() => setOpen(null)} className="md:hidden mb-3 -ml-1 inline-flex items-center gap-1 text-sm text-off-black/60"><ChevronLeft className="w-4 h-4" />Playbook</button>
          {topic ? <Card topic={topic} names={names} isAdmin={isAdmin} onUseReply={onUseReply} onSaved={onTopics} /> : open ? <ArticleView slug={open} /> : null}
        </div>
      </div>
    </div>
  )
}

const plain = (title: string) => title.replace(/^Scenario\s+\w+:\s*/i, '').replace(/\s*[\u2600-\u27BF\u2B50].*$/, '').replace(/\s*\([^)]*\)\s*$/, '')

function Card({ topic, names, isAdmin, onUseReply, onSaved }: { topic: Topic; names: Names; isAdmin: boolean; onUseReply?: (body: string) => void; onSaved: (t: Topic[]) => void }) {
  const [reply, setReply] = useState(0)
  const [details, setDetails] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (editing === null) return
    setBusy(true)
    try {
      await helpApi.save({ slug: topic.slug, title: topic.title, group: 'Topics', body: editing })
      onSaved((await helpApi.topics()).topics); setEditing(null); toast.success('Saved. Reps see it now.')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  if (editing !== null) {
    return (
      <div className="space-y-3">
        <h3 className="text-2xl font-semibold text-off-black">{topic.title}</h3>
        <textarea value={editing} onChange={e => setEditing(e.target.value)} rows={18} aria-label="Card text" className="w-full rounded-xl border border-border-gray px-4 py-3 font-mono text-xs leading-relaxed focus:outline-none focus:border-off-black/30" />
        <p className="text-xs text-off-black/50">1. steps, - exceptions, ### Reply: name, then the reply. Keep it to one screen.</p>
        <div className="flex justify-end gap-1"><button onClick={() => setEditing(null)} className={modalCancel}>Cancel</button><button onClick={save} disabled={busy} className={modalPrimary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save</button></div>
      </div>
    )
  }
  const current = topic.replies[Math.min(reply, topic.replies.length - 1)]
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-2xl font-semibold text-off-black">{topic.title}</h3>
        {isAdmin && <button onClick={() => setEditing(topic.body)} className="text-[13px] text-off-black/45 hover:text-off-black">Edit</button>}
      </div>
      <Steps steps={topic.steps} className="mt-5" />
      {current && (
        <div className="mt-7">
          {topic.replies.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {topic.replies.map((r, i) => <button key={r.label} onClick={() => setReply(i)} aria-pressed={current === r} className={`px-3 py-1 rounded-full text-[13px] transition-colors ${current === r ? 'bg-dark-fill text-white' : 'bg-off-black/[0.05] text-off-black/70 hover:bg-off-black/[0.09]'}`}>{r.label}</button>)}
            </div>
          )}
          <ReplyCard text={fillNames(current.text, names)} onUse={onUseReply} />
        </div>
      )}
      {topic.notes.length > 0 && <ul className="mt-7 space-y-2.5 border-l-2 border-border-gray pl-4">{topic.notes.map(n => <Note key={n} text={n} />)}</ul>}
      {topic.details.length > 0 && (
        <div className="mt-7 pt-4 border-t border-border-gray">
          <button onClick={() => setDetails(v => !v)} aria-expanded={details} className="inline-flex items-center gap-1 text-[13px] text-off-black/55 hover:text-off-black">Full details<ChevronDown className={`w-3.5 h-3.5 transition-transform ${details ? 'rotate-180' : ''}`} /></button>
          {details && <div className="mt-2">{topic.details.map(d => <Detail key={d.slug} slug={d.slug} title={d.title} />)}</div>}
        </div>
      )}
    </div>
  )
}

/** "Only the frame broke? Send Frame only." reads with the question darker. */
function Note({ text }: { text: string }) {
  const m = /^(.+?\?)\s+(.+)$/.exec(text)
  return <li className="text-[15px] leading-snug text-off-black/65">{m ? <><span className="text-off-black">{m[1]}</span> {m[2]}</> : text}</li>
}

function Detail({ slug, title }: { slug: string; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-border-gray last:border-0">
      <button onClick={() => setOpen(v => !v)} aria-expanded={open} className="w-full flex items-center justify-between py-2.5 text-left text-sm text-off-black/75 hover:text-off-black">{title}<ChevronDown className={`w-3.5 h-3.5 shrink-0 text-off-black/40 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
      {open && <div className="pb-4"><ArticleView slug={slug} bare /></div>}
    </div>
  )
}

function ArticleView({ slug, bare }: { slug: string; bare?: boolean }) {
  const [article, setArticle] = useState<Article | null>(null)
  useEffect(() => { let live = true; setArticle(null); helpApi.article(slug).then(r => { if (live) setArticle(r.article) }).catch(e => toast.error((e as Error).message)); return () => { live = false } }, [slug])
  if (!article) return <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />
  // Where else a number is written is the editor's business, not the reader's.
  const body = slug === PRICES ? article.body.replace(/\n###\s*Also stated in[\s\S]*$/i, '').replace(/^[^\n]*\n+(?=###)/, '') : article.body
  return (
    <div>
      {!bare && <h3 className="text-2xl font-semibold text-off-black mb-4">{slug === PRICES ? 'Prices and policies' : plain(article.title)}</h3>}
      {slug === PRICES ? <Facts text={body} /> : <HelpText text={body} className="!text-[15px] !space-y-2.5" />}
    </div>
  )
}

/** "- **Delivery:** 10 to 12 days" as a label and its value, under each heading: looked up, not read. */
function Facts({ text }: { text: string }) {
  const groups: { title: string; rows: { label: string; value: string }[] }[] = []
  for (const line of text.split('\n')) {
    const h = /^#{1,4}\s+(.*)$/.exec(line)
    if (h) { groups.push({ title: h[1], rows: [] }); continue }
    const b = /^\s*[-*]\s+(.*)$/.exec(line)
    if (!b) continue
    if (!groups.length) groups.push({ title: '', rows: [] })
    const m = /^\*\*([^*]{2,32}):\*\*\s*(.+)$/.exec(b[1]) || /^([A-Z][^:*]{2,28}):\s+(.+)$/.exec(b[1])
    groups[groups.length - 1].rows.push(m ? { label: m[1], value: m[2][0].toUpperCase() + m[2].slice(1) } : { label: '', value: b[1] })
  }
  return (
    <div className="space-y-7">
      {groups.filter(g => g.rows.length).map(g => (
        <section key={g.title}>
          {g.title && <h4 className="text-[13px] text-off-black/45 mb-1">{g.title}</h4>}
          <dl className="divide-y divide-border-gray">
            {g.rows.map(r => (
              <div key={r.label + r.value} className="py-2.5 md:flex md:gap-5">
                {r.label && <dt className="md:w-36 shrink-0 text-[15px] font-medium text-off-black">{r.label}</dt>}
                <dd className="flex-1 min-w-0"><HelpText text={r.value} className="!text-[15px]" /></dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
