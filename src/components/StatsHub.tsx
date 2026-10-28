import { useNavigate } from 'react-router-dom'
import { segment, segmentGroup } from '@/lib/ui'
import StatsPanel from '@/components/StatsPanel'
import CustomCounter from '@/components/CustomCounter'
import SupportClosesPanel from '@/components/SupportClosesPanel'

type Tab = 'overview' | 'counter' | 'tickets'

/**
 * Settings > Stats (admin only): how the business is doing in one place.
 * Overview (order speed and the Shopify numbers), the Custom Counter (designer
 * payouts) and Tickets Resolved (support, by person). Each tab keeps its own
 * address, /settings/stats, /settings/counter and /settings/support_closes, so
 * old links and bookmarks still land on it.
 */
export default function StatsHub({ initial }: { initial: Tab }) {
  const navigate = useNavigate()
  const go = (t: Tab) => navigate(t === 'overview' ? '/settings/stats' : t === 'counter' ? '/settings/counter' : '/settings/support_closes')
  return (
    <div className="space-y-4">
      <div className={segmentGroup}>
        <button onClick={() => go('overview')} className={segment(initial === 'overview', 'sm')}>Overview</button>
        <button onClick={() => go('counter')} className={segment(initial === 'counter', 'sm')}>Custom Counter</button>
        <button onClick={() => go('tickets')} className={segment(initial === 'tickets', 'sm')}>Tickets Resolved</button>
      </div>
      {initial === 'overview' && <StatsPanel />}
      {initial === 'counter' && <CustomCounter />}
      {initial === 'tickets' && <SupportClosesPanel />}
    </div>
  )
}
