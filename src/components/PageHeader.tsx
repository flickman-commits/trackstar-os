import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { openCommandSearch } from '@/lib/commandSearch'

/**
 * The phone header every tool shares, modeled on the order list's: the stars
 * with a count pill beside them, then the tool's name in small caps with one
 * control on the right. Desktop headers stay as each page has them; this
 * renders only below md. The stars are a fixed height and never stretch.
 * The stars row ends with the search button: a phone has no ⌘K, so this is
 * how every page reaches the one search box.
 */
export default function PageHeader({ title, pill, subtitle, control, right }: {
  title: string
  /** A short count next to the stars, e.g. "288 orders" or "7 open". */
  pill?: ReactNode
  subtitle?: ReactNode
  /** One control on the title row's right: a view picker, a filter. */
  control?: ReactNode
  /** Something on the stars row's right, used sparingly. */
  right?: ReactNode
}) {
  return (
    <div className="md:hidden pt-4 pb-3 flex-shrink-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-8 w-auto shrink-0 object-contain" />
          {pill && <span className="px-2 py-0.5 bg-off-black/10 text-off-black/60 text-xs font-medium rounded whitespace-nowrap">{pill}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {right}
          <button onClick={openCommandSearch} aria-label="Search orders" title="Search"
            className="w-9 h-9 -mr-1 inline-flex items-center justify-center rounded-full text-off-black/70 active:bg-off-black/10">
            <Search className="w-5 h-5" strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-off-black uppercase tracking-tight leading-tight">{title}</h2>
          {subtitle && <div className="text-xs text-off-black/45 mt-0.5">{subtitle}</div>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
    </div>
  )
}
