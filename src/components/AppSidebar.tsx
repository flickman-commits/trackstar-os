import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Package, Users, Ticket, Calculator, Settings, Wrench, Send, FileText, ListOrdered, Braces, Vote, Inbox, Gift } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Capability } from '@/lib/roles'

/**
 * The tool rail.
 *
 * Every separate thing this app does used to live somewhere different: Creators
 * was a link in the top right, Create Discount was a floating pill in the
 * bottom left but only on the standard view, Pace Converter and Weather Lookup
 * were the same pill but only on the custom view, and Settings was an unlabelled
 * gear next to the completed-orders count. Two of those five were invisible
 * depending on which tab you were on.
 *
 * They are all here now, in one column. Fulfillment and Creators are places
 * you go; Discounts, Pace and Weather are things you reach for mid-task, so
 * those three sit behind a single Tools tile with a hover flyout. Settings sits
 * at the bottom because it is the one you reach for least and always want in
 * the same place.
 *
 * Dark grey rather than a brand colour, and the same dark grey as the
 * storefront footer card, so the tool borrows a shape the brand already uses.
 * Not purple: the dashboard behind it uses purple for things that act - approve
 * buttons, the research queue - and a purple rail would compete with them.
 * Against the dark ground the current tile is a white card, which is the
 * strongest contrast available and needs no colour at all.
 *
 * Desktop only. On mobile the screen is a single column of orders and a fixed
 * rail would eat a third of it.
 */

type Item = {
  id: string
  label: string
  icon: LucideIcon
  /** Internal navigation. */
  to?: string
  /** Opens a panel or an action instead of navigating. */
  onClick?: () => void
  /** Leaves the app entirely. */
  href?: string
  title: string
}

function Tile({ item, active }: { item: Item; active?: boolean }) {
  const Icon = item.icon
  // Only the current tile gets a card. Giving every tile one made the rail read
  // as a stack of nine equal buttons with nothing telling you where you are.
  const inner = (
    <>
      <span
        className={`flex items-center justify-center w-11 h-11 rounded-xl transition-all ${
          active
            ? 'bg-white text-dark-fill shadow-[0_1px_3px_rgba(0,0,0,0.25)]'
            : 'text-white/55 group-hover:bg-white/10 group-hover:text-white'
        }`}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span
        className={`text-[10px] leading-tight text-center max-w-[68px] truncate ${
          active ? 'text-white font-semibold' : 'text-white/50 font-medium group-hover:text-white/80'
        }`}
      >
        {item.label}
      </span>
    </>
  )

  const cls = 'group flex flex-col items-center gap-1.5 w-full py-1.5 focus:outline-none'

  if (item.to) return <Link to={item.to} className={cls} title={item.title}>{inner}</Link>
  if (item.href) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={cls} title={item.title}>
        {inner}
      </a>
    )
  }
  return <button onClick={item.onClick} className={cls} title={item.title}>{inner}</button>
}

/**
 * The card a rail tile opens beside itself. Drawn on the page body rather
 * than inside the rail: inside, it shared the rail's layer, and any page that
 * draws its own layer (a sticky header, a dropdown) covered it, so the menu
 * only showed on Fulfillment. Above every page, below the modals (z-50).
 */
function Flyout({ anchor, onEnter, onLeave, children }: { anchor: RefObject<HTMLElement | null>; onEnter: () => void; onLeave: () => void; children: ReactNode }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect()
    if (r) setAt({ left: r.right, top: r.top })
  }, [anchor])
  if (!at) return null
  return createPortal(
    // pl-2 rather than ml-2: the padding is part of the hover target, so
    // the cursor never leaves the menu while crossing to it.
    <div className="fixed pl-2 z-[45]" style={{ left: at.left, top: at.top }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="w-60 p-1.5 rounded-2xl bg-dark-fill shadow-[0_6px_24px_rgba(0,0,0,0.25)] border border-white/[0.08]">
        {children}
      </div>
    </div>,
    document.body,
  )
}

/**
 * The two small utilities, folded into one tile with a flyout.
 *
 * Discounts, Pace and Weather each had their own tile, which made the rail
 * read as five equal destinations when only two of them are places you go.
 * These are things you reach for mid-task, so they sit behind one "Tools"
 * tile and appear on hover, beside the rail, in the same dark card.
 *
 * Hover opens it, but click toggles it too, so it works from a keyboard and on
 * a trackpad that never quite hovers. Closing is delayed a beat so crossing
 * the gap between the tile and the menu does not slam it shut halfway.
 */
function ToolsTile({
  can,
  active,
  onOpenDiscounts,
  onOpenPaceConverter,
}: {
  can: (c: Capability) => boolean
  active: boolean
  onOpenDiscounts: () => void
  onOpenPaceConverter: () => void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  const show = () => { cancelClose(); setOpen(true) }
  const hide = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpen(false), 160) }

  const tools = [
    { id: 'discounts', cap: 'tools.discounts' as Capability, label: 'Discounts', hint: 'One-time discount code', icon: Ticket, onClick: onOpenDiscounts },
    { id: 'pace', cap: 'tools.pace' as Capability, label: 'Pace Converter', hint: 'Finish time to pace', icon: Calculator, onClick: onOpenPaceConverter },
  ].filter(t => can(t.cap))

  // Nothing to offer this role: no Tools tile at all.
  if (!tools.length) return null

  const rowCls = 'group/row flex items-center gap-3 w-full px-3 py-2 rounded-xl text-left hover:bg-white/10 transition-colors'
  const rowInner = (t: (typeof tools)[number]) => {
    const Icon = t.icon
    return (
      <>
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.06] text-white/70 group-hover/row:text-white shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-white leading-tight">{t.label}</span>
          <span className="block text-[11px] text-white/45 leading-tight mt-0.5 truncate">{t.hint}</span>
        </span>
      </>
    )
  }

  return (
    <div ref={anchor} className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <Tile
        item={{ id: 'tools', label: 'Tools', icon: Wrench, onClick: () => setOpen(o => !o), title: 'Discounts and pace converter' }}
        active={active || open}
      />
      {open && (
        <Flyout anchor={anchor} onEnter={show} onLeave={hide}>
          {tools.map(t => (
            <button key={t.id} onClick={() => { t.onClick?.(); setOpen(false) }} className={rowCls}>
              {rowInner(t)}
            </button>
          ))}
        </Flyout>
      )}
    </div>
  )
}

/**
 * Sales, with its workspace one hover away: Outreach (today's emails), and
 * the Templates, Sequences and Variables pages. Clicking the tile still goes
 * straight to Outreach. Same flyout as Tools, same forgiving close.
 */
function SalesTile({ item, active }: { item: Item; active: boolean }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const cancelClose = () => { if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null } }
  const show = () => { cancelClose(); setOpen(true) }
  const hide = () => { cancelClose(); closeTimer.current = window.setTimeout(() => setOpen(false), 160) }
  const pages = [
    { to: '/sales', label: 'Outreach', hint: "Today's emails to send", icon: Send },
    { to: '/sales/templates', label: 'Templates', hint: 'The wording, in one place', icon: FileText },
    { to: '/sales/sequences', label: 'Sequences', hint: 'Which template, and when', icon: ListOrdered },
    { to: '/sales/variables', label: 'Variables', hint: 'Words templates fill in', icon: Braces },
  ]
  return (
    <div ref={anchor} className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <Tile item={item} active={active || open} />
      {open && (
        <Flyout anchor={anchor} onEnter={show} onLeave={hide}>
            {pages.map(pg => {
              const Icon = pg.icon
              return (
                <Link key={pg.to} to={pg.to} onClick={() => setOpen(false)} className="group/row flex items-center gap-3 w-full px-3 py-2 rounded-xl text-left hover:bg-white/10 transition-colors">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.06] text-white/70 group-hover/row:text-white shrink-0"><Icon className="w-4 h-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-white leading-tight">{pg.label}</span>
                    <span className="block text-[11px] text-white/45 leading-tight mt-0.5 truncate">{pg.hint}</span>
                  </span>
                </Link>
              )
            })}
        </Flyout>
      )}
    </div>
  )
}

/**
 * The same tools, laid along the bottom for a phone.
 *
 * On a narrow screen a fixed side rail would eat a third of the width, so the
 * desktop rail hides below md and this takes its place: the same floating
 * dark card, inset from the edges with the same radius and shadow, turned on
 * its side along the bottom where a thumb already rests. The tiles sit in a row and scroll sideways when
 * they do not fit; the card itself stays put. Same white card on the current
 * tile, so the app reads as one thing on both screens. The three small
 * utilities lose their flyout and sit in the row as ordinary tiles; a hover
 * menu has no meaning on a thumb.
 */
export function MobileToolBar({
  can,
  onOpenSettings,
  activeId,
}: {
  can: (c: Capability) => boolean
  onOpenSettings: () => void
  activeId?: string
}) {
  const fulfillmentTo = useFulfillmentReturn()
  const items: Item[] = [
    ...railItems(can, fulfillmentTo),
    // Discounts, Pace and Weather are desktop tools; the phone bar keeps to the pages.
    ...(can('tools.surveys') ? [{ id: 'surveys', label: 'Survey', icon: Vote, to: '/surveys', title: 'Design Survey' } as Item] : []),
    { id: 'settings', label: 'Settings', icon: Settings, onClick: onOpenSettings, title: 'Settings' },
  ]
  return (
    <nav
      aria-label="Tools"
      // Same inset (3), radius (22px) and shadow as the desktop rail, so it is
      // recognisably the same object. Sits above the home indicator.
      className="md:hidden fixed left-3 right-3 z-30 rounded-[22px] bg-dark-fill shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
    >
      {/* Horizontal scroll with the scrollbar hidden: the half-visible next
          tile already says there is more, and a bar under a row of icons
          looks broken. The rounded card clips the strip at its corners. */}
      <div className="flex gap-1 px-1.5 py-1.5 overflow-x-auto rounded-[22px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map(item => (
          <div key={item.id} className="shrink-0">
            <MobileTile item={item} active={activeId === item.id} />
          </div>
        ))}
      </div>
    </nav>
  )
}

/**
 * A phone tile: icon and label inside one rounded square. On desktop the
 * label hangs below the square, which reads well in a column; along the bottom
 * of a phone that costs a whole extra line, so here the square holds both.
 */
function MobileTile({ item, active }: { item: Item; active?: boolean }) {
  const Icon = item.icon
  const cls = `flex flex-col items-center justify-center gap-1 w-[66px] h-[54px] rounded-xl transition-all focus:outline-none ${
    active ? 'bg-white text-dark-fill shadow-[0_1px_3px_rgba(0,0,0,0.25)]' : 'text-white/55 active:bg-white/10'
  }`
  const inner = (
    <>
      <Icon className="w-[18px] h-[18px]" />
      <span className={`text-[10px] leading-none text-center max-w-[60px] truncate ${active ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
    </>
  )
  if (item.to) return <Link to={item.to} className={cls} title={item.title}>{inner}</Link>
  if (item.href) return <a href={item.href} target="_blank" rel="noopener noreferrer" className={cls} title={item.title}>{inner}</a>
  return <button onClick={item.onClick} className={cls} title={item.title}>{inner}</button>
}

/** The places you go. Shared by the desktop rail and the mobile bar. */
/**
 * Where the Fulfillment tile goes: back to the queue, filters and order you
 * last had open (they live in the address), not to the bare page. Kept for
 * the tab's life; Support keeps its own place by staying mounted.
 */
let lastFulfillment = '/'
try { lastFulfillment = sessionStorage.getItem('rail.fulfillment') || '/' } catch { /* private window */ }
function useFulfillmentReturn() {
  const { pathname, search } = useLocation()
  const [to, setTo] = useState(lastFulfillment)
  useEffect(() => {
    if (pathname === '/' || pathname.startsWith('/orders/')) {
      lastFulfillment = `${pathname}${search}`
      try { sessionStorage.setItem('rail.fulfillment', lastFulfillment) } catch { /* fine */ }
      setTo(lastFulfillment)
    }
  }, [pathname, search])
  return to
}

function railItems(can: (c: Capability) => boolean, fulfillmentTo = '/'): Item[] {
  return [
    { id: 'fulfillment', label: 'Fulfillment', icon: Package, to: fulfillmentTo, title: 'Orders to personalize, custom designs and partners' },
    ...(can('support') ? [{ id: 'support', label: 'Support', icon: Inbox, to: '/support', title: 'The shared inbox for fast@trackstar.art' } as Item] : []),
    // Creators is admin-only, same as the route behind it. Sales is for anyone
    // on the Attio workspace; the API says no to everyone else.
    ...(can('creators') ? [{ id: 'creators', label: 'Creators', icon: Users, to: '/creators', title: 'The creator programme' } as Item] : []),
    ...(can('sales') ? [{ id: 'sales', label: 'Sales', icon: Send, to: '/sales', title: 'Outreach: the emails to send today, read from Attio' } as Item] : []),
  ]
}

export default function AppSidebar({
  can,
  onOpenDiscounts,
  onOpenPaceConverter,
  onOpenSettings,
  activeId,
}: {
  can: (c: Capability) => boolean
  onOpenDiscounts: () => void
  onOpenPaceConverter: () => void
  onOpenSettings: () => void
  /** Which tile reads as current. 'fulfillment' on the dashboard. */
  activeId?: string
}) {
  const fulfillmentTo = useFulfillmentReturn()
  const items: Item[] = [
    ...railItems(can, fulfillmentTo),
    // Pages of their own, so they get tiles; Tools keeps the two popups.
    ...(can('tools.surveys') ? [{ id: 'surveys', label: 'Survey', icon: Vote, to: '/surveys', title: 'Design Survey: community votes on new designs' } as Item] : []),
    ...(can('tools.samples') ? [{ id: 'samples', label: 'Samples', icon: Gift, to: '/samples', title: 'Samples: send prints as Shopify or Gelato orders' } as Item] : []),
  ]

  return (
    <aside className="hidden md:flex fixed left-3 top-3 bottom-3 w-[78px] z-30 flex-col rounded-[22px] bg-dark-fill shadow-[0_2px_10px_rgba(0,0,0,0.10)]">
      {/* overflow-visible on purpose: overflow-y-auto would also clip on the
          x axis. Seven tiles never need to scroll. */}
      <div className="flex-1 flex flex-col gap-0.5 px-1.5 pt-2.5 overflow-visible">
        {items.map(item => (
          item.id === 'sales'
            ? <SalesTile key={item.id} item={item} active={activeId === item.id} />
            : <Tile key={item.id} item={item} active={activeId === item.id} />
        ))}
        <ToolsTile
          can={can}
          active={activeId === 'discounts' || activeId === 'pace'}
          onOpenDiscounts={onOpenDiscounts}
          onOpenPaceConverter={onOpenPaceConverter}
        />
      </div>
      {/* Pinned, and separated so it does not read as one of the tools. */}
      <div className="px-1.5 pb-2.5 pt-2 mt-1 border-t border-white/[0.10]">
        <Tile
          item={{ id: 'settings', label: 'Settings', icon: Settings, onClick: onOpenSettings, title: 'Settings' }}
          active={activeId === 'settings'}
        />
      </div>
    </aside>
  )
}
