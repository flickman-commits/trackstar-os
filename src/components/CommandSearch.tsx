import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2, X, Inbox, Mail, Instagram, Settings2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Capability } from '@/lib/roles'

/**
 * ⌘K from anywhere: one box that finds an order by number, customer email,
 * customer or runner name, or bib, whether it is standard, custom or a
 * partner order, open or done, and opens it in the right view (the order
 * view routes by /orders/<ref> and switches to the order's type on its own).
 * For people whose role has Support it finds conversations too, opened at
 * /support?thread=<id>; the server decides that (api/search.js). Typing a
 * page name ("support", "sales") jumps there.
 */
type Hit = { ref: string; number: string; type: string; done: boolean; runner: string | null; customer: string | null; email: string | null; race: string | null; createdAt?: string }
type Thread = { id: string; channel: string; who: string | null; email: string | null; subject: string | null; status: string; lastMessageAt?: string }
type Kind = 'order' | 'thread' | 'page'
type Pill = { label: string; tone: 'neutral' | 'open' | 'done' }
type Row = { key: string; kind: Kind; title: string; detail: string; pills: Pill[]; go: () => void }

const TYPE_LABEL: Record<string, string> = { standard: 'Standard', custom: 'Custom', race_partner: 'Partner' }
const KIND_LABEL: Record<Kind, string> = { order: 'Orders', thread: 'Conversations', page: 'Pages' }
const KIND_ORDER: Kind[] = ['order', 'thread', 'page']

/** "Oct 12, 1:27 PM", with the year only when it is not this year (Shopify's own format). */
function when(iso?: string) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  return `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

/** A status pill, drawn like Shopify's: a soft fill and a leading dot. */
function StatusPill({ pill }: { pill: Pill }) {
  const tone = pill.tone === 'open'
    ? 'bg-amber-100 text-amber-900'
    : pill.tone === 'done' ? 'bg-off-black/[0.06] text-off-black/70' : 'bg-off-black/[0.06] text-off-black/70'
  const dot = pill.tone === 'open' ? 'border-amber-700' : 'border-off-black/60 bg-off-black/60'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap ${tone}`}>
      {pill.tone !== 'neutral' && <span className={`w-2 h-2 rounded-full border-[1.5px] ${dot}`} />}
      {pill.label}
    </span>
  )
}

function KindIcon({ kind, channel }: { kind: Kind; channel?: string }) {
  const cls = 'w-5 h-5 text-off-black/70 flex-shrink-0'
  if (kind === 'order') return <Inbox className={cls} strokeWidth={1.75} />
  if (kind === 'thread') return channel === 'instagram' ? <Instagram className={cls} strokeWidth={1.75} /> : <Mail className={cls} strokeWidth={1.75} />
  return <Settings2 className={cls} strokeWidth={1.75} />
}

/** A keycap, as in the palette's footer. */
const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md bg-off-black/[0.06] text-off-black/60 text-[11px] font-medium font-sans">{children}</kbd>
)

export default function CommandSearch({ can, onOpenSettings }: { can: (c: Capability) => boolean; onOpenSettings: () => void }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [only, setOnly] = useState<Kind | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!open) return
    setQ(''); setHits([]); setThreads([]); setActive(0); setOnly(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // Orders, read as you type (a short pause first so each key is not a request).
  useEffect(() => {
    const term = q.trim()
    if (!open || term.replace(/^#/, '').length < 2) { setHits([]); setThreads([]); setLoading(false); return }
    setLoading(true)
    let stale = false
    const t = setTimeout(() => {
      apiFetch(`/api/search?q=${encodeURIComponent(term)}`).then(r => r.ok ? r.json() : null)
        .then(d => { if (!stale) { setHits(d?.results || []); setThreads(d?.threads || []); setActive(0) } })
        .catch(() => {})
        .finally(() => { if (!stale) setLoading(false) })
    }, 180)
    return () => { stale = true; clearTimeout(t) }
  }, [q, open])

  const close = () => setOpen(false)
  const pages = useMemo(() => [
    { name: 'Standard orders', words: 'standard orders fulfillment queue', to: '/' },
    { name: 'Custom orders', words: 'custom orders designs', to: '/?view=custom' },
    { name: 'Partners', words: 'partners race partner', to: '/?view=partners' },
    { name: 'Bulk orders', words: 'bulk orders deals', to: '/?view=bulk' },
    ...(can('support') ? [{ name: 'Support', words: 'support inbox email instagram', to: '/support' }] : []),
    ...(can('sales') ? [{ name: 'Sales', words: 'sales outreach attio', to: '/sales' }] : []),
    ...(can('creators') ? [{ name: 'Creators', words: 'creators program samples', to: '/creators' }] : []),
    ...(can('settings.admin') ? [{ name: 'Samples', words: 'samples gelato', to: '/samples' }] : []),
    { name: 'Settings', words: 'settings connections team stats', to: '' },
  ], [can])

  const allRows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase()
    const pageRows: Row[] = term.length < 2 ? [] : pages
      .filter(p => p.name.toLowerCase().includes(term) || p.words.split(' ').some(w => w.startsWith(term)))
      .map(p => ({ key: `page:${p.name}`, kind: 'page', title: p.name, detail: 'Go to page', pills: [], go: () => (p.to ? navigate(p.to) : onOpenSettings()) }))
    const orderRows: Row[] = hits.map(h => ({
      key: `order:${h.ref}`,
      kind: 'order',
      title: `#${h.ref}`,
      detail: [h.runner, h.race, when(h.createdAt), h.customer && h.customer !== h.runner ? h.customer : null, h.email].filter(Boolean).join(' · '),
      pills: [{ label: TYPE_LABEL[h.type] || h.type, tone: 'neutral' }, h.done ? { label: 'Done', tone: 'done' } : { label: 'Open', tone: 'open' }],
      go: () => navigate(`/orders/${h.ref}`),
    }))
    const threadRows: Row[] = threads.map(t => ({
      key: `thread:${t.id}`,
      kind: 'thread',
      title: t.who || 'Unknown sender',
      detail: [t.subject, t.email && t.email !== t.who ? t.email : null, when(t.lastMessageAt)].filter(Boolean).join(' · '),
      pills: [
        { label: t.channel === 'instagram' ? 'Instagram' : 'Email', tone: 'neutral' },
        t.status === 'closed' ? { label: 'Closed', tone: 'done' } : t.status === 'filtered' ? { label: 'Filtered', tone: 'done' } : { label: 'Open', tone: 'open' },
      ],
      go: () => navigate(`/support?thread=${encodeURIComponent(t.id)}`),
    }))
    return [...orderRows, ...threadRows, ...pageRows]
  }, [q, hits, threads, pages, navigate, onOpenSettings])

  // The category chips across the top, with counts; picking one narrows the list.
  const counts = useMemo(() => KIND_ORDER.map(k => ({ kind: k, n: allRows.filter(r => r.kind === k).length })).filter(c => c.n > 0), [allRows])
  const rows = only ? allRows.filter(r => r.kind === only) : allRows
  useEffect(() => { if (only && !counts.some(c => c.kind === only)) setOnly(null) }, [counts, only])
  useEffect(() => { setActive(0) }, [only])
  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [active])

  if (!open) return null
  const choose = (r: Row | undefined) => { if (!r) return; close(); r.go() }
  const cycleChip = (dir: 1 | -1) => {
    const order: (Kind | null)[] = [null, ...counts.map(c => c.kind)]
    if (order.length < 2) return
    setOnly(order[(order.indexOf(only) + dir + order.length) % order.length])
  }
  const term = q.trim().replace(/^#/, '')

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-start justify-center px-4 pt-[10vh]" onMouseDown={close}>
      <div className="w-full max-w-[760px] bg-white rounded-3xl shadow-[0_32px_80px_rgba(0,0,0,0.22)] overflow-hidden flex flex-col max-h-[78vh]" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-6 py-5 border-b border-border-gray">
          <Search className="w-5 h-5 text-off-black/80 flex-shrink-0" strokeWidth={2} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); close() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(rows.length - 1, a + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
              else if (e.key === 'Tab' && counts.length > 0) { e.preventDefault(); cycleChip(e.shiftKey ? -1 : 1) }
              else if (e.key === 'Enter') { e.preventDefault(); choose(rows[active]) }
            }}
            placeholder={can('support') ? 'Order #, email, name, bib or conversation' : 'Order #, customer email, name or bib'}
            className="flex-1 min-w-0 text-lg text-off-black placeholder:text-off-black/35 focus:outline-none bg-transparent"
          />
          {loading && <Loader2 className="w-4 h-4 animate-spin text-off-black/35 flex-shrink-0" />}
          {q && (
            <button onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label="Clear search"
              className="p-1 -mr-1 rounded-md text-off-black/60 hover:text-off-black hover:bg-off-black/5 flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {counts.length > 0 && (
          <div className="flex flex-wrap gap-2 px-5 pt-4 pb-1">
            {counts.map(c => {
              const on = only === c.kind
              return (
                <button key={c.kind} onClick={() => setOnly(on ? null : c.kind)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[15px] transition-colors ${on ? 'bg-dark-fill text-white' : 'bg-off-black/[0.05] text-off-black hover:bg-off-black/[0.09]'}`}>
                  {KIND_LABEL[c.kind]} <span className={on ? 'text-white/70' : 'text-off-black/50'}>{c.n}</span>
                </button>
              )
            })}
          </div>
        )}

        {rows.length > 0 ? (
          <ul ref={listRef} className="flex-1 overflow-y-auto px-3 py-2">
            {rows.map((r, i) => (
              <li key={r.key}>
                <button
                  data-row={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(r)}
                  className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-colors ${i === active ? 'bg-off-black/[0.045]' : ''}`}
                >
                  <KindIcon kind={r.kind} channel={r.kind === 'thread' ? (r.pills[0]?.label === 'Instagram' ? 'instagram' : 'email') : undefined} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[15px] font-semibold text-off-black truncate">{r.title}</span>
                      {r.pills.map(pl => <StatusPill key={pl.label} pill={pl} />)}
                    </div>
                    {r.detail && <div className="mt-0.5 text-sm text-off-black/60 truncate">{r.detail}</div>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-6 py-8 text-sm text-off-black/50">
            {term.length < 2 ? (can('support') ? 'Search every order (standard, custom, partners, open or done) and support conversations.' : 'Search every order: standard, custom and partners, open or done.') : loading ? 'Searching…' : 'Nothing matches.'}
          </div>
        )}

        <div className="flex items-center gap-5 px-6 py-3.5 border-t border-border-gray text-sm text-off-black/45">
          <span className="inline-flex items-center gap-2">Move <Key>↑</Key><Key>↓</Key></span>
          {counts.length > 1 && <span className="inline-flex items-center gap-2">Filter <Key>Tab</Key></span>}
          <span className="inline-flex items-center gap-2">Close <Key>Esc</Key></span>
          <span className="ml-auto inline-flex items-center gap-2">Open <Key>↵</Key></span>
        </div>
      </div>
    </div>
  )
}
