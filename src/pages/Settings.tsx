import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, Search, Copy, Loader2, FlaskConical, Check, Settings as SettingsIcon, ChevronLeft, ChevronRight, Star, Users, CloudSun, DollarSign, UserCog, ScrollText, BarChart3, ShieldCheck, KeyRound, Plug, PencilRuler, Lightbulb, EyeOff, Image as ImageIcon } from 'lucide-react'
import { REVIEW_PRODUCTS } from '@/lib/reviewLinks'
import { apiFetch } from '@/lib/api'
import { btnPrimary, inputBase } from '@/lib/ui'
import { useAuth } from '@/lib/auth'
import type { Capability } from '@/lib/roles'
import RenderTemplatesPanel from '@/components/RenderTemplatesPanel'
import DesignNeedsPanel from '@/components/DesignNeedsPanel'
import FeatureRequestsPanel from '@/components/FeatureRequestsPanel'
import PricingCalculator from '@/components/PricingCalculator'
import { PeoplePanel, RolesPanel, ActivityPanel, AccountPanel } from '@/components/TeamPanel'
import ApiKeysPanel from '@/components/ApiKeysPanel'
import ConnectionsPanel from '@/components/ConnectionsPanel'
import RaceDatabasePanel from '@/components/RaceDatabasePanel'
import AssignmentPanel from '@/components/AssignmentPanel'
import SkippedProductsPanel from '@/components/SkippedProductsPanel'
import SiteGalleryPanel from '@/components/SiteGalleryPanel'
import StatsHub from '@/components/StatsHub'
import ProductsBulkEdit from '@/pages/ProductsBulkEdit'
import PageHeader from '@/components/PageHeader'
import LookupHealthPanel from '@/components/LookupHealthPanel'
import ClearResearchCard from '@/components/ClearResearchCard'
import Toast, { type ToastMessage } from '@/components/orders/Toast'

export type SettingsPanel = 'features' | 'design_needs' | 'products' | 'pricing' | 'reviews' | 'stats' | 'races' | 'lookup' | 'storefront' | 'account' | 'people' | 'roles' | 'apikeys' | 'connections' | 'assignments' | 'skipped' | 'gallery' | 'support_closes' | 'activity' | 'counter' | 'designs' | 'diagnostics' | 'maintenance'

/**
 * Settings navigation. Grouped rather than a flat list because the panels do
 * genuinely different jobs — a pricing workspace and a destructive cache wipe
 * should not sit next to each other looking identical.
 *
 * `races` and `lookup` open their own full-screen overlays rather than
 * rendering inline; they are listed here so the nav is the single place you go
 * looking, not because they share the panel area.
 */
const SETTINGS_NAV: {
  group: string
  /** Hidden from anyone who is not an admin. The endpoints behind these refuse
      a non-admin session too, so this is presentation, not the enforcement. */
  adminOnly?: boolean
  /** The role permission (src/lib/roles.ts) an item needs; none means everyone. */
  items: { id: SettingsPanel; label: string; blurb: string; icon: typeof SettingsIcon; cap?: Capability }[]
}[] = [
  {
    group: 'Tools',
    items: [
      { id: 'reviews', label: 'Request Reviews', blurb: 'Copy a review request message for any product', icon: Star, cap: 'settings.reviews' },
      { id: 'features', label: 'Feature Requests', blurb: 'What the team has asked to have built', icon: Lightbulb },
      { id: 'design_needs', label: 'Design Needs', blurb: 'What the production files need so the script can make the print', icon: PencilRuler, cap: 'settings.design_needs' },
    ],
  },
  {
    group: 'Data',
    items: [
      { id: 'races', label: 'Race Database', blurb: 'Race dates, locations and weather', icon: CloudSun, cap: 'settings.data' },
      { id: 'lookup', label: 'Instant Lookup', blurb: 'Which races work, which need help', icon: Search, cap: 'settings.data' },
    ],
  },
  {
    group: 'Account',
    items: [
      { id: 'account', label: 'My Account', blurb: 'Your role and your password', icon: UserCog },
    ],
  },
  {
    group: 'Reports',
    adminOnly: true,
    items: [
      { id: 'stats', label: 'Stats', blurb: 'How fast orders go out, Shopify numbers, the Custom Counter and Tickets Resolved', icon: BarChart3 },
      { id: 'activity', label: 'Activity Log', blurb: 'Who did what, and when', icon: ScrollText },
    ],
  },
  {
    group: 'Store',
    adminOnly: true,
    items: [
      { id: 'pricing', label: 'Pricing Calculator', blurb: 'Costs, retail and margin across DTC and wholesale', icon: DollarSign },
      { id: 'products', label: 'Products & Prices', blurb: 'Change prices across every Shopify product at once', icon: DollarSign },
      { id: 'skipped', label: 'Skipped Products', blurb: 'Shopify products with nothing to personalize, kept out of the fulfillment tool', icon: EyeOff },
      { id: 'gallery', label: 'Site Gallery', blurb: 'Approved customs to feature on the custom product page', icon: ImageIcon },
      { id: 'storefront', label: 'Customers Served', blurb: 'The counter shown on the Shopify storefront', icon: Users },
    ],
  },
  {
    group: 'Team',
    adminOnly: true,
    items: [
      { id: 'people', label: 'People', blurb: 'Who can sign in and what they are allowed to do', icon: Users },
      { id: 'roles', label: 'Roles', blurb: 'What each role can see and use', icon: ShieldCheck },
      { id: 'assignments', label: 'Order Assignment', blurb: 'Who new orders go to, and extra help for busy stretches', icon: UserCog },
    ],
  },
  {
    group: 'System',
    adminOnly: true,
    items: [
      { id: 'connections', label: 'Connections', blurb: 'Shopify, Artelo, Gmail and every other service, on or off', icon: Plug },
      { id: 'apikeys', label: 'API Keys', blurb: 'Keys for Claude and other integrations', icon: KeyRound },
      { id: 'designs', label: 'Designs', blurb: 'Automated prints: which races have a template, the workers and the queue', icon: Sparkles },
      { id: 'diagnostics', label: 'Diagnostics', blurb: 'Test connections and run a full health check', icon: FlaskConical },
      { id: 'maintenance', label: 'Maintenance', blurb: 'Cache and research resets - destructive', icon: SettingsIcon },
    ],
  },
]

/**
 * Settings: /settings, and /settings/<panel> for one section. Drawn over the
 * content area so the rail and the phone's tool bar stay put. On a phone it
 * opens on a list of sections; picking one opens it alone.
 *
 * This used to be a branch of the Dashboard. Everything here is read when
 * Settings opens, so nothing it holds is shared with the order list.
 */
export default function Settings() {
  const { user: currentUser, isAdmin, can } = useAuth()
  /** The settings nav as this person sees it. Only admins see the Admin group. */
  // A role sees only its own items; a group with none left disappears.
  const visibleNav = SETTINGS_NAV
    .filter((g) => !g.adminOnly || isAdmin)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.cap || can(i.cap)) }))
    .filter((g) => g.items.length > 0)
  const visibleItems = visibleNav.flatMap((g) => g.items)

  const goToSettings = useNavigate()
  const { pathname: currentPath } = useLocation()
  // The Custom Counter and Tickets Resolved are tabs of Stats now; their old
  // addresses (/settings/counter, /settings/support_closes) still open them.
  const pathPanel = currentPath.split('/')[2]
  const settingsPanelInUrl = visibleItems.find(i => i.id === pathPanel)?.id
    || (isAdmin && (pathPanel === 'counter' || pathPanel === 'support_closes') ? pathPanel as SettingsPanel : null)
  // A phone opens on the list of sections; a desktop opens on the first one this role can see.
  const isPhone = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  const settingsPanel: SettingsPanel = settingsPanelInUrl || visibleItems[0]?.id || 'account'
  const setSettingsPanel = (id: SettingsPanel) => goToSettings(`/settings/${id}`)
  const [settingsQuery, setSettingsQuery] = useState('')
  type HealthCheck = { status: 'ok' | 'warn' | 'error'; detail?: string | null; latency?: string }
  type HealthResults = { overall: string; checks: Record<string, HealthCheck>; error?: string }
  const [healthResults, setHealthResults] = useState<HealthResults | null>(null)
  const [isRunningHealth, setIsRunningHealth] = useState(false)
  type ConnTestStep = { name: string; status: 'ok' | 'warn' | 'error'; message: string; detail?: string | null; latency?: string }
  type ConnTestProvider = { status: 'ok' | 'warn' | 'error' | 'pending'; steps: ConnTestStep[] }
  type ConnTestResult = { timestamp: string; providers: { artelo: ConnTestProvider; shopify: ConnTestProvider; etsy: ConnTestProvider }; error?: string }
  const [connTestResults, setConnTestResults] = useState<ConnTestResult | null>(null)
  const [isRunningConnTest, setIsRunningConnTest] = useState(false)

  const [reviewCopied, setReviewCopied] = useState<string | null>(null)
  const [customersServedCount, setCustomersServedCount] = useState<number | null>(null)
  const [customersServedInput, setCustomersServedInput] = useState('')
  const [isLoadingCounter, setIsLoadingCounter] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  // Race shorthands from scraper configs plus user overrides, for the Race
  // Database panel. The order list reads its own copy for filenames.
  const [raceShorthands, setRaceShorthands] = useState<Record<string, string>>({})
  const [raceShorthandOverrides, setRaceShorthandOverrides] = useState<Record<string, string>>({})
  const fetchRaceShorthands = useCallback(async () => {
    try {
      const res = await apiFetch('/api/orders/actions?action=race-shorthands')
      if (!res.ok) return
      const data = await res.json()
      if (data?.shorthands) setRaceShorthands(data.shorthands)
      if (data?.overrides) setRaceShorthandOverrides(data.overrides)
    } catch { /* the panel still renders without them */ }
  }, [])
  useEffect(() => { fetchRaceShorthands() }, [fetchRaceShorthands])

  // The order list is not on screen while Settings is, and it loads fresh
  // when it opens again, so a change made here has nothing to refresh.
  const refreshOrders = useCallback(async () => {}, [])

  // Fetch current customers served count
  const fetchCustomersServedCount = async () => {
    try {
      const response = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'customers-served-info' })
      })
      if (!response.ok) throw new Error('Failed to fetch count')
      const data = await response.json()
      setCustomersServedCount(data.count)
      setCustomersServedInput(String(data.count))
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to fetch customers served count:', error)
    }
  }

  // Save customers served count and sync to Shopify
  const saveCustomersServedCount = async () => {
    const parsed = parseInt(customersServedInput, 10)
    if (isNaN(parsed) || parsed < 0) {
      setToast({ message: 'Enter a valid number', type: 'error' })
      return
    }
    setIsLoadingCounter(true)
    try {
      const response = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'customers-served-set', count: parsed })
      })
      if (!response.ok) throw new Error('Failed to update count')
      const data = await response.json()
      setCustomersServedCount(data.count)
      setCustomersServedInput(String(data.count))
      setToast({ message: `Counter updated to ${data.formatted} and synced to Shopify`, type: 'success' })
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Failed to update', type: 'error' })
    } finally {
      setIsLoadingCounter(false)
    }
  }
  // Once, when Settings opens.
  useEffect(() => { fetchCustomersServedCount() }, [])

  return (
    <>
      <div className="fixed top-0 right-0 left-0 md:left-[92px] bottom-[calc(92px+env(safe-area-inset-bottom))] md:bottom-0 z-40 bg-[#f3f3f3] flex flex-col">
        <div className="px-3 md:px-5 w-full flex flex-col h-full min-h-0">
          {(!settingsPanelInUrl || !isPhone) && (
            <PageHeader title="Settings" subtitle={currentUser?.email || undefined} />
          )}
          <div className="pt-4 md:pt-5 pb-3 hidden md:flex items-center justify-between gap-4 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
              <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Settings</h1>
            </div>
            <div className="relative w-full max-w-[420px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-off-black/40" />
              <input
                value={settingsQuery}
                onChange={(e) => setSettingsQuery(e.target.value)}
                placeholder="Search settings"
                className="w-full pl-9 pr-3 py-2 bg-white border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30"
              />
            </div>
          </div>

          <section className="flex-1 min-h-0 pb-3">
            <div className="h-full bg-white border border-border-gray rounded-lg shadow-sm overflow-hidden flex">
              {/* Sections. On a phone this is the whole page until one is picked. */}
              <aside className={`${settingsPanelInUrl ? 'hidden md:flex' : 'flex'} w-full md:w-56 flex-shrink-0 flex-col md:border-r border-border-gray md:bg-subtle-gray`}>
                <nav className="flex-1 overflow-y-auto p-2 md:p-2">
                  {visibleNav.map((group) => {
                    const items = group.items.filter((i) =>
                      !settingsQuery.trim() ||
                      (i.label + ' ' + i.blurb).toLowerCase().includes(settingsQuery.trim().toLowerCase())
                    )
                    if (!items.length) return null
                    return (
                      <div key={group.group} className="mb-3">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-off-black/35">{group.group}</p>
                        {items.map((item) => {
                          const Icon = item.icon
                          const active = settingsPanel === item.id || (item.id === 'stats' && (settingsPanel === 'counter' || settingsPanel === 'support_closes'))
                          return (
                            <button
                              key={item.id}
                              onClick={() => setSettingsPanel(item.id)}
                              className={`w-full flex items-center gap-3 md:gap-2 px-2 py-3 md:py-1.5 rounded-md text-left text-sm transition-colors border-b md:border-0 border-border-gray/60 ${active ? 'md:bg-white md:text-off-black md:shadow-sm md:font-medium' : 'text-off-black/80 md:text-off-black/65 md:hover:bg-white/70'}`}
                            >
                              <Icon className="w-4 h-4 flex-shrink-0 text-off-black/45" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate">{item.label}</span>
                                <span className="md:hidden block text-xs text-off-black/45 truncate">{item.blurb}</span>
                              </span>
                              <ChevronRight className="md:hidden w-4 h-4 text-off-black/30" />
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </nav>
              </aside>

              {/* The open section. */}
              <div className={`${settingsPanelInUrl ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 flex-col`}>
                <div className="flex items-center gap-2 px-3 md:px-5 py-3 md:py-0 md:h-[64px] border-b border-border-gray flex-shrink-0">
                  <button onClick={() => goToSettings('/settings')} className="md:hidden inline-flex items-center gap-1 -ml-1 px-1.5 py-1 text-sm text-off-black/60 hover:text-off-black rounded">
                    <ChevronLeft className="w-4 h-4" /> Settings
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-off-black truncate">
                      {visibleItems.find((i) => i.id === (settingsPanel === 'counter' || settingsPanel === 'support_closes' ? 'stats' : settingsPanel))?.label ?? 'Settings'}
                    </h2>
                    <p className="hidden md:block text-xs text-off-black/45 truncate">
                      {visibleItems.find((i) => i.id === (settingsPanel === 'counter' || settingsPanel === 'support_closes' ? 'stats' : settingsPanel))?.blurb ?? ''}
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-3 md:p-5">
              {settingsPanel === 'pricing' && isAdmin && <PricingCalculator />}
              {(settingsPanel === 'stats' || settingsPanel === 'counter' || settingsPanel === 'support_closes') && isAdmin && <StatsHub initial={settingsPanel === 'counter' ? 'counter' : settingsPanel === 'support_closes' ? 'tickets' : 'overview'} />}
              {settingsPanel === 'design_needs' && can('settings.design_needs') && <DesignNeedsPanel />}
              {settingsPanel === 'features' && <FeatureRequestsPanel />}
              {settingsPanel === 'account' && <AccountPanel />}
              {settingsPanel === 'people' && isAdmin && <PeoplePanel />}
              {settingsPanel === 'roles' && isAdmin && <RolesPanel />}
              {settingsPanel === 'connections' && isAdmin && <ConnectionsPanel />}
              {settingsPanel === 'apikeys' && isAdmin && <ApiKeysPanel />}
              {settingsPanel === 'assignments' && isAdmin && <AssignmentPanel />}
              {settingsPanel === 'skipped' && isAdmin && <SkippedProductsPanel />}
              {settingsPanel === 'gallery' && isAdmin && <SiteGalleryPanel />}
              {settingsPanel === 'activity' && isAdmin && <ActivityPanel />}
              {settingsPanel === 'designs' && isAdmin && <RenderTemplatesPanel />}

              {settingsPanel === 'reviews' && can('settings.reviews') && (
                <div>
                  {REVIEW_PRODUCTS.map((product) => (
                    <button
                      key={product.name}
                      onClick={() => {
                        const msg = `If you have 2-seconds would you mind leaving us a review? It really helps us as a young brand. Link here: ${product.link}`
                        const ta = document.createElement('textarea')
                        ta.value = msg
                        ta.style.position = 'fixed'
                        ta.style.opacity = '0'
                        document.body.appendChild(ta)
                        ta.select()
                        document.execCommand('copy')
                        document.body.removeChild(ta)
                        setReviewCopied(product.name)
                        setTimeout(() => setReviewCopied(null), 2000)
                      }}
                      className="w-full text-left px-4 py-3 rounded-lg hover:bg-subtle-gray transition-colors flex items-center justify-between group"
                    >
                      <span className="text-sm text-off-black">{product.name}</span>
                      <span className="text-xs text-off-black/30 group-hover:text-off-black/50 flex items-center gap-1">
                        {reviewCopied === product.name ? (
                          <><Check className="w-3.5 h-3.5 text-green-600" /><span className="text-green-600">Copied!</span></>
                        ) : (
                          <><Copy className="w-3.5 h-3.5" /> Copy</>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {settingsPanel === 'lookup' && can('settings.data') && <LookupHealthPanel embedded />}

              {settingsPanel === 'races' && can('settings.data') && (
                <RaceDatabasePanel raceShorthands={raceShorthands} raceShorthandOverrides={raceShorthandOverrides} refreshShorthands={fetchRaceShorthands} setToast={setToast} fetchOrders={refreshOrders} />
              )}

              {settingsPanel === 'storefront' && isAdmin && (
                <div className="space-y-4">
            {/* Customers Served Counter */}
            <div>
              <div className="rounded-lg border border-border-gray bg-subtle-gray p-4">
                <p className="text-sm font-medium text-off-black">Customers Served Counter</p>
                <p className="text-xs mt-0.5 text-off-black/50 mb-3">Adjust the counter displayed on the Shopify storefront. Saves to DB and syncs to Shopify.</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={customersServedInput}
                    onChange={(e) => setCustomersServedInput(e.target.value)}
                    placeholder={customersServedCount !== null ? String(customersServedCount) : 'Loading...'}
                    className={`${inputBase} flex-1 min-w-0`}
                  />
                  <button
                    onClick={saveCustomersServedCount}
                    disabled={isLoadingCounter || customersServedInput === String(customersServedCount)}
                    className={`${btnPrimary} flex-shrink-0`}
                  >
                    {isLoadingCounter && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isLoadingCounter ? 'Saving…' : 'Update & Sync'}
                  </button>
                </div>
              </div>
            </div>

                </div>
              )}

              {settingsPanel === 'diagnostics' && isAdmin && (
                <div className="space-y-4 divide-y divide-border-gray [&>div+div]:pt-4">
            {/* Test Connections — granular Artelo / Shopify / Etsy diagnostics */}
            <div>
              <div className="rounded-lg border border-border-gray bg-subtle-gray p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-off-black">Test Connections</p>
                    <p className="text-xs mt-0.5 text-off-black/50">Step-by-step diagnostics for Artelo, Shopify, and Etsy - tells you exactly which credential or API call is failing.</p>
                  </div>
                  <button
                    onClick={async () => {
                      setIsRunningConnTest(true)
                      setConnTestResults(null)
                      try {
                        const response = await apiFetch('/api/orders/actions?action=test-connections')
                        const data = await response.json()
                        if (!response.ok && !data.providers) {
                          setConnTestResults({ timestamp: new Date().toISOString(), providers: { artelo: { status: 'error', steps: [] }, shopify: { status: 'error', steps: [] }, etsy: { status: 'error', steps: [] } }, error: data.error || `HTTP ${response.status}` })
                        } else {
                          setConnTestResults(data)
                        }
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : 'Failed to test connections'
                        setConnTestResults({ timestamp: new Date().toISOString(), providers: { artelo: { status: 'error', steps: [] }, shopify: { status: 'error', steps: [] }, etsy: { status: 'error', steps: [] } }, error: msg })
                      } finally {
                        setIsRunningConnTest(false)
                      }
                    }}
                    disabled={isRunningConnTest}
                    className={`${btnPrimary} flex-shrink-0`}
                  >
                    {isRunningConnTest && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isRunningConnTest ? 'Testing…' : 'Test Connections'}
                  </button>
                </div>

                {connTestResults && (
                  <div className="mt-4 space-y-3">
                    {connTestResults.error && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{connTestResults.error}</div>
                    )}
                    {(['artelo', 'shopify', 'etsy'] as const).map(provider => {
                      const p = connTestResults.providers[provider]
                      if (!p) return null
                      const providerLabel = { artelo: 'Artelo', shopify: 'Shopify', etsy: 'Etsy' }[provider]
                      const headerIcon = p.status === 'ok' ? '✅' : p.status === 'warn' ? '⚠️' : '❌'
                      const headerColor = p.status === 'ok' ? 'text-green-700' : p.status === 'warn' ? 'text-amber-700' : 'text-red-700'
                      const bgColor = p.status === 'ok' ? 'bg-green-50 border-green-200' : p.status === 'warn' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
                      return (
                        <div key={provider} className={`rounded border ${bgColor} p-3`}>
                          <div className={`text-xs font-bold ${headerColor} uppercase tracking-wide mb-2`}>
                            {headerIcon} {providerLabel}
                          </div>
                          <div className="space-y-1.5">
                            {p.steps.map((step, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-xs">
                                <span className="flex-shrink-0 mt-0.5">{step.status === 'ok' ? '✅' : step.status === 'warn' ? '⚠️' : '❌'}</span>
                                <div className="min-w-0 flex-1">
                                  <span className="font-medium text-off-black">{step.name}</span>
                                  {step.latency && <span className="text-off-black/30 ml-1.5">({step.latency})</span>}
                                  <div className={`mt-0.5 ${step.status === 'ok' ? 'text-off-black/60' : step.status === 'warn' ? 'text-amber-700' : 'text-red-700'}`}>
                                    {step.message}
                                  </div>
                                  {step.detail && (
                                    <div className="mt-1 px-2 py-1 bg-white/60 border border-black/5 rounded font-mono text-[10px] text-off-black/60 break-all whitespace-pre-wrap">
                                      {step.detail}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* System Health Check */}
            <div>
              <div className="rounded-lg border border-border-gray bg-subtle-gray p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-off-black">System Health Check</p>
                    <p className="text-xs mt-0.5 text-off-black/50">Tests database, Etsy, Shopify, Resend, and Slack connections. Runs automatically every Monday at 12pm.</p>
                  </div>
                  <button
                    onClick={async () => {
                      setIsRunningHealth(true)
                      setHealthResults(null)
                      try {
                        const response = await apiFetch('/api/orders/actions?action=health-check')
                        const data = await response.json()
                        if (!response.ok && !data.checks) {
                          setHealthResults({ overall: 'error', checks: {}, error: data.error || `HTTP ${response.status}` })
                        } else {
                          setHealthResults(data)
                        }
                      } catch (err) {
                        setHealthResults({ overall: 'error', checks: {}, error: err instanceof Error ? err.message : 'Failed to run health check' })
                      } finally {
                        setIsRunningHealth(false)
                      }
                    }}
                    disabled={isRunningHealth}
                    className={`${btnPrimary} flex-shrink-0`}
                  >
                    {isRunningHealth && <Loader2 className="w-3 h-3 animate-spin" />}
                    {isRunningHealth ? 'Checking…' : 'Run Health Check'}
                  </button>
                </div>

                {healthResults && (
                  <div className="mt-3 space-y-1.5">
                    <div className={`text-xs font-medium ${healthResults.overall === 'healthy' ? 'text-green-600' : healthResults.overall === 'degraded' ? 'text-amber-600' : 'text-red-600'}`}>
                      {healthResults.overall === 'healthy' ? '✅ All systems healthy' : healthResults.overall === 'degraded' ? '⚠️ Some systems degraded' : '🚨 Critical issues detected'}
                    </div>
                    {healthResults.error && (
                      <div className="text-xs text-red-500 mt-1">{healthResults.error}</div>
                    )}
                    {healthResults.checks && Object.entries(healthResults.checks).map(([name, check]) => (
                      <div key={name} className="flex items-start gap-2 text-xs">
                        <span className="flex-shrink-0 mt-0.5">{check.status === 'ok' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'}</span>
                        <div className="min-w-0">
                          <span className="font-medium text-off-black capitalize">{name}</span>
                          <span className="text-off-black/50 ml-1.5">{check.detail}</span>
                          {check.latency && <span className="text-off-black/30 ml-1">({check.latency})</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

                </div>
              )}

              {settingsPanel === 'maintenance' && isAdmin && (
                <div className="space-y-4">
            {/* Danger zone */}
            <ClearResearchCard onDone={refreshOrders} />
                </div>
              )}
              {settingsPanel === 'products' && isAdmin && <ProductsBulkEdit embedded />}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </>
  )
}
