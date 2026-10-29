import { showsRaceNotRun } from '@/lib/raceStatus'
import type { ReactNode } from 'react'

/**
 * One shared tag vocabulary for orders.
 *
 * Everything that used to be scattered across badges, colored sub-text lines
 * and callout boxes is derived here so the dashboard table and the order detail
 * modal always say the same thing in the same color.
 *
 * Tone meanings (keep these consistent, they are the whole point):
 *   red    = blocking or urgent. Someone has to act.
 *   amber  = needs attention before this order can ship.
 *   purple = photo add-on. Changes what gets printed.
 *   blue   = informational. Data provenance, no action implied.
 *   green  = verified or done.
 *   pink   = gift.
 *   gray   = neutral context.
 */

export type TagTone = 'red' | 'amber' | 'purple' | 'blue' | 'green' | 'pink' | 'gray'

export interface OrderTag {
  key: string
  label: string
  /** Small trailing detail, e.g. the reason a lookup failed. */
  sublabel?: string
  tone: TagTone
  /** Hover text with the full explanation. */
  title?: string
  /** Lower sorts first. Set by tone unless overridden. */
  weight?: number
}

/** Minimal shape needed to derive tags. Matches the Dashboard Order type. */
export interface TaggableOrder {
  status?: string | null
  researchStatus?: string | null
  researchSource?: string | null
  lookupOutcome?: string | null
  lookupMatchedName?: string | null
  lookupVerified?: boolean | null
  trackstarOrderType?: string | null
  hasScraperAvailable?: boolean
  bibNumber?: string | null
  officialTime?: string | null
  officialPace?: string | null
  hasOverrides?: boolean
  hadNoTime?: boolean
  timeFromName?: string | null
  isExpedited?: boolean
  waitingOnCustomerSince?: string | null
  isBigSpender?: boolean
  isSample?: boolean
  photoPath?: string | null
  photoPlacedAt?: string | null
  photoUnpaid?: boolean
  orderTotalUsd?: number | null
  shippingMethod?: string | null
  flagReason?: string | null
  raceName?: string
  effectiveRaceName?: string
  raceYear?: number | null
  effectiveRaceYear?: number | null
  raceDateIso?: string | null
  yearOverride?: number | null
}

const TONE_WEIGHT: Record<TagTone, number> = {
  red: 0, amber: 1, purple: 2, green: 3, blue: 4, pink: 5, gray: 6,
}

/**
 * How the runner data on this order was obtained, collapsed from the twelve
 * raw lookupOutcome values into three trust levels. The specific reason rides
 * along as the sublabel so nothing is lost.
 */
const TRUST_TAGS: Record<string, { label: string; sublabel?: string; tone: TagTone; title: string }> = {
  // Customer confirmed a real official-results match.
  auto_match: {
    label: 'Verified', sublabel: 'auto match', tone: 'green',
    title: 'Instant Lookup found a match for this customer and they approved it.',
  },
  picked_from_list: {
    label: 'Verified', sublabel: 'picked from list', tone: 'green',
    title: 'Instant Lookup found several matches and the customer picked theirs.',
  },
  // Customer typed the values by hand. The reason lives on hover: the label
  // stays short because what matters is that a human typed it.
  manual_no_match: {
    label: 'Customer typed', tone: 'blue',
    title: 'Instant Lookup found no match for this name and year, so the customer typed their details in by hand.',
  },
  manual_lookup_error: {
    label: 'Customer typed', tone: 'blue',
    title: 'Instant Lookup did not work for this customer, so they typed their details in by hand.',
  },
  manual_rate_limited: {
    label: 'Customer typed', tone: 'blue',
    title: 'Instant Lookup was rate limited for this customer, so they typed their details in by hand.',
  },
  manual_timeout: {
    label: 'Customer typed', tone: 'blue',
    title: 'Instant Lookup timed out for this customer, so they typed their details in by hand.',
  },
  manual_user_choice: {
    label: 'Customer typed', tone: 'blue',
    title: 'The customer skipped Instant Lookup and typed their details in by hand.',
  },
  edited_by_customer: {
    // "Edited" not "typed": Instant Lookup did find something and they changed
    // it. Whoever fulfills this should know the numbers were overridden on
    // purpose, not entered from a blank form.
    label: 'Customer edited', tone: 'blue',
    title: 'Instant Lookup found a result and the customer changed the time, pace or bib on the review screen. These are their numbers, not the official ones - print them as given.',
  },
}

/**
 * Build the full tag list for an order, most urgent first.
 */
export function getOrderTags(o: TaggableOrder): OrderTag[] {
  const tags: OrderTag[] = []

  // Priority handling first. These change what Eli works on next.
  if (o.isSample) {
    tags.push({ key: 'sample', label: '🎁 Sample', tone: 'purple', weight: 2, title: 'A sample we sent: a creator sample, or an order from Tools > Samples.' })
  }
  if (o.isExpedited && o.trackstarOrderType === 'standard') {
    tags.push({ key: 'expedited', label: '🚀 Expedited', tone: 'red', weight: -2,
      title: `Customer paid for ${o.shippingMethod || 'expedited'} shipping. Move this to the front of the queue.` })
  }
  if (o.isBigSpender && o.trackstarOrderType === 'standard') {
    tags.push({ key: 'big-spender', label: '💰 Big Spender', tone: 'amber', weight: -1,
      sublabel: o.orderTotalUsd ? `$${Math.round(o.orderTotalUsd).toLocaleString()}` : undefined,
      title: o.orderTotalUsd ? `Customer spent $${Math.round(o.orderTotalUsd)}. Prioritize this order.` : 'High value order. Prioritize this order.' })
  }

  // We asked the customer something in Support and they have not answered.
  // Gray while it is fresh, amber from 3 days: time to chase.
  if (o.waitingOnCustomerSince && o.status !== 'completed') {
    const days = Math.floor((Date.now() - new Date(o.waitingOnCustomerSince).getTime()) / 86400000)
    tags.push({ key: 'waiting-customer', label: 'Waiting on customer', sublabel: days < 1 ? 'today' : `${days}d`,
      tone: days >= 3 ? 'amber' : 'gray', weight: days >= 3 ? 0.5 : 1.5,
      title: `We emailed the customer ${days < 1 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} and they have not replied. It clears when they reply or the conversation is closed in Support.` })
  }

  // Photo add-on changes the artwork, so it ranks above ordinary flags.
  if (o.photoUnpaid) {
    tags.push({ key: 'photo-unpaid', label: 'Photo not paid', tone: 'red',
      title: 'A photo was added after the order and the customer has not paid the Photo Add-On yet. Hold this print until the Shopify order reads paid.' })
  }
  if (o.photoPath) {
    tags.push(o.photoPlacedAt
      ? { key: 'photo', label: 'Photo placed', tone: 'green',
          title: 'This print includes a customer photo and it has been confirmed on the artwork.' }
      : { key: 'photo', label: 'Photo on print', tone: 'purple',
          title: 'This print includes a customer photo. It must be placed and confirmed before the order can be completed.' })
  }

  // Blocking data problems.
  if (o.status === 'missing_year' && !o.yearOverride) {
    tags.push({ key: 'year-missing', label: 'Year missing', tone: 'red',
      title: 'No race year on this order. Contact the customer to confirm which year they ran.' })
  }
  if ((o.effectiveRaceName || o.raceName) === 'Unknown Race') {
    tags.push({ key: 'unknown-race', label: 'Unknown race', tone: 'red',
      title: 'We could not identify the race on this order. It needs manual assistance.' })
  }
  if (o.status === 'flagged') {
    tags.push({ key: 'flagged', label: 'Flagged', tone: 'amber',
      title: o.flagReason || 'This order has been flagged for review.' })
  }

  // Where the numbers came from, when the customer supplied them. One tag.
  // "Verified" means they confirmed an official-results match at checkout;
  // "Customer typed" or "Customer edited" means print their numbers as given.
  // Research progress (needs research, not found, retry) is the Status
  // column's job, not a tag, so it is never said twice.
  // A verified match where the customer changed only the name on the print
  // arrives as "<outcome>_name_edited". The time, pace and bib are still the
  // official ones, so it stays a green Verified tag, saying what changed and
  // which name official results actually matched.
  const nameEdited = !!o.lookupOutcome && o.lookupOutcome.endsWith('_name_edited')
  const matchedName = o.lookupMatchedName ? `"${o.lookupMatchedName}"` : 'this runner'
  let lookupTrust = nameEdited
    ? { label: 'Verified', sublabel: 'name edited', tone: 'green' as const,
        title: `Official results matched ${matchedName} and the customer approved it, then changed the name on the print. Time, pace and bib are the official ones. Print the name the customer gave.` }
    : (o.lookupOutcome ? TRUST_TAGS[o.lookupOutcome] : null)
  // Customer edited the numbers after also changing the name: say who matched.
  if (lookupTrust && !nameEdited && o.lookupMatchedName) {
    lookupTrust = { ...lookupTrust, title: `${lookupTrust.title} Official results matched ${matchedName}.` }
  }
  if (o.researchSource === 'customer_verified') {
    tags.push({ key: 'trust', ...(lookupTrust?.tone === 'green' ? lookupTrust : { label: 'Verified', sublabel: 'by customer', tone: 'green' as const, title: 'The customer confirmed an official-results match before checkout.' }) })
  } else if (o.researchSource === 'scraper' && o.researchStatus === 'found') {
    tags.push({ key: 'trust', label: 'Found', sublabel: 'by research', tone: 'gray' as const, title: 'The tool looked this runner up on the official results site itself. The customer gave only their name; check the match before approving.' })
  } else if (o.researchSource === 'research_agent' && o.researchStatus === 'found') {
    tags.push({ key: 'trust', label: 'Found', sublabel: 'by research agent', tone: 'gray' as const, title: 'The research agent read this off the official results page (link in the research notes). The customer gave only their name; check the match before approving.' })
  } else if (o.researchSource === 'manual_entry') {
    tags.push({ key: 'trust', label: 'Entered', sublabel: 'by hand', tone: 'gray' as const, title: 'Someone on the team typed this result in by hand.' })
  } else if (o.researchSource === 'customer_supplied') {
    tags.push({ key: 'trust', ...(lookupTrust?.tone === 'blue' ? lookupTrust : { label: 'Customer typed', tone: 'blue' as const, title: 'The customer typed these numbers at checkout. They were never matched against official results. Print them as given.' }) })
  }

  // Customer choices about what prints.
  if (o.hadNoTime) {
    tags.push({ key: 'no-time', label: 'No time', tone: 'amber',
      title: 'The customer asked for no finish time on the poster. Leave time and pace blank.' })
  }
  if (o.timeFromName) {
    tags.push({ key: 'customer-time', label: 'Customer time', sublabel: o.timeFromName, tone: 'blue',
      title: `The customer supplied this time themselves: ${o.timeFromName}` })
  }
  if (o.hasOverrides) {
    tags.push({ key: 'edited', label: 'Edited', tone: 'blue',
      title: 'Someone overrode the runner name, race or year on this order.' })
  }

  // A race that has not happened has one thing to say: wait. Only the photo
  // and priority flags matter until race day; the Status column says the rest.
  const shown = showsRaceNotRun(o)
    ? tags.filter(t => ['photo', 'photo-unpaid', 'expedited', 'big-spender', 'waiting-customer'].includes(t.key))
    : tags

  return shown.sort((a, b) =>
    (a.weight ?? TONE_WEIGHT[a.tone]) - (b.weight ?? TONE_WEIGHT[b.tone]))
}

const TONE_CLASS: Record<TagTone, string> = {
  red:    'bg-red-500/10 text-red-600 border-red-500/30',
  amber:  'bg-amber-500/10 text-amber-700 border-amber-500/30',
  purple: 'bg-[#4600D6]/10 text-[#4600D6] border-[#4600D6]/25',
  blue:   'bg-blue-500/10 text-blue-600 border-blue-500/25',
  green:  'bg-green-500/10 text-green-700 border-green-500/25',
  pink:   'bg-pink-50 text-pink-600 border-pink-200',
  gray:   'bg-off-black/5 text-off-black/50 border-off-black/10',
}

/**
 * Hover card. Waits before appearing so it does not flash while someone is
 * scanning a list, and disappears immediately on leave. Native title is not
 * used because it cannot be styled and its timing is inconsistent.
 */
export function HoverTip({
  text, children, align = 'left', className = '',
}: {
  text?: string
  children: ReactNode
  align?: 'left' | 'center'
  className?: string
}) {
  if (!text) return <>{children}</>
  return (
    <span className={`relative inline-flex group ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-50 mt-1 w-max max-w-[15rem] whitespace-normal rounded-md bg-dark-fill px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-white opacity-0 shadow-lg transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-hover:delay-700 ${
          align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'
        }`}
      >
        {text}
      </span>
    </span>
  )
}

/** A single tag chip. Label is bold, any short reason rides along in lighter text. */
export function TagChip({ tag, size = 'sm' }: { tag: OrderTag; size?: 'sm' | 'md' }) {
  return (
    <HoverTip text={tag.title}>
      <span
        className={`inline-flex items-baseline gap-1 rounded border whitespace-nowrap ${TONE_CLASS[tag.tone]} ${
          size === 'md' ? 'px-2 py-0.5 text-[11px]' : 'px-1.5 py-0.5 text-[10px]'
        } ${tag.title ? 'cursor-help' : ''}`}
      >
        <span className="font-semibold">{tag.label}</span>
        {tag.sublabel && <span className="font-normal opacity-70">{tag.sublabel}</span>}
      </span>
    </HoverTip>
  )
}

/**
 * Tag list. Every tag always renders. Tags are the signal Eli scans for, so
 * nothing is ever hidden behind an overflow chip. They wrap instead.
 */
export default function OrderTags({
  order, size = 'sm', className = '', exclude, only,
}: {
  order: TaggableOrder
  size?: 'sm' | 'md'
  className?: string
  /** Tag keys to skip, for surfaces that already show them elsewhere. */
  exclude?: string[]
  /** Only these tag keys, for a surface that shows one kind (the Runner card shows 'trust'). */
  only?: string[]
}) {
  const all = getOrderTags(order)
  const tags = all.filter(t => !exclude?.includes(t.key) && (!only || only.includes(t.key)))
  if (tags.length === 0) return null

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {tags.map(t => <TagChip key={t.key} tag={t} size={size} />)}
    </div>
  )
}
