import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import BrandToaster from '@/components/BrandToaster'
import { useEffect, useState, Component, lazy, Suspense } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import Dashboard from '@/pages/Dashboard'
import { SignInGate, RequireAdmin, RequireCap, useAuth } from '@/lib/auth'

/**
 * Every page but the Dashboard loads on first visit, so the fulfillment team
 * does not download Monopoly or the customer portals, and customers do not
 * download the admin app. After a deploy an open tab can ask for a chunk that
 * no longer exists; that reloads the page once instead of showing an error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any page's props
function lazyPage<T extends React.ComponentType<any>>(load: () => Promise<{ default: T }>) {
  const KEY = 'ts_chunk_reload'
  return lazy(() => load().then((mod) => {
    try { sessionStorage.removeItem(KEY) } catch { /* private mode */ }
    return mod
  }, (err) => {
    let reloaded = false
    try { reloaded = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1') } catch { /* private mode */ }
    if (!reloaded) { window.location.reload(); return new Promise<{ default: T }>(() => {}) }
    throw err
  }))
}
const ApprovalPortal = lazyPage(() => import('@/pages/ApprovalPortal'))
const BulkIntake = lazyPage(() => import('@/pages/BulkIntake'))
const RunnerClaim = lazyPage(() => import('@/pages/RunnerClaim'))
const SurveyVote = lazyPage(() => import('@/pages/SurveyVote'))
const DesignSurveys = lazyPage(() => import('@/pages/DesignSurveys'))
const CreatorsHome = lazyPage(() => import('@/pages/CreatorsHome'))
const Samples = lazyPage(() => import('@/pages/Samples'))
const BriefsAdmin = lazyPage(() => import('@/pages/BriefsAdmin'))
const CreatorPortal = lazyPage(() => import('@/pages/CreatorPortal'))
const CreatorApply = lazyPage(() => import('@/pages/CreatorApply'))
const Monopoly = lazyPage(() => import('@/pages/Monopoly'))
const MonopolyModel = lazyPage(() => import('@/pages/MonopolyModel'))
const Sales = lazyPage(() => import('@/pages/Sales'))
const SalesWorkspace = lazyPage(() => import('@/pages/SalesWorkspace'))
const Support = lazyPage(() => import('@/pages/Support'))
const Settings = lazyPage(() => import('@/pages/Settings'))

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-dark-fill flex items-center justify-center px-4">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-white mb-2">Something went wrong</h1>
            <p className="text-white/60 text-body-sm mb-6">An unexpected error occurred.</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 text-body-sm font-medium text-off-black bg-white hover:bg-white/90 rounded-md transition-opacity"
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * True when the app is being served from the Marathon Monopoly subdomain.
 *
 * On that host the partnership page is the whole site: it answers at "/" so a
 * race director gets monopoly.trackstar.art rather than a path hanging off the
 * fulfilment tool. The dashboard and the rest of the admin surface are not
 * routed there at all, which also means the subdomain cannot be used to reach
 * them even with the password.
 *
 * Matched on the leading label rather than the full string so preview
 * deployments and any future monopoly.* host behave the same way.
 */
function isMonopolyHost(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname.split('.')[0] === 'monopoly'
}

/** The one canonical address for the partnership page. */
const MONOPOLY_ORIGIN = 'https://monopoly.trackstar.art'

/**
 * creator.trackstar.art: the Creator Program on its own address. The landing
 * page answers at "/" and the onboarding/portal links (/creator/<token>) work
 * there too; nothing else is routed on that host. Old fast.trackstar.art/apply
 * links redirect here (production only, like Monopoly).
 */
function isCreatorHost(): boolean {
  if (typeof window === 'undefined') return false
  return window.location.hostname.split('.')[0] === 'creator'
}
const CREATOR_ORIGIN = 'https://creator.trackstar.art'

function RedirectToCreatorHost() {
  const onProduction = window.location.hostname.endsWith('trackstar.art')
  useEffect(() => {
    if (onProduction) window.location.replace(`${CREATOR_ORIGIN}/apply${window.location.search}`)
  }, [onProduction])
  return onProduction ? null : <CreatorApply />
}

/**
 * Sends an old /monopoly link to the subdomain that now owns the page.
 *
 * A hard redirect rather than a removed route, because links to
 * fast.trackstar.art/monopoly are already in race directors' inboxes and a 404
 * is a worse answer than a redirect. The query string survives so a
 * personalized ?p= link still greets the right race.
 *
 * Only fires on the real domain. On localhost the page keeps rendering in
 * place, otherwise every local run of /monopoly would bounce to production.
 */
function RedirectToMonopolyHost({ path = '/' }: { path?: string }) {
  const onProduction = window.location.hostname.endsWith('trackstar.art')

  useEffect(() => {
    if (onProduction) {
      window.location.replace(`${MONOPOLY_ORIGIN}${path}${window.location.search}`)
    }
  }, [onProduction, path])

  if (onProduction) return null
  return path === '/model' ? (
    <SignInGate>
      <MonopolyModel />
    </SignInGate>
  ) : (
    <Monopoly />
  )
}

/**
 * Sales stays mounted once opened. The first visit of a session reads the
 * queue from Attio (the stars); after that, going to Fulfillment and back
 * shows it exactly as it was left, drafts included. Only a full page load
 * starts it over. Hidden with display:none while another page is up.
 */
function SalesKeepAlive() {
  const { pathname } = useLocation()
  const { can } = useAuth()
  const onSales = pathname === '/sales' || pathname === '/send'
  const [opened, setOpened] = useState(onSales)
  useEffect(() => { if (onSales) setOpened(true) }, [onSales])
  // A role without Sales gets the signpost, and Sales never loads behind it.
  if (!can('sales')) return onSales ? <RequireCap cap="sales"><></></RequireCap> : null
  if (!opened) return null
  return (
    <div className={onSales ? 'contents' : 'hidden'} aria-hidden={!onSales}>
      <Sales active={onSales} />
    </div>
  )
}

/** Support, mounted once opened and only hidden after, like Sales: back and forth with Fulfillment keeps your place. */
function SupportKeepAlive() {
  const { pathname } = useLocation()
  const { can } = useAuth()
  const onSupport = pathname === '/support'
  const [opened, setOpened] = useState(onSupport)
  useEffect(() => { if (onSupport) setOpened(true) }, [onSupport])
  if (!can('support')) return onSupport ? <RequireCap cap="support"><></></RequireCap> : null
  if (!opened) return null
  return (
    <div className={onSupport ? 'contents' : 'hidden'} aria-hidden={!onSupport}>
      <Support active={onSupport} />
    </div>
  )
}

export default function App() {
  if (isCreatorHost()) {
    return (
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<CreatorApply />} />
            {/* Vercel redirects / to /apply here, so link previews get the creator card. */}
            <Route path="/apply" element={<CreatorApply />} />
            <Route path="/creator/:token" element={<CreatorPortal />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          <BrandToaster />
        </BrowserRouter>
      </ErrorBoundary>
    )
  }
  if (isMonopolyHost()) {
    return (
      <ErrorBoundary>
        <BrowserRouter>
          <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<Monopoly />} />
            {/* Same page, so an existing /monopoly link pasted at this host
                still lands somewhere sensible instead of 404ing. */}
            <Route path="/monopoly" element={<Monopoly />} />
            <Route
              path="/model"
              element={
                <SignInGate>
                  <MonopolyModel />
                </SignInGate>
              }
            />
            <Route
              path="/monopoly/model"
              element={
                <SignInGate>
                  <MonopolyModel />
                </SignInGate>
              }
            />
            {/* Anything else on this host is not a page we publish here. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          <BrandToaster />
        </BrowserRouter>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={null}>
        <Routes>
          {/* Public routes — no password gate */}
          <Route path="/approve/:token" element={<ApprovalPortal />} />
          {/* A partner's runner list for a bulk order. The link is the credential. */}
          <Route path="/intake/:token" element={<BulkIntake />} />
          {/* One runner entering their own address for a bulk order. */}
          <Route path="/runner/:token" element={<RunnerClaim />} />
          {/* Design Survey: the community votes on new designs from a story link. */}
          <Route path="/vote/:token" element={<SurveyVote />} />
          <Route path="/creator/:token" element={<CreatorPortal />} />
          {/* The page lives on creator.trackstar.art now. */}
          <Route path="/apply" element={<RedirectToCreatorHost />} />
          {/* The page lives on monopoly.trackstar.art now. */}
          <Route path="/monopoly" element={<RedirectToMonopolyHost />} />

          {/* Protected routes */}
          <Route path="/*" element={
            <SignInGate>
              {/* The rail and the tool panels live outside the route table so
                  they survive a page change. */}
              <AppShell>
              <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                {/* An open order has its own address, so a reload or a shared link lands on it. */}
                <Route path="/orders/:orderRef" element={<Dashboard />} />
                <Route path="/surveys" element={<DesignSurveys />} />
                <Route path="/samples" element={<RequireCap cap="tools.samples"><Samples /></RequireCap>} />
                {/* Admin view: the creator programme, the bulk product editor
                    and the brief admin all change things outside the day to day
                    fulfillment work. */}
                <Route path="/creators" element={<RequireCap cap="creators"><CreatorsHome /></RequireCap>} />
                <Route path="/creators/:creatorId" element={<RequireCap cap="creators"><CreatorsHome /></RequireCap>} />
                {/* The products editor is a Settings section now. */}
                <Route path="/products" element={<Navigate to="/settings/products" replace />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/:panel" element={<Settings />} />
                <Route path="/briefs" element={<RequireAdmin><BriefsAdmin /></RequireAdmin>} />
                <Route path="/briefs/:briefId" element={<RequireAdmin><BriefsAdmin /></RequireAdmin>} />
                {/* Sales is for reps: anyone signed in whose email is on the Attio
                    workspace, or an admin. The API decides; the page shows why not. */}
                {/* Rendered by SalesKeepAlive below, so it survives leaving the page.
                    /send is the short name the brief uses. */}
                <Route path="/sales" element={null} />
                {/* The Sales workspace: templates, sequences and variables. */}
                <Route path="/sales/templates" element={<RequireCap cap="sales"><SalesWorkspace /></RequireCap>} />
                <Route path="/sales/sequences" element={<RequireCap cap="sales"><SalesWorkspace /></RequireCap>} />
                <Route path="/sales/variables" element={<RequireCap cap="sales"><SalesWorkspace /></RequireCap>} />
                <Route path="/send" element={null} />
                {/* Support: the shared inbox for fast@trackstar.art. */}
                {/* Rendered by SupportKeepAlive below, so the open conversation survives a trip to Fulfillment. */}
                <Route path="/support" element={null} />
                <Route path="/monopoly/model" element={<RedirectToMonopolyHost path="/model" />} />
              </Routes>
              <SalesKeepAlive />
              <SupportKeepAlive />
              </Suspense>
              </AppShell>
            </SignInGate>
          } />
        </Routes>
        </Suspense>
        <BrandToaster />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
