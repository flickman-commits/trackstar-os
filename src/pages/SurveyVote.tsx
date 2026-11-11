import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Check, Maximize2 } from 'lucide-react'
import ProofFullscreen from '@/components/ProofFullscreen'
import { loadPublic, LoadError } from '@/lib/publicLoad'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * Design Survey, the voter's page. Opened from an Instagram story link, so it
 * is built for a phone in one hand and follows the approval portal: one card
 * per design that swipes sideways, a Full screen view with pinch and zoom, and
 * a vote button on every design. One tap on it is the vote; the "why" comes
 * after, and is optional. A vote can be changed; it is never counted twice.
 */

const T = { page: '#0F0F10', card: '#1A1A1C', line: 'rgba(255,255,255,0.12)', accent: '#4600D6', font: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif" }

type Option = { id: string; name: string; imageUrl: string; thumbnailUrl: string | null }
type Survey = { title: string; question: string; open: boolean; endsAt: string | null; options: Option[]; myVote: { optionId: string; comment: string | null } | null }

/** "23h 14m", "14m 05s", for the time left. */
function timeLeft(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}

/** One id per browser, so a second visit changes the vote rather than adding one. */
function voterId(): string {
  const make = () => (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '')
  try {
    const existing = localStorage.getItem('ts_voter')
    if (existing) return existing
    const id = make()
    localStorage.setItem('ts_voter', id)
    return id
  } catch {
    return make()
  }
}

export default function SurveyVote() {
  const { token } = useParams<{ token: string }>()
  const voter = useMemo(voterId, [])
  const [survey, setSurvey] = useState<Survey | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'voted' | 'unavailable'>('loading')
  const [index, setIndex] = useState(0)
  const [voted, setVoted] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [commentSaved, setCommentSaved] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState<number | null>(null)
  const rail = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  useEffect(() => {
    loadPublic<Survey>(`${API_BASE}/api/public/survey?token=${encodeURIComponent(token || '')}&voter=${encodeURIComponent(voter)}`)
      .then(s => {
        setSurvey(s)
        if (s.myVote) {
          setVoted(s.myVote.optionId); setComment(s.myVote.comment || ''); setCommentSaved(!!s.myVote.comment); setState('voted')
        } else setState('ready')
      })
      .catch((e: LoadError) => setState(e.gone ? 'gone' : 'unavailable'))
  }, [token, voter])

  // Keep the counter and dots in step with a swipe.
  const onScroll = () => {
    const el = rail.current
    if (!el) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) setIndex(i)
  }
  const goTo = (i: number) => {
    setIndex(i)
    rail.current?.scrollTo({ left: i * (rail.current?.clientWidth || 0), behavior: 'smooth' })
  }

  const send = (optionId: string, text: string) => fetch(`${API_BASE}/api/public/survey`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, voterId: voter, optionId, comment: text }),
  })

  /** The vote itself: one tap, no separate select-then-submit. */
  const vote = async (optionId: string) => {
    setBusy(optionId); setErr(null)
    try {
      const res = await send(optionId, '')
      if (res.status === 409) { setErr('Voting has closed for this one.'); return }
      if (!res.ok) throw new Error()
      setVoted(optionId); setComment(''); setCommentSaved(false); setFullscreen(null); setState('voted')
      window.scrollTo({ top: 0 })
    } catch {
      setErr('That did not go through. Please try again.')
    } finally { setBusy(null) }
  }

  const saveComment = async () => {
    if (!voted || !comment.trim()) return
    setBusy('comment'); setErr(null)
    try {
      const res = await send(voted, comment)
      if (!res.ok) throw new Error()
      setCommentSaved(true)
    } catch {
      setErr('That did not save. Please try again.')
    } finally { setBusy(null) }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-[100dvh] text-white" style={{ backgroundColor: T.page, fontFamily: T.font }}>
      <div className="max-w-md mx-auto px-4 pt-5 pb-8">
        <div className="flex items-center justify-center mb-4">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 w-auto" />
        </div>
        {children}
      </div>
    </div>
  )

  if (state === 'loading') return shell(<div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>)
  if (state === 'unavailable') return shell(
    <div className="rounded-2xl p-8 text-center mt-10" style={{ backgroundColor: T.card }}>
      <h1 className="text-lg font-bold mb-1">We couldn't load this just now</h1>
      <p className="text-sm text-white/60">Check your connection and try again.</p>
      <button onClick={() => window.location.reload()} className="mt-4 inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold bg-white text-black">Try again</button>
    </div>
  )
  if (state === 'gone' || !survey) return shell(
    <div className="rounded-2xl p-8 text-center mt-10" style={{ backgroundColor: T.card }}>
      <h1 className="text-lg font-bold mb-1">This link is not active</h1>
      <p className="text-sm text-white/60">Check the story for a fresh one.</p>
    </div>
  )

  // Past the end time the page shuts: no designs, no voting, just a thank you.
  const endsAtMs = survey.endsAt ? new Date(survey.endsAt).getTime() : null
  const ended = !survey.open || (endsAtMs !== null && endsAtMs <= now)
  if (ended) return shell(
    <div className="rounded-2xl p-8 text-center mt-10" style={{ backgroundColor: T.card }}>
      <h1 className="text-xl font-bold mb-1">This survey has ended</h1>
      <p className="text-sm text-white/60">Thanks for checking it out. Keep an eye on our page for the design that won.</p>
      <a href="https://trackstar.art" className="inline-block mt-5 text-xs text-white/40">trackstar.art</a>
    </div>
  )
  const countdown = endsAtMs !== null && (
    <div className="mt-3 flex justify-center">
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold" style={{ backgroundColor: 'rgba(70,0,214,0.25)', color: '#C4B5FD' }}>
        <span className="w-1.5 h-1.5 rounded-full bg-[#A78BFA] animate-pulse" /> Survey ends in {timeLeft(endsAtMs - now)}
      </span>
    </div>
  )

  const total = survey.options.length
  const votedOpt = survey.options.find(o => o.id === voted) || null
  const voteButton = (o: Option, size: 'md' | 'lg' = 'md') => (
    <button
      type="button"
      onClick={() => vote(o.id)}
      disabled={!!busy || !survey.open}
      className={`w-full rounded-xl font-bold transition-opacity disabled:opacity-40 ${size === 'lg' ? 'py-4 text-base' : 'py-3.5 text-[15px]'}`}
      style={{ backgroundColor: T.accent, color: '#fff' }}
    >
      {busy === o.id ? <Loader2 className="w-4 h-4 animate-spin inline" /> : `Vote for ${o.name}`}
    </button>
  )

  const viewer = fullscreen !== null && (
    <ProofFullscreen
      proofs={survey.options.map(o => ({ id: o.id, imageUrl: o.imageUrl }))}
      index={fullscreen}
      onIndexChange={i => { setFullscreen(i); if (state === 'ready') goTo(i) }}
      onClose={() => setFullscreen(null)}
      counterLabel={`${survey.options[fullscreen]?.name} of ${total}`}
      footer={survey.open && survey.options[fullscreen] ? voteButton(survey.options[fullscreen], 'lg') : undefined}
    />
  )

  if (state === 'voted' && votedOpt) return shell(
    <>
      <div className="text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: T.accent }}>
          <Check className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-bold">Thanks for voting!</h1>
        <p className="text-sm text-white/60 mt-1">You picked {votedOpt.name} for {survey.title}.</p>
      </div>
      {countdown}
      <button type="button" onClick={() => setFullscreen(survey.options.indexOf(votedOpt))} className="mt-5 block w-full rounded-2xl overflow-hidden" style={{ backgroundColor: T.card }}>
        <img src={votedOpt.imageUrl} alt={votedOpt.name} className="w-full max-h-[48dvh] object-contain" />
      </button>

      {/* The why, after the fact: the vote already counts without it. */}
      <div className="mt-4 rounded-2xl p-3" style={{ backgroundColor: T.card }}>
        {commentSaved ? (
          <div className="text-sm">
            <p className="text-white/80 italic">"{comment}"</p>
            <button type="button" onClick={() => setCommentSaved(false)} className="mt-2 text-xs text-white/50 underline underline-offset-4">Edit</button>
          </div>
        ) : (
          <>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value.slice(0, 500))}
              placeholder={`What do you like about ${votedOpt.name}? (optional)`}
              rows={2}
              className="w-full bg-transparent text-[15px] text-white placeholder:text-white/40 resize-none focus:outline-none"
            />
            <button
              type="button"
              onClick={saveComment}
              disabled={!comment.trim() || busy === 'comment'}
              className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-35"
              style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
            >
              {busy === 'comment' ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Send'}
            </button>
          </>
        )}
        {err && <p className="text-sm text-red-400 mt-2">{err}</p>}
      </div>

      {survey.open && (
        <button onClick={() => setState('ready')} className="mt-5 block mx-auto text-sm font-semibold text-white/70 underline underline-offset-4">
          Change my vote
        </button>
      )}
      <a href="https://trackstar.art" className="block mt-8 text-center text-xs text-white/40">trackstar.art</a>
      {viewer}
    </>
  )

  return shell(
    <>
      <h1 className="text-[22px] leading-tight font-bold text-center">{survey.question}</h1>
      <p className="text-sm text-white/55 text-center mt-1">{survey.title} · swipe to see all {total}</p>
      {countdown}
      {err && <p className="mt-3 text-center text-sm text-red-400">{err}</p>}

      {/* One card per design, swiped sideways like the approval portal. */}
      <div
        ref={rail}
        onScroll={onScroll}
        className="mt-4 -mx-4 flex overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {survey.options.map((o, i) => (
          <div key={o.id} className="snap-center shrink-0 w-full px-4">
            <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: T.card, border: `1px solid ${voted === o.id ? T.accent : T.line}` }}>
              <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${T.line}` }}>
                <span className="text-[13px] font-semibold">Option {i + 1} of {total}{o.name !== `Option ${i + 1}` ? ` · ${o.name}` : ''}</span>
                {voted === o.id && <span className="text-[11px] font-semibold" style={{ color: '#A78BFA' }}>Your vote</span>}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFullscreen(i)}
                  className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium bg-black/55 backdrop-blur"
                >
                  <Maximize2 className="w-3.5 h-3.5" /> Full screen
                </button>
                <img
                  src={o.imageUrl}
                  alt={o.name}
                  onClick={() => setFullscreen(i)}
                  className="w-full max-h-[56dvh] object-contain cursor-zoom-in"
                  draggable={false}
                />
              </div>
              {survey.open && <div className="p-3" style={{ borderTop: `1px solid ${T.line}` }}>{voteButton(o)}</div>}
            </div>
          </div>
        ))}
      </div>

      {total > 1 && (
        <div className="mt-4 flex items-center justify-center gap-1.5">
          {survey.options.map((o, i) => (
            <button key={o.id} type="button" onClick={() => goTo(i)} aria-label={o.name} className="rounded-full transition-all"
              style={{ width: i === index ? 24 : 8, height: 8, backgroundColor: i === index ? '#FFFFFF' : 'rgba(255,255,255,0.3)' }} />
          ))}
        </div>
      )}
      {viewer}
    </>
  )
}
