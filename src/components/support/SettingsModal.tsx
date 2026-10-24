import { X } from 'lucide-react'
import { btnGhost } from '@/lib/ui'
import { useEscape } from '@/lib/useEscape'
import { MailboxCard, InstagramCard } from './Details'
import RoutingRules from './RoutingRules'
import { FilterList } from './SenderFilter'
import PlaybookEditor from './PlaybookEditor'
import ForwardersCard from './ForwardersCard'
import DraftModelCard from './DraftModelCard'
import type { InstagramStatus, MailboxStatus, SenderFilter, Teammate } from '@/types/support'

/**
 * Settings for the inbox, out of the way of the conversation: where new
 * conversations go, the Gmail mailbox, the Instagram account. Admins only;
 * everyone else sees the not-connected banner at the top of the page if
 * something needs an admin.
 */
export default function SettingsModal({ team, unassignedCount, status, instagram, isAdmin, filters, onChanged, onClose }: {
  team: Teammate[]
  unassignedCount: number
  status: MailboxStatus | null
  instagram: InstagramStatus | null
  isAdmin: boolean
  filters: SenderFilter[]
  onChanged: () => void
  onClose: () => void
}) {
  useEscape(onClose)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-border-gray flex items-center justify-between">
          <div>
            <div className="text-base font-semibold text-off-black">Support settings</div>
            <div className="text-xs text-off-black/50">Routing, filtered senders, drafting, the mailbox and Instagram.</div>
          </div>
          <button onClick={onClose} className={btnGhost}><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isAdmin && <RoutingRules team={team} unassignedCount={unassignedCount} onChanged={onChanged} />}
          <FilterList filters={filters} onChanged={onChanged} />
          <ForwardersCard isAdmin={isAdmin} />
          <DraftModelCard isAdmin={isAdmin} />
          <PlaybookEditor isAdmin={isAdmin} />
          <MailboxCard status={status} isAdmin={isAdmin} onChanged={onChanged} />
          <InstagramCard status={instagram} isAdmin={isAdmin} onChanged={onChanged} />
        </div>
      </div>
    </div>
  )
}
