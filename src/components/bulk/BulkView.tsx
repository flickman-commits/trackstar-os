import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Loader2, Check, X, Upload, Download, Link2, Copy, ExternalLink, RefreshCw, FlaskConical,
  CheckCircle2, ChevronLeft, ChevronDown, ChevronUp, Trash2, FileText, Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnPrimary, btnSecondary, btnGhost, inputBase } from '@/lib/ui'
import { useArmed } from '@/lib/useArmed'
import AssigneePicker, { Avatar, type Teammate } from '@/components/AssigneePicker'
import { DealModal, InvoiceCard, LineTemplate, type Deal } from '@/components/bulk/DealPanels'
import StatusPill from '@/components/orders/StatusPill'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * Bulk partner orders: a prepaid run of co-branded prints for one race.
 *
 * The list is sorted by due date because that is the question Eli has: what
 * is next. The detail is one long page rather than a modal: a readiness
 * strip, the production file so nobody prints from the wrong artwork, the
 * runner list, the files, and the Artelo sheet at the bottom. Runners are
 * ordinary orders; clicking one opens the normal order modal.
 */

export interface BulkRunner {
  id: string
  orderNumber: string
  lineItemIndex: number
  runnerName: string
  email: string | null
  address: { line1: string; line2: string; city: string; state: string; zip: string; country: string } | null
  addressComplete: boolean
  fileUrl: string | null
  researched: boolean
  researchStatus: string | null
  bib: string | null
  time: string | null
  pace: string | null
  eventType: string | null
  completed: boolean
}

export interface BulkOrder {
  id: string
  number: string
  partnerName: string
  raceName: string
  raceYear: number
  quantity: number
  frameType: string
  productSize: string
  stripeInvoiceUrl: string | null
  shopifyOrderId?: string | null
  shopifyOrderName?: string | null
  shopifyOrderUrl?: string | null
  paidAt: string | null
  productionFileUrl: string | null
  previewImageUrl: string | null
  raceDate: string | null
  dueDate: string | null
  status: string
  submittedAt: string | null
  intakeToken: string
  runnerToken: string
  intakeNote: string | null
  notes: string | null
  partnerOrderId: string | null
  /** The deal it is one line of (DealPanels), and the event at the race. */
  dealId?: string | null
  deal?: { id: string; number: string; printKind: 'standard' | 'cobranded'; invoiceSentAt?: string | null; paidAt?: string | null } | null
  /** not_sent / sent / paid (deals.js paymentStatus). */
  paymentStatus?: 'not_sent' | 'sent' | 'paid'
  eventType?: string | null
  /** Who runs it; new ones go to the bulk default in Order Assignment. */
  assigneeId: string | null
  progress: { total: number; withAddress: number; researched: number; found: number; files: number; completed: number }
  runners?: BulkRunner[]
  readiness?: {
    paid: boolean
    raceDate: { ok: boolean; date: string | null }
    scraper: { ok: boolean; configured: boolean; yearConfigured: boolean; health: { status: string; checkedAt: string; detail: string | null } | null }
    design: { ok: boolean; status: string | null; approvedImageUrl: string | null }
    runners: { total: number; withAddress: number; ok: boolean }
  }
  sheetProblems?: { orderNumber: string; runnerName: string; problem: string }[]
}

const STATUS_LABEL: Record<string, string> = {
  collecting: 'Collecting Info',
  fulfillment: 'Fulfillment',
  submitted: 'Sent to Artelo',
}
/** Same treatment as the order modal's design status: an icon, a tint, and the stages above it. */
const STATUS_STYLE: Record<string, { dot: string; color: string; bg: string; border: string }> = {
  collecting: { dot: 'bg-off-black/30', color: 'text-off-black/70', bg: 'bg-off-black/5', border: 'border-border-gray' },
  fulfillment: { dot: 'bg-blue-500', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  submitted: { dot: 'bg-emerald-500', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
}
// Where the invoice stands (server/domain/bulk/deals.js paymentStatus); Shopify moves it on its own.
const PAYMENT: Record<string, { label: string; dot: string; color: string; bg: string }> = {
  not_sent: { label: 'Invoice not sent', dot: 'bg-off-black/30', color: 'text-off-black/70', bg: 'bg-off-black/5' },
  sent: { label: 'Invoice sent', dot: 'bg-amber-500', color: 'text-amber-700', bg: 'bg-amber-50' },
  paid: { label: 'Paid', dot: 'bg-emerald-500', color: 'text-emerald-700', bg: 'bg-emerald-50' },
}
const STAGES: { key: string; label: string }[] = [
  { key: 'collecting', label: 'Collecting Info' },
  { key: 'fulfillment', label: 'Fulfillment' },
  { key: 'submitted', label: 'Sent to Artelo' },
]

function fmtDate(s?: string | null) {
  return s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}
function daysUntil(s?: string | null) {
  if (!s) return null
  return Math.round((new Date(s).getTime() - Date.now()) / 86400000)
}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await apiFetch(`${API_BASE}/api/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data as T
}

function copyText(text: string, what = 'Copied') {
  navigator.clipboard.writeText(text).then(() => toast.success(what)).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast.success(what)
  })
}

// ─── List ──────────────────────────────────────────────────────────────────

/** A status chip in the order modal's badge style. */
function Chip({ tone, children, onClick, title }: { tone: 'green' | 'amber' | 'red' | 'gray'; children: React.ReactNode; onClick?: () => void; title?: string }) {
  const cls = tone === 'green' ? 'bg-green-50 text-green-700 border-green-200'
    : tone === 'amber' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : tone === 'red' ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-subtle-gray text-off-black/60 border-border-gray'
  const base = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-semibold ${cls}`
  if (onClick) return <button type="button" onClick={onClick} title={title} className={`${base} hover:opacity-80`}>{children}</button>
  return <span className={base} title={title}>{children}</span>
}

export default function BulkView({ onOpenRunner, refreshRunners, onCount, toolbar, search = '', creating = false, onCreatingChange, team = [], meId, openId, onOpened }: {
  /** Open this run straight away (from the Standard view's Bulk orders panel). */
  openId?: string | null
  onOpened?: () => void
  /** The team, for the Assignee column and picker. */
  team?: Teammate[]
  meId?: string | null
  /** The dashboard's shared search toolbar, shown at the top of the card. */
  toolbar?: React.ReactNode
  search?: string
  /** The New Bulk Order button lives in the page header; it drives this. */
  creating?: boolean
  onCreatingChange?: (open: boolean) => void
  /** Open a runner in the ordinary order modal. */
  onOpenRunner: (orderNumber: string) => void
  /** Ask the dashboard to reload its bulk-runner orders so the modal has fresh data. */
  refreshRunners: () => void
  /** How many bulk orders exist, for the header badge. */
  onCount?: (n: number) => void
}) {
  const [list, setList] = useState<BulkOrder[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => { if (openId) { setSelectedId(openId); onOpened?.() } }, [openId, onOpened])
  const setCreating = (v: boolean) => onCreatingChange?.(v)
  const q = search.trim().toLowerCase()
  const shown = useMemo(() => !list || !q ? list : list.filter(b => [b.number, b.partnerName, b.raceName, b.eventType, String(b.raceYear)].some(v => String(v || '').toLowerCase().includes(q))), [list, q])

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/bulk`)
      const data = await res.json()
      setList(data.bulkOrders || [])
      onCount?.((data.bulkOrders || []).length)
    } catch { toast.error('Could not load bulk orders') }
  }, [onCount])
  useEffect(() => { load() }, [load])

  if (selectedId) {
    return <BulkDetail key={selectedId} id={selectedId} onBack={() => { setSelectedId(null); load() }} onOpenRun={setSelectedId} onOpenRunner={onOpenRunner} refreshRunners={refreshRunners} team={team} meId={meId} />
  }

  return (
    <div className="bg-white border border-border-gray rounded-md overflow-hidden flex-1 flex flex-col min-h-0">
      {toolbar}
      <div className="flex-1 overflow-y-auto">
        {list === null ? (
          <div className="flex items-center justify-center py-16 text-off-black/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : !shown || shown.length === 0 ? (
          <div className="text-center py-16 text-off-black/40 text-sm">No bulk orders yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-subtle-gray text-[11px] uppercase tracking-wider text-off-black/50">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Order</th>
                <th className="text-left px-3 py-2.5 font-semibold">Partner</th>
                <th className="text-left px-3 py-2.5 font-semibold">Race</th>
                <th className="text-left px-3 py-2.5 font-semibold">Ships</th>
                <th className="text-left px-3 py-2.5 font-semibold">Payment</th>
                <th className="text-left px-3 py-2.5 font-semibold">Assignee</th>
                <th className="text-left px-3 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown!.map(b => {
                const d = daysUntil(b.dueDate)
                const st = STATUS_STYLE[b.status] || STATUS_STYLE.collecting
                return (
                  <tr key={b.id} onClick={() => setSelectedId(b.id)} className="border-t border-border-gray/70 hover:bg-subtle-gray cursor-pointer">
                    <td className="px-4 py-3 font-mono text-[12px] text-off-black/70">{b.number}</td>
                    <td className="px-3 py-3 font-semibold text-off-black">{b.partnerName}</td>
                    <td className="px-3 py-3 text-off-black/80">{b.raceName} <span className="text-off-black/45">{b.raceYear}</span>{b.eventType && b.eventType !== 'Marathon' && <span className="ml-1.5 text-xs font-medium text-off-black/60">{b.eventType}</span>}</td>
                    <td className="px-3 py-3">
                      {b.dueDate ? (
                        <span className={d !== null && d < 0 ? 'text-red-600 font-semibold' : d !== null && d <= 3 ? 'text-amber-700 font-semibold' : 'text-off-black/80'}>
                          {fmtDate(b.dueDate)}{d !== null && d < 0 ? ` · ${-d}d late` : ''}
                        </span>
                      ) : <span className="text-off-black/40">No race date</span>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {(() => { const p = PAYMENT[b.paymentStatus || (b.paidAt ? 'paid' : 'not_sent')]; return <StatusPill size="xs" label={p.label} dot={p.dot} color={p.color} bg={p.bg} /> })()}
                        {b.shopifyOrderName && <span className="text-[11px] text-off-black/45">{b.shopifyOrderName}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-3">{(() => {
                      const u = team.find(t => t.id === b.assigneeId)
                      return u
                        ? <span className="inline-flex items-center gap-1.5 text-sm text-off-black whitespace-nowrap"><Avatar user={u} size={20} />{u.firstName}</span>
                        : <span className="text-sm text-off-black/40">Unassigned</span>
                    })()}</td>
                    <td className="px-3 py-3"><StatusPill size="xs" label={STATUS_LABEL[b.status] || b.status} dot={st.dot} color={st.color} bg={st.bg} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      {creating && <DealModal onClose={() => setCreating(false)} onCreated={deal => { setCreating(false); load(); if (deal.runs[0]) setSelectedId(deal.runs[0].id) }} />}
    </div>
  )
}

// ─── Detail ────────────────────────────────────────────────────────────────

function BulkDetail({ id, onBack, onOpenRunner, refreshRunners, team, meId }: { id: string; onBack: () => void; onOpenRun: (runId: string) => void; onOpenRunner: (n: string) => void; refreshRunners: () => void; team: Teammate[]; meId?: string | null }) {
  const [b, setB] = useState<BulkOrder | null>(null)
  const [intakeText, setIntakeText] = useState('')
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeProblems, setIntakeProblems] = useState<string[]>([])
  const [researching, setResearching] = useState(false)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [unmatched, setUnmatched] = useState<{ filename: string; candidates: { orderNumber: string; runnerName: string }[] }[]>([])
  const [checking, setChecking] = useState(false)
  const [reach, setReach] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [intakeLinkOpen, setIntakeLinkOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // The order's billing record: customer, terms, invoice, and a co-branded file's check.
  const [deal, setDeal] = useState<Deal | null>(null)
  const [editingOrder, setEditingOrder] = useState(false)
  const { arm, isArmed } = useArmed()

  const load = useCallback(async () => {
    const res = await apiFetch(`${API_BASE}/api/bulk?id=${id}`)
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Not found'); onBack(); return }
    setB(data.bulkOrder)
    if (data.bulkOrder?.deal?.id) {
      const d = await apiFetch(`${API_BASE}/api/bulk/deals?id=${encodeURIComponent(data.bulkOrder.deal.id)}`).then(r => r.json()).catch(() => null)
      setDeal(d?.deal || null)
    }
  }, [id, onBack])
  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, ok?: string) => {
    try {
      const out = await api<{ bulkOrder: BulkOrder }>({ id, ...body })
      if (out.bulkOrder) setB(out.bulkOrder)
      if (ok) toast.success(ok)
      return out
    } catch (err) { toast.error((err as Error).message); return null }
  }
  const update = (fields: Record<string, unknown>) => act({ action: 'update', ...fields })

  const runIntake = async () => {
    const out = await act({ action: 'intake', text: intakeText }) as { added: number; skipped: number; problems: string[] } | null
    if (!out) return
    setIntakeProblems(out.problems || [])
    toast.success(`${out.added} added${out.skipped ? `, ${out.skipped} already on the list` : ''}`)
    if (!out.problems?.length) { setIntakeText(''); setIntakeOpen(false) }
    refreshRunners()
  }

  const researchAll = async () => {
    setResearching(true)
    try {
      let remaining = 1
      let total = 0
      while (remaining > 0) {
        const out = await api<{ done: { status: string }[]; remaining: number; bulkOrder: BulkOrder }>({ id, action: 'research', limit: 3 })
        total += out.done.length
        remaining = out.remaining
        setB(out.bulkOrder)
        if (out.done.length === 0) break
      }
      toast.success(`Researched ${total} runner${total === 1 ? '' : 's'}`)
      refreshRunners()
    } catch (err) { toast.error((err as Error).message) } finally { setResearching(false) }
  }

  const uploadFiles = async (files: FileList | File[], orderNumber?: string) => {
    const arr = Array.from(files)
    if (!arr.length) return
    setUploading({ done: 0, total: arr.length })
    const misses: typeof unmatched = []
    let matched = 0
    for (let i = 0; i < arr.length; i++) {
      const fd = new FormData()
      fd.append('id', id)
      fd.append('file', arr[i])
      if (orderNumber) fd.append('orderNumber', orderNumber)
      try {
        const res = await apiFetch(`${API_BASE}/api/bulk/files`, { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok) { toast.error(`${arr[i].name}: ${data.error}`) }
        else if (data.matched) { matched++; if (data.reachable === false) toast.warning(`${arr[i].name} uploaded but is not reachable from outside`) }
        else misses.push({ filename: data.filename, candidates: data.candidates || [] })
      } catch { toast.error(`${arr[i].name}: upload failed`) }
      setUploading({ done: i + 1, total: arr.length })
    }
    setUploading(null)
    if (matched) toast.success(`${matched} file${matched === 1 ? '' : 's'} attached`)
    if (misses.length) setUnmatched(prev => [...prev, ...misses])
    await load()
  }

  const checkUrls = async () => {
    setChecking(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/bulk/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'check' }) })
      const data = await res.json()
      const map: Record<string, boolean> = {}
      for (const r of data.results || []) map[r.orderNumber] = r.ok
      setReach(map)
      if (data.unreachable) toast.error(`${data.unreachable} file${data.unreachable === 1 ? ' is' : 's are'} not reachable. Artelo will reject those rows.`)
      else toast.success(`All ${data.checked} files reachable from outside`)
    } catch { toast.error('Check failed') } finally { setChecking(false) }
  }

  const downloadSheet = async (force = false) => {
    const res = await apiFetch(`${API_BASE}/api/bulk/sheet?id=${id}${force ? '&force=1' : ''}`)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.error || 'Could not build the sheet', { duration: 8000 })
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || `${b?.number}_Artelo.xlsx`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const intakeLink = useMemo(() => (b ? `${window.location.origin}/intake/${b.intakeToken}` : ''), [b])
  const runnerLink = useMemo(() => (b ? `${window.location.origin}/runner/${b.runnerToken}` : ''), [b])

  if (!b) return <div className="flex items-center justify-center py-16 text-off-black/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
  const r = b.readiness!
  const runners = b.runners || []
  const d = daysUntil(b.dueDate)
  const st = STATUS_STYLE[b.status] || STATUS_STYLE.collecting
  const canResearch = r.paid && runners.length > 0 && r.scraper.ok
  const allResearched = runners.length > 0 && runners.every(x => x.researched)
  const problems = b.sheetProblems || []
  const collecting = b.status === 'collecting'
  const fulfilling = b.status === 'fulfillment'
  const submitted = b.status === 'submitted'

  // ── Cards, so the status decides the order rather than the markup ──
  const intakeCard = (
    <div className="bg-white border border-border-gray rounded-md p-4">
      {!collecting && (
        <button onClick={() => setIntakeLinkOpen(o => !o)} className="w-full flex items-center justify-between text-left -my-1">
          <span className="text-xs font-semibold uppercase tracking-tight text-off-black/60">Partner intake link</span>
          {intakeLinkOpen ? <ChevronUp className="w-4 h-4 text-off-black/40" /> : <ChevronDown className="w-4 h-4 text-off-black/40" />}
        </button>
      )}
      {(collecting || intakeLinkOpen) && <div className={collecting ? '' : 'mt-3'}>
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex-1 min-w-0">
          {collecting && <div className="text-[11px] font-semibold text-[#4600D6] uppercase tracking-wider">Partner intake link</div>}
          <p className="text-sm text-off-black/70 mt-0.5">Send this to {b.partnerName}. They enter each runner's name and shipping address and the list fills in here.</p>
          <div className="mt-2 font-mono text-[12px] text-off-black/60 truncate">{intakeLink}</div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button onClick={() => copyText(intakeLink, 'Intake link copied')} className={btnPrimary}><Copy className="w-4 h-4" /> Copy link</button>
          <a href={intakeLink} target="_blank" rel="noopener noreferrer" className={btnSecondary} title="Open"><ExternalLink className="w-3.5 h-3.5" /></a>
          <button onClick={() => { if (arm('rotate-link')) act({ action: 'new-intake-link' }, 'New link made') }} className={btnGhost} title="Make a new link (the old one stops working)"><RefreshCw className="w-3.5 h-3.5" />{isArmed('rotate-link') && ' Click again: the old link stops working'}</button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-off-black/60">
        <span>Runner self-serve link, for the partner to forward to their team:</span>
        <code className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-subtle-gray truncate max-w-[360px]">{runnerLink}</code>
        <button onClick={() => copyText(runnerLink, 'Runner link copied')} className={btnGhost}><Copy className="w-3.5 h-3.5" /> Copy</button>
      </div>
      <input value={b.intakeNote || ''} onChange={e => setB({ ...b, intakeNote: e.target.value })} onBlur={e => update({ intakeNote: e.target.value })} placeholder="Note shown to the partner and runners on those pages (optional)" className={`${inputBase} w-full mt-3 text-xs`} />
      </div>}
    </div>
  )

  // Each runner's print renders (render worker) from the race design, or for a
  // co-branded order from its uploaded file, is approved in their order, and
  // its PDF becomes that runner's file for the Artelo sheet.
  const standardCard = (
    <div className="bg-white border border-border-gray rounded-md p-4">
      <div className="text-[11px] font-semibold text-off-black/50 uppercase tracking-wider">{b.deal?.printKind === 'cobranded' ? 'Co-branded prints' : 'Standard prints'}</div>
      <div className="text-lg font-bold text-off-black leading-tight mt-0.5">{b.raceName} {b.raceYear}{b.eventType && b.eventType !== 'Marathon' ? ` · ${b.eventType}` : ''}</div>
      <p className="text-xs text-off-black/60 mt-1">Each runner's print renders from {b.deal?.printKind === 'cobranded' ? 'the uploaded co-branded file' : 'the race design'} once they are researched. Open a runner to approve their design; approved prints attach to the Artelo sheet on their own ({b.progress.files} of {runners.length} so far).</p>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black">{b.productSize}</span>
        <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black">{b.frameType}</span>
      </div>
    </div>
  )

  const productionCard = standardCard
  const runnersCard = (
    <div className="bg-white border border-border-gray rounded-md">
      <div className="p-3 md:p-4 border-b border-border-gray flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-tight">Runners</h3>
          <span className="text-xs text-off-black/50 tabular-nums">
            {runners.length}{b.quantity ? ` of ${b.quantity}` : ''}
            {fulfilling || submitted ? ` · ${b.progress.found} found · ${b.progress.files} files · ${b.progress.completed} done` : b.progress.withAddress < runners.length ? ` · ${runners.length - b.progress.withAddress} missing an address` : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {!submitted && <button onClick={() => setIntakeOpen(o => !o)} className={btnSecondary}><Plus className="w-3.5 h-3.5" /> Add runners</button>}
          {fulfilling && (
            <button onClick={researchAll} disabled={!canResearch || researching || allResearched} className={btnPrimary} title={!r.paid ? 'Mark paid first' : !r.scraper.ok ? 'Scraper is not ready' : allResearched ? 'Everyone is researched' : 'Research every runner without results'}>
              {researching ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />} Research all
            </button>
          )}
        </div>
      </div>

      {intakeOpen && (
        <div className="p-3 md:p-4 border-b border-border-gray bg-subtle-gray space-y-2">
          <p className="text-xs text-off-black/60">Paste a CSV with a header row (First Name, Last Name, Address, Address 2, City, State, Zip, Country, Email), or one name per line to add addresses later.</p>
          <textarea value={intakeText} onChange={e => setIntakeText(e.target.value)} rows={6} className={`${inputBase} w-full font-mono text-xs`} placeholder={'First Name,Last Name,Address,City,State,Zip\nJane,Doe,1 Main St,Brooklyn,NY,11201'} />
          {intakeProblems.length > 0 && (
            <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2 space-y-0.5 max-h-32 overflow-y-auto">{intakeProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          )}
          <div className="flex gap-2 justify-end"><button onClick={() => { setIntakeOpen(false); setIntakeProblems([]) }} className={btnGhost}>Cancel</button><button onClick={runIntake} disabled={!intakeText.trim()} className={btnPrimary}>Add to list</button></div>
        </div>
      )}

      {runners.length === 0 ? (
        <div className="text-center py-10 text-sm text-off-black/40">No runners yet. {collecting ? 'Send the partner the intake link, or add them by hand.' : 'Add them above.'}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle-gray text-[11px] uppercase tracking-wider text-off-black/50">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">#</th>
                <th className="text-left px-3 py-2 font-semibold">Runner</th>
                <th className="text-left px-3 py-2 font-semibold">Address</th>
                {!collecting && <>
                  <th className="text-left px-3 py-2 font-semibold">Bib</th>
                  <th className="text-left px-3 py-2 font-semibold">Time</th>
                  <th className="text-left px-3 py-2 font-semibold">Research</th>
                  <th className="text-left px-3 py-2 font-semibold">File</th>
                  <th className="text-left px-3 py-2 font-semibold">Done</th>
                </>}
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {runners.map(x => (
                <RunnerRow key={x.id} r={x} compact={collecting} reach={reach[x.orderNumber]} editing={editing === x.orderNumber} removeArmed={isArmed(`remove:${x.orderNumber}`)}
                  onEdit={() => setEditing(editing === x.orderNumber ? null : x.orderNumber)}
                  onSave={async (fields) => { await act({ action: 'update-runner', orderNumber: x.orderNumber, ...fields }, 'Saved'); setEditing(null); refreshRunners() }}
                  onRemove={async () => { if (arm(`remove:${x.orderNumber}`)) { await act({ action: 'remove-runner', orderNumber: x.orderNumber }, 'Removed'); refreshRunners() } }}
                  onOpen={() => onOpenRunner(x.orderNumber)}
                  onUpload={(f) => uploadFiles([f], x.orderNumber)}
                  onDetach={async () => { await apiFetch(`${API_BASE}/api/bulk/files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'detach', orderNumber: x.orderNumber }) }); load() }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )

  const filesCard = (
    <div className="bg-white border border-border-gray rounded-md p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-tight">Print files</h3>
          <p className="text-xs text-off-black/60 mt-0.5">Drop the finished PDFs. They match by filename ({b.number}-17_… or last name) and get a public link Artelo can fetch.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={checkUrls} disabled={checking || b.progress.files === 0} className={btnSecondary}>{checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} Check links</button>
          <button onClick={() => fileInput.current?.click()} disabled={Boolean(uploading)} className={btnPrimary}>{uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> {uploading.done} of {uploading.total}</> : <><Upload className="w-4 h-4" /> Add files</>}</button>
          <input ref={fileInput} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" className="hidden" onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }} />
        </div>
      </div>
      <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); uploadFiles(e.dataTransfer.files) }} className="border-2 border-dashed border-border-gray rounded-md py-5 text-center text-xs text-off-black/45">
        Drag files here · {b.progress.files} of {runners.length} attached
      </div>
      {unmatched.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">These files did not match a runner. Drop them on the right row, or rename them.</p>
          <ul className="text-xs text-amber-900 space-y-0.5">
            {unmatched.map((u, i) => <li key={i}><span className="font-mono">{u.filename}</span>{u.candidates.length ? ` could be ${u.candidates.map(c => c.runnerName).join(' or ')}` : ' matched nobody'}</li>)}
          </ul>
          <button onClick={() => setUnmatched([])} className={btnGhost}>Clear</button>
        </div>
      )}
    </div>
  )

  const arteloCard = (
    <div className="bg-white border border-border-gray rounded-md p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-tight">Artelo bulk upload</h3>
          <p className="text-xs text-off-black/60 mt-0.5">One row per runner in the template's columns. Download, then upload it on Artelo's Orders page.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => downloadSheet(false)} disabled={runners.length === 0} className={btnPrimary}><Download className="w-4 h-4" /> Download sheet</button>
          {!submitted && <button onClick={() => { if (arm('submitted')) update({ status: 'submitted' }) }} className={btnSecondary}><FileText className="w-3.5 h-3.5" /> {isArmed('submitted') ? 'Click again to mark uploaded to Artelo' : 'Mark uploaded'}</button>}
        </div>
      </div>
      {problems.length > 0 ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-xs font-semibold text-red-700 mb-1">{problems.length} row{problems.length === 1 ? '' : 's'} would fail at Artelo</p>
          <ul className="text-xs text-red-800 space-y-0.5 max-h-40 overflow-y-auto">{problems.map((p, i) => <li key={i}><span className="font-mono">{p.orderNumber}</span> {p.runnerName}: {p.problem}</li>)}</ul>
          <button onClick={() => downloadSheet(true)} className={`${btnGhost} mt-1`}>Download anyway</button>
        </div>
      ) : runners.length > 0 ? (
        <p className="text-xs text-green-700 inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Every row has an address and a file.</p>
      ) : null}
      {b.submittedAt && <p className="text-xs text-off-black/50">Uploaded to Artelo {fmtDate(b.submittedAt)}.</p>}
    </div>
  )

  const pay = PAYMENT[b.paymentStatus || (r.paid ? 'paid' : 'not_sent')]
  const myRun = deal?.runs.find(x => x.id === b.id) || null
  const label = 'text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5'
  const link = 'self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2 disabled:opacity-50'
  // A status you can change from the pill itself, as on the order view.
  const pill = (p: { label: string; dot: string; color: string; bg: string }, value: string, options: [string, string][], onPick: (v: string) => void, title: string) => (
    <label className={`relative shrink-0 inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-full border border-border-gray text-xs font-medium whitespace-nowrap cursor-pointer ${p.bg} ${p.color}`} title={title}>
      <span className={`w-2 h-2 rounded-full ${p.dot}`} aria-hidden />{p.label}<ChevronDown className="w-3 h-3 opacity-60" />
      <select value={value} onChange={e => onPick(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label={title}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-6">
      <div className="bg-white border border-border-gray rounded-md">
      {/* Header, as on an order: back, the two statuses, the organization, who has it. */}
      <div className="sticky top-0 z-30 px-4 md:px-6 py-3 md:py-4 bg-white/95 backdrop-blur border-b border-border-gray rounded-t-md flex flex-wrap items-center gap-2 md:gap-3">
        <button onClick={onBack} title="Back to bulk orders" className="inline-flex items-center gap-1 -ml-1 px-1.5 py-1 text-off-black/60 hover:text-off-black hover:bg-off-black/5 rounded transition-colors">
          <ChevronLeft className="w-4 h-4" /><span className="text-sm hidden md:inline">Bulk orders</span>
        </button>
        {pill({ label: STATUS_LABEL[b.status] || b.status, ...st }, b.status, STAGES.map(x => [x.key, STATUS_LABEL[x.key]]), v => update({ status: v }), 'Production status')}
        {pill(pay, b.paymentStatus || 'not_sent', [['not_sent', 'Invoice not sent'], ['sent', 'Invoice sent'], ['paid', 'Paid']], v => act({ action: 'payment', status: v }, 'Payment updated'), 'Invoice and payment. Shopify updates it on its own.')}
        <h3 className="text-lg md:text-heading-md text-off-black leading-tight min-w-0 truncate">{b.partnerName}</h3>
        {team.length > 0 && <span className="hidden md:inline"><AssigneePicker team={team} value={b.assigneeId} meId={meId} onChange={assigneeId => update({ assigneeId })} /></span>}
      </div>

      <div className="p-4 md:p-6 flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-6 md:items-start">
      <aside className="order-2 md:order-none md:col-start-2 md:row-start-1 md:sticky md:top-20 space-y-4 mt-6 md:mt-0">
        {/* What is being made, and when it ships. */}
        <div className="bg-subtle-gray border border-border-gray rounded-md p-3">
          <div className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-0.5">Order Details</div>
          <h3 className="text-lg font-bold text-off-black leading-tight">
            {b.raceName}{' '}<span className="inline-flex items-center px-2 py-0.5 border rounded text-xs font-semibold align-middle bg-white border-border-gray text-off-black">{b.raceYear}</span>
          </h3>
          <div className="text-xs text-off-black/55 mt-0.5 font-mono">{b.number}</div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {b.quantity ? <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black">{b.quantity} prints</span> : null}
            <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black">{b.productSize}</span>
            <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black">{b.frameType}</span>
            <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black">{b.deal?.printKind === 'standard' ? 'Standard' : 'Co-branded'}</span>
          </div>
          {myRun?.notes && <div className="text-xs text-off-black/60 mt-2">Events: {myRun.notes}</div>}
          <div className="mt-3 pt-2 border-t border-border-gray">
            <div className="text-[11px] text-off-black/50">Fulfillment date</div>
            <div className={`text-sm font-bold ${d !== null && d < 0 ? 'text-red-600' : d !== null && d <= 3 ? 'text-amber-700' : 'text-off-black'}`}>{b.dueDate ? fmtDate(b.dueDate) : 'Not set'}{d !== null && d < 0 ? ` · ${-d}d late` : ''}</div>
            {b.raceDate && <div className="text-[11px] text-off-black/45">Race day {fmtDate(b.raceDate)}</div>}
          </div>
        </div>

        {/* The facts, read only. */}
        <div>
          <h4 className={label}>Tags</h4>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone={r.scraper.ok ? 'green' : 'red'} title={r.scraper.health ? `Probed ${fmtDate(r.scraper.health.checkedAt)}${r.scraper.health.detail ? `: ${r.scraper.health.detail}` : ''}` : undefined}>
              {!r.scraper.configured ? 'No scraper for this race' : !r.scraper.yearConfigured ? `Scraper: ${b.raceYear} not configured` : r.scraper.health?.status === 'not_run_yet' ? 'Scraper ready · race not run yet' : r.scraper.health ? `Scraper ${r.scraper.health.status}` : 'Scraper ready'}
            </Chip>
            {b.partnerOrderId && <Chip tone={r.design.ok ? 'green' : 'amber'}>{r.design.ok ? 'Design approved' : `Design ${(r.design.status || 'not started').replace(/_/g, ' ')}`}</Chip>}
            <Chip tone={r.runners.ok ? 'green' : r.runners.total ? 'amber' : 'gray'}>{r.runners.total ? `${r.runners.withAddress} of ${r.runners.total} with address` : 'No runners yet'}</Chip>
            {deal && <Chip tone="gray">{deal.shipping === 'organization' ? 'Ships to them' : 'Ships to each runner'}</Chip>}
          </div>
        </div>

        {deal && <InvoiceCard deal={deal} onChanged={load} />}

        {/* Smaller things you can do to the order. */}
        <div>
          <h4 className={label}>Actions</h4>
          <div className="flex flex-col items-stretch gap-1.5">
            {deal && <button onClick={() => setEditingOrder(true)} className={link}><Pencil className="w-3.5 h-3.5" /> Edit order</button>}
            {!submitted && <button onClick={() => setIntakeOpen(o => !o)} className={link}><Plus className="w-3.5 h-3.5" /> Add runners</button>}
            {fulfilling && (
              <button onClick={researchAll} disabled={!canResearch || researching || allResearched} className={link} title={!r.paid ? 'Mark paid first' : !r.scraper.ok ? 'Scraper is not ready' : allResearched ? 'Everyone is researched' : 'Research every runner without results'}>
                {researching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />} Research all runners
              </button>
            )}
            {!collecting && <button onClick={() => downloadSheet(false)} disabled={runners.length === 0} className={link}><Download className="w-3.5 h-3.5" /> Download the Artelo sheet</button>}
            {fulfilling && <button onClick={() => { if (arm('submitted')) update({ status: 'submitted' }) }} className={link}><FileText className="w-3.5 h-3.5" /> {isArmed('submitted') ? 'Click again to mark uploaded to Artelo' : 'Mark uploaded to Artelo'}</button>}
          </div>
        </div>
      </aside>

      {/* The work, in the order the stage needs it. */}
      <div className="order-1 md:order-none md:col-start-1 md:row-start-1 min-w-0 flex flex-col gap-4">
        {deal?.printKind === 'cobranded' && myRun && !submitted && (
          <div className="border border-border-gray rounded-md p-4 space-y-1.5">
            <div className={label}>Co-branded production file</div>
            <p className="text-[11px] text-off-black/50">The Illustrator file, built like a race template (same layers and artboards). The render worker checks it, then makes every runner's print from it.</p>
            <LineTemplate run={myRun} onChanged={load} />
          </div>
        )}
        {collecting && <>{intakeCard}{runnersCard}</>}
        {fulfilling && <>{productionCard}{runnersCard}{filesCard}{arteloCard}{intakeCard}</>}
        {submitted && <>{arteloCard}{productionCard}{runnersCard}</>}
      </div>
      </div>
      </div>
      {editingOrder && deal && <DealModal deal={deal} onClose={() => setEditingOrder(false)} onCreated={() => { setEditingOrder(false); load() }} />}
    </div>
  )
}

function RunnerRow({ r, compact, reach, editing, removeArmed, onEdit, onSave, onRemove, onOpen, onUpload, onDetach }: {
  r: BulkRunner; compact?: boolean; reach?: boolean; editing: boolean; removeArmed?: boolean
  onEdit: () => void; onSave: (fields: { runnerName?: string; address?: BulkRunner['address'] }) => Promise<void>; onRemove: () => void; onOpen: () => void
  onUpload: (f: File) => void; onDetach: () => void
}) {
  const [name, setName] = useState(r.runnerName)
  const [a, setA] = useState(r.address || { line1: '', line2: '', city: '', state: '', zip: '', country: 'United States' })
  useEffect(() => { setName(r.runnerName); setA(r.address || { line1: '', line2: '', city: '', state: '', zip: '', country: 'United States' }) }, [r])
  const status = r.researchStatus
  const badge = !r.researched ? { t: 'Pending', c: 'bg-subtle-gray text-off-black/60' }
    : status === 'found' ? { t: 'Found', c: 'bg-green-100 text-green-700' }
    : status === 'not_found' ? { t: 'Not found', c: 'bg-amber-100 text-amber-700' }
    : status === 'ambiguous' ? { t: 'Ambiguous', c: 'bg-amber-100 text-amber-700' }
    : { t: (status || 'error').replace(/_/g, ' '), c: 'bg-red-100 text-red-700' }
  return (
    <>
      <tr className="border-t border-border-gray/70 hover:bg-subtle-gray/60">
        <td className="px-3 py-2 font-mono text-[11px] text-off-black/45">{r.lineItemIndex}</td>
        <td className="px-3 py-2 font-medium"><button onClick={onOpen} className="hover:underline text-left">{r.runnerName}</button></td>
        <td className="px-3 py-2 text-xs text-off-black/70 max-w-[260px] truncate">{r.addressComplete ? `${r.address!.line1}, ${r.address!.city} ${r.address!.state} ${r.address!.zip}` : <span className="text-amber-700 font-semibold">Missing</span>}</td>
        {!compact && <>
        <td className="px-3 py-2 tabular-nums">{r.bib || <span className="text-off-black/30">·</span>}</td>
        <td className="px-3 py-2 tabular-nums">{r.time || <span className="text-off-black/30">·</span>}</td>
        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${badge.c}`}>{badge.t}</span></td>
        <td className="px-3 py-2">
          {r.fileUrl ? (
            <span className="inline-flex items-center gap-1">
              <a href={r.fileUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-green-700 font-semibold inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> File{reach === false ? <span className="text-red-600"> · unreachable</span> : reach === true ? <span className="text-green-700"> · ok</span> : ''}</a>
              <button onClick={onDetach} className="text-off-black/30 hover:text-red-600" title="Detach"><X className="w-3 h-3" /></button>
            </span>
          ) : (
            <label className="text-[11px] text-off-black/50 hover:text-off-black cursor-pointer inline-flex items-center gap-1"><Upload className="w-3 h-3" /> Add<input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" onChange={e => { if (e.target.files?.[0]) onUpload(e.target.files[0]); e.target.value = '' }} /></label>
          )}
        </td>
        <td className="px-3 py-2">{r.completed ? <Check className="w-4 h-4 text-green-600" /> : <span className="text-off-black/30">·</span>}</td>
        </>}
        <td className="px-2 py-2 text-right whitespace-nowrap">
          <button onClick={onEdit} className={btnGhost}>{editing ? 'Close' : 'Edit'}</button>
          <button onClick={onRemove} className={`${btnGhost}${removeArmed ? ' text-red-600' : ''}`} title="Remove"><Trash2 className="w-3.5 h-3.5" />{removeArmed && ' Click again to remove'}</button>
        </td>
      </tr>
      {editing && (
        <tr className="bg-subtle-gray/60">
          <td colSpan={compact ? 4 : 9} className="px-3 py-3">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Runner name" className={`${inputBase} col-span-2`} />
              <input value={a.line1} onChange={e => setA({ ...a, line1: e.target.value })} placeholder="Address" className={`${inputBase} col-span-2`} />
              <input value={a.line2} onChange={e => setA({ ...a, line2: e.target.value })} placeholder="Apt / unit" className={inputBase} />
              <input value={a.city} onChange={e => setA({ ...a, city: e.target.value })} placeholder="City" className={inputBase} />
              <input value={a.state} onChange={e => setA({ ...a, state: e.target.value })} placeholder="State" className={inputBase} />
              <input value={a.zip} onChange={e => setA({ ...a, zip: e.target.value })} placeholder="Zip" className={inputBase} />
              <input value={a.country} onChange={e => setA({ ...a, country: e.target.value })} placeholder="Country" className={inputBase} />
              <div className="col-span-2 md:col-span-3 flex justify-end gap-2"><button onClick={() => onSave({ runnerName: name, address: a })} className={btnPrimary}>Save</button></div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
