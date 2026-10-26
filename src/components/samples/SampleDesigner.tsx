/**
 * Tools > Samples, overseas: make the print instead of uploading one. Pick the
 * race, year and runner; the scrapers find the result and a render worker
 * makes the 12x18 PDF, which becomes the Gelato sample's file. Server:
 * api/samples.js (design-*), server/domain/samples/sampleDesign.js.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Search, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnPrimary, btnSecondary, textLink } from '@/lib/ui'

const field = 'w-full px-3 py-2 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-off-black/10'

type Match = { name?: string; bib?: string; time?: string; pace?: string; city?: string; state?: string; eventType?: string }
type State = {
  orderNumber: string
  raceName: string
  raceYear: number
  runnerName: string
  result: { status: string; bib: string | null; time: string | null; pace: string | null; eventType: string | null; notes: string | null; matches: Match[] } | null
  ready: boolean
  reasons: string[]
  render: { version: number; status: 'queued' | 'rendering' | 'done' | 'failed'; error: string | null; notes: string | null; previewUrl: string | null; file: string | null } | null
  fileUrl: string | null
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const r = await apiFetch('/api/samples', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || 'Request failed')
  return d as T
}

const STATUS: Record<string, string> = {
  not_found: 'No finisher by that name in the results',
  race_not_run: 'That race has not been run yet, or results are not posted',
  no_scraper: 'There is no results lookup for this race',
  upstream_error: 'The results site did not answer. Try again in a minute',
  ambiguous: 'More than one possible match',
}

export default function SampleDesigner({ onUse }: { onUse: (file: { name: string; url: string }, title: string) => void }) {
  const [races, setRaces] = useState<{ raceName: string; years: number[] | null }[] | null>(null)
  const [workersOnline, setWorkersOnline] = useState(0)
  const [raceName, setRaceName] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear() - 1))
  const [runnerName, setRunnerName] = useState('')
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState<'find' | 'accept' | 'render' | 'use' | null>(null)

  useEffect(() => {
    apiFetch('/api/samples?view=design-races').then(async r => {
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not load the races')
      setRaces(d.races); setWorkersOnline(d.workersOnline || 0)
    }).catch(e => { setRaces([]); toast.error((e as Error).message) })
  }, [])

  // A render is picked up by a worker within seconds and takes about a minute; follow it until it lands.
  const rendering = state?.render && (state.render.status === 'queued' || state.render.status === 'rendering')
  useEffect(() => {
    if (!rendering || !state) return
    const t = setInterval(() => { post<State>({ action: 'design-state', orderNumber: state.orderNumber }).then(setState).catch(() => {}) }, 4000)
    return () => clearInterval(t)
  }, [rendering, state?.orderNumber]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (kind: NonNullable<typeof busy>, body: Record<string, unknown>) => {
    setBusy(kind)
    try { setState(await post<State>(body)) } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const find = () => run('find', { action: 'design-find', orderNumber: state?.orderNumber, raceName, year, runnerName })
  const use = async () => {
    if (!state?.render) return
    setBusy('use')
    try {
      const f = await post<{ name: string; url: string }>({ action: 'design-use', orderNumber: state.orderNumber })
      setState({ ...state, fileUrl: f.url })
      onUse(f, `${state.raceName} ${state.raceYear}, ${state.runnerName}`)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  const years = races?.find(r => r.raceName === raceName)?.years
  const r = state?.result
  const found = r?.status === 'found'
  // What the render still needs, past the result itself (shown above it).
  const blockers = (state?.reasons || []).filter(x => !/^No (bib number|finish time)/.test(x))
  const canFind = raceName && runnerName.trim() && /^\d{4}$/.test(year) && busy === null

  return (
    <div className="space-y-3">
      {races && !races.length ? (
        <p className="text-sm text-off-black/60">No race can be designed right now: no render worker with templates has checked in. Upload a PDF instead.</p>
      ) : (
        <>
          <select value={raceName} onChange={e => setRaceName(e.target.value)} className={field} disabled={!races}>
            <option value="">{races ? 'Pick the race' : 'Loading races...'}</option>
            {races?.map(x => <option key={x.raceName} value={x.raceName}>{x.raceName}</option>)}
          </select>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <input value={runnerName} onChange={e => setRunnerName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && canFind) find() }} placeholder="Runner's name, as on the results" className={field} />
            {years?.length ? (
              <select value={year} onChange={e => setYear(e.target.value)} className={field}>
                {!years.includes(Number(year)) && <option value={year}>{year}</option>}
                {[...years].sort((a, b) => b - a).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            ) : (
              <input value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Year" inputMode="numeric" className={field} />
            )}
          </div>
          <button onClick={find} disabled={!canFind} className={`${btnSecondary} w-full justify-center`}>
            {busy === 'find' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{busy === 'find' ? 'Searching the results...' : state ? 'Search again' : 'Find their result'}
          </button>
        </>
      )}

      {state && r && (
        <div className="rounded-md border border-border-gray bg-white p-3 space-y-2 text-sm">
          {found ? (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-off-black">{state.runnerName}, {state.raceName} {state.raceYear}</div>
                <div className="text-off-black/60">Bib {r.bib || '-'} · {r.time || 'no time'}{r.pace ? ` · ${r.pace}/mi` : ''}{r.eventType ? ` · ${r.eventType}` : ''}</div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium text-off-black">{STATUS[r.status] || `Research: ${r.status}`}</div>
                {r.notes && <div className="text-off-black/55 text-xs mt-0.5">{r.notes}</div>}
              </div>
            </div>
          )}
          {!found && r.matches.length > 0 && (
            <div className="border-t border-border-gray pt-2 space-y-1">
              <div className="text-xs text-off-black/50">Close matches. Pick the right one:</div>
              {r.matches.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate">{m.name} <span className="text-off-black/50">· bib {m.bib || '-'}{m.time ? ` · ${m.time}` : ''}{m.city ? ` · ${m.city}${m.state ? `, ${m.state}` : ''}` : ''}</span></span>
                  <button onClick={() => run('accept', { action: 'design-accept', orderNumber: state.orderNumber, match: m })} disabled={busy !== null} className={`${btnSecondary} !py-1 !px-2 text-xs`}>Use</button>
                </div>
              ))}
            </div>
          )}
          {found && blockers.length > 0 && (
            <div className="border-t border-border-gray pt-2 text-xs text-off-black/65 space-y-0.5">
              <div className="font-medium text-off-black/80">Before it can render:</div>
              {blockers.map(b => <div key={b}>· {b}</div>)}
            </div>
          )}
          <a href={`/orders/${state.orderNumber}`} target="_blank" rel="noopener noreferrer" className={textLink}>Open {state.orderNumber} to fix the result, date or weather <ExternalLink className="w-3 h-3" /></a>
        </div>
      )}

      {state?.ready && !rendering && state.render?.status !== 'done' && (
        <div className="space-y-1">
          {state.render?.status === 'failed' && <p className="text-xs text-red-600">The last render failed: {state.render.error}</p>}
          <button onClick={() => run('render', { action: 'design-render', orderNumber: state.orderNumber })} disabled={busy !== null} className={`${btnPrimary} w-full justify-center`}>
            {busy === 'render' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}Render the print
          </button>
          {!workersOnline && <p className="text-xs text-off-black/50">No render Mac is awake right now. It renders as soon as one checks in.</p>}
        </div>
      )}

      {rendering && (
        <div className="flex items-center gap-2 rounded-md border border-border-gray bg-white p-3 text-sm text-off-black/70">
          <Loader2 className="w-4 h-4 animate-spin" />{state?.render?.status === 'queued' ? 'Waiting for a render Mac...' : 'Rendering the print...'}
        </div>
      )}

      {state?.render?.status === 'done' && (
        <div className="rounded-md border border-border-gray bg-white p-3 space-y-3">
          {state.render.previewUrl && <img src={state.render.previewUrl} alt="The rendered print" className="w-full max-w-[280px] mx-auto rounded border border-border-gray" />}
          {state.render.notes && <p className="text-xs text-amber-700">{state.render.notes}</p>}
          <div className="flex gap-2">
            <button onClick={() => run('render', { action: 'design-render', orderNumber: state.orderNumber })} disabled={busy !== null} className={btnSecondary}><RefreshCw className="w-4 h-4" />Render again</button>
            <button onClick={use} disabled={busy !== null} className={`${btnPrimary} flex-1 justify-center`}>
              {busy === 'use' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}{state.fileUrl ? 'Using this design' : 'Use this design'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
