import PageHeader from '@/components/PageHeader'
import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Loader2, X, Copy, Check, Instagram, Plus, Mail, Pencil, ChevronDown, ChevronLeft, Search, ExternalLink } from 'lucide-react'
import { btnSecondary, pageShell, sectionLabel, infoCard, cardLabel, textLink } from '@/lib/ui'
import { useArmed } from '@/lib/useArmed'
import { apiFetch } from '@/lib/api'
import { toast } from 'sonner'
import { TRYBE_URL } from '@/lib/creatorLinks'
import CreatorsTabs from '@/components/CreatorsTabs'
import PrintPicker from '@/components/PrintPicker'

type CreatorStatus = 'invited' | 'applied' | 'active' | 'paused' | 'denied'
type CommissionModel = 'free_product' | 'flat_per_asset' | 'rev_share' | 'hybrid'
type ContentStatus = 'not_received' | 'received' | 'edited' | 'posted'

interface BriefLite {
  id: string
  title: string
  status: string
}

interface Creator {
  id: string
  inviteToken: string
  invitedAt: string
  onboardedAt: string | null
  name: string | null
  email: string | null
  instagramHandle: string | null
  tiktokHandle: string | null
  // Application questions from the onboarding wizard
  bestContentLinks: string | null  // legacy — field removed from the wizard
  whyWorkWithUs: string | null
  raceName: string | null
  raceYear: number | null
  bibNumber: string | null
  finishTime: string | null
  productTitle?: string | null
  productSize: string | null
  frameType: string | null
  shippingName: string | null
  shippingAddress1: string | null
  shippingAddress2: string | null
  shippingCity: string | null
  shippingState: string | null
  shippingZip: string | null
  shippingCountry: string | null
  contentStatus: ContentStatus
  commissionModel: CommissionModel
  commissionConfig: Record<string, unknown>
  commissionNotes: string | null
  whitelistingEnabled: boolean
  metaPageId: string | null
  notes: string | null
  status: CreatorStatus
  sampleOrderId: string | null
  sampleOrder?: {
    id: string
    orderNumber: string
    status: string
    createdAt: string
    trackingNumber?: string | null
    trackingCarrier?: string | null
    shippedAt?: string | null
  } | null
  briefAssignments?: Array<{ brief: BriefLite }>
  // Internal-only: per-creator sample COGS based on size + frame.
  sampleCostUsd?: number
  createdAt: string
  updatedAt: string
}

const STATUS_CONFIG: Record<CreatorStatus, { label: string; color: string; bg: string }> = {
  invited:    { label: 'Invited',    color: 'text-off-black/50', bg: 'bg-off-black/5' },
  applied:    { label: 'Applied',    color: 'text-blue-700',     bg: 'bg-blue-50' },
  active:     { label: 'Active',     color: 'text-emerald-700',  bg: 'bg-emerald-50' },
  paused:     { label: 'Paused',     color: 'text-amber-700',    bg: 'bg-amber-50' },
  denied:     { label: 'Denied',     color: 'text-red-700',      bg: 'bg-red-50' },
}

// Content-delivery pipeline — tracks the asset, not the creator's program
// standing. Owned/updated by Matt as he reviews / edits / publishes.
const CONTENT_STATUS_CONFIG: Record<ContentStatus, { label: string; color: string; bg: string }> = {
  not_received: { label: 'Not received', color: 'text-off-black/50', bg: 'bg-off-black/5' },
  received:     { label: 'Received',     color: 'text-blue-700',     bg: 'bg-blue-50' },
  edited:       { label: 'Edited',       color: 'text-amber-700',    bg: 'bg-amber-50' },
  posted:       { label: 'Posted',       color: 'text-emerald-700',  bg: 'bg-emerald-50' },
}

function sampleStatusLabel(orderStatus: string | undefined | null): { label: string; color: string } {
  if (!orderStatus) return { label: 'Not yet requested', color: 'text-off-black/40' }
  if (orderStatus === 'completed') return { label: 'Sent to Production', color: 'text-emerald-700' }
  if (orderStatus === 'flagged')   return { label: 'Flagged',            color: 'text-amber-700' }
  return { label: 'In queue', color: 'text-blue-700' }
}

interface HomeMetrics {
  creators: {
    total: number
    active: number
    invited: number
    applied: number
    paused: number
    appliedThisMonth: number
  }
  samples: {
    total: number
    shipped: number
    pending: number
    costEstimatedUsd: number | null
    costIsPlaceholder: boolean
  }
  ads: { running: number; isPlaceholder: boolean }
  revenue: { attributedThisMonthUsd: number; isPlaceholder: boolean }
  commission: { pendingUsd: number; isPlaceholder: boolean }
}

function formatUsd(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

/** The queues inside the Creators tab, like the order queues. */
type CreatorsView = 'applied' | 'active' | 'all' | 'denied'

const VIEW_LABEL: Record<CreatorsView, string> = {
  applied: 'Applied',
  active: 'Active',
  all: 'All',
  denied: 'Denied',
}

interface WinningAd {
  id: string
  title: string
  url: string
  imageUrl: string | null
  notes: string | null
  createdAt: string
}

/** An applicant still waiting on a yes or no. */
const isApplicant = (c: Creator) => c.status === 'applied' && !c.sampleOrder

export default function CreatorsHome() {
  const [metrics, setMetrics] = useState<HomeMetrics | null>(null)
  const [creators, setCreators] = useState<Creator[]>([])
  const [briefs, setBriefs] = useState<BriefLite[]>([])
  const [ads, setAds] = useState<WinningAd[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [decliningId, setDecliningId] = useState<string | null>(null)
  const { arm, isArmed } = useArmed()
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogRace[] | null>(null)

  // The open creator lives in the address bar as /creators/<id> and the view
  // as ?view=, so a reload, the back button and a shared link land in place.
  const { creatorId = null } = useParams<{ creatorId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view') as CreatorsView | null
  const tab: 'creators' | 'ads' = searchParams.get('tab') === 'ads' ? 'ads' : 'creators'

  const loadAll = useCallback(async () => {
    try {
      const [metricsRes, creatorsRes, briefsRes, adsRes] = await Promise.all([
        apiFetch('/api/creators/manage?action=home-metrics'),
        apiFetch('/api/creators/manage?action=list-creators'),
        apiFetch('/api/creators/manage?action=list-briefs'),
        apiFetch('/api/creators/ads'),
      ])
      if (!metricsRes.ok) throw new Error(`Metrics failed: ${metricsRes.status}`)
      if (!creatorsRes.ok) throw new Error(`Creators failed: ${creatorsRes.status}`)
      if (!briefsRes.ok) throw new Error(`Briefs failed: ${briefsRes.status}`)
      setMetrics(await metricsRes.json())
      const { creators } = await creatorsRes.json()
      const { briefs } = await briefsRes.json()
      setCreators(creators)
      setBriefs(briefs.filter((b: BriefLite) => b.status === 'active'))
      if (adsRes.ok) setAds((await adsRes.json()).ads || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // The races we sell, live from Shopify, for picking a sample's race.
  useEffect(() => {
    apiFetch('/api/creators/catalog').then(r => r.ok ? r.json() : { products: [] }).then(d => setCatalog(d.products || [])).catch(() => setCatalog([]))
  }, [])

  const applicants = creators.filter(isApplicant)
  // Default to the applicants while any are waiting; otherwise the active list.
  const view: CreatorsView = viewParam && viewParam in VIEW_LABEL ? viewParam : applicants.length ? 'applied' : 'active'
  const setView = (v: CreatorsView) => setSearchParams(v === (applicants.length ? 'applied' : 'active') ? {} : { view: v }, { replace: true })

  const selected = creatorId ? creators.find(c => c.id === creatorId) || null : null
  const openCreator = (c: Creator) => navigate({ pathname: `/creators/${c.id}`, search: searchParams.toString() })
  const closeCreator = useCallback(() => navigate({ pathname: '/creators', search: searchParams.toString() }), [navigate, searchParams])

  useEffect(() => {
    if (!creatorId) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) closeCreator()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [creatorId, closeCreator])

  // Search across name, email, Instagram, race and sample order number.
  const q = query.trim().toLowerCase().replace(/^@/, '')
  const matches = (c: Creator) => !q || [c.name, c.email, c.instagramHandle, c.raceName, c.sampleOrder?.orderNumber]
    .some(v => String(v || '').toLowerCase().includes(q))
  const inView: Record<CreatorsView, Creator[]> = {
    applied: applicants,
    active: creators.filter(c => !isApplicant(c) && c.status !== 'denied'),
    all: creators,
    denied: creators.filter(c => c.status === 'denied'),
  }
  const counts = { applied: inView.applied.length, active: inView.active.length, all: inView.all.length, denied: inView.denied.length }
  // A search reaches past the queue, so a name is found wherever it is.
  const list = (q ? creators : inView[view]).filter(matches)

  const handleDeclineSample = async (creator: Creator) => {
    if (!arm(`decline:${creator.id}`)) return
    setDecliningId(creator.id)
    try {
      const res = await apiFetch('/api/creators/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline-creator-sample', creatorId: creator.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Decline failed: ${res.status}`)
      }
      await loadAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to decline')
    } finally {
      setDecliningId(null)
    }
  }

  const handleApproveSample = async (creator: Creator) => {
    setApprovingId(creator.id)
    try {
      const res = await apiFetch('/api/creators/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve-creator-sample', creatorId: creator.id }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Approve failed: ${res.status}`)
      }
      const out = await res.json().catch(() => ({}))
      toast.success(`Approved. Sample ${out.orderNumber || ''} sent as a free Shopify order.`.replace('  ', ' '))
      await loadAll()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to approve')
    } finally {
      setApprovingId(null)
    }
  }

  const decide = (c: Creator) => isApplicant(c) ? (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); handleDeclineSample(c) }}
        disabled={decliningId === c.id || approvingId === c.id}
        className={btnSecondary}
        title="Marked denied and no sample is made. You can un-deny them later from the Denied view."
      >
        {decliningId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />} {isArmed(`decline:${c.id}`) ? 'Click again to decline' : 'Decline'}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleApproveSample(c) }}
        disabled={approvingId === c.id || decliningId === c.id}
        className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-40 whitespace-nowrap"
      >
        {approvingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
      </button>
    </div>
  ) : null

  const statsLine = metrics && (
    <span className="text-xs text-off-black/50 whitespace-nowrap">
      {metrics.creators.appliedThisMonth} new this month · {metrics.samples.total} samples{metrics.samples.costEstimatedUsd != null ? ` · ${formatUsd(metrics.samples.costEstimatedUsd)} spent` : ''}
    </span>
  )

  return (
    <div className={pageShell}>
      <div className="px-3 md:px-5 w-full flex flex-col h-full">
        {!selected && (
          <PageHeader
            title="Creators"
            subtitle={statsLine}
            pill={applicants.length ? `${applicants.length} applied` : undefined}
            control={
              <select value={view} onChange={e => setView(e.target.value as CreatorsView)} className="text-xs font-medium bg-white border border-border-gray rounded-full pl-3 pr-7 py-1.5 appearance-none">
                {(Object.keys(VIEW_LABEL) as CreatorsView[]).map(k => <option key={k} value={k}>{VIEW_LABEL[k]} ({counts[k]})</option>)}
              </select>
            }
          />
        )}
        <div className="pt-4 md:pt-5 pb-3 hidden md:flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
            <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Creators</h1>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />}
          </div>
          <div className="flex-1 flex items-center justify-end gap-2 md:gap-3 min-w-0">
            {tab === 'creators' && <div className="relative flex-1 max-w-[640px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-off-black/40" />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); if (selected) closeCreator() }}
                placeholder="Search by name, email, Instagram, race or order #"
                className="w-full pl-9 pr-8 py-2 bg-white border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30"
              />
              {query && <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-off-black/40 hover:text-off-black"><X className="w-3.5 h-3.5" /></button>}
            </div>}
            <CreatorsTabs active={tab} />
            <button onClick={() => setShowInvite(true)} className="inline-flex items-center gap-1.5 px-3 py-2 bg-dark-fill text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity whitespace-nowrap">
              <Plus className="w-4 h-4" /> New invite
            </button>
          </div>
        </div>

        {error && !isLoading && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 mb-3 text-sm text-red-800 flex-shrink-0">{error}</div>
        )}

        {selected ? (
          <div className="flex-1 min-h-0 overflow-y-auto pb-36 md:pb-8">
            <CreatorDetail
              key={selected.id}
              creator={selected}
              onBack={closeCreator}
              decide={decide(selected)}
              catalog={catalog}
              onChanged={loadAll}
              onDeleted={async () => { closeCreator(); await loadAll() }}
            />
          </div>
        ) : creatorId && isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-off-black/30" /></div>
        ) : tab === 'ads' ? (
          <section className="flex-1 min-h-0 pb-3">
            <div className="h-full bg-white border border-border-gray rounded-lg shadow-sm overflow-y-auto">
              <WinningAdsPanel ads={ads} onChanged={loadAll} />
            </div>
          </section>
        ) : (
          <section className="flex-1 min-h-0 pb-3">
            <div className="h-full bg-white border border-border-gray rounded-lg shadow-sm overflow-hidden flex flex-col">
              {/* The queues, with the program's numbers on the right. */}
              <div className="hidden md:flex items-center justify-between gap-3 px-3 py-2.5 border-b border-border-gray flex-shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto">
                  {(Object.keys(VIEW_LABEL) as CreatorsView[]).map(k => (
                    <button
                      key={k}
                      onClick={() => setView(k)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${view === k && !q ? 'bg-dark-fill text-white' : 'text-off-black/70 hover:bg-subtle-gray'}`}
                    >
                      {VIEW_LABEL[k]}
                      <span className={`text-xs ${view === k && !q ? 'text-white/70' : k === 'applied' && counts.applied ? 'text-amber-700 font-semibold' : 'text-off-black/40'}`}>{counts[k]}</span>
                    </button>
                  ))}
                </div>
                {statsLine}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-off-black/30" /></div>
                ) : list.length === 0 ? (
                  <div className="text-center py-20 px-6 text-sm text-off-black/50">
                    {q ? `No creators match "${query}".` : view === 'applied' ? 'No one is waiting on a decision.' : 'Nobody here yet.'}
                  </div>
                ) : (
                  <ul className="divide-y divide-border-gray">
                    {list.map(c => <CreatorRow key={c.id} c={c} onOpen={() => openCreator(c)} decide={decide(c)} />)}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {showInvite && (
        <InviteModal
          briefs={briefs}
          onClose={() => setShowInvite(false)}
          onCreated={async () => {
            await loadAll()
          }}
        />
      )}
    </div>
  )
}

/** One creator in the list. Applicants show their pitch and the decision buttons. */
function CreatorRow({ c, onOpen, decide }: { c: Creator; onOpen: () => void; decide: React.ReactNode }) {
  const statusCfg = STATUS_CONFIG[c.status]
  const sample = sampleStatusLabel(c.sampleOrder?.status)
  const content = CONTENT_STATUS_CONFIG[c.contentStatus] || CONTENT_STATUS_CONFIG.not_received
  const race = c.raceName ? `${c.raceName}${c.raceYear ? ` ${c.raceYear}` : ''}` : null
  const facts = [race, c.productSize && c.frameType ? `${c.productSize} ${c.frameType}` : null, c.shippingCity && c.shippingState ? `${c.shippingCity}, ${c.shippingState}` : null].filter(Boolean)
  return (
    <li onClick={onOpen} className="px-4 py-3.5 hover:bg-subtle-gray cursor-pointer transition-colors flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-off-black">{c.name || <span className="text-off-black/40 italic font-normal">Not yet onboarded</span>}</span>
          {c.instagramHandle && (
            <span className="inline-flex items-center gap-1 text-xs text-off-black/50"><Instagram className="w-3 h-3" />{socialHandle(c.instagramHandle)}</span>
          )}
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${statusCfg.bg} ${statusCfg.color}`}>{statusCfg.label}</span>
        </div>
        {facts.length > 0 && <div className="text-xs text-off-black/55 mt-1">{facts.join(' · ')}</div>}
        {isApplicant(c) && c.whyWorkWithUs && (
          <p className="text-xs text-off-black/70 mt-1.5 leading-relaxed line-clamp-2 max-w-[90ch]">{c.whyWorkWithUs}</p>
        )}
      </div>
      {decide || (
        <div className="flex items-center gap-4 text-xs shrink-0">
          <span className={sample.color}>{sample.label}</span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium ${content.bg} ${content.color}`}>{content.label}</span>
          <span className="text-off-black/40 hidden lg:inline w-24 text-right">{new Date(c.invitedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      )}
    </li>
  )
}

/**
 * Ads that are working, so the team and the creators can see what to make
 * more of. Creators see the same list in their portal. Also holds the links
 * creators need: Trybe, and the community once it exists.
 */
function WinningAdsPanel({ ads, onChanged }: { ads: WinningAd[]; onChanged: () => void | Promise<void> }) {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ title: '', url: '', imageUrl: '', notes: '' })
  const { arm, isArmed } = useArmed()
  const field = 'w-full px-3 py-2 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-off-black/10'

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await apiFetch('/api/creators/ads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not add the ad')
      setF({ title: '', url: '', imageUrl: '', notes: '' }); setAdding(false)
      await onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add the ad') } finally { setBusy(false) }
  }
  const remove = async (ad: WinningAd) => {
    if (!arm(`remove:${ad.id}`)) return
    const res = await apiFetch(`/api/creators/ads?id=${encodeURIComponent(ad.id)}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Could not remove the ad'); return }
    await onChanged()
  }

  return (
    <div className="p-4 md:p-5 space-y-5">
      <div className="grid md:grid-cols-2 gap-3">
        <a href={TRYBE_URL} target="_blank" rel="noopener noreferrer" className="group border border-border-gray rounded-md p-4 hover:bg-subtle-gray transition-colors">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-off-black">Trybe <ExternalLink className="w-3.5 h-3.5 text-off-black/40" /></div>
          <p className="text-xs text-off-black/55 mt-1">Where creators upload content, do revisions and get it into our ad account. Creators sign up at jointrybe.com.</p>
        </a>
        <div className="border border-dashed border-border-gray rounded-md p-4" title="Link coming once the community is live">
          <div className="flex items-center gap-2 text-sm font-semibold text-off-black/50">Community <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/45 text-[10px] font-medium rounded uppercase tracking-wider">Coming soon</span></div>
          <p className="text-xs text-off-black/45 mt-1">Where creators will learn more about which ads are working.</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className={sectionLabel}>Winning ads <span className="text-off-black/30">({ads.length})</span></h2>
          {!adding && <button onClick={() => setAdding(true)} className={btnSecondary}><Plus className="w-3.5 h-3.5" /> Add winning ad</button>}
        </div>
        {adding && (
          <div className="border border-border-gray rounded-md p-4 mb-4 space-y-2.5 bg-subtle-gray/50">
            <div className="grid md:grid-cols-2 gap-2.5">
              <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Title, e.g. Chicago unboxing, POV hook" className={field} autoFocus />
              <input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="Link to the ad or video" className={field} />
            </div>
            <input value={f.imageUrl} onChange={e => setF({ ...f, imageUrl: e.target.value })} placeholder="Thumbnail image link (optional)" className={field} />
            <textarea value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} rows={3} placeholder="Why it works: the hook, the angle, the numbers (optional)" className={`${field} resize-none`} />
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={busy || !f.title.trim() || !f.url.trim()} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-dark-fill text-white rounded-md disabled:opacity-50">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add
              </button>
              <button onClick={() => { setAdding(false); setErr(null) }} className="px-3 py-2 text-sm text-off-black/60">Cancel</button>
            </div>
            <p className="text-[11px] text-off-black/45">Creators see these in their portal.</p>
          </div>
        )}
        {ads.length === 0 && !adding ? (
          <div className="border border-dashed border-border-gray rounded-md p-8 text-center text-sm text-off-black/50">No winning ads yet. Add the first one so creators can see what works.</div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ads.map(ad => (
              <div key={ad.id} className="border border-border-gray rounded-md overflow-hidden bg-white flex flex-col">
                {ad.imageUrl && (
                  <a href={ad.url} target="_blank" rel="noopener noreferrer" className="block aspect-[4/5] bg-subtle-gray">
                    <img src={ad.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </a>
                )}
                <div className="p-3 flex-1 flex flex-col gap-1.5">
                  <a href={ad.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-off-black hover:text-[#4F2DD4] inline-flex items-center gap-1">
                    {ad.title} <ExternalLink className="w-3 h-3 text-off-black/40" />
                  </a>
                  {ad.notes && <p className="text-xs text-off-black/65 whitespace-pre-wrap leading-relaxed">{ad.notes}</p>}
                  <div className="mt-auto pt-1 flex items-center justify-between text-[11px] text-off-black/40">
                    <span>{new Date(ad.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    <button onClick={() => remove(ad)} className={isArmed(`remove:${ad.id}`) ? 'text-red-600' : 'hover:text-red-600'}>{isArmed(`remove:${ad.id}`) ? 'Click again: creators stop seeing it' : 'Remove'}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InviteModal — generate a fresh creator invite with optional briefs
// ---------------------------------------------------------------------------
function InviteModal({ briefs, onClose, onCreated }: {
  briefs: BriefLite[]
  onClose: () => void
  onCreated: () => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [instagram, setInstagram] = useState('')
  const [selectedBriefIds, setSelectedBriefIds] = useState<Set<string>>(new Set())
  const [isCreating, setIsCreating] = useState(false)
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)

  const toggleBrief = (id: string) => {
    setSelectedBriefIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreate = async () => {
    setIsCreating(true)
    try {
      const res = await apiFetch('/api/creators/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-creator-invite',
          name: name.trim() || null,
          email: email.trim() || null,
          instagramHandle: instagram.trim() || null,
          briefIds: Array.from(selectedBriefIds),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Create failed: ${res.status}`)
      }
      const { creator } = await res.json()
      const url = `${window.location.origin}/creator/${creator.inviteToken}`
      setCreatedLink(url)
      // Auto-copy so Matt can paste right into a DM
      try {
        await navigator.clipboard.writeText(url)
        setLinkCopied(true)
      } catch {
        // Clipboard may not be available — fall through; user can copy manually
      }
      await onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create invite')
    } finally {
      setIsCreating(false)
    }
  }

  const handleCopy = async () => {
    if (!createdLink) return
    try {
      await navigator.clipboard.writeText(createdLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1500)
    } catch {
      // Silent fallback
    }
  }

  return (
    <div
      className="fixed inset-0 bg-off-black/60 flex items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-md max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-semibold text-off-black">
              {createdLink ? 'Invite ready' : 'New Creator Invite'}
            </h3>
            <button onClick={onClose} className="text-off-black/40 hover:text-off-black">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* After-create view: show the link, copy affordance */}
          {createdLink ? (
            <div>
              <p className="text-sm text-off-black/70 mb-3">
                Send this link to the creator - it takes them to the onboarding wizard.
                {linkCopied && ' Already copied to your clipboard.'}
              </p>
              <div className="flex items-center gap-2 mb-5">
                <code className="flex-1 text-xs text-off-black/80 bg-subtle-gray px-2 py-2 rounded border border-border-gray truncate">
                  {createdLink}
                </code>
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 text-xs font-medium bg-white border border-border-gray rounded hover:bg-off-black/5 transition-colors inline-flex items-center gap-1"
                >
                  {linkCopied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                </button>
              </div>
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-dark-fill text-white text-sm font-medium rounded hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          ) : (
            // Pre-create form
            <>
              <p className="text-xs text-off-black/50 mb-4">
                All fields optional except briefs. You can fill these in later from the creator drawer.
              </p>

              <div className="space-y-3.5">
                <div>
                  <div className="text-xs text-off-black/60 mb-1">Name</div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Creator's name (optional)"
                    className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                    autoFocus
                  />
                </div>
                <div>
                  <div className="text-xs text-off-black/60 mb-1">Email</div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="optional"
                    className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                  />
                </div>
                <div>
                  <div className="text-xs text-off-black/60 mb-1">Instagram</div>
                  <input
                    type="text"
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="@handle (optional)"
                    className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                  />
                </div>

                <div>
                  <div className="text-xs text-off-black/60 mb-2">
                    Assign Briefs <span className="text-off-black/40">(optional)</span>
                  </div>
                  {briefs.length === 0 ? (
                    <div className="text-xs text-off-black/40 italic bg-subtle-gray border border-dashed border-border-gray rounded p-3">
                      No active briefs yet - you can <Link to="/briefs" className="underline">create one</Link> first, or skip and assign later.
                    </div>
                  ) : (
                    <div className="space-y-1 max-h-44 overflow-y-auto border border-border-gray rounded p-2">
                      {briefs.map(b => (
                        <label
                          key={b.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-subtle-gray cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedBriefIds.has(b.id)}
                            onChange={() => toggleBrief(b.id)}
                            className="w-4 h-4"
                          />
                          <span className="text-sm text-off-black">{b.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border-gray">
                <button onClick={onClose} className="px-4 py-2 text-sm text-off-black/60 hover:bg-off-black/5 rounded transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={isCreating}
                  className="px-4 py-2 bg-dark-fill text-white text-sm font-medium rounded hover:opacity-90 disabled:opacity-40 transition-opacity inline-flex items-center gap-2"
                >
                  {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isCreating ? 'Creating…' : 'Generate Invite Link'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CreatorDetail: one creator, laid out like an order. Content, samples and
// statuses on the left; profile, race and shipping on the right. Every card
// saves itself, so there is no page-wide Save.
// ---------------------------------------------------------------------------
interface CatalogRace { race: string; edition: string | null; label: string; title: string; image: string | null }

interface SampleOrder {
  orderNumber: string
  status: string
  raceName: string | null
  raceYear: number | null
  productSize: string | null
  frameType: string | null
  createdAt: string
  trackingNumber: string | null
  trackingCarrier: string | null
  shippedAt: string | null
  /** Sent as a Shopify order, not imported into the queue yet. */
  pending?: boolean
  shopifyUrl?: string | null
  arteloUrl?: string | null
  fulfillmentPath?: string | null
}

const SIZES = ['8x10', '12x18', '16x24']
const FRAMES = ['Black Oak', 'Natural Oak', 'Unframed']
const fieldCls = 'w-full px-3 py-2 text-sm border border-border-gray rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-off-black/10'

function CreatorDetail({ creator, onBack, decide, onChanged, onDeleted, catalog }: {
  creator: Creator
  onBack: () => void
  /** Approve and Decline, for an applicant. */
  decide?: React.ReactNode
  onChanged: () => void | Promise<void>
  onDeleted: () => void | Promise<void>
  catalog: CatalogRace[] | null
}) {
  const [samples, setSamples] = useState<SampleOrder[] | null>(null)
  const [copied, setCopied] = useState(false)
  const [notes, setNotes] = useState(creator.notes || '')
  const [link, setLink] = useState('')
  const { arm, isArmed } = useArmed()
  const statusCfg = STATUS_CONFIG[creator.status]
  const portalUrl = `${window.location.origin}/creator/${creator.inviteToken}`
  const links = (creator.bestContentLinks || '').split(/\s+/).map(s => s.trim()).filter(Boolean)

  const loadSamples = useCallback(async () => {
    const res = await apiFetch(`/api/creators/samples?creatorId=${encodeURIComponent(creator.id)}`)
    if (res.ok) setSamples((await res.json()).samples || [])
  }, [creator.id])
  useEffect(() => { loadSamples() }, [loadSamples])

  const save = async (updates: Partial<Creator>) => {
    const res = await apiFetch('/api/creators/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update-creator', creatorId: creator.id, updates }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Could not save')
    }
    await onChanged()
  }
  const saveQuietly = (updates: Partial<Creator>) => save(updates).catch(e => toast.error(e instanceof Error ? e.message : 'Could not save'))

  const remove = async () => {
    if (!arm('delete')) return
    const res = await apiFetch('/api/creators/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-creator', creatorId: creator.id }),
    })
    if (!res.ok) { const err = await res.json().catch(() => ({})); toast.error(err.error || 'Could not delete'); return }
    await onDeleted()
  }

  const copyPortal = async () => {
    try { await navigator.clipboard.writeText(portalUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="bg-white border border-border-gray rounded-md w-full">
      {/* Header, as on an order: back, status, name, and the decision for an applicant. */}
      <div className="sticky top-0 z-30 px-4 md:px-6 py-3 md:py-4 bg-white/95 backdrop-blur border-b border-border-gray rounded-t-md flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button onClick={onBack} title="Back to creators (Esc)" className="inline-flex items-center gap-1 -ml-1 px-1.5 py-1 text-off-black/60 hover:text-off-black hover:bg-off-black/5 rounded transition-colors">
            <ChevronLeft className="w-5 h-5 md:w-4 md:h-4" />
            <span className="text-sm hidden md:inline">Creators</span>
          </button>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.bg} ${statusCfg.color}`}>{statusCfg.label}</span>
          <h3 className="text-lg md:text-xl font-semibold text-off-black truncate">{creator.name || 'Pending creator'}</h3>
          {creator.instagramHandle && (
            <a href={socialUrl('instagram', creator.instagramHandle) || '#'} target="_blank" rel="noopener noreferrer" className="hidden md:inline-flex items-center gap-1 text-sm text-off-black/50 hover:text-[#4F2DD4]">
              <Instagram className="w-3.5 h-3.5" />{socialHandle(creator.instagramHandle)}
            </a>
          )}
        </div>
        {decide}
      </div>

      <div className="p-4 md:p-6 grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
        {/* Left: where they stand, their content, their samples. */}
        <div className="space-y-5 min-w-0">
          <div className="grid sm:grid-cols-2 gap-3">
            <StatusSelect<CreatorStatus>
              label="Program"
              value={creator.status}
              onChange={(v) => saveQuietly({ status: v })}
              options={['invited', 'applied', 'active', 'paused', 'denied']}
              config={STATUS_CONFIG}
            />
            <StatusSelect<ContentStatus>
              label="Content"
              value={creator.contentStatus}
              onChange={(v) => saveQuietly({ contentStatus: v })}
              options={['not_received', 'received', 'edited', 'posted']}
              config={CONTENT_STATUS_CONFIG}
            />
          </div>

          <Card title="Content" right={<a href={TRYBE_URL} target="_blank" rel="noopener noreferrer" className={textLink}>Trybe <ExternalLink className="w-3 h-3" /></a>}>
            {links.length === 0 ? (
              <p className="text-sm text-off-black/45">No content yet. Paste links to their videos as they come in.</p>
            ) : (
              <ul className="space-y-1.5">
                {links.map(l => (
                  <li key={l} className="flex items-center justify-between gap-2 text-sm">
                    <a href={/^https?:\/\//.test(l) ? l : `https://${l}`} target="_blank" rel="noopener noreferrer" className="text-off-black hover:text-[#4F2DD4] hover:underline truncate">{l}</a>
                    <button onClick={() => saveQuietly({ bestContentLinks: links.filter(x => x !== l).join('\n') || null })} className="text-off-black/30 hover:text-red-600 shrink-0" title="Remove"><X className="w-3.5 h-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
            <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (!link.trim()) return; saveQuietly({ bestContentLinks: [...links, link.trim()].join('\n') }); setLink('') }}>
              <input value={link} onChange={e => setLink(e.target.value)} placeholder="Paste a link to a video" className={fieldCls} />
              <button type="submit" disabled={!link.trim()} className={btnSecondary}><Plus className="w-3.5 h-3.5" /> Add</button>
            </form>
          </Card>

          {(creator.whyWorkWithUs || (creator.briefAssignments?.length ?? 0) > 0) && (
            <Card title="Application">
              {creator.whyWorkWithUs && <p className="text-sm text-off-black/80 whitespace-pre-wrap leading-relaxed">{creator.whyWorkWithUs}</p>}
              {(creator.briefAssignments?.length ?? 0) > 0 && (
                <div className={creator.whyWorkWithUs ? 'mt-3 pt-3 border-t border-border-gray' : ''}>
                  <div className={cardLabel}>Briefs</div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {creator.briefAssignments!.map(a => <span key={a.brief.id} className="px-2 py-1 bg-off-black/5 text-off-black/70 text-xs rounded">{a.brief.title}</span>)}
                  </div>
                </div>
              )}
            </Card>
          )}

          <EditCard
            title="Requested print (from their application)"
            creator={creator}
            onSave={save}
            catalog={catalog}
            fields={[
              { key: 'productTitle', label: 'Print', kind: 'print', display: v => catalog?.find(c => c.title === v)?.label || v },
              { key: 'raceYear', label: 'Year' },
              { key: 'bibNumber', label: 'Bib' },
              { key: 'finishTime', label: 'Time' },
              { key: 'productSize', label: 'Size', options: SIZES },
              { key: 'frameType', label: 'Frame', options: FRAMES },
            ]}
          />
          <Card title="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => { if (notes !== (creator.notes || '')) saveQuietly({ notes: notes || null }) }}
              rows={3}
              placeholder="Anything worth remembering about this creator. Saves when you click away."
              className={`${fieldCls} resize-y`}
            />
          </Card>
        </div>

        {/* Right: who they are and where things go. */}
        <div className="space-y-4">
          <EditCard
            title="Profile"
            creator={creator}
            onSave={save}
            fields={[
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email', href: v => `mailto:${v}` },
              { key: 'instagramHandle', label: 'Instagram', display: socialHandle, href: v => socialUrl('instagram', v) },
              { key: 'tiktokHandle', label: 'TikTok', display: socialHandle, href: v => socialUrl('tiktok', v) },
            ]}
          />
          {/* Every sample they have had, each with where to open it. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className={sectionLabel}>Samples{samples?.length ? ` (${samples.length})` : ''}</h4>
            </div>
            <div className={infoCard}>
              {samples === null ? (
                <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />
              ) : samples.length === 0 ? (
                <p className="text-sm text-off-black/45">No sample sent yet.</p>
              ) : (
                <ul className="divide-y divide-border-gray -my-2">
                  {samples.map(s => {
                    const st = s.pending ? { label: 'Sent to Shopify', color: 'text-blue-700' } : s.shippedAt || s.trackingNumber ? { label: 'Shipped', color: 'text-emerald-700' } : sampleStatusLabel(s.status)
                    return (
                      <li key={s.orderNumber} className="py-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-off-black truncate">{s.raceName}{s.raceYear ? ` ${s.raceYear}` : ''}</div>
                            <div className="text-xs text-off-black/50">{[s.productSize, s.frameType].filter(v => v && v !== '-').join(' · ')} · #{s.orderNumber} · {new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                          </div>
                          <span className={`text-xs font-medium shrink-0 ${st.color}`}>{st.label}</span>
                        </div>
                        {s.trackingNumber && <div className="text-[11px] text-off-black/45 font-mono mt-0.5">{s.trackingCarrier ? `${s.trackingCarrier} ` : ''}{s.trackingNumber}</div>}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {s.shopifyUrl && <a href={s.shopifyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border-gray bg-white text-[11px] text-off-black/75 hover:border-off-black/30"><img src="/shopify-icon.png" alt="" className="w-3 h-3" />Shopify</a>}
                          {s.arteloUrl && <a href={s.arteloUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border-gray bg-white text-[11px] text-off-black/75 hover:border-off-black/30"><img src="/artelo-icon.png" alt="" className="w-3 h-3 rounded-[2px]" />Artelo</a>}
                          {s.fulfillmentPath && <Link to={s.fulfillmentPath} className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border-gray bg-white text-[11px] text-off-black/75 hover:border-off-black/30"><img src="/trackstar-stars-transparent.png" alt="" className="w-3 h-3 object-contain" />Fulfillment</Link>}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {creator.status !== 'denied' && !isApplicant(creator) && (
                <SendSample creator={creator} catalog={catalog} hasSample={!!samples?.length} onDone={async () => { await loadSamples(); await onChanged() }} />
              )}
            </div>
          </div>

          <EditCard
            title="Shipping"
            creator={creator}
            onSave={save}
            note="Changes also go onto their sample order, so it ships to the new address."
            fields={[
              { key: 'shippingName', label: 'Recipient' },
              { key: 'shippingAddress1', label: 'Address' },
              { key: 'shippingAddress2', label: 'Apt / suite' },
              { key: 'shippingCity', label: 'City' },
              { key: 'shippingState', label: 'State' },
              { key: 'shippingZip', label: 'ZIP' },
              { key: 'shippingCountry', label: 'Country' },
            ]}
          />

          <div>
            <div className={sectionLabel}>Actions</div>
            <div className="mt-2 flex flex-col items-start gap-2">
              <button onClick={copyPortal} className={textLink}>{copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy their portal link'}</button>
              <a href={portalUrl} target="_blank" rel="noopener noreferrer" className={textLink}><ExternalLink className="w-3.5 h-3.5" /> Open their portal</a>
              {creator.email && <a href={`mailto:${creator.email}`} className={textLink}><Mail className="w-3.5 h-3.5" /> Email them</a>}
              <button onClick={remove} className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"><X className="w-3.5 h-3.5" /> {isArmed('delete')
                ? `Click again to delete for good${creator.sampleOrder && !creator.sampleOrder.shippedAt && creator.sampleOrder.status !== 'completed' ? `, with unshipped sample ${creator.sampleOrder.orderNumber}` : ''}`
                : 'Delete creator'}</button>
            </div>
            <p className="text-[11px] text-off-black/40 mt-3">
              Invited {new Date(creator.invitedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {creator.onboardedAt && ` · applied ${new Date(creator.onboardedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className={sectionLabel}>{title}</h4>
        {right}
      </div>
      <div className={infoCard}>{children}</div>
    </div>
  )
}

type EditField = {
  key: keyof Creator
  label: string
  kind?: 'race' | 'print'
  options?: string[]
  display?: (v: string | null) => string | null
  href?: (v: string) => string | null
}

/** A card of fields that shows values and edits in place, saving just its own fields. */
function EditCard({ title, creator, fields, onSave, note, catalog }: {
  title: string
  creator: Creator
  fields: EditField[]
  onSave: (updates: Partial<Creator>) => Promise<void>
  note?: string
  catalog?: CatalogRace[] | null
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const start = () => { setDraft(Object.fromEntries(fields.map(f => [f.key, creator[f.key] == null ? '' : String(creator[f.key])]))); setEditing(true) }
  const submit = async () => {
    setBusy(true)
    try {
      const updates = Object.fromEntries(fields.map(f => [f.key, draft[f.key as string]?.trim() || null])) as Partial<Creator>
      // Picking a print also sets its race.
      if (fields.some(f => f.kind === 'print') && draft.raceName) updates.raceName = draft.raceName
      await onSave(updates)
      setEditing(false)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className={sectionLabel}>{title}</h4>
        {!editing && <button onClick={start} className={textLink}><Pencil className="w-3 h-3" /> Edit</button>}
      </div>
      <div className={infoCard}>
        {editing ? (
          <div className="space-y-2">
            {note && <p className="text-[11px] text-off-black/50">{note}</p>}
            {fields.map(f => {
              const v = draft[f.key as string] ?? ''
              const set = (val: string) => setDraft(d => ({ ...d, [f.key]: val }))
              return (
                <label key={f.key as string} className="block">
                  <span className={cardLabel}>{f.label}</span>
                  {f.kind === 'print' ? (
                    <PrintPicker value={v || null} options={catalog || null} onChange={(c: CatalogRace) => setDraft(d => ({ ...d, productTitle: c.title, raceName: c.race }))} />
                  ) : f.kind === 'race' ? (
                    <RacePicker value={v} onChange={set} catalog={catalog || null} />
                  ) : f.options ? (
                    <select value={v} onChange={e => set(e.target.value)} className={fieldCls}>
                      <option value="">-</option>
                      {[...new Set([...f.options, ...(v && !f.options.includes(v) ? [v] : [])])].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input value={v} onChange={e => set(e.target.value)} className={fieldCls} />
                  )}
                </label>
              )
            })}
            <div className="flex gap-2 pt-1">
              <button onClick={submit} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-dark-fill text-white rounded-md disabled:opacity-50">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save
              </button>
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-off-black/60">Cancel</button>
            </div>
          </div>
        ) : (
          <dl className="space-y-1.5">
            {fields.map(f => {
              const raw = creator[f.key] == null || creator[f.key] === '' ? null : String(creator[f.key])
              const text = raw && f.display ? f.display(raw) : raw
              const href = raw && f.href ? f.href(raw) : null
              return (
                <div key={f.key as string} className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-off-black/50 text-xs shrink-0">{f.label}</dt>
                  <dd className="text-right min-w-0 break-words">
                    {!text ? <span className="text-off-black/30">-</span>
                      : href ? <a href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer" className="text-off-black hover:text-[#4F2DD4] hover:underline">{text}</a>
                      : <span className="text-off-black">{text}</span>}
                  </dd>
                </div>
              )
            })}
          </dl>
        )}
      </div>
    </div>
  )
}

/** Pick a race from the live Shopify catalog. A race not in the catalog stays selectable so old records still show. */
function RacePicker({ value, onChange, catalog }: { value: string; onChange: (v: string) => void; catalog: CatalogRace[] | null }) {
  if (!catalog) return <div className={`${fieldCls} text-off-black/40 inline-flex items-center gap-2`}><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading races from Shopify</div>
  const races = [...new Set(catalog.map(c => c.race))]
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={fieldCls}>
      <option value="">Choose a race</option>
      {value && !races.includes(value) && <option value={value}>{value} (not in the store)</option>}
      {races.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

/**
 * Send a creator a sample: the first one or another (a second race, a
 * reshoot, a replacement). Goes into the Standard queue as CREATOR-XXXXXX
 * (then -2, -3...), to the address on file. Server: api/creators/sample.js.
 */
function SendSample({ creator, catalog, hasSample, onDone }: { creator: Creator; catalog: CatalogRace[] | null; hasSample: boolean; onDone: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const blank = () => ({
    raceName: hasSample ? '' : creator.raceName || '',
    raceYear: String(hasSample ? new Date().getFullYear() : creator.raceYear || new Date().getFullYear()),
    bibNumber: hasSample ? '' : creator.bibNumber || '',
    finishTime: hasSample ? '' : creator.finishTime || '',
    productSize: creator.productSize || '12x18',
    frameType: creator.frameType || 'Black Oak',
  })
  const [f, setF] = useState(blank)
  // The exact print; starts on their requested race's standard edition.
  const [product, setProduct] = useState<CatalogRace | null>(null)
  useEffect(() => { if (!product && catalog && f.raceName) setProduct((!hasSample && catalog.find(c => c.title === creator.productTitle)) || catalog.find(c => c.race === f.raceName && !c.edition) || catalog.find(c => c.race === f.raceName) || null) }, [catalog, f.raceName, product, hasSample, creator.productTitle])
  const inCatalog = !!product
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await apiFetch('/api/creators/sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creatorId: creator.id, ...f, raceName: product!.race, productTitle: product!.title, raceYear: Number(f.raceYear) }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `Could not create the sample (server said ${res.status})`)
      setOpen(false)
      await onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not create the sample') } finally { setBusy(false) }
  }
  if (!open) {
    return (
      <button onClick={() => { setF(blank()); setProduct(null); setOpen(true) }} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border border-dashed border-border-gray rounded-md text-off-black/70 bg-white hover:bg-subtle-gray">
        <Plus className="w-3.5 h-3.5" /> {hasSample ? 'Send another sample' : 'Send a sample'}
      </button>
    )
  }
  return (
    <div className="mt-3 border border-border-gray rounded-md p-3 space-y-2.5 bg-white">
      <div className={cardLabel}>{hasSample ? 'Another sample' : 'New sample'}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 sm:col-span-1"><PrintPicker value={product?.title || null} onChange={(p: CatalogRace) => setProduct(p)} options={catalog} /></div>
        <input value={f.raceYear} onChange={e => setF({ ...f, raceYear: e.target.value })} placeholder="Year" inputMode="numeric" className={`${fieldCls} col-span-2 sm:col-span-1`} />
        <input value={f.bibNumber} onChange={e => setF({ ...f, bibNumber: e.target.value })} placeholder="Bib # (optional)" className={fieldCls} />
        <input value={f.finishTime} onChange={e => setF({ ...f, finishTime: e.target.value })} placeholder="Finish time (optional)" className={fieldCls} />
        <select value={f.productSize} onChange={e => setF({ ...f, productSize: e.target.value })} className={fieldCls}>{SIZES.map(s => <option key={s}>{s}</option>)}</select>
        <select value={f.frameType} onChange={e => setF({ ...f, frameType: e.target.value })} className={fieldCls}>{FRAMES.map(s => <option key={s}>{s}</option>)}</select>
      </div>
      <p className="text-[11px] text-off-black/50">Sent as a free Shopify order to the address on file: they get Shopify's order emails and Artelo makes it like any order.</p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || !inCatalog || !/^\d{4}$/.test(f.raceYear)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-dark-fill text-white rounded-md disabled:opacity-50">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create sample
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-off-black/60">Cancel</button>
      </div>
    </div>
  )
}

// Normalize a social input (handle or URL) into a clickable URL.
// Accepts: "@handle", "handle", "https://instagram.com/handle", "instagram.com/handle"
function socialUrl(platform: 'instagram' | 'tiktok', raw: string | null): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return v
  const handle = v.replace(/^@/, '').replace(/^.*\.com\//i, '').replace(/\/$/, '')
  if (!handle) return null
  return platform === 'tiktok'
    ? `https://www.tiktok.com/@${handle.replace(/^@/, '')}`
    : `https://www.instagram.com/${handle}`
}

// Extract a friendly display handle from either a raw handle or a full URL.
function socialHandle(raw: string | null): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (!v) return null
  if (!/^https?:\/\//i.test(v)) return v
  // Pull the trailing path segment from a URL — e.g. /_butch.82/ → @_butch.82
  const match = v.match(/\/(@?[^/?]+)\/?(?:[?#].*)?$/)
  if (!match) return v
  const seg = match[1].replace(/^@/, '')
  return `@${seg}`
}

// Color-tinted dropdown — background reflects the currently selected value.
// Used for the Program + Content status pickers at the top of the drawer so
// a glance tells you both states without having to read labels.
function StatusSelect<T extends string>({
  label, value, onChange, options, config,
}: {
  label: string
  value: T
  onChange: (v: T) => void
  options: T[]
  config: Record<T, { label: string; bg: string; color: string }>
}) {
  const cfg = config[value]
  return (
    <div>
      <Label>{label}</Label>
      <div className={`relative rounded border border-current/10 ${cfg.bg}`}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className={`w-full appearance-none bg-transparent px-3 py-2 pr-8 text-sm font-medium ${cfg.color} focus:outline-none focus:ring-2 focus:ring-off-black/20 cursor-pointer`}
        >
          {options.map(opt => (
            <option key={opt} value={opt} className="bg-white text-off-black font-normal">
              {config[opt].label}
            </option>
          ))}
        </select>
        <ChevronDown className={`w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${cfg.color}`} />
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-off-black/60 mb-1">{children}</div>
}
