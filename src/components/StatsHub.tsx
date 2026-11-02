import { useNavigate } from 'react-router-dom'
import { segment, segmentGroup } from '@/lib/ui'
import StatsPanel from '@/components/StatsPanel'
import SupportClosesPanel from '@/components/SupportClosesPanel'

type Tab = 'overview' | 'tickets'

/**
 * Settings > Stats (admin only): how the business is doing in one place.
 * Overview (order speed and the Shopify numbers) and Tickets Resolved (support,
 * by person). Each tab keeps its own address, /settings/stats and
 * /settings/support_closes, so old links and bookmarks still land on it. The
 * Custom Counter has its own Settings section (Team).
 */
export default function StatsHub({ initial }: { initial: Tab }) {
  const navigate = useNavigate()
  const go = (t: Tab) => navigate(t === 'overview' ? '/settings/stats' : '/settings/support_closes')
  return (
    <div className="space-y-4">
      <div className={segmentGroup}>
        <button onClick={() => go('overview')} className={segment(initial === 'overview', 'sm')}>Overview</button>
        <button onClick={() => go('tickets')} className={segment(initial === 'tickets', 'sm')}>Tickets Resolved</button>
      </div>
      {initial === 'overview' && <StatsPanel />}
      {initial === 'tickets' && <SupportClosesPanel />}
    </div>
  )
}
