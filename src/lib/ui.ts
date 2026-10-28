/**
 * Shared control vocabulary for the Settings workspaces.
 *
 * These panels were each built on their own, so the same job had picked up
 * about eight different spellings — a primary button appeared as
 * `hover:opacity-90`, `hover:opacity-80` and `hover:bg-off-black/80`, at
 * px-3/px-4/px-5 and py-1.5/py-2/py-3, depending only on which panel you were
 * standing in. Now that they share a shell that reads as one inconsistency
 * rather than several separate tools.
 *
 * The rule these encode: ONE primary per panel — the thing the panel is for.
 * Everything else is secondary. Destructive is its own tier so it can never be
 * mistaken for either.
 *
 * Deliberately class strings rather than components: the call sites are plain
 * `<button>`s with their own handlers and icons, and wrapping them all in a
 * component would be a much larger change for the same visual result.
 */

/** Shared geometry. Every control in a panel toolbar is this size. */
const base =
  'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md ' +
  'text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

/** The one action a panel exists to perform. */
export const btnPrimary = `${base} bg-dark-fill text-white hover:bg-off-black/85`

/** Supporting actions. Visible, but never competing with the primary. */
export const btnSecondary = `${base} bg-white border border-border-gray text-off-black/70 hover:bg-subtle-gray`

/** Irreversible. Its own tier so it cannot read as an ordinary action. */
export const btnDanger = `${base} bg-red-600 text-white hover:bg-red-700`

/** Utility actions that should recede until wanted — refresh, dismiss. */
export const btnGhost = `${base} text-off-black/55 hover:text-off-black hover:bg-off-black/5`

/**
 * Segmented control. Used for switching a panel's view rather than acting on
 * it — pricing channels, lookup's race/log split. Distinct from buttons on
 * purpose: choosing what you are looking at is not the same gesture as doing
 * something to it.
 */
export const segment = (active: boolean, size: 'sm' | 'md' = 'sm') =>
  `${size === 'md' ? 'px-4 py-1.5 text-sm' : 'px-3 py-1.5 text-xs'} ` +
  `rounded-md font-medium transition-colors ${
    active
      ? 'bg-dark-fill text-white'
      : 'text-off-black/60 hover:text-off-black hover:bg-off-black/5'
  }`

/** Wrapper that groups segments into one control. */
export const segmentGroup = 'inline-flex items-center gap-0.5 p-0.5 bg-subtle-gray border border-border-gray rounded-lg'

/** Text inputs inside panels. */
export const inputBase =
  'px-3 py-1.5 text-sm bg-white border border-border-gray rounded-md ' +
  'focus:outline-none focus:ring-2 focus:ring-off-black/15 placeholder:text-off-black/35'

/** The row of controls that sits above a panel's content. */
export const panelToolbar = 'flex flex-wrap items-center gap-2 mb-4'

/** Small uppercase label used above fields and stats. */
export const fieldLabel = 'block text-[11px] font-semibold text-off-black/50 uppercase tracking-wider mb-1'

/**
 * A chip: one fact about a record, as the fulfilment tool draws them.
 * Square-ish corners, a border, small bold text. Pair with a tone.
 */
export const chip = 'inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-semibold'

/** Tones for `chip`. Attio's own hues where a field comes from Attio. */
export const chipTone = {
  neutral: 'bg-white border-border-gray text-off-black',
  quiet: 'bg-white border-border-gray text-off-black/60',
  race: 'bg-orange-100 text-orange-800 border-orange-300',
  charity: 'bg-pink-100 text-pink-800 border-pink-300',
  corporate: 'bg-sky-100 text-sky-800 border-sky-300',
  pr: 'bg-violet-100 text-violet-800 border-violet-300',
  slate: 'bg-slate-100 text-slate-700 border-slate-300',
  amber: 'bg-amber-100 text-amber-800 border-amber-300',
  rose: 'bg-rose-100 text-rose-800 border-rose-300',
  purple: 'bg-purple-100 text-purple-800 border-purple-300',
  lime: 'bg-lime-100 text-lime-800 border-lime-300',
  teal: 'bg-teal-100 text-teal-800 border-teal-300',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  blue: 'bg-blue-100 text-blue-800 border-blue-300',
  red: 'bg-red-100 text-red-800 border-red-300',
} as const

/*
 * The fulfilment page's own building blocks, named so other tools can use
 * them. Each string is copied from Dashboard.tsx, not invented, so a page
 * built from these reads as the same product.
 */

/** Page background and the centred column every tool page sits in. */
export const pageShell = 'h-[calc(100dvh-92px-env(safe-area-inset-bottom))] md:h-screen overflow-hidden bg-[#f3f3f3] flex flex-col'
export const pageColumn = 'mx-auto px-4 md:px-8 lg:px-12 w-full flex flex-col h-full'

/** Stars, then the big title. */
export const pageHeader = 'pt-4 md:pt-8 lg:pt-10 pb-3 md:pb-6 flex items-center md:items-end justify-between gap-3 md:gap-6 flex-shrink-0'
export const pageTitle = 'text-3xl md:text-4xl lg:text-[40px] font-bold text-off-black mb-1'
export const pageLogo = 'h-8 md:h-11 w-fit'

/** The page's one big action, top right ("Import New Orders"). */
export const btnHero = 'inline-flex items-center gap-2 px-3 md:px-6 py-2 md:py-2.5 bg-dark-fill text-white rounded-md hover:opacity-90 transition-opacity font-medium text-xs md:text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed'
/** Its quieter sibling, same height. */
export const btnHeroSecondary = 'inline-flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-white border border-border-gray text-off-black/70 rounded-md hover:bg-subtle-gray transition-colors font-medium text-xs md:text-sm whitespace-nowrap'

/** "DESIGNS TO BE PERSONALIZED" and its count chip. */
export const sectionTitle = 'text-base md:text-lg font-semibold text-off-black uppercase tracking-tight'
export const sectionCount = 'px-2.5 py-1 bg-off-black/10 text-off-black/60 text-sm font-medium rounded'

/** The white card a list lives in, and the toolbar row at its top. */
export const listCard = 'bg-white border border-border-gray rounded-lg shadow-sm overflow-hidden flex-1 flex flex-col min-h-0'
export const listToolbar = 'p-3 md:p-4 border-b border-border-gray flex-shrink-0'
/** Toolbar search and select, grey until used. */
export const toolbarInput = 'w-full pl-9 md:pl-11 pr-4 py-2.5 md:py-3 bg-subtle-gray border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30 transition-colors'
export const toolbarSelect = (active: boolean) =>
  `w-full appearance-none pl-3 md:pl-4 pr-9 py-2.5 md:py-3 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30 transition-colors cursor-pointer ${
    active ? 'bg-dark-fill text-white border-dark-fill' : 'bg-subtle-gray border-border-gray text-off-black'
  }`
/** The grey column-header strip above a list ("SRC  ORDER #  STATUS"). */
export const listHead = 'bg-subtle-gray border-b border-border-gray text-xs font-semibold text-off-black/60 uppercase tracking-wider'

/** Order modal: section heading, the grey card under it, and a card's own label. */
export const sectionLabel = 'text-xs font-semibold text-off-black/50 uppercase tracking-tight'
export const infoCard = 'bg-subtle-gray border border-border-gray rounded-md p-3'
export const cardLabel = 'text-[10px] font-semibold text-off-black/40 uppercase tracking-wider'
/** The blue text link beside a section heading ("+ Add comment", "View Results"). */
export const textLink = 'inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors'

/** "View Completed Orders" footer pill and its count. */
export const footerPill = 'inline-flex items-center gap-2 px-4 py-2 bg-white border border-border-gray rounded-full shadow-sm text-sm text-off-black/70 hover:bg-subtle-gray transition-colors'
export const footerPillCount = 'px-2 py-0.5 text-xs font-medium rounded-full bg-off-black/5 text-off-black/60'

/** Toast card, shared by sonner and the dashboard's Toast (see BrandToaster). */
export const toastCard = 'flex items-center gap-2.5 bg-white border border-border-gray rounded-lg shadow-[0_6px_24px_rgba(0,0,0,0.10)] px-4 py-3 text-sm font-medium text-off-black'
export const toastStyle = { fontFamily: "Inter, system-ui, -apple-system, sans-serif", letterSpacing: '-0.01em' }

/*
 * The modal, as the global search (⌘K) draws it: dimmed page, a big white
 * card with soft corners, a header row, a body, and a footer strip. Every
 * action that needs typing or several steps opens in this (ActionModal).
 */
export const modalOverlay = 'fixed inset-0 z-[80] bg-black/40 flex items-start justify-center px-3 md:px-4 pt-[max(12px,env(safe-area-inset-top))] md:pt-[10vh]'
export const modalCard = 'w-full bg-white rounded-3xl shadow-[0_32px_80px_rgba(0,0,0,0.22)] overflow-hidden flex flex-col max-h-[85dvh] md:max-h-[80vh]'
export const modalHeader = 'flex items-center gap-3 px-6 py-5 border-b border-border-gray'
export const modalBody = 'flex-1 overflow-y-auto px-6 py-5 space-y-4 text-sm text-off-black'
export const modalFooter = 'flex items-center gap-2 px-6 py-3.5 border-t border-border-gray'
/** Inputs, selects and textareas inside a modal: the search box's size, in a field. */
export const modalInput = 'w-full min-w-0 px-3.5 py-2.5 text-[15px] text-off-black bg-white border border-border-gray rounded-xl focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30 placeholder:text-off-black/35'
/** The search's filter chips, for quick picks (10% / 15% / 20%). */
export const modalChip = (on: boolean) =>
  `inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[15px] transition-colors ${on ? 'bg-dark-fill text-white' : 'bg-off-black/[0.05] text-off-black hover:bg-off-black/[0.09]'}`
const modalBtnBase = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const modalPrimary = `${modalBtnBase} bg-dark-fill text-white hover:bg-off-black/85`
export const modalDanger = `${modalBtnBase} bg-red-600 text-white hover:bg-red-700`
export const modalCancel = `${modalBtnBase} text-off-black/60 hover:text-off-black hover:bg-off-black/5`
