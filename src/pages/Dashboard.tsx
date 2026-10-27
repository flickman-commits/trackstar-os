import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import Toast, { type ToastMessage } from '@/components/orders/Toast'
import { Search, Plus, Loader2, ChevronDown as ChevronDownIcon, ImagePlus, MessageSquareText, SlidersHorizontal } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { segment, segmentGroup } from '@/lib/ui'
import BulkView from '@/components/bulk/BulkView'
import { useDesign } from '@/lib/useDesign'
import StatusLegend from '@/components/StatusLegend'
import { Avatar, QueuePill, PersonFilter, TeamPanel, type QueueMember } from '@/components/AssigneePicker'
import { setTeamColors } from '@/lib/teamColors'
import { useSearchParams, useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import EmailCustomerModal from '@/components/support/EmailCustomerModal'
import PageHeader from '@/components/PageHeader'
import OrderTags, { HoverTip } from '@/components/OrderTags'
import OrderDetail from '@/components/orders/OrderDetail'
import StatusPill from '@/components/orders/StatusPill'
import {
  type ActiveView, type DesignStatus, type EditValues, type Order, type PossibleMatch,
  DESIGN_STATUS_CONFIG, designLabel, mapOrder, orderRefOf,
} from '@/components/orders/orderModel'
import {
  formatDueDate, isDueDateUrgent, dueIsLive, workableSince, orderAge, getStatusDisplay,
  orderItemCount, orderItemPosition,
} from '@/components/orders/orderFormat'

// API calls now go to /api/* serverless functions (same origin)

// Source indicator — shopify/etsy icon for marketplace orders, or a distinct
// green "Creator" chip for creator-program sample orders so Elí can tell at
// a glance these are free fulfillments (not paying customers).
function OrderSourceMark({ source, size = 'md' }: { source: Order['source']; size?: 'sm' | 'md' }) {
  if (source === 'creator_sample') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold whitespace-nowrap"
        title="Creator-program sample - free fulfillment"
      >
        🎁 Creator
      </span>
    )
  }
  const cls = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'
  const label = source === 'shopify' ? 'Shopify' : 'Etsy'
  const src = source === 'shopify' ? '/shopify-icon.png' : '/etsy-icon.png'
  return <img src={src} alt={label} title={label} className={`${cls} inline-block flex-shrink-0`} />
}

/**
 * Greeting for whoever is looking at the screen.
 *
 * This used to pick a timezone from which tab was open - custom orders meant
 * Dan in New York, standard meant Elí in Costa Rica - which was a reasonable
 * guess back when those were the only two people in the tool. It is wrong now
 * that everyone signs in as themselves: it would tell a third person good
 * evening because of the tab they clicked. The browser already knows what time
 * it is where the person is sitting, so use that.
 */
function getGreeting(): string {
  const hour = new Date().getHours()

  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The bottom of a list that loads more as it scrolls into view (a button too, in case it never does). */
function LoadMore({ loading, onMore }: { loading: boolean; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const more = useRef(onMore)
  more.current = onMore
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) more.current() }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className="py-4 text-center">
      <button onClick={onMore} disabled={loading} className="inline-flex items-center gap-1.5 text-xs text-off-black/45 hover:text-off-black/70">
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}{loading ? 'Loading completed orders…' : 'Load more completed orders'}
      </button>
    </div>
  )
}

// 90, not 100: some orders wait on things that are not ours (a customer who
// does not answer, results not up), and the pauses do not catch all of them.
const GOAL_PCT = 90

type OnTime = { pct: number; goalHours: number; due: number; onTime: number; lateNow: number; oldestLateDays: number | null; lateOrders: string[] }

/**
 * The pulse on getting orders out: of the standard orders whose deadline
 * (a day and a half since Oct 26, 2026) came up in the past week, the share out before it (open ones count
 * as late), and beside it the open orders already past their deadline, which
 * filters the list to them. See server/domain/orders/onTime.js.
 */
function OnTimeStat({ stat, lateActive, onLate }: { stat: OnTime; lateActive: boolean; onLate: () => void }) {
  const { pct } = stat
  const days = `${stat.goalHours / 24}-day`
  const color = pct >= GOAL_PCT ? 'bg-green-500' : pct >= 75 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="ml-5 flex items-end gap-5">
      <div className="flex flex-col gap-1" title={`Past 7 days: ${stat.onTime} of the ${stat.due} standard orders whose ${days} deadline came up went out in time. The clock starts at the order, or race day if it was ordered before the race, and pauses while results are not up yet (up to 3 days) and while we wait on the customer's reply.`}>
        <span className="text-xs text-off-black/60 whitespace-nowrap">Out within {stat.goalHours / 24} days</span>
        <div className="flex items-start gap-2.5">
          <div className="flex flex-col gap-1 pt-1.5">
            <div className="relative w-32 h-2 rounded-full bg-off-black/10 overflow-hidden">
              <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
              {/* The goal, marked on the bar. */}
              <div className="absolute top-0 bottom-0 w-px bg-off-black/40" style={{ left: `${GOAL_PCT}%` }} />
            </div>
            <span className="text-[11px] text-off-black/45 whitespace-nowrap">Goal is {GOAL_PCT}%</span>
          </div>
          <div className="flex flex-col items-start leading-tight">
            <span className="text-sm font-semibold text-off-black tabular-nums">{pct}%</span>
            <span className="text-[11px] text-off-black/45 whitespace-nowrap">past 7d</span>
          </div>
        </div>
      </div>
      <button
        onClick={onLate}
        disabled={!stat.lateNow}
        title={stat.lateNow ? (lateActive ? 'Show every order again' : `Show only the open orders past their ${days} deadline`) : 'Nothing is past its deadline'}
        className={`flex flex-col items-start gap-0.5 rounded-md px-2 py-1 -mb-1 text-left transition-colors ${lateActive ? 'bg-red-50 ring-1 ring-red-200' : 'hover:bg-off-black/5'} disabled:cursor-default disabled:hover:bg-transparent`}
      >
        <span className="text-xs text-off-black/60 whitespace-nowrap">Late now</span>
        <span className={`text-sm font-semibold tabular-nums ${stat.lateNow ? 'text-red-600' : 'text-off-black'}`}>{stat.lateNow}</span>
        <span className="text-[11px] text-off-black/45 whitespace-nowrap">{stat.lateNow && stat.oldestLateDays != null ? `oldest ${stat.oldestLateDays === 1 ? '1 day' : `${stat.oldestLateDays} days`}` : 'past deadline'}</span>
      </button>
    </div>
  )
}

/** The name to greet someone by. Falls back to the part of an email before the @. */

function greetingName(user: { firstName?: string | null; email?: string | null } | null): string {
  return (user?.firstName || '').trim() || (user?.email || '').split('@')[0] || 'there'
}

// Date and pace are now pre-formatted by the API for direct copy to Illustrator
// Date: MM.DD.YY (e.g., "11.02.25")
// Pace: X:XX / mi (e.g., "7:15 / mi")

// Each view's order list as last loaded, kept for the whole visit (leaving the
// page and coming back too). Switching views shows the cached list at once and
// refreshes it behind; before, every switch emptied the table and waited a
// second or two for the whole list again.
type ViewList = { orders: Order[]; completedCount: number | null }
// The standard queue's search over completed orders, by term.
const searchCache = new Map<string, { at: number; orders: Order[] }>()
const viewCache = new Map<ActiveView, ViewList>()
// One request per view at a time: a prefetch and a switch to the same view share it.
const inFlight = new Map<ActiveView, Promise<ViewList & { matches: Record<string, PossibleMatch[]> }>>()
function loadView(view: ActiveView) {
  const running = inFlight.get(view)
  if (running) return running
  const p = (async () => {
    const response = await apiFetch(`/api/orders?type=${view}${view === 'standard' ? '&scope=open' : ''}`)
    if (!response.ok) throw new Error('Failed to fetch orders')
    const data = await response.json()
    const rows: Record<string, unknown>[] = data.orders || []
    // The research's possible matches, so the accept picker shows after a reload too.
    const matches: Record<string, PossibleMatch[]> = {}
    for (const o of rows) {
      const m = o.possibleMatches as PossibleMatch[] | undefined
      if (Array.isArray(m) && m.length > 0) matches[o.orderNumber as string] = m
    }
    const list = { orders: rows.map(mapOrder), completedCount: typeof data.completedCount === 'number' ? data.completedCount : null }
    viewCache.set(view, list)
    return { ...list, matches }
  })().finally(() => inFlight.delete(view))
  inFlight.set(view, p)
  return p
}

export default function Dashboard() {
  const { user: currentUser, isAdmin, can } = useAuth()
  // The "Email customer" modal on an order: a new Support conversation about it.
  const [emailingOrder, setEmailingOrder] = useState<Order | null>(null)
  // Who is on the team, for the assignee picker, and whether the queue shows
  // only my orders. "mine" is the default for anyone who has orders assigned,
  // so Eli opens the tool to Eli's queue; someone with none sees everything.
  const [team, setTeam] = useState<{ id: string; firstName: string; lastName: string }[]>([])
  // Who new orders of each type go to today (regular, plus any help on a shift).
  const [queues, setQueues] = useState<Record<string, QueueMember[]>>({})
  // Whose orders show in standard and custom: a teammate's id, '' for
  // everyone, 'none' for unassigned.
  const [personFilter, setPersonFilter] = useState<string | null>(null)
  const loadTeam = useCallback(() => {
    apiFetch('/api/orders/assign').then(r => r.ok ? r.json() : null).then(d => { if (d?.users) { setTeamColors(d.users); setTeam(d.users) } if (d?.queues) setQueues(d.queues) }).catch(() => {})
  }, [])
  useEffect(() => { loadTeam() }, [loadTeam])
  const [searchParams, setSearchParams] = useSearchParams()
  const [orders, setOrders] = useState<Order[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Cmd+K opens the search over every order (CommandSearch, in AppShell).
  // The race and queue filters live in the address (?race=...&queue=review),
  // so a reload or a shared link keeps the view. Changing one replaces the
  // history entry; the back button is for orders, not filter clicks.
  type StageFilter = '' | 'review' | 'attach' | 'action' | 'waiting' | 'not_run' | 'late'
  const setUrlParam = useCallback((key: string, value: string) => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  }, [setSearchParams])
  const raceFilter = searchParams.get('race') || ''  // empty = show all races
  const setRaceFilter = useCallback((v: string) => setUrlParam('race', v), [setUrlParam])
  // Standard orders: the queue to work. '' is everything open.
  const stageFilter: StageFilter = (['review', 'attach', 'action', 'waiting', 'not_run', 'late'] as const).find(k => k === searchParams.get('queue')) || ''
  const setStageFilter = useCallback((v: StageFilter) => setUrlParam('queue', v), [setUrlParam])
  // Custom orders: open ones by due date (the default), or every custom order, completed too.
  const customAll = searchParams.get('show') === 'all'
  const setCustomAll = useCallback((all: boolean) => setUrlParam('show', all ? 'all' : ''), [setUrlParam])
  // Team member and race pickers sit behind a Filters toggle, closed by default.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showCompleted, setShowCompleted] = useState(false)
  // Header stat: share of standard orders out by their deadline (1.5 days), past 7 days (goal 90%), and the ones late now.
  const [onTime, setOnTime] = useState<OnTime | null>(null)
  // And standard orders sent to production in the last 24 hours. Read again
  // every five minutes while the tab is visible.
  const [sentToday, setSentToday] = useState<{ count: number; byPerson: { name: string; count: number }[] } | null>(null)
  useEffect(() => {
    if (!can('settings.stats')) return
    const read = () => apiFetch('/api/admin/stats?range=7d&only=fulfillment').then(r => r.ok ? r.json() : null)
      .then(d => {
        const t = d?.onTime; if (t?.due) setOnTime({ pct: t.onTimePct, goalHours: t.goalHours || 36, due: t.due, onTime: t.onTime, lateNow: t.lateNow, oldestLateDays: t.oldestLateDays, lateOrders: t.lateOrders || [] })
        if (typeof d?.sentToday?.count === 'number') setSentToday({ count: d.sentToday.count, byPerson: d.sentToday.byPerson || [] })
      }).catch(() => {})
    read()
    const t = setInterval(() => { if (document.visibilityState === 'visible') read() }, 300_000)
    return () => clearInterval(t)
  }, [can])
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null)
  const [bulkCreating, setBulkCreating] = useState(false)

  // Old links with ?settings=1 go to the Settings page.
  const goToSettings = useNavigate()

  // One flag for the consolidated Instant Lookup Dashboard. All
  // of its data fetching lives inside the component now, rather than being
  // threaded through this already-oversized page.

  // The open order's automated print (standard orders only). See DesignPanel.
  const design = useDesign(selectedOrder?.trackstarOrderType === 'standard' ? selectedOrder.id : null, can('orders.render'))
  // The design's "waiting on" list comes from the server. When what it depends on
  // changes (weather confirmed, a bib or time entered, a date fixed), ask again,
  // so Create Design works without reloading the page.
  const designReload = design.reload
  const designInputs = selectedOrder ? [selectedOrder.bibNumber, selectedOrder.officialTime, selectedOrder.officialPace, selectedOrder.weatherConfirmedAt, selectedOrder.weatherTemp, selectedOrder.weatherCondition, selectedOrder.raceDate, selectedOrder.raceDateVerified, selectedOrder.photoPath].join('|') : ''
  useEffect(() => { if (designInputs) designReload() }, [designInputs, designReload])

  const [toast, setToast] = useState<ToastMessage | null>(null)
  // Store possible matches per order for ambiguous results (not persisted to DB)
  const [possibleMatchesMap, setPossibleMatchesMap] = useState<Record<string, PossibleMatch[]>>({})
  // Race database state
  // Tab switcher: standard vs custom order view
  // Which orders are on screen, from the address: ?view=custom | partners | bulk
  // (standard is the default and is left out). Changing the view drops the
  // race filter, since the race list differs per view.
  const VIEW_PARAM: Record<ActiveView, string> = { standard: '', custom: 'custom', race_partner: 'partners', bulk: 'bulk' }
  const activeView: ActiveView = (Object.keys(VIEW_PARAM) as ActiveView[]).find(v => VIEW_PARAM[v] === (searchParams.get('view') || '')) || 'standard'
  const setActiveView = useCallback((v: ActiveView) => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); if (VIEW_PARAM[v]) next.set('view', VIEW_PARAM[v]); else next.delete('view'); next.delete('race'); return next }, { replace: true })
  }, [setSearchParams]) // eslint-disable-line react-hooks/exhaustive-deps
  // Uploading to Artelo sends the print to production, so done is just Completed.
  const doneLabel = 'Completed'
  const doneHeading = 'Completed Orders'
  const [bulkCount, setBulkCount] = useState<number | null>(null)
  // "New Partner" modal state
  const [showNewRacePartner, setShowNewRacePartner] = useState(false)
  const [newPartnerValues, setNewPartnerValues] = useState({ partnerName: '', raceYear: String(new Date().getFullYear()), contactName: '', contactEmail: '' })
  const [isCreatingPartner, setIsCreatingPartner] = useState(false)
  const [raceShorthands, setRaceShorthands] = useState<Record<string, string>>({})

  // Fetch orders from database (filtered by activeView type)
  // Completed standard orders are fetched only while someone is looking at them.
  const [completedCount, setCompletedCount] = useState<number | null>(null)
  // The view the orders in state belong to, so the cache below files them under it.
  const ordersViewRef = useRef<ActiveView | null>(null)
  const activeViewRef = useRef(activeView)
  activeViewRef.current = activeView
  useEffect(() => {
    const view = ordersViewRef.current
    if (view) viewCache.set(view, { orders, completedCount })
  }, [orders, completedCount])
  const fetchOrders = useCallback(async () => {
    const view = activeView
    try {
      // Standard orders: completed ones come from their own requests (the pages
      // below, or a search). The other views are small enough to load whole.
      const data = await loadView(view)
      // The person switched views while this loaded: it is cached, not shown.
      if (activeViewRef.current !== view) return
      setCompletedCount(data.completedCount)
      const transformedOrders = data.orders
      ordersViewRef.current = view
      setOrders(transformedOrders)
      // Current Team's per-person counts come from their own request; reload them
      // with the list so every count (bubble, queue chips, team) moves together.
      loadTeam()

      // Hydrate possibleMatchesMap from persisted research records so the
      // accept-button picker shows up even after a page reload (not just
      // immediately after running research).
      if (Object.keys(data.matches).length > 0) {
        setPossibleMatchesMap(prev => ({ ...data.matches, ...prev }))
      }

      // Sync selectedOrder with fresh data if the detail panel is open
      setSelectedOrder(prev => {
        if (!prev) return null
        const fresh = transformedOrders.find(o => o.id === prev.id)
        if (!fresh) return prev
        // Only update if something changed to avoid unnecessary re-renders.
        // The pipeline is the status in the header ("Confirm weather"): it moves
        // when a race's weather or date is confirmed, with no change to the row's own status.
        const pipelineMoved = JSON.stringify(fresh.pipeline || null) !== JSON.stringify(prev.pipeline || null)
        if (fresh.designStatus !== prev.designStatus || fresh.status !== prev.status || pipelineMoved
          || fresh.weatherConfirmedAt !== prev.weatherConfirmedAt || fresh.raceDateVerified !== prev.raceDateVerified) {
          return { ...prev, ...fresh }
        }
        return prev
      })
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching orders:', error)
      if (activeViewRef.current === view) setToast({ message: 'Failed to fetch orders', type: 'error' })
    } finally {
      if (activeViewRef.current === view) setIsLoading(false)
    }
  }, [activeView, loadTeam])

  // Completed standard orders, newest first, a page at a time: they sit at the
  // bottom of the queue's All and load as you scroll down to them. The open
  // list stays its own request (it refreshes every minute; this does not).
  const [completedPage, setCompletedPage] = useState<Order[]>([])
  const [completedLoading, setCompletedLoading] = useState(false)
  const completedBusy = useRef(false)
  const loadCompleted = useCallback(async (reset: boolean) => {
    if (completedBusy.current) return
    completedBusy.current = true
    setCompletedLoading(true)
    try {
      const skip = reset ? 0 : completedPage.length
      const r = await apiFetch(`/api/orders?type=standard&scope=completed&take=100&skip=${skip}`)
      if (!r.ok) return
      const d = await r.json()
      const rows: Order[] = (d.orders || []).map((o: Record<string, unknown>) => mapOrder(o))
      setCompletedPage(prev => {
        if (!reset) return [...prev, ...rows.filter(o => !prev.some(p => p.id === o.id))]
        // A refresh: the newest page again, with whatever was loaded below it kept.
        const ids = new Set(rows.map(o => o.id))
        return [...rows, ...prev.filter(o => !ids.has(o.id)).slice(Math.max(0, prev.length - rows.length))]
      })
    } catch { /* the next scroll or refresh tries again */ } finally {
      completedBusy.current = false
      setCompletedLoading(false)
    }
  }, [completedPage.length])
  const showStandardDone = activeView === 'standard' && stageFilter === '' && !searchQuery.trim()
  // A search in the standard queue: the completed orders it matches, found on
  // the server, a short pause after the last key.
  const [searchDone, setSearchDone] = useState<Order[]>([])
  useEffect(() => {
    const term = searchQuery.trim()
    if (activeView !== 'standard' || term.replace(/^#/, '').length < 2) { setSearchDone([]); return }
    // A term searched in the last few minutes answers at once (completed orders rarely change).
    const key = term.toLowerCase()
    const hit = searchCache.get(key)
    if (hit && Date.now() - hit.at < 5 * 60_000) { setSearchDone(hit.orders); return }
    let stale = false
    const t = setTimeout(() => {
      apiFetch(`/api/orders?type=standard&scope=completed&take=100&q=${encodeURIComponent(term)}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return
          const rows: Order[] = (d.orders || []).map((o: Record<string, unknown>) => mapOrder(o))
          searchCache.set(key, { at: Date.now(), orders: rows })
          if (!stale) setSearchDone(rows)
        })
        .catch(() => {})
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [searchQuery, activeView])
  useEffect(() => { if (showStandardDone && !completedPage.length) loadCompleted(true) }, [showStandardDone]) // eslint-disable-line react-hooks/exhaustive-deps
  // An order left the open list (completed here or by someone else): read the newest completed page again.
  const openIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (activeView !== 'standard' || searchQuery.trim()) return
    const now = new Set(orders.filter(o => o.status !== 'completed').map(o => o.id))
    const left = [...openIds.current].some(id => !now.has(id))
    openIds.current = now
    if (left && completedPage.length) loadCompleted(true)
  }, [orders]) // eslint-disable-line react-hooks/exhaustive-deps

  // Order Assignment changed who has what (help added or ended, the order
  // list spread): reload the list and Current Team so nobody has to refresh.
  useEffect(() => {
    const onChanged = () => { fetchOrders() }
    window.addEventListener('trackstar:orders-changed', onChanged)
    return () => window.removeEventListener('trackstar:orders-changed', onChanged)
  }, [fetchOrders, loadTeam])

  // A review decision changes the order's status ("Ready for review" becomes
  // "Design rejected" or "Sending to production"), and so do Hold and Send now.
  // Flip the header at once, then let the list refresh confirm it from the server.
  const reviewKey = design.job ? `${design.job.id}:${design.job.review}:${design.job.send?.state || ''}` : null
  const prevReviewKey = useRef<string | null>(reviewKey)
  const reviewedOrderId = selectedOrder?.id ?? null  // the design hook follows the open order
  useEffect(() => {
    const prev = prevReviewKey.current
    prevReviewKey.current = reviewKey
    if (!prev || !reviewKey || prev === reviewKey || prev.split(':')[0] !== reviewKey.split(':')[0]) return
    const [, review, send] = reviewKey.split(':')
    const note = design.job?.reviewNote
    const pipeline: Order['pipeline'] = review === 'rejected'
      ? { stage: 'action', reason: 'Design rejected', kind: 'data', fix: `The design was rejected: ${note || 'no note'}. Fix the data; a new design renders on the next import.` }
      : review !== 'approved' ? undefined
      : send === 'sent' ? { stage: 'done', reason: 'Completed' }
      : send === 'queued' ? { stage: 'attach', reason: 'Sending to production', fix: 'Approved. It is attached in Artelo and sent to production in a few minutes, unless someone holds it.' }
      : send === 'held' ? { stage: 'attach', reason: 'Held', fix: 'Approved, and held from production. Send it to production when it is ready, or attach it in Artelo by hand.' }
      : send === 'waiting' ? { stage: 'attach', reason: 'Uploaded, waiting on other prints', fix: 'Attached to its item in Artelo. The Artelo order goes to production once every print on it has its design. Mark it complete if the rest is handled in Artelo.' }
      : send === 'manual' ? { stage: 'action', reason: 'Expedited shipping', kind: 'artelo', fix: 'Manually attach and add expedited shipping to this order in Artelo, then mark it complete.' }
      : send === 'blocked' ? { stage: 'action', reason: 'Artelo would not take it', kind: 'artelo', fix: design.job?.send?.reason || 'Artelo refused it.' }
      : { stage: 'attach', reason: 'Attach in Artelo', fix: 'The print is approved and in the Artelo library (Orders folder), but was not sent. Send it to production, or attach it in Artelo by hand and mark the order done.' }
    if (pipeline) {
      setSelectedOrder(prev => prev && prev.id === reviewedOrderId ? { ...prev, pipeline } : prev)
      setOrders(prev => prev.map(o => o.id === reviewedOrderId ? { ...o, pipeline } : o))
    }
    fetchOrders()
  }, [reviewKey, design.job, reviewedOrderId, fetchOrders])

  // Create a new race-partner "order" (used to send proof links to race orgs)
  const createRacePartner = async () => {
    if (!newPartnerValues.partnerName.trim()) {
      setToast({ message: 'Partner name is required', type: 'error' })
      return
    }
    setIsCreatingPartner(true)
    try {
      const res = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-race-partner',
          partnerName: newPartnerValues.partnerName.trim(),
          raceYear: parseInt(newPartnerValues.raceYear, 10) || new Date().getFullYear(),
          contactName: newPartnerValues.contactName.trim() || null,
          contactEmail: newPartnerValues.contactEmail.trim() || null,
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Create failed (${res.status})`)
      }
      setToast({ message: 'Partner added', type: 'success' })
      setShowNewRacePartner(false)
      setNewPartnerValues({ partnerName: '', raceYear: String(new Date().getFullYear()), contactName: '', contactEmail: '' })
      await fetchOrders()
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Failed to create partner', type: 'error' })
    } finally {
      setIsCreatingPartner(false)
    }
  }

  // Import new orders from Artelo
  const importOrders = async () => {
    setIsImporting(true)
    try {
      const response = await apiFetch(`/api/orders/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        const errorData = await response.text()
        throw new Error(`Import failed (${response.status}): ${errorData}`)
      }

      const data = await response.json()
      if (data.skipped === 'already_running') { setToast({ message: 'An import is already running', type: 'success' }); return }
      if (data.lastImportedAt) setLastImportedAt(data.lastImportedAt)
      const parts = []
      if (data.imported > 0) parts.push(`${data.imported} imported`)
      if (data.updated > 0) parts.push(`${data.updated} updated`)
      if (data.skipped > 0) parts.push(`${data.skipped} skipped`)
      if (data.needsAttention > 0) parts.push(`${data.needsAttention} missing year`)
      setToast({
        message: parts.length > 0 ? parts.join(', ') : 'No changes',
        type: 'success'
      })

      // Refresh the orders list
      await fetchOrders()
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error importing orders:', error)
      const message = error instanceof Error ? error.message : 'Failed to import orders from Artelo'
      setToast({ message, type: 'error' })
    } finally {
      setIsImporting(false)
    }
  }

  // Orders come in on their own now (the auto-import cron, every 10 minutes).
  // Check the stamp each minute and reload the list when it moves.
  useEffect(() => {
    let last: string | null = null
    const check = async () => {
      try {
        const r = await apiFetch('/api/orders/import')
        if (!r.ok) return
        const { lastImportedAt: at } = await r.json()
        setLastImportedAt(at)
        if (last && at && at !== last) fetchOrders()
        last = at
      } catch { /* next tick */ }
    }
    check()
    const t = setInterval(() => { if (document.visibilityState === 'visible') check() }, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Old links with ?settings=1 land on the Settings page.
  useEffect(() => {
    if (searchParams.get('settings') === '1') goToSettings('/settings', { replace: true })
  }, [searchParams, goToSettings])

  // Mark order as completed.
  // Keep the modal open after the action — Eli often wants to take another
  // look at the same order right after marking it (re-check filename, etc.),
  // and the optimiztic status flip swaps the button to "Re-Open Order" so
  // he can immediately un-do if he hit it by mistake.
  const markAsCompletedRef = useRef<(orderNumber: string) => void>(() => {})
  const markAsCompleted = async (orderNumber: string) => {
    try {
      const response = await apiFetch(`/api/orders/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', orderNumber })
      })

      if (!response.ok) {
        // The server refuses to complete a photo order until the photo is
        // confirmed placed. Surface that reason instead of a generic failure,
        // otherwise the button just appears to do nothing.
        const body = await response.json().catch(() => ({}))
        // A 500 carries its reason in `error`; show it rather than a blank "failed".
        throw new Error(body.message || (typeof body.error === 'string' && body.error.length > 24 ? body.error : '') || `Failed to mark as completed (${response.status})`)
      }

      setToast({ message: 'Order marked as completed!', type: 'success' })
      // Optimiztically reflect the new status without closing the modal
      setSelectedOrder(prev => prev && prev.orderNumber === orderNumber ? { ...prev, status: 'completed' } : prev)
      setOrders(prev => prev.map(o => o.orderNumber === orderNumber ? { ...o, status: 'completed' } : o))
      await fetchOrders()
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error completing order:', error)
      setToast({
        message: error instanceof Error ? error.message : 'Failed to complete order',
        type: 'error',
      })
    }
  }
  markAsCompletedRef.current = markAsCompleted
  // A standard order's design is approved: the only time Mark as Completed shows for it.
  const standardDesignApproved = design.job?.status === 'done' && design.job.review === 'approved'
  const standardDesignApprovedRef = useRef(false)
  standardDesignApprovedRef.current = standardDesignApproved

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  // Runner edit covers the name plus the result itself. Race name and year are
  // no longer editable: they come straight off the order and the wizard now
  // collects the year, so the old override escape hatch is not needed.
  const [editValues, setEditValues] = useState<EditValues>({ runnerNameOverride: '', bibNumber: '', officialTime: '', officialPace: '' })

  // Close modal and reset edit state
  // Orders open in place of the table rather than in a popup.
  const inlineDetail = !!selectedOrder && !showCompleted

  // The open order lives in the address bar as /orders/5038 (or /orders/5038-2
  // for the second line item), so a reload, the back button and a shared link
  // all land on the order. Clicking in adds a history entry; J/K replaces it.
  const { orderRef: urlOrderRef = null } = useParams<{ orderRef: string }>()
  const navigate = useNavigate()
  const { search: urlSearch } = useLocation()  // the filters ride along when an order opens or closes
  const selectedRef = selectedOrder ? orderRefOf(selectedOrder) : null
  const lastSelectedRef = useRef<string | null>(selectedRef)
  const lastUrlRef = useRef<string | null>(urlOrderRef)
  const replaceNextUrl = useRef(false)
  const lookedUpRef = useRef<string | null>(null)
  useEffect(() => {
    const open = (o: Order) => { lastSelectedRef.current = orderRefOf(o); setSelectedOrder(o) }
    // The order behind a ref: from the loaded list first, otherwise fetched on its own.
    // A bare number (no -2 suffix) also opens an order whose only print is a
    // later line item, as when the first item was not a print.
    const pick = (list: Order[], ref: string) => list.find(o => orderRefOf(o) === ref)
      || (!ref.includes('-') ? list.filter(o => orderRefOf(o).split('-')[0] === ref).sort((a, b) => (a.lineItemIndex || 0) - (b.lineItemIndex || 0))[0] : undefined)
    const resolve = (ref: string) => {
      const hit = pick(orders, ref)
      if (hit) { open(hit); return }
      if (lookedUpRef.current === ref) return
      lookedUpRef.current = ref
      const [number] = ref.split('-')
      apiFetch(`/api/orders?number=${encodeURIComponent(number)}`).then(r => r.ok ? r.json() : null).then(d => {
        const found = pick(((d?.orders || []) as Record<string, unknown>[]).map(mapOrder), ref)
        if (!found) { setToast({ message: `Order ${ref} was not found`, type: 'error' }); navigate(`/${urlSearch}`, { replace: true }); return }
        if (found.trackstarOrderType !== activeView) setActiveView(found.trackstarOrderType as typeof activeView)
        open(found)
      }).catch(() => {})
    }
    if (selectedRef !== lastSelectedRef.current) {
      // The order changed here (a click, J/K, closing): the address follows.
      lastSelectedRef.current = selectedRef
      if (selectedRef !== urlOrderRef) {
        lastUrlRef.current = selectedRef
        navigate(`${selectedRef ? `/orders/${selectedRef}` : '/'}${urlSearch}`, { replace: replaceNextUrl.current })
      }
      replaceNextUrl.current = false
      return
    }
    if (urlOrderRef !== lastUrlRef.current) {
      // The address changed (back, forward, a typed link): the order follows.
      lastUrlRef.current = urlOrderRef
      if (!urlOrderRef) { lastSelectedRef.current = null; setSelectedOrder(null); return }
      resolve(urlOrderRef)
      return
    }
    // First load with an order in the address: open it once the list is here.
    if (urlOrderRef && selectedRef !== urlOrderRef) resolve(urlOrderRef)
  }, [selectedRef, urlOrderRef, orders, activeView, setActiveView, navigate, urlSearch])
  useEffect(() => {
    document.title = selectedOrder ? `Order ${orderRefOf(selectedOrder)} · TrackstarOS` : 'TrackstarOS'
    return () => { document.title = 'TrackstarOS' }
  }, [selectedOrder])

  const closeModal = useCallback(() => {
    setSelectedOrder(null)
    setIsEditing(false)
    setEditValues({ runnerNameOverride: '', bibNumber: '', officialTime: '', officialPace: '' })
  }, [])

  // Fetch orders on mount and when view changes
  // Only show full loading spinner on initial load; show subtle refresh indicator on view switch.
  // The count is read through a ref so a changing order count does not re-run
  // the effect and restart the poll.
  // Once the first list is up, load the other views quietly, one after another,
  // so the first switch to each is instant too.
  const prefetched = useRef(false)
  useEffect(() => {
    if (isLoading || prefetched.current) return
    const t = setTimeout(async () => {
      prefetched.current = true
      for (const v of ['standard', 'custom', 'race_partner', 'bulk'] as const) {
        if (!viewCache.has(v)) await loadView(v).catch(() => {})
      }
    }, 1500)
    return () => clearTimeout(t)
  }, [isLoading])
  // A view loaded before (this visit, or before leaving the page) shows at once
  // from the cache while a fresh copy loads behind it.
  useEffect(() => {
    const cached = viewCache.get(activeView)
    if (ordersViewRef.current !== activeView) {
      ordersViewRef.current = cached ? activeView : null
      setOrders(cached?.orders || [])
      setCompletedCount(cached?.completedCount ?? null)
    }
    if (cached) {
      setIsLoading(false)
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    fetchOrders().finally(() => setIsRefreshing(false))

    // Poll to pick up external changes (customer approvals, etc.), but only
    // while someone is looking: a background tab polling all day was most of
    // our Supabase egress. Coming back to the tab refreshes right away, and
    // new imports reload the list through the stamp check above, so this can
    // be slow.
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') { fetchOrders() }
    }, 120_000)
    const onVisible = () => { if (document.visibilityState === 'visible') { fetchOrders() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVisible) }
  }, [fetchOrders, loadTeam, activeView])

  // Fetch race shorthands from scraper configs + user overrides (once on mount).
    const fetchRaceShorthands = useCallback(async () => {
    try {
      const res = await apiFetch('/api/orders/actions?action=race-shorthands')
      if (!res.ok) return
      const data = await res.json()
      if (data?.shorthands) setRaceShorthands(data.shorthands)
    } catch { /* swallow — filenames still render via fallback */ }
  }, [])
  useEffect(() => { fetchRaceShorthands() }, [fetchRaceShorthands])

  // Merge one race name into another. Backfills orders + race rows
  // on the server and refetches everything when done.

  // Save (or clear, when empty) a user shorthand override.

  // Designs to be personalized
  // Standard view: pending + flagged + ready + missing_year, sorted newest first
  // Custom view: all items where designStatus !== 'sent_to_production', sorted oldest first (by due date)
  // Mine only applies to the two queues people actually work: standard and custom.
  const scoped = activeView === 'standard' || activeView === 'custom'
  const myId = currentUser?.id || null
  // Admins start on everyone; everyone else starts on their own orders.
  useEffect(() => { if (personFilter === null && myId) setPersonFilter(isAdmin ? '' : myId) }, [personFilter, myId, isAdmin])
  const person = personFilter || ''
  // One rule for every list on the page (open, completed, search results), so
  // picking a person can never show someone else's orders.
  const byPerson = useCallback((o: Order) =>
    !scoped || !person || (person === 'none' ? !o.assigneeId : o.assigneeId === person), [scoped, person])

  /** Reassign one order. Optimistic, rolled back if the server refuses. */
  // The Assignee column in the desktop tables: avatar and first name.
  const assigneeCell = (order: Order) => {
    const u = team.find(t => t.id === order.assigneeId)
    if (!u) return <span className="text-sm text-off-black/40">Unassigned</span>
    return <span className="inline-flex items-center gap-1.5 text-sm text-off-black whitespace-nowrap"><Avatar user={u} size={20} />{u.firstName}</span>
  }

  const assignOrder = useCallback(async (orderId: string, assigneeId: string | null) => {
    const name = assigneeId ? (team.find(u => u.id === assigneeId)?.firstName ?? null) : null
    const before = orders.find(o => o.id === orderId)
    const apply = (id: string | null, n: string | null) => {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, assigneeId: id, assigneeName: n } : o))
      setSelectedOrder(prev => prev && prev.id === orderId ? { ...prev, assigneeId: id, assigneeName: n } : prev)
    }
    apply(assigneeId, name)
    try {
      const res = await apiFetch('/api/orders/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, assigneeId }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not reassign')
      setToast({ message: name ? `Assigned to ${name}` : 'Unassigned', type: 'success' })
      loadTeam()
    } catch (e) {
      apply(before?.assigneeId ?? null, before?.assigneeName ?? null)
      setToast({ message: e instanceof Error ? e.message : 'Could not reassign', type: 'error' })
    }
  }, [orders, team, loadTeam])

  const ordersToFulfill = useMemo(() => {
    // Guard: ensure orders match the active view type to prevent cross-contamination
    const typeFiltered = orders.filter(o => (o.trackstarOrderType || 'standard') === activeView)
      .filter(byPerson)
    if (activeView === 'custom' || activeView === 'race_partner') {
      // Design-driven views: show all non-done items, sorted by most recent first for race_partner
      // (custom uses due date; race_partner has no due date so we fall back to createdAt)
      // A partner's design work ends at Approved by Partner, so that is done.
      const isDone = (o: Order) => o.designStatus === 'sent_to_production' || (activeView === 'race_partner' && o.designStatus === 'approved_by_customer')
      const activeOrders = typeFiltered.filter(o => !isDone(o))
      if (activeView === 'race_partner') {
        return activeOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      }
      return activeOrders.sort((a, b) => {
        const dateA = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
        const dateB = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
        if (dateA !== dateB) return dateA - dateB
        // Same due date: the one that paid to skip the line goes first.
        return Number(b.isRushOrder || false) - Number(a.isRushOrder || false)
      })
    }
    // Standard view: filter by status; expedited orders pinned to top, then oldest order first,
    // so the queue is worked in the order customers placed them.
    const fulfillOrders = typeFiltered.filter(o =>
      o.status === 'flagged' || o.status === 'ready' || o.status === 'pending' || o.status === 'missing_year'
    )
    return fulfillOrders.sort((a, b) => {
      // Expedited shipping first (the customer paid for speed), then big
      // spenders whose race has happened, then everything by how long it has
      // been workable, longest first. Orders for races not yet run sink to the
      // bottom, soonest race first.
      if (a.isExpedited && !b.isExpedited) return -1
      if (!a.isExpedited && b.isExpedited) return 1
      const now = Date.now()
      const bigA = !!a.isBigSpender && workableSince(a) <= now, bigB = !!b.isBigSpender && workableSince(b) <= now
      if (bigA && !bigB) return -1
      if (!bigA && bigB) return 1
      return workableSince(a) - workableSince(b)
    })
  }, [orders, activeView, byPerson])

  const completedOrders = useMemo(() => {
    // Guard: ensure orders match the active view type
    const typeFiltered = orders.filter(o => (o.trackstarOrderType || 'standard') === activeView).filter(byPerson)
    if (activeView === 'race_partner') {
      return typeFiltered.filter(o => o.designStatus === 'sent_to_production' || o.designStatus === 'approved_by_customer')
    }
    if (activeView === 'custom') {
      return typeFiltered.filter(o => o.designStatus === 'sent_to_production')
    }
    // Standard: the search's matches from the server; otherwise the completed pages.
    const done = typeFiltered.filter(o => o.status === 'completed')
    if (searchQuery.trim()) return [...done, ...searchDone.filter(o => !done.some(d => d.id === o.id)).filter(byPerson)]
    // Just completed here (still in the open list until the refresh) goes on top.
    const paged = completedPage.filter(o => (o.trackstarOrderType || 'standard') === 'standard').filter(byPerson)
    return [...done.filter(o => !paged.some(p => p.id === o.id)), ...paged]
  }, [orders, activeView, byPerson, completedPage, searchQuery, searchDone])

  const matchesSearch = useCallback((o: Order, query: string) =>
    o.orderNumber.toLowerCase().includes(query) ||
    o.displayOrderNumber.toLowerCase().includes(query) ||
    o.parentOrderNumber.toLowerCase().includes(query) ||
    (o.raceName || '').toLowerCase().includes(query) ||
    (o.effectiveRaceName || '').toLowerCase().includes(query) ||
    (o.runnerName || '').toLowerCase().includes(query) ||
    (o.effectiveRunnerName || '').toLowerCase().includes(query) ||
    // The buyer, who is often not the runner (gifts): find an order from the
    // email in a customer's message, or by the name on it.
    (o.customerEmail || '').toLowerCase().includes(query) ||
    (o.customerName || '').toLowerCase().includes(query) ||
    // Bibs match exactly: "12" should find bib 12, not every bib with a 1 and a 2.
    (!!o.bibNumber && o.bibNumber.toLowerCase() === query) ||
    (!!o.bibNumberCustomer && o.bibNumberCustomer.toLowerCase() === query)
  , [])

  // Race dropdown options — built from the currently-visible queue so the
  // counts reflect "what would I see if I picked this race?". Pulled from the
  // active queue rather than completedOrders so we don't surface stale races.
  const raceFilterOptions = useMemo(() => {
    const counts = new Map<string, number>()
    // Counted like the queue: races not yet run only when that chip is on.
    const notRun = (o: Order) => o.pipeline?.stage === 'waiting' && o.pipeline?.reason === 'Race not run yet'
    for (const o of ordersToFulfill) {
      if (activeView === 'standard' && notRun(o) !== (stageFilter === 'not_run')) continue
      const name = o.effectiveRaceName || o.raceName || ''
      if (!name) continue
      counts.set(name, (counts.get(name) || 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [ordersToFulfill, activeView, stageFilter])

  // How many open standard orders sit in each stage, for the queue chips.
  // Orders for a race that has not happened yet cannot be fulfilled, so they
  // are kept out of every "to fulfill" count and live in their own bucket.
  const isNotRun = (o: Order) => o.pipeline?.stage === 'waiting' && o.pipeline?.reason === 'Race not run yet'
  const fulfillable = useMemo(() => activeView === 'standard' ? ordersToFulfill.filter(o => !isNotRun(o)) : ordersToFulfill, [ordersToFulfill, activeView])
  // Current Team shows the same: each person's orders that can be worked now.
  const teamQueue = useMemo(() => {
    const people = queues[activeView]
    if (activeView !== 'standard' || !people) return people
    const n: Record<string, number> = {}
    for (const o of fulfillable) if (o.assigneeId) n[o.assigneeId] = (n[o.assigneeId] || 0) + 1
    return people.map(p => p.open == null ? p : { ...p, open: n[p.userId] || 0 })
  }, [queues, activeView, fulfillable])

  // Standard orders ready to approve, by who they are assigned to (the team panel).
  const toApprove = useMemo(() => {
    const n = new Map<string, number>()
    for (const o of fulfillable) if (o.pipeline?.stage === 'review') { const k = o.assigneeId || ''; n.set(k, (n.get(k) || 0) + 1) }
    return [...n.entries()].map(([userId, count]) => ({ userId, count })).sort((a, b) => b.count - a.count)
  }, [fulfillable])

  const stageCounts = useMemo(() => {
    const c = { review: 0, attach: 0, action: 0, waiting: 0, notRun: 0 }
    if (activeView !== 'standard') return c
    for (const o of ordersToFulfill) {
      const s = o.pipeline?.stage
      if (isNotRun(o)) c.notRun++
      else if (s === 'review') c.review++
      else if (s === 'attach') c.attach++
      else if (s === 'action') c.action++
      // Waiting holds both kinds: on something outside (a race, a worker) and on a customer's reply.
      if (!isNotRun(o) && (s === 'waiting' || s === 'needs_research' || o.waitingOnCustomerSince)) c.waiting++
    }
    return c
  }, [ordersToFulfill, activeView])

  const filteredOrders = useMemo(() => {
    let base = ordersToFulfill
    if (raceFilter && activeView === 'standard') {
      base = base.filter(o => (o.effectiveRaceName || o.raceName) === raceFilter)
    }
    if (stageFilter === 'late' && activeView === 'standard') {
      const late = new Set(onTime?.lateOrders || [])
      base = base.filter(o => late.has(o.orderNumber))
    } else if (stageFilter && activeView === 'standard') {
      base = base.filter(o => stageFilter === 'not_run' ? isNotRun(o)
        : stageFilter === 'waiting' ? ((o.pipeline?.stage === 'waiting' || o.pipeline?.stage === 'needs_research' || !!o.waitingOnCustomerSince) && !isNotRun(o))
        : o.pipeline?.stage === stageFilter)
    } else if (activeView === 'standard') {
      // "All" is everything that can be fulfilled; races not yet run sit under their own chip.
      base = base.filter(o => !isNotRun(o))
    }
    if (!searchQuery) return base
    const query = searchQuery.trim().toLowerCase()
    return base.filter(o => matchesSearch(o, query))
  }, [ordersToFulfill, raceFilter, stageFilter, searchQuery, matchesSearch, activeView, onTime])

  const filteredCompletedOrders = useMemo(() => {
    let base = completedOrders
    if (raceFilter && activeView === 'standard') {
      base = base.filter(o => (o.effectiveRaceName || o.raceName) === raceFilter)
    }
    if (!searchQuery) return base
    const query = searchQuery.trim().toLowerCase()
    return base.filter(o => matchesSearch(o, query))
  }, [completedOrders, raceFilter, searchQuery, matchesSearch, activeView])

  // Completed orders show under the open ones, in the same table: in a search,
  // in the standard queue's All, and in custom's All.
  const showDoneInline = !!searchQuery || showStandardDone || (activeView === 'custom' && customAll)
  const doneHasMore = showStandardDone && completedCount != null && completedPage.length < completedCount

  // --- Bulk research ---
  // Orders eligible for batch research from the *currently visible* queue.
  // Skips: completed, missing scraper, already researched, creator/partner.
  // Honors the active race + search filters so the user can scope a run.

  // --- Keyboard navigation between orders (j/k) ---
  // When the order detail modal is open, j moves to the next order in the
  // currently visible queue and k moves to the previous one. Skipped when
  // the user is typing into a field or in the middle of an inline edit.
  //
  // navigableOrders = the list j/k cycle through. When the open order is a
  // completed one (e.g. a custom order sent to production), navigate within the
  // completed list so j/k scroll through all completed orders. Otherwise use the
  // active queue (filteredOrders), inserting the selected order if it isn't
  // already there so j/k keep working right after marking an order complete.
  const navigableOrders = useMemo(() => {
    if (!selectedOrder) return filteredOrders
    // Completed order open → cycle through the completed list.
    if (filteredCompletedOrders.some(o => o.id === selectedOrder.id)) {
      return filteredCompletedOrders
    }
    const inFiltered = filteredOrders.some(o => o.id === selectedOrder.id)
    if (inFiltered) return filteredOrders
    // Insert selected order at its natural position (by orderNumber) so j/k feel consistent
    const result = [...filteredOrders]
    const insertIdx = result.findIndex(o =>
      (o.orderNumber || '').localeCompare(selectedOrder.orderNumber || '') > 0
    )
    if (insertIdx === -1) {
      result.push(selectedOrder)
    } else {
      result.splice(insertIdx, 0, selectedOrder)
    }
    return result
  }, [filteredOrders, filteredCompletedOrders, selectedOrder])

  const currentOrderIndex = useMemo(() => {
    if (!selectedOrder) return -1
    return navigableOrders.findIndex(o => o.id === selectedOrder.id)
  }, [selectedOrder, navigableOrders])

  const navigateOrder = useCallback((direction: 'next' | 'prev') => {
    if (currentOrderIndex < 0) return
    const target = direction === 'next' ? currentOrderIndex + 1 : currentOrderIndex - 1
    if (target < 0 || target >= navigableOrders.length) return
    replaceNextUrl.current = true
    setSelectedOrder(navigableOrders[target])
    setIsEditing(false)
    setEditValues({ runnerNameOverride: '', bibNumber: '', officialTime: '', officialPace: '' })
  }, [currentOrderIndex, navigableOrders])

  useEffect(() => {
    if (!selectedOrder) return
    const handler = (e: KeyboardEvent) => {
      // Don't hijack j/k when the user is typing or editing inline
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }
      if (isEditing) return
      // F: Mark as complete (after A approved the design and A attached it in Artelo).
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat && (e.key === 'f' || e.key === 'F')) {
        if (selectedOrder.status === 'completed' || selectedOrder.status === 'flagged') return
        if (selectedOrder.trackstarOrderType === 'standard' && !standardDesignApprovedRef.current) return
        e.preventDefault()
        markAsCompletedRef.current(selectedOrder.orderNumber)
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // S = up (previous), D = down (next), on the left hand with A, R and F.
      // Matches the on-screen chips.
      if (e.key === 'Escape') {
        e.preventDefault()
        closeModal()
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        navigateOrder('prev')
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        navigateOrder('next')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedOrder, isEditing, navigateOrder, closeModal])

  // 1-4 switch views, in the order the toggle shows them. Only when no
  // order is open and nobody is typing.
  useEffect(() => {
    const views = ['standard', 'custom', 'race_partner', 'bulk'] as const
    const handler = (e: KeyboardEvent) => {
      if (selectedOrder || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      const i = ['1', '2', '3', '4'].indexOf(e.key)
      if (i < 0) return
      e.preventDefault()
      setActiveView(views[i])
      setSearchQuery('')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedOrder, setActiveView])

  // Helper to check if an order has multiple items
  const getOrderItemCount = useCallback((parentOrderNumber: string) => orderItemCount(orders, parentOrderNumber), [orders])
  // Which print this is among the order's prints (see orderItemPosition).
  const getOrderItemPosition = useCallback((order: Order) => orderItemPosition(orders, order), [orders])

  // One toolbar for all four views: search on every one, the race filter
  // and research button where they apply.
  // On mobile they stack; on md+ the race select sits beside search.
  const toolbar = (
    <div className="p-3 md:p-4 border-b border-border-gray flex-shrink-0">
      <div className="flex flex-col md:flex-row md:items-end gap-2 md:gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-off-black/40" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search this view by order #, runner, bib, race or customer email (⌘K searches every order)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter on an exact order number opens that order, from any view.
              if (e.key !== 'Enter') return
              const q = searchQuery.trim().replace(/^#/, '').toLowerCase()
              if (!q) return
              const hit = orders
                .filter(o => [o.displayOrderNumber, o.parentOrderNumber, o.orderNumber].some(v => String(v || '').replace(/^#/, '').toLowerCase() === q))
                .sort((a, b) => (a.lineItemIndex || 0) - (b.lineItemIndex || 0))[0]
              if (hit) { e.preventDefault(); setSelectedOrder(hit); searchInputRef.current?.blur() }
            }}
            className="w-full pl-9 md:pl-11 pr-4 py-2 md:py-3 bg-subtle-gray border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30 transition-colors"
          />
        </div>
        {/* Team member and race, folded away until wanted. A dot counts the ones in use. */}
        {scoped && (
          <button
            onClick={() => setFiltersOpen(o => !o)}
            className={`self-start md:self-auto inline-flex items-center gap-1.5 px-3 py-2 md:py-3 rounded-md text-sm whitespace-nowrap transition-colors ${filtersOpen ? 'bg-subtle-gray text-off-black' : 'text-off-black/55 hover:text-off-black hover:bg-subtle-gray'}`}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {((scoped && person ? 1 : 0) + (activeView === 'standard' && raceFilter ? 1 : 0)) > 0 && <span className="px-1.5 py-0.5 rounded-full bg-dark-fill text-white text-[10px] font-semibold tabular-nums leading-none">{(scoped && person ? 1 : 0) + (activeView === 'standard' && raceFilter ? 1 : 0)}</span>}
            <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
        {activeView === 'custom' && (
        <div>
          <div className="hidden md:block text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mb-1">Show</div>
          <div className="flex md:inline-flex w-full md:w-auto rounded-md border border-border-gray bg-subtle-gray p-0.5">
            {([[false, 'Open', ordersToFulfill.length], [true, 'All', ordersToFulfill.length + completedOrders.length]] as const).map(([all, label, n]) => (
              <button
                key={label}
                onClick={() => setCustomAll(all)}
                title={all ? 'Every custom order: open ones by due date, then completed' : 'Open custom orders, due soonest first'}
                className={`flex-1 md:flex-none px-2 md:px-3 py-1.5 md:py-2.5 rounded text-xs md:text-sm font-medium whitespace-nowrap transition-colors inline-flex items-center justify-center gap-1 md:gap-1.5 ${customAll === all ? 'bg-white text-off-black shadow-sm' : 'text-off-black/55 hover:text-off-black'}`}
              >
                {label}
                <span className={`text-[11px] tabular-nums ${customAll === all ? 'text-off-black/50' : 'text-off-black/35'}`}>{n}</span>
              </button>
            ))}
          </div>
        </div>
        )}
        {activeView === 'standard' && (
        <div>
          <div className="hidden md:block text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mb-1">Queue</div>
          <div className="flex md:inline-flex w-full md:w-auto rounded-md border border-border-gray bg-subtle-gray p-0.5">
            {([['', 'All', fulfillable.length], ['review', 'Review', stageCounts.review], ['attach', 'Attach', stageCounts.attach], ['action', 'Action', stageCounts.action], ['waiting', 'Waiting', stageCounts.waiting]] as const).map(([key, label, n]) => (
              <button
                key={key || 'all'}
                onClick={() => setStageFilter(key)}
                className={`flex-1 md:flex-none px-2 md:px-3 py-1.5 md:py-2.5 rounded text-xs md:text-sm font-medium whitespace-nowrap transition-colors inline-flex items-center justify-center gap-1 md:gap-1.5 ${stageFilter === key ? 'bg-white text-off-black shadow-sm' : 'text-off-black/55 hover:text-off-black'}`}
              >
                {label}
                <span className={`text-[11px] tabular-nums ${stageFilter === key ? 'text-off-black/50' : 'text-off-black/35'}`}>{n}</span>
              </button>
            ))}
          </div>
          {/* Set apart: orders for races not yet run. Not in any count above. */}
          {stageCounts.notRun > 0 && (
            <button onClick={() => setStageFilter(stageFilter === 'not_run' ? '' : 'not_run')}
              title="Orders for races that have not happened yet. Nothing to do until race day; they are not counted as orders to fulfill."
              className={`ml-0 md:ml-2 mt-1.5 md:mt-0 inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 md:py-2.5 rounded-md border border-dashed text-xs md:text-sm font-medium whitespace-nowrap transition-colors ${stageFilter === 'not_run' ? 'bg-white border-off-black/30 text-off-black shadow-sm' : 'border-border-gray text-off-black/45 hover:text-off-black'}`}>
              Not run yet <span className="text-[11px] tabular-nums opacity-70">{stageCounts.notRun}</span>
            </button>
          )}
        </div>
        )}
        {(activeView === 'race_partner' || activeView === 'bulk') && (
          <button
            onClick={() => activeView === 'bulk' ? setBulkCreating(true) : setShowNewRacePartner(true)}
            className="inline-flex items-center justify-center gap-2 px-4 md:px-5 py-2.5 md:py-3 bg-dark-fill text-white rounded-md hover:opacity-90 transition-opacity font-medium text-sm whitespace-nowrap"
          >
            {activeView === 'bulk' ? <Plus className="w-4 h-4" /> : <ImagePlus className="w-4 h-4" />}
            {activeView === 'bulk' ? 'New Bulk Order' : 'New Partner'}
          </button>
        )}
      </div>
      {filtersOpen && scoped && (
      <div className="mt-2 md:mt-3">
        {/* Whose orders. Clicking a person in Current Team does the same. */}
        {/* On the phone the person and race pickers share one row, with no labels. */}
        <div className="grid grid-cols-2 gap-2 md:flex md:gap-3">
        {scoped && (
          <div className={`md:w-52 ${activeView === 'standard' ? '' : 'col-span-2'}`}>
            <div className="hidden md:block text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mb-1">Team Member</div>
            <PersonFilter team={team} value={person} meId={myId} onChange={setPersonFilter} />
          </div>
        )}
        {activeView === 'standard' && (
        <div className={`md:w-64 ${scoped ? '' : 'col-span-2'}`}>
          <div className="hidden md:block text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mb-1">Race</div>
          <div className="relative">
          <select
            value={raceFilter}
            onChange={(e) => setRaceFilter(e.target.value)}
            className={`w-full appearance-none pl-3 md:pl-4 pr-9 py-2 md:py-3 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30 transition-colors cursor-pointer ${
              raceFilter
                ? 'bg-dark-fill text-white border-dark-fill'
                : 'bg-subtle-gray border-border-gray text-off-black'
            }`}
          >
            <option value="" className="bg-white text-off-black">All races ({raceFilterOptions.reduce((s, [, c]) => s + c, 0)})</option>
            {raceFilterOptions.map(([name, count]) => (
              <option key={name} value={name} className="bg-white text-off-black">{name} ({count})</option>
            ))}
          </select>
          <ChevronDownIcon className={`w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${raceFilter ? 'text-white' : 'text-off-black/40'}`} />
          </div>
        </div>
        )}
        </div>
      </div>
      )}
    </div>
  )

  return (
    <div className="h-[calc(100dvh-92px-env(safe-area-inset-bottom))] md:h-screen overflow-hidden bg-[#f3f3f3] flex flex-col">
      <div className="max-w-[1800px] mx-auto px-4 md:px-6 lg:px-8 w-full flex flex-col h-full">
        {/* Header - Compact bar on mobile, full greeting on desktop */}
        {/* The phone header: stars, count, tool name, the view picker. */}
        {!inlineDetail && (
          <PageHeader
            title={activeView === 'standard' ? 'Standard Orders' : activeView === 'custom' ? 'Custom Orders' : activeView === 'bulk' ? 'Bulk Orders' : 'Partners'}
            pill={`${activeView === 'bulk' ? (bulkCount ?? '') : fulfillable.length} orders`}
            subtitle={lastImportedAt ? `Last refreshed ${new Date(lastImportedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : undefined}
            control={
              <div className="relative">
                <select
                  value={activeView}
                  onChange={(e) => { setActiveView(e.target.value as 'standard' | 'custom' | 'race_partner' | 'bulk'); setSearchQuery('') }}
                  className="appearance-none pl-3 pr-7 py-1.5 text-xs font-medium rounded-full border border-border-gray bg-white text-off-black focus:outline-none focus:ring-2 focus:ring-off-black/20"
                >
                  <option value="standard">Standard</option>
                  <option value="custom">Custom</option>
                  <option value="race_partner">Partners</option>
                  <option value="bulk">Bulk</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center"><ChevronDownIcon className="w-3.5 h-3.5 text-off-black/40" /></div>
              </div>
            }
          />
        )}
        <div className={`pt-4 md:pt-5 pb-3 items-center justify-between gap-3 md:gap-6 flex-shrink-0 hidden md:flex`}>
          {/* Left side: logo, greeting, and summary */}
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2.5">
              <img
                src="/trackstar-stars-transparent.png"
                alt="Trackstar"
                className="h-8 md:h-[34px] w-auto shrink-0 object-contain"
              />
            </div>
            <div className="hidden md:block">
              <h1 className="text-[29px] font-bold text-off-black">
                {getGreeting()}, {greetingName(currentUser)}
              </h1>

            </div>
          </div>

        </div>

        {/* Orders to Personalize Section. While an order is open, its header
            stays and the order takes the table's place (inlineDetail). */}
        {!isLoading && (
        <section className={inlineDetail ? 'flex-shrink-0 flex flex-col' : `flex-1 flex flex-col min-h-0 pb-4 ${activeView === 'race_partner' && completedOrders.length > 0 ? '' : 'md:pb-6'}`}>
          {/* Section Header */}
          <div className={`items-center justify-between mb-3 md:mb-4 flex-shrink-0 hidden md:flex`}>
            <div>
            <div className="flex items-center gap-3 md:gap-6">
              <h2 className="text-base md:text-lg font-semibold text-off-black uppercase tracking-tight">
                <span className="hidden md:inline-block relative">
                  {activeView === 'standard' ? 'Standard Orders' : activeView === 'custom' ? 'Custom Orders' : activeView === 'bulk' ? 'Bulk Orders' : 'Partners'}
                  {/* Notification bubble, overlapping the end of the heading. */}
                  <span className="absolute -top-3 -right-6 z-10 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-[#4600D6] text-white text-[11px] font-bold leading-none tracking-normal shadow-[0_2px_6px_rgba(70,0,214,0.45)] ring-2 ring-white">
                    {activeView === 'bulk' ? (bulkCount ?? '') : fulfillable.length}
                  </span>
                </span>
              </h2>
              {isRefreshing && <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />}
              {activeView === 'standard' && onTime && <OnTimeStat stat={onTime} lateActive={stageFilter === 'late'} onLate={() => setStageFilter(stageFilter === 'late' ? '' : 'late')} />}
            </div>
            {lastImportedAt && (
              <button
                onClick={importOrders}
                disabled={isImporting}
                className="mt-1 inline-flex items-center gap-1.5 text-xs text-off-black/45 hover:text-off-black/70 disabled:cursor-default"
                title="Orders import on their own every 10 minutes. Click to check now."
              >
                {isImporting && <Loader2 className="w-3 h-3 animate-spin" />}
                {isImporting ? 'Checking for new orders…' : `Last refreshed ${new Date(lastImportedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
              </button>
            )}
            </div>
            {/* View Switcher - Desktop. A segmented control rather than three
                free-standing pills: these are three views of one list, not three
                separate actions, and grouping them says so. Matches the channel
                switcher in the pricing panel. Mobile keeps its dropdown, which
                is the right control when the options do not fit side by side. */}
            <div className="hidden md:block relative">
            {/* Floats above the switcher so the header keeps its height. */}
            <div className="absolute bottom-full right-0 mb-2.5">
              {activeView === 'standard' && sentToday
                ? <TeamPanel team={team} sent={sentToday.byPerson} toApprove={toApprove} selected={person} onSelect={(id) => setPersonFilter(f => f === id ? '' : id)} />
                : <QueuePill people={teamQueue} team={team} selected={person} onSelect={scoped ? (id) => setPersonFilter(f => f === id ? '' : id) : undefined} />}
            </div>
            <div className={`inline-flex ${segmentGroup}`}>
              {([
                ['standard', 'Standard'],
                ['custom', 'Custom'],
                ['race_partner', 'Partners'],
                ['bulk', 'Bulk'],
              ] as const).map(([key, label], i) => (
                <button
                  key={key}
                  onClick={() => { closeModal(); setActiveView(key); setSearchQuery('') }}
                  className={`${segment(activeView === key, 'md')} inline-flex items-center gap-2`}
                  title={`${label} (${i + 1})`}
                >
                  {label}
                  <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-current/25 text-[10px] font-medium leading-none opacity-60 font-sans">{i + 1}</kbd>
                </button>
              ))}
            </div>
            </div>
          </div>

          {/* Bulk is its own screen: a table of runs, not a list of orders. The
              runner rows are still orders, so the modal below opens them. */}
          {inlineDetail ? null : activeView === 'bulk' ? (
            <BulkView
              onOpenRunner={(orderNumber) => { const o = orders.find(x => x.orderNumber === orderNumber); if (o) setSelectedOrder(o); else fetchOrders().then(() => { const oo = orders.find(x => x.orderNumber === orderNumber); if (oo) setSelectedOrder(oo) }) }}
              refreshRunners={() => { fetchOrders() }}
              onCount={setBulkCount}
              toolbar={toolbar}
              search={searchQuery}
              creating={bulkCreating}
              onCreatingChange={setBulkCreating}
              team={team}
              meId={myId}
            />
          ) : (
          <div className="bg-white border border-border-gray rounded-lg shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
            {toolbar}

            {/* Scrollable Container */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">

              {/* ===== MOBILE CARD LIST ===== */}
              <div className="md:hidden divide-y divide-border-gray">
                {activeView === 'standard' ? (
                  <>
                    {filteredOrders.map((order) => {
                      const statusDisplay = getStatusDisplay(order)
                      const itemCount = getOrderItemCount(order.parentOrderNumber)
                      return (
                        <div
                          key={order.id}
                          onClick={() => setSelectedOrder(order)}
                          className="px-4 py-3 active:bg-subtle-gray cursor-pointer"
                        >
                          {/* Row 1: Source + Order# + Badges ... Status */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <OrderSourceMark source={order.source} size="sm" />
                              <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                              {itemCount > 1 && (
                                <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                  {getOrderItemPosition(order)}/{itemCount}
                                </span>
                              )}
                              {(() => { const age = orderAge(order); return <span className={`text-[11px] whitespace-nowrap ${age.cls}`}>{age.label}</span> })()}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <HoverTip text={statusDisplay.label} align="center">
                                <span className="cursor-help"><StatusPill size="xs" label={statusDisplay.label} dot={statusDisplay.dot} color={statusDisplay.color} bg={statusDisplay.bg} /></span>
                              </HoverTip>
                              {(order.notes || (order.commentCount ?? 0) > 0) && (
                                <HoverTip text="Has notes or comments"><MessageSquareText className="w-3.5 h-3.5 text-amber-500 cursor-help" /></HoverTip>
                              )}
                              {!person && order.assigneeName && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-off-black/60 whitespace-nowrap" title="Assigned to">{(() => { const u = team.find(t => t.id === order.assigneeId); return u ? <Avatar user={u} size={16} /> : null })()}{order.assigneeName}</span>
                              )}
                            </div>
                          </div>
                          {/* Row 2: Runner, then race underneath */}
                          <div className="mt-1">
                            <div className="text-sm text-off-black">
                              {order.effectiveRunnerName || order.runnerName || 'Unknown Runner'}
                            </div>
                            <div className="text-xs text-off-black/50 mt-0.5">
                              {order.effectiveRaceName || order.raceName} {order.effectiveRaceYear || order.raceYear}
                            </div>
                            {order.status === 'ready' && order.bibNumber && (
                              <div className="text-xs text-green-600 mt-0.5">
                                Bib {order.bibNumber} · {order.hadNoTime ? 'No time' : order.officialTime || 'time needed'}
                              </div>
                            )}
                          </div>
                          {/* Row 3: Tags */}
                          <OrderTags order={order} className="mt-1.5" />
                        </div>
                      )
                    })}
                    {/* Completed orders in search (mobile) */}
                    {showDoneInline && filteredCompletedOrders.length > 0 && (
                      <>
                        <div className="px-4 py-2.5 bg-subtle-gray/50">
                          <span className="text-xs font-semibold text-off-black/40 uppercase tracking-wider">{doneHeading}</span>
                        </div>
                        {filteredCompletedOrders.map((order) => {
                          const itemCount = getOrderItemCount(order.parentOrderNumber)
                          return (
                            <div
                              key={order.id}
                              onClick={() => setSelectedOrder(order)}
                              className="px-4 py-3 active:bg-subtle-gray cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <OrderSourceMark source={order.source} size="sm" />
                                  <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                                  {itemCount > 1 && (
                                    <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                      {getOrderItemPosition(order)}/{itemCount}
                                    </span>
                                  )}
                                </div>
                                <span className="text-base flex-shrink-0">✅</span>
                              </div>
                              <div className="mt-1">
                                <span className="text-sm text-off-black">{order.effectiveRunnerName || order.runnerName || 'Unknown Runner'}</span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2">
                                <span className="text-xs text-off-black/40">Completed</span>
                                <span className="text-xs text-off-black/40 truncate text-right max-w-[50%]">
                                  {order.effectiveRaceName || order.raceName}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </>
                ) : (
                  /* Custom Designs / Partners - Mobile Cards */
                  <>
                    {filteredOrders.map((order) => {
                      const designConfig = DESIGN_STATUS_CONFIG[order.designStatus as DesignStatus] || DESIGN_STATUS_CONFIG.not_started
                      const itemCount = getOrderItemCount(order.parentOrderNumber)
                      const isPartner = order.trackstarOrderType === 'race_partner'
                      return (
                        <div
                          key={order.id}
                          onClick={() => setSelectedOrder(order)}
                          className="px-4 py-3 active:bg-subtle-gray cursor-pointer"
                        >
                          {/* Row 1: Design status + Order# + badges */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${designConfig.bgColor} ${designConfig.color}`}>
                                <span className={`w-2 h-2 rounded-full shrink-0 ${designConfig.dot}`} aria-hidden />
                                {designLabel(order.designStatus, order.trackstarOrderType)}
                              </span>
                              {!isPartner && (
                                <>
                                  <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                                  {itemCount > 1 && (
                                    <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                      {getOrderItemPosition(order)}/{itemCount}
                                    </span>
                                  )}
                                </>
                              )}
                              {(order.notes || (order.commentCount ?? 0) > 0) && (
                                <HoverTip text="Has notes or comments"><MessageSquareText className="w-3.5 h-3.5 text-amber-500 cursor-help" /></HoverTip>
                              )}
                              {!person && order.assigneeName && (
                                <span className="inline-flex items-center gap-1 text-[11px] text-off-black/60 whitespace-nowrap" title="Assigned to">{(() => { const u = team.find(t => t.id === order.assigneeId); return u ? <Avatar user={u} size={16} /> : null })()}{order.assigneeName}</span>
                              )}
                            </div>
                          </div>
                          {/* Row 2: Runner name (or Partner name) */}
                          <div className="mt-1">
                            <span className="text-sm text-off-black font-medium">
                              {isPartner
                                ? (order.partnerName || order.raceName || 'Partner')
                                : (order.effectiveRunnerName || order.runnerName || 'Unknown Runner')}
                            </span>
                          </div>
                          {/* Row 3: Due date + Race (or Year + Contact for partner) */}
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            {isPartner ? (
                              <>
                                <span className="text-xs text-off-black/40">
                                  {order.raceYear ? `Year: ${order.raceYear}` : ''}
                                </span>
                                <span className="text-xs text-off-black/40 truncate text-right max-w-[50%]">
                                  {order.partnerContactName || order.customerEmail || '-'}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className={`text-xs flex items-center gap-1.5 ${isDueDateUrgent(order.dueDate, dueIsLive(order)) ? 'text-red-600 font-medium' : 'text-off-black/40'}`}>
                                  {order.isRushOrder && (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800" title="Customer paid to skip the line: 4-day turnaround">
                                      ⚡ Rush
                                    </span>
                                  )}
                                  <span>Due: {formatDueDate(order.dueDate, dueIsLive(order))}</span>
                                </span>
                                <span className="text-xs text-off-black/40 truncate text-right max-w-[50%]">
                                  {order.effectiveRaceName || order.raceName || '-'}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {/* Completed orders in search (custom mobile) */}
                    {showDoneInline && filteredCompletedOrders.length > 0 && (
                      <>
                        <div className="px-4 py-2.5 bg-subtle-gray/50">
                          <span className="text-xs font-semibold text-off-black/40 uppercase tracking-wider">{doneHeading}</span>
                        </div>
                        {filteredCompletedOrders.map((order) => {
                          const designConfig = DESIGN_STATUS_CONFIG[order.designStatus as DesignStatus] || DESIGN_STATUS_CONFIG.sent_to_production
                          const itemCount = getOrderItemCount(order.parentOrderNumber)
                          return (
                            <div
                              key={order.id}
                              onClick={() => setSelectedOrder(order)}
                              className="px-4 py-3 active:bg-subtle-gray cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${designConfig.bgColor} ${designConfig.color}`}>
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${designConfig.dot}`} aria-hidden />
                                    {designLabel(order.designStatus, order.trackstarOrderType)}
                                  </span>
                                  <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                                  {itemCount > 1 && (
                                    <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                      {getOrderItemPosition(order)}/{itemCount}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="mt-1">
                                <span className="text-sm text-off-black">{order.effectiveRunnerName || order.runnerName || 'Unknown Runner'}</span>
                              </div>
                              <div className="mt-0.5 flex items-center justify-between gap-2">
                                <span className="text-xs text-off-black/40">Completed</span>
                                <span className="text-xs text-off-black/40 truncate text-right max-w-[50%]">
                                  {order.effectiveRaceName || order.raceName || '-'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </>
                )}

                {filteredOrders.length === 0 && !searchQuery && (
                  <div className="text-center py-12 text-off-black/40 text-sm">
                    {activeView === 'standard' ? 'No orders to personalize' : activeView === 'custom' ? 'No custom designs' : 'No partners yet - click "New Partner" to add one'}
                  </div>
                )}
                {searchQuery && filteredOrders.length === 0 && filteredCompletedOrders.length === 0 && (
                  <div className="text-center py-12 text-off-black/40 text-sm">
                    No matching orders found
                  </div>
                )}
              </div>

              {/* ===== DESKTOP TABLE ===== */}
              <table className={`w-full hidden md:table ${scoped ? 'table-fixed' : ''}`}>
                {activeView === 'standard' ? (
                  <>
                    {/* Standard Orders Table */}
                    <thead className="bg-subtle-gray border-b border-border-gray sticky top-0 z-10">
                      <tr>
                        <th className="text-center pl-6 pr-2 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-28">Src</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-40">Order #</th>
                        <th className="text-center px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider"><span className="inline-flex items-center">Status<StatusLegend /></span></th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-1/4">Details</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-52">
                          <div className="flex items-center gap-2 leading-none">
                            Assignee
                          </div>
                        </th>
                        <th className="text-left px-3 pr-6 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider hidden md:table-cell">Tags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-gray">
                      {filteredOrders.map((order, index) => {
                        const statusDisplay = getStatusDisplay(order)
                        const itemCount = getOrderItemCount(order.parentOrderNumber)
                        return (
                          <tr
                            key={order.id}
                            onClick={() => setSelectedOrder(order)}
                            className={`hover:bg-subtle-gray cursor-pointer transition-colors ${index % 2 === 1 ? 'bg-subtle-gray/30' : ''}`}
                          >
                            <td className="pl-6 pr-2 py-4 text-center">
                              <OrderSourceMark source={order.source} />
                            </td>
                            <td className="px-3 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                                {itemCount > 1 && (
                                  <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                    Item {getOrderItemPosition(order)} of {itemCount}
                                  </span>
                                )}
                              </div>
                              {(() => { const age = orderAge(order); return <div className={`mt-0.5 text-[11px] ${age.cls}`}>{age.label}</div> })()}
                            </td>
                            <td className="px-3 py-4 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <HoverTip text={order.pipeline?.fix || statusDisplay.label} align="center">
                                  <span className="inline-flex items-center gap-1.5 cursor-help whitespace-nowrap">
                                    <StatusPill label={statusDisplay.label} dot={statusDisplay.dot} color={statusDisplay.color} bg={statusDisplay.bg} />
                                  </span>
                                </HoverTip>
                                {(order.notes || (order.commentCount ?? 0) > 0) && (
                                  <HoverTip text="Has notes or comments"><MessageSquareText className="w-3.5 h-3.5 text-amber-500 cursor-help" /></HoverTip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-4">
                              <div className="text-sm text-off-black">{order.effectiveRunnerName || order.runnerName || 'Unknown Runner'}</div>
                              <div className="text-xs text-off-black/50 mt-0.5">
                                {order.effectiveRaceName || order.raceName} {order.effectiveRaceYear || order.raceYear}
                              </div>
                              {/* Result data once research lands. Everything else
                                  that used to live here is now a tag. */}
                              {order.status === 'ready' && order.bibNumber && (
                                <div className="text-xs text-green-600 mt-1 leading-tight">
                                  Bib {order.bibNumber} · {order.hadNoTime ? 'No time' : order.officialTime || 'time needed'}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-4">{assigneeCell(order)}</td>
                            <td className="px-3 pr-6 py-4 hidden md:table-cell align-middle">
                              <OrderTags order={order} />
                            </td>
                          </tr>
                        )
                      })}
                      {/* Completed orders inline when searching (standard view) */}
                      {showDoneInline && filteredCompletedOrders.length > 0 && (
                        <>
                          <tr className="bg-subtle-gray/50">
                            <td colSpan={6} className="px-6 py-3">
                              <span className="text-xs font-semibold text-off-black/40 uppercase tracking-wider">{doneHeading}</span>
                            </td>
                          </tr>
                          {filteredCompletedOrders.map((order, index) => {
                            const itemCount = getOrderItemCount(order.parentOrderNumber)
                            return (
                              <tr
                                key={order.id}
                                onClick={() => setSelectedOrder(order)}
                                className={`hover:bg-subtle-gray cursor-pointer transition-colors ${index % 2 === 1 ? 'bg-subtle-gray/30' : ''}`}
                              >
                                <td className="pl-6 pr-2 py-4 text-center">
                                  <OrderSourceMark source={order.source} />
                                </td>
                                <td className="px-3 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                                    {itemCount > 1 && (
                                      <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                        Item {getOrderItemPosition(order)} of {itemCount}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-4 text-center">
                                  <span className="inline-flex items-center gap-1.5 text-xs text-off-black/60 whitespace-nowrap"><span className="w-2 h-2 rounded-full bg-green-500" />{doneLabel}</span>
                                </td>
                                <td className="px-3 py-4">
                                  <div className="text-sm text-off-black">{order.effectiveRunnerName || order.runnerName || 'Unknown Runner'}</div>
                                  <div className="text-xs text-off-black/50 mt-0.5">
                                    {order.effectiveRaceName || order.raceName} {order.effectiveRaceYear || order.raceYear}
                                  </div>
                                </td>
                                <td className="px-3 py-4">{assigneeCell(order)}</td>
                                <td className="px-3 pr-6 py-4 hidden md:table-cell align-middle">
                                  <OrderTags order={order} />
                                </td>
                              </tr>
                            )
                          })}
                        </>
                      )}
                    </tbody>
                  </>
                ) : activeView === 'race_partner' ? (
                  <>
                    {/* Partners Table */}
                    <thead className="bg-subtle-gray border-b border-border-gray sticky top-0 z-10">
                      <tr>
                        <th className="text-left pl-6 pr-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-44">Design Status</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider">Partner</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-24">Year</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider hidden md:table-cell">Contact</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-40">Assignee</th>
                        <th className="text-left px-3 pr-6 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider">Options Sent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-gray">
                      {filteredOrders.map((order, index) => {
                        const designConfig = DESIGN_STATUS_CONFIG[order.designStatus as DesignStatus] || DESIGN_STATUS_CONFIG.not_started
                        return (
                          <tr
                            key={order.id}
                            onClick={() => setSelectedOrder(order)}
                            className={`hover:bg-subtle-gray cursor-pointer transition-colors ${index % 2 === 1 ? 'bg-subtle-gray/30' : ''}`}
                          >
                            <td className="pl-6 pr-3 py-4">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${designConfig.bgColor} ${designConfig.color}`}>
                                <span className={`w-2 h-2 rounded-full shrink-0 ${designConfig.dot}`} aria-hidden />
                                {designLabel(order.designStatus, order.trackstarOrderType)}
                              </span>
                            </td>
                            <td className="px-3 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-off-black">{order.partnerName || order.raceName || 'Partner'}</span>
                                {(order.notes || (order.commentCount ?? 0) > 0) && (
                                  <HoverTip text="Has notes or comments"><MessageSquareText className="w-3.5 h-3.5 text-amber-500 cursor-help" /></HoverTip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-4">
                              <span className="text-sm text-off-black/70">{order.raceYear || '-'}</span>
                            </td>
                            <td className="px-3 py-4 hidden md:table-cell">
                              <span className="text-sm text-off-black/70">{order.partnerContactName || order.customerEmail || '-'}</span>
                            </td>
                            <td className="px-3 py-4">{assigneeCell(order)}</td>
                            {/* Every proof on a partner order is an option on
                                their portal, so the count is the whole story.
                                This column read as empty for two reasons: it
                                was hidden below 1024px, and proofCount was
                                being dropped by mapOrder before it ever
                                reached the row. */}
                            <td className="px-3 pr-6 py-4 text-sm text-off-black/60">
                              {(order.proofCount ?? 0) > 0 ? (
                                <span className="px-2 py-0.5 bg-off-black/5 rounded text-xs font-medium">
                                  {order.proofCount} option{order.proofCount === 1 ? '' : 's'}
                                </span>
                              ) : (
                                <span className="text-off-black/30 text-xs">None</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </>
                ) : (
                  <>
                    {/* Custom Designs Table */}
                    <thead className="bg-subtle-gray border-b border-border-gray sticky top-0 z-10">
                      <tr>
                        <th className="text-center pl-6 pr-2 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-12">Src</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-48">Order #</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-44">Design Status</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-40">Due Date</th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-52">
                          <div className="flex items-center gap-2 leading-none">
                            Assignee
                          </div>
                        </th>
                        <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider hidden md:table-cell">Runner</th>
                        <th className="text-left px-3 pr-6 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider hidden lg:table-cell">Race</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-gray">
                      {filteredOrders.map((order, index) => {
                        const designConfig = DESIGN_STATUS_CONFIG[order.designStatus as DesignStatus] || DESIGN_STATUS_CONFIG.not_started
                        const itemCount = getOrderItemCount(order.parentOrderNumber)
                        return (
                          <tr
                            key={order.id}
                            onClick={() => setSelectedOrder(order)}
                            className={`hover:bg-subtle-gray cursor-pointer transition-colors ${index % 2 === 1 ? 'bg-subtle-gray/30' : ''}`}
                          >
                            <td className="pl-6 pr-2 py-4 text-center">
                              <img
                                src={order.source === 'shopify' ? '/shopify-icon.png' : '/etsy-icon.png'}
                                alt={order.source === 'shopify' ? 'Shopify' : 'Etsy'}
                                title={order.source === 'shopify' ? 'Shopify' : 'Etsy'}
                                className="w-5 h-5 inline-block"
                              />
                            </td>
                            <td className="px-3 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                                {itemCount > 1 && (
                                  <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                    Item {getOrderItemPosition(order)} of {itemCount}
                                  </span>
                                )}
                                {(order.notes || (order.commentCount ?? 0) > 0) && (
                                  <HoverTip text="Has notes or comments"><MessageSquareText className="w-3.5 h-3.5 text-amber-500 cursor-help" /></HoverTip>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-4">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${designConfig.bgColor} ${designConfig.color}`}>
                                <span className={`w-2 h-2 rounded-full shrink-0 ${designConfig.dot}`} aria-hidden />
                                {designLabel(order.designStatus, order.trackstarOrderType)}
                              </span>
                            </td>
                            <td className="px-3 py-4">
                              {/* The rush chip sits with the due date, not with
                                  the order number: the short date is the thing
                                  it explains, and without it a 4-day date just
                                  looks like an order about to be late. */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                {order.isRushOrder && (
                                  <span
                                    className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 whitespace-nowrap"
                                    title="Customer paid to skip the line: 4-day design turnaround"
                                  >
                                    ⚡ Rush
                                  </span>
                                )}
                                <span className={`text-sm ${isDueDateUrgent(order.dueDate, dueIsLive(order)) ? 'text-red-600 font-medium' : 'text-off-black'}`}>
                                  {formatDueDate(order.dueDate, dueIsLive(order))}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-4">{assigneeCell(order)}</td>
                            <td className="px-3 py-4 hidden md:table-cell">
                              <span className="text-sm text-off-black">{order.effectiveRunnerName || order.runnerName || 'Unknown Runner'}</span>
                            </td>
                            <td className="px-3 pr-6 py-4 text-sm text-off-black/60 hidden lg:table-cell">
                              <span className="line-clamp-1">{order.effectiveRaceName || order.raceName || '-'}</span>
                            </td>
                          </tr>
                        )
                      })}
                      {/* Completed orders inline when searching (custom view) */}
                      {showDoneInline && filteredCompletedOrders.length > 0 && (
                        <>
                          <tr className="bg-subtle-gray/50">
                            <td colSpan={7} className="px-6 py-3">
                              <span className="text-xs font-semibold text-off-black/40 uppercase tracking-wider">{doneHeading}</span>
                            </td>
                          </tr>
                          {filteredCompletedOrders.map((order, index) => {
                            const designConfig = DESIGN_STATUS_CONFIG[order.designStatus as DesignStatus] || DESIGN_STATUS_CONFIG.sent_to_production
                            const itemCount = getOrderItemCount(order.parentOrderNumber)
                            return (
                              <tr
                                key={order.id}
                                onClick={() => setSelectedOrder(order)}
                                className={`hover:bg-subtle-gray cursor-pointer transition-colors ${index % 2 === 1 ? 'bg-subtle-gray/30' : ''}`}
                              >
                                <td className="pl-6 pr-2 py-4 text-center">
                                  <img
                                    src={order.source === 'shopify' ? '/shopify-icon.png' : '/etsy-icon.png'}
                                    alt={order.source === 'shopify' ? 'Shopify' : 'Etsy'}
                                    title={order.source === 'shopify' ? 'Shopify' : 'Etsy'}
                                    className="w-5 h-5 inline-block"
                                  />
                                </td>
                                <td className="px-3 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                                    {itemCount > 1 && (
                                      <span className="px-1.5 py-0.5 bg-off-black/5 text-off-black/60 text-[10px] font-medium rounded whitespace-nowrap">
                                        Item {getOrderItemPosition(order)} of {itemCount}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-4">
                                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${designConfig.bgColor} ${designConfig.color}`}>
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${designConfig.dot}`} aria-hidden />
                                    {designLabel(order.designStatus, order.trackstarOrderType)}
                                  </span>
                                </td>
                                <td className="px-3 py-4">
                                  <span className="text-sm text-off-black/40">{order.dueDate ? formatDueDate(order.dueDate, false) : '-'}</span>
                                </td>
                                <td className="px-3 py-4">{assigneeCell(order)}</td>
                                <td className="px-3 py-4 hidden md:table-cell">
                                  <span className="text-sm text-off-black">{order.effectiveRunnerName || order.runnerName || 'Unknown Runner'}</span>
                                </td>
                                <td className="px-3 pr-6 py-4 text-sm text-off-black/60 hidden lg:table-cell">
                                  <span className="line-clamp-1">{order.effectiveRaceName || order.raceName || '-'}</span>
                                </td>
                              </tr>
                            )
                          })}
                        </>
                      )}
                    </tbody>
                  </>
                )}
              </table>

              {filteredOrders.length === 0 && !searchQuery && (
                <div className="hidden md:block text-center py-16 text-off-black/40 text-sm">
                  {activeView === 'standard' ? 'No orders to personalize' : activeView === 'custom' ? 'No custom designs' : 'No partners yet - click "New Partner" to add one'}
                </div>
              )}

              {searchQuery && filteredOrders.length === 0 && filteredCompletedOrders.length === 0 && (
                <div className="hidden md:block text-center py-16 text-off-black/40 text-sm">
                  No matching orders found
                </div>
              )}
              {doneHasMore && <LoadMore loading={completedLoading} onMore={() => loadCompleted(false)} />}
            </div>
          </div>
          )}
        </section>
        )}

        {/* Bottom bar: Partners' completed orders. Standard and custom show
            theirs in the list, so they have no bar and the table runs to the bottom. */}
        {!isLoading && !inlineDetail && activeView === 'race_partner' && completedOrders.length > 0 && (
          <div className="flex-shrink-0 py-1.5 md:py-4 md:mt-2 mb-2 md:mb-8 md:border-t border-border-gray/50">
            <div className="flex items-center justify-center gap-3">
              {(
                <button
                  onClick={() => setShowCompleted(true)}
                  className="inline-flex items-center gap-2 px-3 md:px-4 py-1 md:py-2 md:bg-white md:border border-border-gray rounded-full md:shadow-sm text-xs md:text-sm text-off-black/60 md:text-off-black/70 hover:bg-subtle-gray transition-colors"
                >
                  <span>{showCompleted ? `Close ${doneHeading}` : `View ${doneHeading}`}</span>
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-off-black/5 text-off-black/60">
                    {completedCount ?? completedOrders.length}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Completed Orders Section (Modal-style) */}
        {showCompleted && (
          <div
            className="fixed inset-0 bg-off-black/60 flex items-center justify-center p-4 z-40"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowCompleted(false)
              }
            }}
          >
            <div className="bg-white rounded-none md:rounded-lg max-w-4xl w-full h-[90vh] md:h-auto md:max-h-[80vh] overflow-hidden shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-border-gray">
                <h2 className="text-base md:text-lg font-semibold text-off-black">Completed Orders</h2>
                <button
                  onClick={() => setShowCompleted(false)}
                  className="text-off-black/40 hover:text-off-black text-2xl leading-none transition-colors"
                >
                  ×
                </button>
              </div>
              <div className="overflow-y-auto flex-1">
                {/* Mobile cards for completed orders modal */}
                <div className="md:hidden divide-y divide-border-gray">
                  {filteredCompletedOrders.map((order) => (
                    <div
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className="px-4 py-3 active:bg-subtle-gray cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <img
                            src={order.source === 'shopify' ? '/shopify-icon.png' : '/etsy-icon.png'}
                            alt={order.source === 'shopify' ? 'Shopify' : 'Etsy'}
                            className="w-4 h-4"
                          />
                          <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                        </div>
                        <span className="text-base">✅</span>
                      </div>
                      <div className="mt-1">
                        <span className="text-sm text-off-black">{order.runnerName}</span>
                      </div>
                      <div className="mt-0.5">
                        <span className="text-xs text-off-black/40">{order.raceName} {order.raceYear}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table for completed orders modal. Partners are not
                    runner orders: no source, no runner, just who and when. */}
                {activeView === 'race_partner' ? (
                <table className="w-full hidden md:table">
                  <thead className="bg-subtle-gray border-b border-border-gray sticky top-0">
                    <tr>
                      <th className="text-left pl-6 pr-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-48">Design Status</th>
                      <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider">Partner</th>
                      <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-24">Year</th>
                      <th className="text-left px-3 pr-6 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider">Contact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-gray">
                    {filteredCompletedOrders.map((order, index) => {
                      const cfg = DESIGN_STATUS_CONFIG[order.designStatus as DesignStatus] || DESIGN_STATUS_CONFIG.sent_to_production
                      return (
                        <tr
                          key={order.id}
                          onClick={() => setSelectedOrder(order)}
                          className={`hover:bg-subtle-gray cursor-pointer transition-colors ${index % 2 === 1 ? 'bg-subtle-gray/30' : ''}`}
                        >
                          <td className="pl-6 pr-3 py-4">
                            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${cfg.bgColor} ${cfg.color}`}>
                              <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} aria-hidden />
                              {designLabel(order.designStatus, order.trackstarOrderType)}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-sm font-medium text-off-black">{order.partnerName || order.raceName || 'Partner'}</td>
                          <td className="px-3 py-4 text-sm text-off-black">{order.raceYear || '-'}</td>
                          <td className="px-3 pr-6 py-4 text-sm text-off-black/60">{order.customerName || '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                ) : (
                <table className="w-full hidden md:table">
                  <thead className="bg-subtle-gray border-b border-border-gray sticky top-0">
                    <tr>
                      <th className="text-center pl-6 pr-2 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-12">Src</th>
                      <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider">Order #</th>
                      <th className="text-center px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider w-20"><span className="inline-flex items-center">Status<StatusLegend /></span></th>
                      <th className="text-left px-3 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider">Runner</th>
                      <th className="text-left px-3 pr-6 py-4 text-xs font-semibold text-off-black/60 uppercase tracking-wider">Race</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-gray">
                    {filteredCompletedOrders.map((order, index) => (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        className={`hover:bg-subtle-gray cursor-pointer transition-colors ${index % 2 === 1 ? 'bg-subtle-gray/30' : ''}`}
                      >
                        <td className="pl-6 pr-2 py-4 text-center">
                          <img
                            src={order.source === 'shopify' ? '/shopify-icon.png' : '/etsy-icon.png'}
                            alt={order.source === 'shopify' ? 'Shopify' : 'Etsy'}
                            title={order.source === 'shopify' ? 'Shopify' : 'Etsy'}
                            className="w-5 h-5 inline-block"
                          />
                        </td>
                        <td className="px-3 py-4">
                          <span className="text-sm font-medium text-off-black">{order.displayOrderNumber}</span>
                        </td>
                        <td className="px-3 py-4 text-center">
                          <span className="inline-flex items-center gap-1.5 text-xs text-off-black/60 whitespace-nowrap"><span className="w-2 h-2 rounded-full bg-green-500" />{doneLabel}</span>
                        </td>
                        <td className="px-3 py-4 text-sm text-off-black">
                          {order.runnerName}
                        </td>
                        <td className="px-3 pr-6 py-4 text-sm text-off-black/60">
                          {order.raceName} {order.raceYear}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}

                {filteredCompletedOrders.length === 0 && (
                  <div className="text-center py-16 text-off-black/40 text-sm">
                    {searchQuery ? 'No matching completed orders' : 'No completed orders yet'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Race Database Full-Screen Overlay */}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-off-black/40" />
          </div>
        )}

        {emailingOrder && (
          <EmailCustomerModal
            order={{ id: emailingOrder.id, displayNumber: emailingOrder.displayOrderNumber || emailingOrder.parentOrderNumber, customerEmail: emailingOrder.customerEmail, customerName: emailingOrder.customerName, runnerName: emailingOrder.effectiveRunnerName || emailingOrder.runnerName, raceName: emailingOrder.effectiveRaceName || emailingOrder.raceName, raceYear: emailingOrder.effectiveRaceYear || emailingOrder.raceYear }}
            repName={currentUser?.firstName || ''}
            onClose={() => setEmailingOrder(null)}
          />
        )}

        {/* Order Details Modal */}

        {/* Orders open in the table's place (inlineDetail); one opened from
            the completed list still opens as a popup over it. */}
        <OrderDetail
          order={selectedOrder}
          orders={orders}
          activeView={activeView}
          design={design}
          raceShorthands={raceShorthands}
          team={team}
          myId={myId}
          possibleMatches={possibleMatchesMap}
          setPossibleMatches={setPossibleMatchesMap}
          edit={{ isEditing, setIsEditing, values: editValues, setValues: setEditValues }}
          nav={{ inline: inlineDetail, index: currentOrderIndex, total: navigableOrders.length, go: navigateOrder, close: closeModal }}
          actions={{ setOrders, setSelectedOrder, fetchOrders, loadTeam, setToast, markAsCompleted, assignOrder, emailCustomer: setEmailingOrder }}
        />

        {/* New Partner Modal */}
        {showNewRacePartner && (
          <div
            className="fixed inset-0 bg-off-black/60 flex items-center justify-center p-4 z-50"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowNewRacePartner(false)
            }}
          >
            <div className="bg-white rounded-md max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-heading-md text-off-black">New Partner</h3>
                  <button onClick={() => setShowNewRacePartner(false)} className="text-off-black/40 hover:text-off-black text-2xl leading-none">×</button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-off-black/60 uppercase tracking-wider mb-1.5">Partner / Race Name *</label>
                    <input
                      type="text"
                      value={newPartnerValues.partnerName}
                      onChange={(e) => setNewPartnerValues(v => ({ ...v, partnerName: e.target.value }))}
                      placeholder="e.g. Jersey City Marathon"
                      className="w-full px-3 py-2 border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-off-black/60 uppercase tracking-wider mb-1.5">Year</label>
                    <input
                      type="number"
                      value={newPartnerValues.raceYear}
                      onChange={(e) => setNewPartnerValues(v => ({ ...v, raceYear: e.target.value }))}
                      className="w-full px-3 py-2 border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-off-black/60 uppercase tracking-wider mb-1.5">Contact Name</label>
                    <input
                      type="text"
                      value={newPartnerValues.contactName}
                      onChange={(e) => setNewPartnerValues(v => ({ ...v, contactName: e.target.value }))}
                      placeholder="Optional"
                      className="w-full px-3 py-2 border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-off-black/60 uppercase tracking-wider mb-1.5">Contact Email</label>
                    <input
                      type="email"
                      value={newPartnerValues.contactEmail}
                      onChange={(e) => setNewPartnerValues(v => ({ ...v, contactEmail: e.target.value }))}
                      placeholder="Optional"
                      className="w-full px-3 py-2 border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 mt-6">
                  <button
                    onClick={() => setShowNewRacePartner(false)}
                    className="px-4 py-2 text-sm font-medium text-off-black/70 hover:bg-subtle-gray rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createRacePartner}
                    disabled={isCreatingPartner || !newPartnerValues.partnerName.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-dark-fill text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                  >
                    {isCreatingPartner && <Loader2 className="w-4 h-4 animate-spin" />}
                    {isCreatingPartner ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Toast Notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </div>
  )
}
