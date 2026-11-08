import { Link, useLocation } from 'react-router-dom'
import PageHeader from '@/components/PageHeader'
import { pageShell, segment, segmentGroup } from '@/lib/ui'
import { useDocumentHead } from '@/lib/useDocumentHead'
import Overview from '@/components/finance/Overview'
import Daily from '@/components/finance/Daily'
import Payouts from '@/components/finance/Payouts'
import Replacements from '@/components/finance/Replacements'
import Timesheets from '@/components/finance/Timesheets'
import Forecast from '@/components/finance/Forecast'

/**
 * Finance: where the money is going, in one place. Admin only.
 *
 * Overview is the dashboard (the period's numbers against the one before,
 * where the money went, the daily trend, the levers, what needs Matt).
 * Daily is the Daily Tracker's scoreboard, read from the sheet's raw tabs
 * each morning. Payouts is who is owed what (customs, hours, the designer
 * fee) and what was paid. Timesheets is every person's hours, for approval.
 * Forecast comes in a later phase. See docs/finance-panel-plan.md.
 */
type Section = 'overview' | 'daily' | 'payouts' | 'replacements' | 'timesheets' | 'forecast'
const TABS: [Section, string, string][] = [
  ['overview', 'Overview', '/finance'], ['daily', 'Daily', '/finance/daily'], ['payouts', 'Payouts', '/finance/payouts'], ['replacements', 'Replacements', '/finance/replacements'],
  ['timesheets', 'Timesheets', '/finance/timesheets'], ['forecast', 'Forecast', '/finance/forecast'],
]

export default function Finance() {
  const { pathname } = useLocation()
  const section: Section = (TABS.find(t => t[2] !== '/finance' && pathname.startsWith(t[2]))?.[0]) || 'overview'
  const label = TABS.find(t => t[0] === section)?.[1] || 'Overview'
  useDocumentHead({ title: `${label} · Finance · Trackstar` })
  return (
    <div className={`${pageShell} !overflow-y-auto`}>
      <div className="px-3 md:px-5 w-full flex flex-col min-h-full">
        <PageHeader title="Finance" subtitle={label} control={
          <select value={TABS.find(t => t[0] === section)?.[2] || '/finance'} onChange={e => { window.location.assign(e.target.value) }} className="text-xs font-medium bg-white border border-border-gray rounded-full pl-3 pr-7 py-1.5 appearance-none">
            {TABS.map(([key, l, to]) => <option key={key} value={to}>{l}</option>)}
          </select>
        } />
        <div className="pt-4 md:pt-5 pb-3 md:pb-4 hidden md:flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
            <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Finance</h1>
          </div>
          <div className={segmentGroup}>
            {TABS.map(([key, l, to]) => <Link key={key} to={to} className={segment(section === key, 'md')}>{l}</Link>)}
          </div>
        </div>
        <section className="flex-1 pb-6">
          {section === 'overview' && <Overview />}
          {section === 'daily' && <Daily />}
          {section === 'payouts' && <Payouts />}
          {section === 'replacements' && <Replacements />}
          {section === 'timesheets' && <Timesheets />}
          {section === 'forecast' && <Forecast />}
        </section>
      </div>
    </div>
  )
}
