import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { btnGhost, btnSecondary, inputBase } from '@/lib/ui'

/**
 * Settings > Activity Log: who did what, and when, searchable.
 *
 * One box searches the summary, the action, the person and the entry's
 * detail; an order number also finds that order's own entries (approved,
 * held, sent to production, completed). Kind, person and a day range narrow
 * it. The search lives in the address (?q=), so a link to "everything about
 * order 4883" is just /settings/activity?q=4883. Append only, as ever.
 */
type Entry = { id: string; action: string; summary: string; detail: unknown; createdAt: string; actor: string; actorEmail: string; userId: string | null }
type Facets = { kinds: { prefix: string; count: number }[]; people: { id: string; name: string; count: number }[] }
type Page = { events: Entry[]; nextBefore: string | null; orderIds: string[] }

/** What each kind of action is called on screen. Anything new shows its own prefix. */
const KIND_LABEL: Record<string, string> = {
  render: 'Designs (approve, reject, render)', artelo: 'Production (sent, held, Artelo)', order: 'Orders', price: 'Prices', variant: 'Products', product: 'Products',
  user: 'People', role: 'Roles', support: 'Support', sales: 'Sales', finance: 'Finance', payouts: 'Payouts', hours: 'Hours', race_payout: 'Race payouts',
  mcp: 'Through an API key', research: 'Research', bulk: 'Bulk orders', sample: 'Samples', samples: 'Samples', creator: 'Creators', connection: 'Connections',
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })

/** The summary with the searched words marked. */
function Marked({ text, q }: { text: string; q: string }) {
  const needle = q.trim()
  if (!needle) return <>{text}</>
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="bg-amber-100 text-off-black rounded-sm px-0.5">{text.slice(i, i + needle.length)}</mark>{text.slice(i + needle.length)}</>
}

export default function ActivityLog() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const kind = params.get('kind') || ''
  const person = params.get('person') || ''
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const [typed, setTyped] = useState(q)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [events, setEvents] = useState<Entry[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [matchedOrder, setMatchedOrder] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const seq = useRef(0)

  const set = (k: string, v: string) => setParams(p => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  // Typing searches after a short pause; the address holds the search.
  useEffect(() => { setTyped(q) }, [q])
  useEffect(() => {
    if (typed === q) return
    const t = window.setTimeout(() => set('q', typed.trim()), 300)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set is stable enough; only the text should re-run this
  }, [typed])

  const query = useCallback((before?: string) => {
    const u = new URLSearchParams({ limit: '100' })
    if (q) u.set('q', q)
    if (kind) u.set('prefix', kind)
    if (person) u.set('userId', person)
    if (from) u.set('from', from)
    if (to) u.set('to', to)
    if (before) u.set('before', before)
    return `/api/admin/audit?${u}`
  }, [q, kind, person, from, to])

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const res = await apiFetch(query())
      const data = await res.json().catch(() => ({}))
      if (mine !== seq.current) return
      if (!res.ok) { toast.error((data as { error?: string }).error || 'Could not load the log'); return }
      const page = data as Page
      setEvents(page.events || []); setNextBefore(page.nextBefore); setMatchedOrder((page.orderIds || []).length > 0); setOpen(new Set())
    } catch {
      if (mine === seq.current) toast.error('Could not reach the server')
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [query])
  useEffect(() => { load() }, [load])
  useEffect(() => { apiFetch('/api/admin/audit?facets=1').then(r => (r.ok ? r.json() : null)).then(d => d && setFacets(d)).catch(() => {}) }, [])

  const more = async () => {
    if (!nextBefore) return
    setLoading(true)
    try {
      const res = await apiFetch(query(nextBefore))
      const page = await res.json() as Page
      if (res.ok) { setEvents(e => [...e, ...(page.events || [])]); setNextBefore(page.nextBefore) }
    } finally { setLoading(false) }
  }

  const filtered = Boolean(q || kind || person || from || to)
  const clear = () => { setTyped(''); setParams(new URLSearchParams(), { replace: true }) }
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-off-black/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Search: an order number, a person, a word like approved or refund" className={`${inputBase} w-full pl-8`} autoFocus aria-label="Search the Activity Log" />
        </div>
        <select value={kind} onChange={e => set('kind', e.target.value)} className={`${inputBase} py-1.5`} aria-label="Kind of action">
          <option value="">Every kind</option>
          {(facets?.kinds || []).map(k => <option key={k.prefix} value={k.prefix}>{KIND_LABEL[k.prefix] || k.prefix} ({k.count})</option>)}
        </select>
        <select value={person} onChange={e => set('person', e.target.value)} className={`${inputBase} py-1.5`} aria-label="Person">
          <option value="">Everyone</option>
          {(facets?.people || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => set('from', e.target.value)} className={`${inputBase} py-1.5`} aria-label="From" />
        <span className="text-xs text-off-black/40">to</span>
        <input type="date" value={to} onChange={e => set('to', e.target.value)} className={`${inputBase} py-1.5`} aria-label="To" />
        {filtered && <button onClick={clear} className={btnGhost}><X className="w-3 h-3" /> Clear</button>}
        <button onClick={load} className={btnGhost} disabled={loading} title="Refresh"><RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <p className="text-[11px] text-off-black/50">
        {loading && !events.length ? 'Searching…' : `${events.length}${nextBefore ? '+' : ''} ${events.length === 1 ? 'entry' : 'entries'}${filtered ? ' match' : ''}, newest first.`}
        {matchedOrder && ' Includes every entry about that order, by its number or its internal id.'}
        {' '}Append only: nothing here can be edited or removed.
      </p>

      {loading && !events.length ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>
      ) : !events.length ? (
        <div className="rounded-lg border border-border-gray bg-subtle-gray/40 p-6 text-center">
          <p className="text-xs text-off-black/50">{filtered ? 'Nothing matches. Try fewer words, or clear the filters.' : 'Nothing logged yet.'}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border-gray divide-y divide-border-gray">
          {events.map(e => {
            const isOpen = open.has(e.id)
            const hasDetail = e.detail != null && typeof e.detail === 'object' && Object.keys(e.detail as object).length > 0
            return (
              <div key={e.id} className="px-3 py-2.5">
                <button onClick={() => hasDetail && toggle(e.id)} className={`w-full flex items-start justify-between gap-4 text-left ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}>
                  <div className="min-w-0 flex items-start gap-1.5">
                    {hasDetail ? (isOpen ? <ChevronDown className="w-3 h-3 mt-0.5 text-off-black/40 shrink-0" /> : <ChevronRight className="w-3 h-3 mt-0.5 text-off-black/40 shrink-0" />) : <span className="w-3 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs text-off-black"><Marked text={e.summary} q={q} /></p>
                      <p className="text-[11px] text-off-black/45 mt-0.5">{e.actor} · <span className="font-mono">{e.action}</span></p>
                    </div>
                  </div>
                  <span className="text-[11px] text-off-black/40 whitespace-nowrap tabular-nums">{fmt(e.createdAt)}</span>
                </button>
                {isOpen && hasDetail && (
                  <pre className="mt-2 ml-4 text-[11px] text-off-black/70 bg-subtle-gray border border-border-gray rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(e.detail, null, 2)}</pre>
                )}
              </div>
            )
          })}
        </div>
      )}
      {nextBefore && <div className="flex justify-center"><button onClick={more} disabled={loading} className={btnSecondary}>{loading ? 'Loading…' : 'Load more'}</button></div>}
    </div>
  )
}
