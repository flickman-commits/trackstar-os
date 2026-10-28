import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, Copy, Loader2, Package, Truck, AlertCircle, Database, Mail, X, Plus, Instagram, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { btnSecondary, chip } from '@/lib/ui'
import { supportApi } from '@/lib/supportApi'
import { useArmed } from '@/lib/useArmed'
import { ago, day } from '@/lib/supportDates'
import { STATUS_LABEL, STATUS_TONE } from '@/lib/supportStatus'
import type { CustomerOrder, OrderItem, InstagramStatus, MailboxStatus, Mockup, SenderFilter, ThreadDetail } from '@/types/support'
import Actions from './Actions'
import { FilterSender } from './SenderFilter'
import { TagChip } from '@/components/OrderTags'

/**
 * The details panel, Intercom's right column: collapsible sections for the
 * customer, this conversation's attributes (assignee, priority, tags), the
 * customer's orders with fulfillment and tracking from Shopify and our own
 * rows beside them, their other conversations, and, for an admin, the
 * mailbox itself.
 */
function Section({ title, count, badge, children, open: initial = true }: { title: string; count?: number; badge?: React.ReactNode; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <div className="border-b border-border-gray">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
        <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-off-black">{title}{count !== undefined && count > 0 && <span className="text-off-black/40 font-normal tabular-nums">{count}</span>}{badge}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-off-black/40 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="px-4 pb-3 space-y-2">{children}</div>}
    </div>
  )
}

function Attr({ label, children }: { label: string; children: React.ReactNode }) {
  // min-w-0 + break-words below keep a long email or code from widening the panel.
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-[86px] shrink-0 text-off-black/45 pt-0.5">{label}</span>
      <span className="min-w-0 flex-1 text-off-black break-words">{children}</span>
    </div>
  )
}

/** Where one print is: in production, being designed, or waiting. */
function itemStage(it: OrderItem): { label: string; cls: string } {
  if (it.status === 'completed' || it.designStatus === 'sent_to_production') return { label: 'In production', cls: 'bg-blue-50 border-blue-200 text-blue-700' }
  if (it.designStatus && it.designStatus !== 'not_started') return { label: it.designStatus === 'approved_by_customer' ? 'Approved, not yet printed' : 'Being designed', cls: 'bg-purple-50 border-purple-200 text-purple-700' }
  return { label: 'Not sent to production yet', cls: 'bg-white border-border-gray text-off-black/60' }
}

/**
 * Where the order is, in one chip: shipped, in production, being designed,
 * or waiting. With several prints, the one furthest behind sets it.
 */
function stage(o: CustomerOrder): { label: string; cls: string } | null {
  if (o.replacement) {
    const st = o.replacement.stage
    return { label: st, cls: st === 'Canceled' ? 'bg-red-50 border-red-200 text-red-700' : st === 'Delivered' || st === 'Shipped' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800' }
  }
  if (o.financialStatus === 'REFUNDED') return { label: 'Refunded', cls: 'bg-red-50 border-red-200 text-red-700' }
  if (o.fulfillmentStatus === 'FULFILLED' || o.tracking.length) return { label: 'Shipped', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' }
  if (!o.items.length) return o.imported ? null : { label: 'Not imported yet', cls: 'bg-white border-border-gray text-off-black/55' }
  const order = ['Not sent to production yet', 'Being designed', 'Approved, not yet printed', 'In production']
  return o.items.map(itemStage).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))[0]
}

/**
 * One order: the number, where it is and when it was placed, tracking and a
 * code when there is one, then every print in it (picture, race, runner, what
 * was bought, and its own stage when the prints are not all at the same
 * point), then one "Open in" row: TrackstarOS, Shopify, Artelo.
 */
function OpenIn({ href, icon, label, title }: { href: string; icon: ReactNode; label: string; title?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={title || `Open in ${label}`}
      className="flex items-center justify-center gap-1.5 min-w-0 px-2 py-1.5 rounded-md border border-border-gray bg-white text-xs font-medium text-off-black hover:border-off-black/30 transition-colors">
      {icon}<span className="truncate">{label}</span>
    </a>
  )
}

/** One print in an order: picture, race, runner and what it is, and where it is when that differs. */
function PrintRow({ o, it, showStage }: { o: CustomerOrder; it: OrderItem; showStage: boolean }) {
  const race = `${it.race}${it.year ? ` ${it.year}` : ''}`
  const bought = [it.size, it.frame && !/^unframed$/i.test(it.frame) ? it.frame.replace(/([a-z])([A-Z])/g, '$1 $2') : null, it.hasPhoto ? 'photo' : null].filter(Boolean).join(' · ')
  const st = showStage ? itemStage(it) : null
  // Our own order view for this print (/orders/4446, -2 for a later item), in a new tab so Support keeps its place.
  const href = o.imported ? `/orders/${o.number}${it.item > 1 ? `-${it.item}` : ''}` : null
  return (
    <div className="flex items-start gap-2.5">
      {it.heroImageUrl ? (
        <a href={it.heroImageUrl} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 block w-11 h-11 rounded border border-border-gray overflow-hidden bg-white hover:opacity-90" title="View full size">
          <img src={it.heroImageUrl} alt={it.productLabel || race} className="w-full h-full object-cover" />
        </a>
      ) : (
        <div className="flex-shrink-0 w-11 h-11 rounded border border-border-gray bg-white flex items-center justify-center text-off-black/25"><Package className="w-4 h-4" /></div>
      )}
      <div className="flex-1 min-w-0 text-xs leading-snug">
        <div className="text-off-black truncate" title={race}>
          {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline" title="This print in TrackstarOS">{race}</a> : race}
        </div>
        {(it.runner || bought) && <div className="text-off-black/60 truncate" title={[it.runner, bought].filter(Boolean).join(' · ')}>{[it.runner, bought].filter(Boolean).join(' · ')}</div>}
        {st && <span className={`mt-0.5 inline-flex items-center px-1.5 py-px border rounded text-[11px] font-medium ${st.cls}`}>{st.label}</span>}
      </div>
    </div>
  )
}

function OrderCard({ o, onUnlink }: { o: CustomerOrder; onUnlink?: () => void }) {
  // Unlink takes a second click, in the page (Arc blocks window.confirm).
  const { arm, isArmed } = useArmed()
  const age = Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 86400000)
  const late = o.fulfillmentStatus !== 'FULFILLED' && !o.tracking.length
  const ageCls = !late ? 'text-off-black/50' : age > 5 ? 'text-red-600 font-medium' : age >= 3 ? 'text-orange-600 font-medium' : 'text-off-black/50'
  const st = stage(o)
  const tracking = o.tracking.find(t => t.url) || o.tracking[0] || null
  const placed = new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  // A print gets its own chip only when the prints are not all in the same place.
  const stages = new Set(o.items.map(it => itemStage(it)?.label))
  const mixed = !o.replacement && !o.tracking.length && o.financialStatus !== 'REFUNDED' && stages.size > 1
  const first = o.items[0]
  const fulfillmentUrl = o.imported && first ? `/orders/${o.number}${first.item > 1 ? `-${first.item}` : ''}` : null
  return (
    <div className="space-y-1.5">
      <div className="bg-subtle-gray border border-border-gray rounded-md p-2.5 space-y-2">
        <div className="text-xs leading-snug">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-semibold text-off-black shrink-0">#{o.number}</span>
            {o.replacement && (
              <span className="shrink-0 inline-flex items-center px-1.5 py-px rounded border border-[#4600D6]/25 bg-[#4600D6]/[0.05] text-[10px] font-medium text-[#4600D6]"
                title={o.replacement.by === 'artelo' ? `Replacement for #${o.replacement.of}, made by Artelo${o.replacement.free ? ' at no charge' : ''}. It never goes through Shopify.` : `Replacement for #${o.replacement.of}, sent from Support${o.replacement.free ? '' : ' (we pay Artelo for it)'}. It never goes through Shopify.`}>
                Replacement{o.replacement.by === 'artelo' && o.replacement.free ? ' · free' : ''}
              </span>
            )}
            {o.items.length > 1 && <span className="text-off-black/50 shrink-0">{o.items.length} prints</span>}
            {!o.items.length && <span className="text-off-black truncate">{o.lineItems[0]?.title || 'Order'}</span>}
            {o.linked && (
              <span className="ml-auto shrink-0 inline-flex items-center gap-0.5 px-1.5 py-px rounded border border-blue-200 bg-blue-50 text-[10px] font-medium text-blue-700" title="Linked by hand: they ordered under a different email">
                Linked
                {onUnlink && <button onClick={() => { if (arm('unlink')) onUnlink() }} title="Unlink this order" aria-label={`Unlink order #${o.number}`} className={isArmed('unlink') ? '-mr-0.5 text-[10px] font-semibold text-red-600' : '-mr-0.5 text-blue-700/60 hover:text-blue-900'}>{isArmed('unlink') ? 'Click again to unlink' : <X className="w-3 h-3" />}</button>}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            {st && !mixed && <span className={`inline-flex items-center px-1.5 py-px border rounded text-[11px] font-medium ${st.cls}`}>{st.label}</span>}
            <span className={`text-[11px] ${ageCls}`} title={new Date(o.createdAt).toLocaleString()}>{o.replacement ? 'Made' : 'Ordered'} {placed}{age > 0 ? `, ${age}d ago` : ', today'}</span>
          </div>
          {tracking && (
            <div className="mt-1 flex items-center gap-1 min-w-0 text-[11px] text-off-black/60" title={`${tracking.company || 'Tracking'} ${tracking.number || ''}`}>
              <Truck className="w-3 h-3 shrink-0" />
              {tracking.url ? <a href={tracking.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700 truncate">{tracking.company || 'Tracking'} {tracking.number}</a> : <span className="truncate">{tracking.company || 'Tracking'} {tracking.number}</span>}
            </div>
          )}
          {o.replacement?.instructions && <div className="mt-0.5 text-[11px] text-off-black/55 line-clamp-2" title={o.replacement.instructions}>Note to Artelo: {o.replacement.instructions}</div>}
          {o.discountCodes.length > 0 && <div className="mt-0.5 text-[11px] text-yellow-900/70 truncate" title={o.discountCodes.join(', ')}>Code: {o.discountCodes.join(', ')}</div>}
        </div>
        {o.items.length > 0 ? (
          <div className="space-y-2">
            {o.items.map(it => <PrintRow key={it.orderId} o={o} it={it} showStage={mixed} />)}
          </div>
        ) : o.lineItems.length > 0 ? (
          <ul className="text-xs text-off-black/60 space-y-0.5">
            {o.lineItems.map((l, i) => <li key={i} className="truncate">{l.quantity > 1 ? `${l.quantity} × ` : ''}{l.title}{l.variant ? ` · ${l.variant}` : ''}</li>)}
          </ul>
        ) : null}
      </div>
      {(fulfillmentUrl || o.adminUrl || o.arteloUrl) && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mb-1">Open in</div>
          <div className="grid grid-cols-3 gap-1.5">
            {fulfillmentUrl && <OpenIn href={fulfillmentUrl} icon={<img src="/trackstar-stars-transparent.png" alt="" className="w-4 h-4 object-contain" />} label="TrackstarOS" title="This order in TrackstarOS" />}
            {o.adminUrl && <OpenIn href={o.adminUrl} icon={<img src="/shopify-icon.png" alt="" className="w-4 h-4" />} label="Shopify" />}
            {o.arteloUrl && <OpenIn href={o.arteloUrl} icon={<img src="/artelo-icon.png" alt="" className="w-4 h-4 rounded-[3px]" />} label="Artelo" />}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Link an order to this customer by its number. For the customer who writes in
 * from a different email than the one they ordered under: once someone finds
 * the order, it is linked to the customer (not just this conversation), so it
 * shows here from now on and in their future conversations too.
 */
function AddOrder({ threadId, onChanged }: { threadId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    const v = value.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      await supportApi.linkOrder(threadId, v)
      toast.success(`Linked order #${v.replace(/^#/, '')}`)
      setValue(''); setOpen(false)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not link that order')
    } finally {
      setBusy(false)
    }
  }
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
        <Plus className="w-3.5 h-3.5" /> Add order
      </button>
    )
  }
  return (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="mt-2 flex items-center gap-1.5">
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setValue('') } }}
        placeholder="Order #, e.g. 4517"
        aria-label="Order number to link"
        inputMode="numeric"
        className="flex-1 min-w-0 px-2 py-1 border border-border-gray rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-off-black/20"
      />
      <button type="submit" disabled={!value.trim() || busy} className={btnSecondary}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Link'}
      </button>
      <button type="button" onClick={() => { setOpen(false); setValue('') }} aria-label="Cancel" className="text-off-black/40 hover:text-off-black"><X className="w-3.5 h-3.5" /></button>
    </form>
  )
}

/** An order number the customer wrote: what it is, and one click to link it. */
function SuggestedOrder({ s, threadId, onChanged }: { s: NonNullable<ThreadDetail['suggestedOrders']>[number]; threadId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const link = async () => {
    setBusy(true)
    try { await supportApi.linkOrder(threadId, s.number); toast.success(`Linked #${s.number}`); onChanged() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-[#4600D6]/30 bg-[#4600D6]/[0.03] px-2.5 py-2">
      <div className="flex-1 min-w-0 text-xs">
        <div className="font-semibold text-off-black">#{s.number} <span className="font-normal text-off-black/45">ordered {new Date(s.orderedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div>
        {s.items.map((it, i) => (
          <div key={i} className="text-off-black/65 truncate">{it.race}{it.year ? ` ${it.year}` : ''}{it.runner ? ` · ${it.runner}` : ''}</div>
        ))}
      </div>
      <button onClick={link} disabled={busy} className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[#4600D6] hover:underline underline-offset-2 disabled:opacity-50">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Link
      </button>
    </div>
  )
}

async function unlinkOrder(threadId: string, number: string, onChanged: () => void) {
  try {
    await supportApi.unlinkOrder(threadId, number)
    toast.success(`Unlinked order #${number}`)
    onChanged()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not unlink')
  }
}

/** Tags on the conversation: chips, a + to add, with the playbook's scenarios suggested. */
function Tags({ tags, suggestions, onChange }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const options = suggestions.filter(s => !tags.includes(s) && s.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
  const add = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) onChange([...tags, v]); setQ(''); setAdding(false) }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded bg-off-black/[0.06] text-[11px] text-off-black/75">
          {t}<button onClick={() => onChange(tags.filter(x => x !== t))} className="text-off-black/40 hover:text-off-black"><X className="w-3 h-3" /></button>
        </span>
      ))}
      {adding ? (
        <div className="relative">
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Tag"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(options[0] && !q.trim() ? options[0] : q) } if (e.key === 'Escape') { setAdding(false); setQ('') } }}
            onBlur={() => setTimeout(() => { setAdding(false); setQ('') }, 150)}
            className="w-32 px-2 py-0.5 text-[11px] border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
          {options.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-48 p-1 rounded-md bg-white border border-border-gray shadow-[0_6px_24px_rgba(0,0,0,0.12)] z-20">
              {options.map(o => <button key={o} onMouseDown={e => { e.preventDefault(); add(o) }} className="w-full text-left px-2 py-1 text-[12px] rounded hover:bg-subtle-gray">{o}</button>)}
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-dashed border-off-black/25 text-[11px] text-off-black/50 hover:text-off-black hover:border-off-black/50"><Plus className="w-3 h-3" />Add</button>
      )}
    </div>
  )
}

/** Where new conversations go, for an admin: one person, on every channel, with a hand-over of what is open now. */
/** The mailbox, for an admin: connect it, import its history, see when it last synced. */
export function MailboxCard({ status, isAdmin, onChanged }: { status: MailboxStatus | null; isAdmin: boolean; onChanged: () => void }) {
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [waiting, setWaiting] = useState(false)
  if (!status) return null
  const runBackfill = async () => {
    setImporting(true)
    let quotaHits = 0
    try {
      for (let i = 0; i < 400; i++) {
        try {
          const out = await supportApi.backfill()
          setProgress(out.total)
          setWaiting(false)
          quotaHits = 0
          if (out.done) { toast.success(`History imported: ${out.total} messages`); break }
        } catch (e) {
          // Gmail's per-minute quota: wait it out and carry on, a few times, before giving up.
          if (/rate limiting|quota/i.test((e as Error).message) && quotaHits++ < 6) {
            setWaiting(true)
            await new Promise(r => setTimeout(r, 65_000))
            continue
          }
          throw e
        }
      }
      onChanged()
    } catch (e) { toast.error((e as Error).message) }
    finally { setImporting(false); setWaiting(false) }
  }
  return (
    <Section title="Mailbox" open={!status.connected || !status.backfill.done}>
      <div className="text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <Mail className="w-3.5 h-3.5 text-off-black/50" />
          {status.connected ? <span className="text-off-black">{status.email}</span> : <span className="text-amber-700">Not connected{status.configured ? '' : ' (OAuth client not set)'}</span>}
        </div>
        {status.connected && <div className="text-off-black/50">Last import {status.lastImportedAt ? ago(status.lastImportedAt) + ' ago' : 'never'} · syncs every 5 minutes</div>}
        {status.connected && !status.backfill.done && isAdmin && (
          <div className="pt-1">
            <button onClick={runBackfill} disabled={importing} className={btnSecondary}>
              {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              {importing ? (waiting ? `Waiting for Gmail's quota… ${progress ?? status.backfill.count} so far` : `Importing… ${progress ?? status.backfill.count}`) : status.backfill.inProgress ? `Continue history import (${status.backfill.count} so far)` : 'Import mailbox history'}
            </button>
            <p className="mt-1 text-off-black/45">Reads every past thread once so the inbox has its history. Safe to run again.</p>
          </div>
        )}
        {status.connected && status.backfill.done && <div className="text-off-black/50">History imported ({status.backfill.count} messages)</div>}
        {!status.connected && isAdmin && status.configured && (
          <div className="pt-1">
            <a href={supportApi.connectUrl} className={btnSecondary}>Connect {status.expectedEmail}</a>
            <p className="mt-1 text-off-black/45">Sign in to Google as the support account. Any other account is refused.</p>
          </div>
        )}
        {!status.connected && !isAdmin && <div className="text-off-black/50">Ask an admin to connect it.</div>}
      </div>
    </Section>
  )
}

/**
 * Instagram, for an admin: connect @trackstar_art (sign in, or paste the
 * long-lived token from the Meta dashboard), pull the recent conversations
 * once, see whether the webhook is set and when a DM last arrived.
 */
export function InstagramCard({ status, isAdmin, onChanged }: { status: InstagramStatus | null; isAdmin: boolean; onChanged: () => void }) {
  const [pasting, setPasting] = useState(false)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const { arm, isArmed } = useArmed()
  if (!status) return null
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    try { const msg = await fn(); if (msg) toast.success(msg); onChanged() }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  const saveToken = () => run(async () => { const out = await supportApi.instagramToken(token.trim()); setToken(''); setPasting(false); return `Connected as @${out.username}` })
  const backfill = () => run(async () => { const out = await supportApi.instagramBackfill(); return `Imported ${out.imported} DM${out.imported === 1 ? '' : 's'} from ${out.conversations} conversation${out.conversations === 1 ? '' : 's'}` })
  const disconnect = () => { if (arm('disconnect')) run(async () => { await supportApi.instagramDisconnect(); return 'Instagram disconnected' }) }
  return (
    <Section title="Instagram" open={!status.connected}>
      <div className="text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <Instagram className="w-3.5 h-3.5 text-pink-600" />
          {status.connected ? <span className="text-off-black">@{status.username}</span> : <span className="text-amber-700">Not connected{status.configured ? '' : ' (Meta app not set)'}</span>}
        </div>
        {status.connected && (
          <div className="text-off-black/50">
            Last DM {status.lastImportedAt ? ago(status.lastImportedAt) + ' ago' : 'none yet'} · arrives by webhook{status.webhookConfigured ? '' : ' (verify token not set)'}
            {status.humanAgent ? ' · 7-day replies' : ' · 24-hour replies'}
          </div>
        )}
        {status.connected && status.tokenExpiresAt && <div className="text-off-black/50">Token renews itself; good until {day(status.tokenExpiresAt)}</div>}
        {isAdmin && status.configured && (
          <div className="pt-1 flex flex-wrap items-center gap-1.5">
            {!status.connected && <a href={supportApi.instagramConnectUrl} className={btnSecondary}><Instagram className="w-3.5 h-3.5" />Connect @{status.expectedHandle}</a>}
            {!status.connected && <button onClick={() => setPasting(v => !v)} className={btnSecondary}><KeyRound className="w-3.5 h-3.5" />Paste a token</button>}
            {status.connected && <button onClick={backfill} disabled={busy} className={btnSecondary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}Import recent DMs</button>}
            {status.connected && <button onClick={disconnect} disabled={busy} className={btnSecondary} title="DMs stop arriving until an admin connects again">{isArmed('disconnect') ? 'Click again: DMs stop arriving' : 'Disconnect'}</button>}
          </div>
        )}
        {isAdmin && status.configured && !status.connected && pasting && (
          <div className="pt-1 space-y-1">
            <input value={token} onChange={e => setToken(e.target.value)} placeholder="Long-lived access token from Meta's dashboard" className="w-full px-2 py-1 text-[11px] border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
            <div className="flex items-center gap-1.5">
              <button onClick={saveToken} disabled={busy || !token.trim()} className={btnSecondary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}Save token</button>
              <span className="text-off-black/45">Instagram &gt; API setup with Instagram login &gt; Generate token, signed in as @{status.expectedHandle}.</span>
            </div>
          </div>
        )}
        {!status.connected && isAdmin && status.configured && !pasting && <p className="text-off-black/45">Sign in to Instagram as the Trackstar account. Any other account is refused.</p>}
        {!status.connected && isAdmin && !status.configured && <p className="text-off-black/45">Set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET from the Meta app first (see .env.example).</p>}
        {!status.connected && !isAdmin && <div className="text-off-black/50">Ask an admin to connect it.</div>}
      </div>
    </Section>
  )
}

/** Copies to the clipboard and says so with a check for a moment. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }
    catch { toast.error('Could not copy') }
  }
  return (
    <button onClick={copy} title={done ? 'Copied' : 'Copy'} className="shrink-0 mt-0.5 text-off-black/35 hover:text-off-black">
      {done ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

export default function Details({ thread, tagSuggestions, onOpenThread, onMerge, merging = [], onPriority, onTags, onInsert, onAttach, onChanged, width, filters, onFiltersChanged }: {
  thread: ThreadDetail | null
  tagSuggestions: string[]
  onOpenThread: (id: string) => void
  /** Fold these other conversations of the customer into this one. */
  onMerge: (ids: string[]) => void
  merging?: string[]
  onPriority: (p: boolean) => void
  onTags: (tags: string[]) => void
  /** Drops a line into the reply box. */
  onInsert: (text: string) => void
  /** Puts a mockup on the reply. */
  onAttach: (m: Mockup) => void
  /** Something changed on the thread; read it again. */
  onChanged: () => void
  /** A width the person dragged to, on wide screens. */
  width?: number
  filters: SenderFilter[]
  onFiltersChanged: () => void
}) {
  // Merging takes a second click, in the page (Arc blocks window.confirm).
  const { arm, isArmed } = useArmed()
  return (
    <aside style={width ? { width } : undefined} className="hidden lg:block w-full lg:w-[272px] xl:w-[300px] shrink-0 lg:overflow-y-auto overflow-x-hidden border-t lg:border-t-0 lg:border-l border-border-gray min-h-0 bg-white">
      {!thread && <div className="px-4 py-6 text-xs text-off-black/45">Pick a conversation to see the customer, their orders and the actions.</div>}
      {thread && (
        <>
          {/* Who they are and where this conversation stands, in one place. The
              assignee is on the conversation's header, so it is not repeated. */}
          <Section title="Conversation" badge={<span className={`${chip} ${STATUS_TONE[thread.status]} font-semibold`}>{STATUS_LABEL[thread.status]}</span>}>
            <Attr label="Name">{thread.customer.name || <span className="text-off-black/40">Unknown</span>}</Attr>
            {thread.customer.email && <Attr label="Email"><span className="inline-flex items-start gap-1.5 min-w-0"><a href={`mailto:${thread.customer.email}`} className="text-blue-600 hover:text-blue-700 break-all">{thread.customer.email}</a><CopyButton text={thread.customer.email} /></span></Attr>}
            {thread.channel === 'instagram' && thread.igUsername && <Attr label="Instagram"><a href={`https://instagram.com/${thread.igUsername}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">@{thread.igUsername}</a></Attr>}
            {/* First seen and this conversation's start were the same date nearly always; the earlier one says it. */}
            <Attr label="Since">{day([thread.customer.firstSeen, thread.createdAt].filter(Boolean).sort()[0] || thread.createdAt)}</Attr>
            {thread.customer.conversations > 1 && <Attr label="Conversations">{thread.customer.conversations}</Attr>}
            <Attr label="Tags">
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                {thread.context.bigSpender && (
                  <TagChip tag={{ key: 'big-spender', label: '💰 Big Spender', tone: 'amber', sublabel: thread.context.spentUsd != null ? `$${Math.round(thread.context.spentUsd).toLocaleString()}` : undefined, title: thread.context.spentUsd != null ? `This customer has spent $${Math.round(thread.context.spentUsd).toLocaleString()} with us across the orders below.` : 'A high-value customer. Prioritize them.' }} />
                )}
                <Tags tags={thread.tags} suggestions={tagSuggestions} onChange={onTags} />
              </span>
            </Attr>
            <Attr label="Priority">
              <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={thread.priority} onChange={e => onPriority(e.target.checked)} className="accent-amber-500" />{thread.priority ? 'Priority' : 'Normal'}</label>
            </Attr>
            {(thread.lastInboundAt || thread.lastOutboundAt) && (
              <div className="grid grid-cols-2 gap-3 text-xs pt-0.5">
                <div><div className="text-off-black/45">Their last message</div><div className="text-off-black">{thread.lastInboundAt ? `${ago(thread.lastInboundAt)} ago` : 'None yet'}</div></div>
                <div><div className="text-off-black/45">Our last message</div><div className="text-off-black">{thread.lastOutboundAt ? `${ago(thread.lastOutboundAt)} ago` : 'None yet'}</div></div>
              </div>
            )}
            {thread.channel !== 'instagram' && thread.customer.email && (
              <div className="pt-1"><FilterSender email={thread.customer.email} filters={filters} onChanged={onFiltersChanged} /></div>
            )}
          </Section>
          <Section title="Orders" count={thread.context.orders.length}>
            {thread.context.shopifyError && <div className="text-xs text-amber-700 inline-flex items-start gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />Shopify did not answer; showing what we have on file.</div>}
            {thread.context.orders.length === 0
              ? <div className="text-xs text-off-black/50 inline-flex items-center gap-1.5"><Package className="w-3.5 h-3.5" />{thread.customerEmail ? `No orders under ${thread.customerEmail}.` : 'No email to look orders up by. Ask for the order number.'}</div>
              : <div className="space-y-3">{thread.context.orders.map(o => (
                  <OrderCard key={`${o.source}-${o.number}`} o={o} onUnlink={o.linked ? () => unlinkOrder(thread.id, o.number, onChanged) : undefined} />
                ))}</div>}
            {(thread.suggestedOrders || []).length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[11px] font-semibold text-off-black/45 uppercase tracking-wider">Mentioned in the conversation</div>
                {(thread.suggestedOrders || []).map(s => (
                  <SuggestedOrder key={s.number} s={s} threadId={thread.id} onChanged={onChanged} />
                ))}
              </div>
            )}
            <AddOrder threadId={thread.id} onChanged={onChanged} />
          </Section>
          {thread.pastThreads.length > 0 && (
          <Section title="Other conversations" count={thread.pastThreads.length}>
            {thread.pastThreads.length > 0 && (
              <div className="space-y-1">
                {thread.pastThreads.map(p => (
                  <div key={p.id} className="rounded-md border border-border-gray bg-white">
                  <button onClick={() => onOpenThread(p.id)} className="w-full text-left px-2.5 py-1.5 rounded-t-md hover:bg-subtle-gray transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-off-black truncate">{p.subject || '(no subject)'}</span>
                      <span className="text-[11px] text-off-black/45 shrink-0">{ago(p.lastMessageAt)}</span>
                    </div>
                    <div className="mt-0.5"><span className={`${chip} ${STATUS_TONE[p.status]}`}>{STATUS_LABEL[p.status]}</span></div>
                  </button>
                  {thread.channel === 'email' && (
                    <button onClick={() => { if (arm(`merge:${p.id}`)) onMerge([p.id]) }}
                      disabled={merging.length > 0}
                      className="w-full inline-flex items-center gap-1.5 text-left px-2.5 py-1 border-t border-border-gray text-[11px] font-medium text-[#4600D6] hover:bg-[#4600D6]/5 rounded-b-md disabled:opacity-60">
                      {merging.includes(p.id) ? <><Loader2 className="w-3 h-3 animate-spin" />Merging…</> : isArmed(`merge:${p.id}`) ? <span className="text-red-600">Click again to merge: its messages move here, no undo</span> : 'Merge into this conversation'}
                    </button>
                  )}
                  </div>
                ))}
              </div>
            )}
          </Section>
          )}
          <Section title="Actions">
            <Actions thread={thread} onInsert={onInsert} onAttach={onAttach} onChanged={onChanged} />
          </Section>
        </>
      )}
    </aside>
  )
}
