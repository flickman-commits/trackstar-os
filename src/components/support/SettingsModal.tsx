import { Settings } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
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
  return (
    <ActionModal icon={Settings} title="Support settings" description="Routing, filtered senders, drafting, the mailbox and Instagram." onClose={onClose} size="lg" bare>
      {isAdmin && <RoutingRules team={team} unassignedCount={unassignedCount} onChanged={onChanged} />}
      <FilterList filters={filters} onChanged={onChanged} />
      <ForwardersCard isAdmin={isAdmin} />
      <DraftModelCard isAdmin={isAdmin} />
      <PlaybookEditor isAdmin={isAdmin} />
      <MailboxCard status={status} isAdmin={isAdmin} onChanged={onChanged} />
      <InstagramCard status={instagram} isAdmin={isAdmin} onChanged={onChanged} />
    </ActionModal>
  )
}
