import PageHeader from '@/components/PageHeader'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Copy, ExternalLink, ImagePlus, X, Trash2, ArrowLeft, MessageSquareText } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useArmed } from '@/lib/useArmed'
import { btnPrimary, btnSecondary, btnGhost, inputBase, segment, segmentGroup, pageShell, fieldLabel } from '@/lib/ui'

/**
 * Design Survey: put a few new design options in front of the community and
 * see which they like. Built on the proof portal's upload path; the public
 * side is /vote/{token}, made to be dropped on an Instagram story.
 */

type ListRow = { id: string; token: string; title: string; status: string; endsAt: string | null; createdAt: string; votes: number; optionCount: number; cover: string | null }
type Option = { id: string; label: string | null; name: string; imageUrl: string; thumbnailUrl: string | null; votes: number; share: number }
type Survey = {
  id: string; token: string; title: string; question: string | null; status: string; endsAt: string | null; open: boolean; total: number; crowdedVotes: number
  options: Option[]; comments: { id: string; optionId: string; comment: string; createdAt: string }[]
}

const voteUrl = (token: string) => `${window.location.origin}/vote/${token}`

async function post(body: Record<string, unknown>) {
  const res = await apiFetch('/api/surveys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function DesignSurveys() {
  const [list, setList] = useState<ListRow[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/surveys')
      setList((await res.json()).surveys || [])
    } catch { toast.error('Could not load surveys') }
  }, [])
  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!newTitle.trim()) return
    try {
      const { survey } = await post({ action: 'create', title: newTitle })
      setNewTitle(''); setCreating(false); setOpenId(survey.id); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create') }
  }

  return (
    <div className={pageShell}>
      <div className="px-3 md:px-5 w-full flex flex-col h-full overflow-y-auto">
        {/* Same headers as the other tools: the phone header, then stars and title on one row. */}
        <PageHeader title="Design Survey" subtitle="Let the community vote on new designs."
          control={!openId ? <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 text-xs font-medium bg-dark-fill text-white rounded-full px-3 py-1.5"><Plus className="w-3.5 h-3.5" /> New</button> : undefined} />
        <div className="pt-4 md:pt-5 pb-3 hidden md:flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
            <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Design Survey</h1>
            <span className="text-sm text-off-black/45 ml-2 truncate">Let the community vote on new designs. Share the link on a story.</span>
          </div>
          {!openId && <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-dark-fill text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity whitespace-nowrap"><Plus className="w-4 h-4" /> New survey</button>}
        </div>

        {creating && !openId && (
          <div className="bg-white border border-border-gray rounded-lg p-4 mb-4 flex flex-col md:flex-row gap-2">
            <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="What is it for? e.g. Chicago Marathon 2026" className={`${inputBase} flex-1`} />
            <div className="flex gap-2">
              <button onClick={create} disabled={!newTitle.trim()} className={btnPrimary}>Create</button>
              <button onClick={() => setCreating(false)} className={btnGhost}>Cancel</button>
            </div>
          </div>
        )}

        {openId ? (
          <SurveyEditor id={openId} onBack={() => { setOpenId(null); load() }} />
        ) : list === null ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>
        ) : list.length === 0 ? (
          <div className="bg-white border border-border-gray rounded-lg py-16 text-center text-sm text-off-black/50">
            No surveys yet. Make one, add the designs, and share the link.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pb-8">
            {list.map(s => (
              <button key={s.id} onClick={() => setOpenId(s.id)} className="text-left bg-white border border-border-gray rounded-lg overflow-hidden hover:shadow-md transition-shadow">
                <div className="aspect-[4/5] bg-subtle-gray">
                  {s.cover ? <img src={s.cover} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-off-black/25"><ImagePlus className="w-6 h-6" /></div>}
                </div>
                <div className="p-3">
                  <div className="font-semibold text-sm text-off-black truncate">{s.title}</div>
                  <div className="text-xs text-off-black/50 mt-0.5">
                    {s.optionCount} design{s.optionCount === 1 ? '' : 's'} · {s.votes} vote{s.votes === 1 ? '' : 's'}
                    {s.status === 'open'
                      ? <span className="ml-1.5 text-emerald-700 font-medium">· Live</span>
                      : <span className="ml-1.5 text-off-black/40">· {s.votes || s.endsAt ? 'Ended' : 'Draft'}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SurveyEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const [s, setS] = useState<Survey | null>(null)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const { arm, isArmed } = useArmed()
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  // Two states: Setup (title, designs, link) and Results (what people chose
  // and why). A survey with votes opens on its results.
  const [view, setView] = useState<'setup' | 'results' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/surveys?id=${encodeURIComponent(id)}`)
    if (!res.ok) { toast.error('Could not load the survey'); return }
    const { survey } = await res.json()
    setS(survey); setTitle(survey.title); setQuestion(survey.question || '')
    setView(v => v ?? (survey.total > 0 ? 'results' : 'setup'))
  }, [id])
  useEffect(() => { load() }, [load])
  // Votes arrive while the story is up; keep the tallies current.
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 20000); return () => clearInterval(t) }, [load])

  const upload = async (files: File[]) => {
    const images = files.filter(f => f.type.startsWith('image/'))
    if (!images.length) return
    setUploading({ done: 0, total: images.length })
    for (const [i, file] of images.entries()) {
      try {
        // Straight to storage, like proofs: no 4.5MB request limit on big files.
        const slot = await post({ action: 'upload-url', id, filename: file.name })
        const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file })
        if (!put.ok) throw new Error('Upload failed')
        await post({ action: 'add-option', id, path: slot.path })
      } catch (e) { toast.error(`${file.name}: ${e instanceof Error ? e.message : 'failed'}`) }
      setUploading({ done: i + 1, total: images.length })
    }
    setUploading(null)
    load()
  }

  // Paste a design straight from the clipboard, as with proofs.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || [])
      if (files.length && !(e.target as HTMLElement)?.closest('input, textarea')) { e.preventDefault(); upload(files) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const saveMeta = async () => {
    if (!s || (title === s.title && question === (s.question || ''))) return
    try { await post({ action: 'update', id, title, question }); load() } catch { toast.error('Could not save') }
  }
  const setStatus = async (status: 'open' | 'closed') => {
    try { await post({ action: 'update', id, status }); load() } catch { toast.error('Could not update') }
  }
  /** Start (or restart) voting for a set time from now, and copy the link. */
  const launch = async (hours: number) => {
    try {
      await post({ action: 'update', id, durationHours: hours })
      navigator.clipboard?.writeText(voteUrl(s!.token)).catch(() => {})
      toast.success(hours ? `Live for ${hours >= 48 ? `${hours / 24} days` : `${hours} hours`}. Link copied for your story.` : 'Live with no end time. Link copied.')
      load()
    } catch { toast.error('Could not start the survey') }
  }
  const rename = async (o: Option, label: string) => {
    if ((o.label || '') === label.trim()) return
    try { await post({ action: 'update-option', optionId: o.id, label }); load() } catch { toast.error('Could not rename') }
  }
  const remove = async (o: Option) => {
    if (!arm(`remove:${o.id}`)) return
    try { await post({ action: 'remove-option', optionId: o.id }); load() } catch { toast.error('Could not remove') }
  }
  const del = async () => {
    if (!s || !arm('delete')) return
    try { await post({ action: 'delete', id }); onBack() } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete') }
  }

  if (!s) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>

  const url = voteUrl(s.token)
  const top = Math.max(0, ...s.options.map(o => o.votes))

  return (
    <div className="pb-10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <button onClick={onBack} className={`${btnGhost} -ml-2`}><ArrowLeft className="w-4 h-4" /> All surveys</button>
        <div className={segmentGroup}>
          <button onClick={() => setView('results')} className={segment(view === 'results', 'md')}>Results</button>
          <button onClick={() => setView('setup')} className={segment(view === 'setup', 'md')}>Setup</button>
        </div>
      </div>

      {view === 'results' ? <SurveyResults s={s} url={url} /> : (<>

      <div className="bg-white border border-border-gray rounded-lg p-4 mb-4">
        <div className="space-y-3">
          <div>
            <label className={fieldLabel}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} onBlur={saveMeta} className={`${inputBase} w-full`} />
          </div>
          <div>
            <label className={fieldLabel}>Question voters see</label>
            <input value={question} onChange={e => setQuestion(e.target.value)} onBlur={saveMeta} placeholder="Which design is your favorite?" className={`${inputBase} w-full`} />
          </div>
        </div>
      </div>

      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold text-off-black uppercase tracking-tight">
          {s.total} vote{s.total === 1 ? '' : 's'}
          {s.crowdedVotes > 0 && <span className="ml-2 normal-case font-normal text-xs text-amber-700" title="More than 5 votes came from one network. Usually an office or a dorm, but worth a glance.">{s.crowdedVotes} from busy networks</span>}
        </h2>
        <div className="flex items-center gap-2">
          {uploading && <span className="text-xs text-off-black/50"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Uploading {uploading.done}/{uploading.total}</span>}
          <button onClick={() => fileRef.current?.click()} className={btnSecondary}><ImagePlus className="w-4 h-4" /> Add designs</button>
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { upload(Array.from(e.target.files || [])); e.target.value = '' }} />
        </div>
      </div>

      {s.options.length === 0 ? (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); upload(Array.from(e.dataTransfer.files)) }}
          className="border-2 border-dashed border-border-gray rounded-lg py-14 text-center text-sm text-off-black/50 bg-white"
        >
          Drop the design options here, paste them, or use Add designs.
        </div>
      ) : (
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); upload(Array.from(e.dataTransfer.files)) }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
        >
          {s.options.map(o => (
            <div key={o.id} className={`bg-white border rounded-lg overflow-hidden ${o.votes && o.votes === top ? 'border-[#4600D6] ring-1 ring-[#4600D6]/30' : 'border-border-gray'}`}>
              <div className="relative aspect-[4/5] bg-subtle-gray">
                <a href={o.imageUrl} target="_blank" rel="noopener noreferrer"><img src={o.thumbnailUrl || o.imageUrl} alt={o.name} className="w-full h-full object-cover" /></a>
                <button onClick={() => remove(o)} className={isArmed(`remove:${o.id}`)
                  ? 'absolute top-1.5 right-1.5 h-6 px-2 rounded-full bg-red-600 text-white text-xs font-medium'
                  : 'absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center hover:bg-red-600'} title="Remove">
                  {isArmed(`remove:${o.id}`) ? `Click again to remove${o.votes ? ` with ${o.votes} vote${o.votes === 1 ? '' : 's'}` : ''}` : <X className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="p-2.5">
                <input defaultValue={o.label || ''} placeholder={o.name} onBlur={e => rename(o, e.target.value)}
                  className="w-full text-sm font-semibold text-off-black bg-transparent focus:outline-none focus:bg-subtle-gray rounded px-1 -mx-1" />
                <div className="mt-2 h-1.5 rounded-full bg-subtle-gray overflow-hidden">
                  <div className="h-full rounded-full bg-[#4600D6]" style={{ width: `${o.share}%` }} />
                </div>
                <div className="mt-1 text-xs text-off-black/55">{o.votes} vote{o.votes === 1 ? '' : 's'} · {o.share}%</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <SendOut s={s} url={url} onLaunch={launch} onEnd={() => setStatus('closed')} />

      <div className="mt-8">
        <button onClick={del} className={`${btnGhost} text-red-600`}><Trash2 className="w-4 h-4" /> {isArmed('delete') ? 'Click again to delete it and all its votes' : 'Delete survey'}</button>
      </div>
      </>)}
    </div>
  )
}

/**
 * What the community chose and why. A single-series bar chart, most votes
 * first, with each design's thumbnail under its own bar so the picture is the
 * label. Then the reasons, grouped by design in the same order.
 */
function SurveyResults({ s, url }: { s: Survey; url: string }) {
  const ranked = [...s.options].sort((a, b) => b.votes - a.votes)
  const max = Math.max(1, ...ranked.map(o => o.votes))
  const leader = ranked[0]?.votes ? ranked[0] : null
  const tied = leader ? ranked.filter(o => o.votes === leader.votes).length > 1 : false
  const byOption = (id: string) => s.comments.filter(c => c.optionId === id)

  if (s.options.length === 0) {
    return <div className="bg-white border border-border-gray rounded-lg py-16 text-center text-sm text-off-black/50">No designs yet. Add them under Setup.</div>
  }

  return (
    <div>
      <div className="bg-white border border-border-gray rounded-lg p-4 md:p-5 mb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h2 className="text-lg font-semibold text-off-black">{s.title}</h2>
          <span className="text-xs text-off-black/45">{s.open ? (s.endsAt ? `Live until ${new Date(s.endsAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Live') : s.total ? 'Voting ended' : 'Not sent yet'} · <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">voter page</a></span>
        </div>
        <p className="text-sm text-off-black/60">
          {s.total === 0 ? 'No votes yet.' : <>
            <span className="font-semibold text-off-black">{s.total}</span> vote{s.total === 1 ? '' : 's'}
            {leader && !tied && <> · <span className="font-semibold text-off-black">{leader.name}</span> leads with {leader.share}%</>}
            {tied && <> · tied at the top</>}
            {s.crowdedVotes > 0 && <span className="ml-2 text-amber-700" title="More than 5 votes came from one network. Usually an office or a dorm, but worth a glance.">· {s.crowdedVotes} from busy networks</span>}
          </>}
        </p>

        {/* Bars grow up from one baseline; the design sits under its bar. */}
        <div className="mt-5 overflow-x-auto">
          <div className="flex items-end gap-3 min-w-max px-1">
            {ranked.map(o => (
              <div key={o.id} className="w-24 md:w-28 flex flex-col items-center" title={`${o.name}: ${o.votes} vote${o.votes === 1 ? '' : 's'} (${o.share}%)`}>
                <span className="text-sm font-semibold text-off-black tabular-nums">{o.votes}</span>
                <span className="text-[11px] text-off-black/45 tabular-nums mb-1">{o.share}%</span>
                <div className="w-full h-44 flex items-end">
                  <div
                    className="w-full rounded-t-[4px] bg-[#4600D6] transition-[height] duration-500"
                    style={{ height: o.votes ? `${(o.votes / max) * 100}%` : '2px', opacity: o.votes ? 1 : 0.25 }}
                  />
                </div>
                <div className="w-full h-px bg-off-black/15" />
                <a href={o.imageUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block w-full aspect-[4/5] rounded-md overflow-hidden bg-subtle-gray border border-border-gray">
                  <img src={o.thumbnailUrl || o.imageUrl} alt={o.name} className="w-full h-full object-cover" />
                </a>
                <span className="mt-1.5 text-xs font-medium text-off-black/70 text-center truncate w-full">{o.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-off-black uppercase tracking-tight mb-2 flex items-center gap-1.5">
        <MessageSquareText className="w-4 h-4" /> Why people picked them ({s.comments.length})
      </h3>
      {s.comments.length === 0 ? (
        <p className="text-sm text-off-black/45">When voters say why they picked a design, it shows up here.</p>
      ) : (
        <div className="space-y-3 pb-4">
          {ranked.filter(o => byOption(o.id).length > 0).map(o => (
            <div key={o.id} className="bg-white border border-border-gray rounded-lg p-3 md:p-4 flex gap-3 md:gap-4">
              <img src={o.thumbnailUrl || o.imageUrl} alt={o.name} className="w-14 md:w-20 aspect-[4/5] object-cover rounded-md border border-border-gray shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-off-black">{o.name} <span className="font-normal text-off-black/45">· {o.votes} vote{o.votes === 1 ? '' : 's'}</span></div>
                <ul className="mt-1.5 space-y-1.5">
                  {byOption(o.id).map(c => (
                    <li key={c.id} className="text-sm text-off-black/80 leading-snug">
                      &ldquo;{c.comment}&rdquo;
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const DURATIONS = [
  { h: 24, label: '24 hours' },
  { h: 48, label: '48 hours' },
  { h: 72, label: '3 days' },
  { h: 168, label: '1 week' },
]

/**
 * Step two of Setup: send it out. Pick how long it runs; the clock starts now
 * and the link is copied for the story. While it runs: the deadline, the link,
 * a way to extend or end it early. After it ends the public page shuts on its
 * own, and it can be reopened from here.
 */
function SendOut({ s, url, onLaunch, onEnd }: { s: Survey; url: string; onLaunch: (hours: number) => void; onEnd: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  const ends = s.endsAt ? new Date(s.endsAt).getTime() : null
  const live = s.open && (!ends || ends > now)
  const fmt = (t: number) => new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const left = ends ? Math.max(0, ends - now) : 0
  const leftText = left >= 86400000 ? `${Math.floor(left / 86400000)}d ${Math.floor((left % 86400000) / 3600000)}h` : `${Math.floor(left / 3600000)}h ${Math.floor((left % 3600000) / 60000)}m`
  const noDesigns = s.options.length === 0

  return (
    <div className="mt-6 bg-white border border-border-gray rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-off-black uppercase tracking-tight">Send it out</h2>
        {live
          ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> Live{ends ? ` · ends ${fmt(ends)} (in ${leftText})` : ' · no end time'}</span>
          : <span className="text-xs text-off-black/50">{ends && ends <= now ? `Ended ${fmt(ends)}` : s.total > 0 ? 'Ended' : 'Not sent yet'}</span>}
      </div>

      {live ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => { navigator.clipboard.writeText(url); toast.success('Link copied. Add it to a story with the link sticker.') }} className={btnPrimary}><Copy className="w-4 h-4" /> Copy link</button>
          <a href={url} target="_blank" rel="noopener noreferrer" className={btnSecondary}><ExternalLink className="w-4 h-4" /> Open</a>
          {ends
            ? <button onClick={() => onLaunch(Math.round((left + 24 * 3600000) / 3600000))} className={btnSecondary}>Add 24 hours</button>
            : DURATIONS.slice(0, 3).map(d => (
                <button key={d.h} onClick={() => onLaunch(d.h)} className={btnSecondary}>End in {d.label}</button>
              ))}
          <button onClick={onEnd} className={btnGhost}>End now</button>
          <span className="w-full text-[11px] text-off-black/40 break-all">{url}</span>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-off-black/55">
            {noDesigns ? 'Add the designs above first.' : 'Pick how long voting runs. The clock starts now, the link is copied, and the page closes itself when time is up.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {DURATIONS.map(d => (
              <button key={d.h} onClick={() => onLaunch(d.h)} disabled={noDesigns} className={d.h === 24 ? btnPrimary : btnSecondary}>
                {s.total > 0 ? 'Reopen for ' : 'Run for '}{d.label}
              </button>
            ))}
            <button onClick={() => onLaunch(0)} disabled={noDesigns} className={btnGhost}>No end time</button>
          </div>
        </>
      )}
    </div>
  )
}
