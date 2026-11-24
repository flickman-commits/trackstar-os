import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, ChevronDown, Loader2, Mail, ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { toast } from 'sonner'
import HelpText from '../HelpText'
import { helpApi, type Article, type AskAnswer } from '@/lib/helpApi'
import { modalCancel, modalPrimary } from '@/lib/ui'
import ReplyCard from './ReplyCard'

/**
 * Help > Ask. One big box: the rep explains the situation and gets one line,
 * up to three steps and a reply to send. With a conversation open it already
 * knows the customer, their order and whether it has printed
 * (server/domain/support/helpCenter.js ask). Why, the articles and past cases
 * stay folded. Closing Help and coming back keeps the answer, so a rep can
 * do a step and return.
 */
type Asked = { question: string; answer: AskAnswer }
const kept = new Map<string, Asked>()

export type AskContext = { threadId: string; label: string }

export default function AskTab({ context, onUseReply, onOpenThread }: { context: AskContext | null; onUseReply: (body: string) => void; onOpenThread: (id: string) => void }) {
  const [useContext, setUseContext] = useState(true)
  const about = useContext ? context : null
  const key = context?.threadId || 'none'
  const [asked, setAsked] = useState<Asked | null>(() => kept.get(key) || null)
  const [pending, setPending] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (window.innerWidth >= 768) box.current?.focus() }, [asked])

  const go = async (previousId: string | null) => {
    const text = q.trim()
    if (text.length < 4 || pending) return
    setPending(text)
    try {
      const answer = await helpApi.ask(text, { threadId: about?.threadId, previousId })
      const next = { question: text, answer }
      kept.set(key, next); setAsked(next); setQ('')
    } catch (e) { toast.error((e as Error).message) } finally { setPending(null) }
  }
  const over = () => { kept.delete(key); setAsked(null); setQ('') }
  const onKey = (previousId: string | null) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(previousId) }
  }

  if (pending) {
    return (
      <div className="h-full overflow-y-auto"><div className="max-w-[640px] mx-auto px-5 md:px-6 py-8 md:py-10">
        <p className="text-sm text-off-black/50">{pending}</p>
        <div className="mt-6 flex items-center gap-2.5 text-lg text-off-black/60"><Loader2 className="w-5 h-5 animate-spin" />{about ? 'Reading the conversation and the order' : 'Reading the playbook'}</div>
        <div className="mt-6 space-y-3 animate-pulse">{['w-4/5', 'w-3/5', 'w-2/3'].map(w => <div key={w} className={`h-4 rounded bg-off-black/[0.06] ${w}`} />)}</div>
      </div></div>
    )
  }
  if (asked) {
    return (
      <div className="h-full flex flex-col min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain"><div className="max-w-[640px] mx-auto px-5 md:px-6 py-6 md:py-8">
          <Answer key={asked.answer.id} asked={asked} onUse={context && about ? onUseReply : undefined} onOpenThread={onOpenThread} />
        </div></div>
        <div className="shrink-0 border-t border-border-gray py-3"><div className="max-w-[640px] mx-auto px-5 md:px-6 flex items-center gap-1 md:gap-2">
          <div className="flex-1 flex items-center rounded-full border border-border-gray pl-4 pr-1.5 py-1 focus-within:border-off-black/30">
            <textarea ref={box} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey(asked.answer.id)} rows={1} placeholder="Ask a follow-up" aria-label="Ask a follow-up"
              className="flex-1 min-w-0 resize-none bg-transparent text-[15px] leading-6 py-1 focus:outline-none placeholder:text-off-black/40" />
            <Send on={q.trim().length >= 4} onClick={() => go(asked.answer.id)} small />
          </div>
          <button onClick={over} className={modalCancel}>Start over</button>
        </div></div>
      </div>
    )
  }
  return (
    <div className="h-full overflow-y-auto"><div className="min-h-full flex flex-col justify-center max-w-[640px] mx-auto px-5 md:px-6 py-8">
      <h3 className="text-center text-[28px] md:text-[34px] font-bold tracking-tight text-off-black leading-tight">Explain your situation</h3>
      <div className="mt-6 rounded-[26px] border border-border-gray bg-white shadow-[0_10px_40px_rgba(0,0,0,0.07)] p-5 transition-colors focus-within:border-off-black/25">
        {about && (
          <span className="mb-3 inline-flex max-w-full items-center gap-1.5 rounded-full bg-off-black/[0.05] pl-3 pr-1.5 py-1 text-[13px] text-off-black/70">
            <Mail className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{about.label}</span>
            <button onClick={() => setUseContext(false)} aria-label="Not about this conversation" title="Not about this conversation" className="shrink-0 p-0.5 rounded-full hover:bg-off-black/10"><X className="w-3 h-3" /></button>
          </span>
        )}
        <textarea ref={box} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey(null)} rows={4} aria-label="Explain your situation"
          placeholder="Customer ordered an 8x10 but meant to get a 12x18. They want to cancel and reorder. Should I cancel it, or can I change the size?"
          className="block w-full resize-none bg-transparent text-[17px] leading-relaxed text-off-black focus:outline-none placeholder:text-off-black/35" />
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[13px] text-off-black/45">
            {!context ? 'Open a conversation first and Help reads the order too.' : !useContext ? <button onClick={() => setUseContext(true)} className="hover:text-off-black underline underline-offset-2">Ask about the open conversation</button> : ''}
          </span>
          <Send on={q.trim().length >= 4} onClick={() => go(null)} />
        </div>
      </div>
    </div></div>
  )
}

function Send({ on, onClick, small }: { on: boolean; onClick: () => void; small?: boolean }) {
  return <button onClick={onClick} disabled={!on} aria-label="Ask" className={`shrink-0 inline-flex items-center justify-center rounded-full bg-dark-fill text-white transition-opacity disabled:opacity-25 hover:bg-off-black/85 ${small ? 'w-8 h-8' : 'w-11 h-11'}`}><ArrowUp className={small ? 'w-4 h-4' : 'w-5 h-5'} /></button>
}

function Answer({ asked, onUse, onOpenThread }: { asked: Asked; onUse?: (body: string) => void; onOpenThread: (id: string) => void }) {
  const { question, answer } = asked
  const [why, setWhy] = useState(false)
  const [rated, setRated] = useState<'helpful' | 'wrong' | null>(null)
  const [fixing, setFixing] = useState(false)
  const [correction, setCorrection] = useState('')
  const [article, setArticle] = useState<Article | null>(null)
  const helpful = async () => { try { await helpApi.helpful(answer.id); setRated('helpful') } catch (e) { toast.error((e as Error).message) } }
  const sendFix = async () => {
    try { await helpApi.notRight(answer.id, correction); setRated('wrong'); setFixing(false); toast.success('Thanks. Matt will look at it.') }
    catch (e) { toast.error((e as Error).message) }
  }
  const openArticle = async (slug: string) => {
    if (article?.slug === slug) { setArticle(null); return }
    try { setArticle((await helpApi.article(slug)).article) } catch (e) { toast.error((e as Error).message) }
  }
  const more = Boolean(answer.why || answer.articles.length || answer.cases.length)
  return (
    <div>
      <p className="text-sm text-off-black/50">{question}</p>
      {!answer.covered && <p className="mt-3 inline-block rounded-full bg-amber-50 px-3 py-1 text-[13px] text-amber-800">Not in the playbook</p>}
      <h3 className="mt-2 text-2xl font-semibold leading-snug text-off-black">{answer.headline}</h3>
      {answer.steps.length > 0 && <Steps steps={answer.steps} className="mt-5" />}
      {answer.reply && <div className="mt-6"><ReplyCard text={answer.reply} onUse={onUse} /></div>}
      <div className="mt-6 pt-4 border-t border-border-gray flex items-center justify-between text-[13px] text-off-black/55">
        {more ? <button onClick={() => setWhy(v => !v)} aria-expanded={why} className="inline-flex items-center gap-1 hover:text-off-black">Why<ChevronDown className={`w-3.5 h-3.5 transition-transform ${why ? 'rotate-180' : ''}`} /></button> : <span />}
        {rated ? <span>{rated === 'helpful' ? 'Thanks' : 'Sent to Matt'}</span> : (
          <span className="inline-flex items-center gap-1">Right?
            <button onClick={helpful} aria-label="Yes, this is right" title="Yes" className="p-1.5 rounded-full hover:bg-off-black/5 hover:text-off-black"><ThumbsUp className="w-4 h-4" /></button>
            <button onClick={() => setFixing(v => !v)} aria-label="No, this is wrong" title="No" className="p-1.5 rounded-full hover:bg-off-black/5 hover:text-off-black"><ThumbsDown className="w-4 h-4" /></button>
          </span>
        )}
      </div>
      {fixing && (
        <div className="mt-3">
          <textarea value={correction} onChange={e => setCorrection(e.target.value)} rows={3} autoFocus placeholder="What's the right answer? Matt adds it so the next person gets it." aria-label="The right answer"
            className="w-full rounded-xl border border-border-gray px-4 py-3 text-[15px] focus:outline-none focus:border-off-black/30 placeholder:text-off-black/35" />
          <div className="mt-2 flex justify-end gap-1"><button onClick={() => setFixing(false)} className={modalCancel}>Cancel</button><button onClick={sendFix} disabled={correction.trim().length < 5} className={modalPrimary}>Send</button></div>
        </div>
      )}
      {why && (
        <div className="mt-3 space-y-4 text-sm text-off-black/75">
          {answer.why && <p className="leading-relaxed">{answer.why}</p>}
          {answer.articles.length > 0 && <div className="flex flex-wrap gap-1.5">{answer.articles.map(a => <button key={a.slug} onClick={() => openArticle(a.slug)} className={`px-3 py-1 rounded-full border text-[13px] ${article?.slug === a.slug ? 'border-off-black/40 text-off-black' : 'border-border-gray hover:border-off-black/30'}`}>{a.title}</button>)}</div>}
          {article && <div className="rounded-2xl border border-border-gray p-4"><HelpText text={article.body} /></div>}
          {answer.cases.length > 0 && (
            <div>
              <div className="text-[13px] text-off-black/45 mb-1">Past cases</div>
              {answer.cases.map(c => <button key={c.id} onClick={() => onOpenThread(c.id)} className="block w-full text-left py-1.5 leading-snug hover:text-off-black">{c.summary}</button>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Steps({ steps, className = '' }: { steps: string[]; className?: string }) {
  return (
    <ol className={`space-y-3 ${className}`}>
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 text-base leading-snug text-off-black">
          <span className="shrink-0 w-6 h-6 rounded-full bg-off-black/[0.06] text-[13px] font-medium inline-flex items-center justify-center tabular-nums">{i + 1}</span>
          <span className="pt-0.5"><Lead text={s} /></span>
        </li>
      ))}
    </ol>
  )
}

/** "Already printed: we can't change it." reads with the condition in bold. */
function Lead({ text }: { text: string }) {
  const m = /^([^:.]{3,40}):\s+(.+)$/.exec(text)
  return m ? <><span className="font-semibold">{m[1]}:</span> {m[2]}</> : <>{text}</>
}
