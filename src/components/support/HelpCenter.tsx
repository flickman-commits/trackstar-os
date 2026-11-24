import { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import ActionModal from '@/components/ActionModal'
import { helpApi, type Topic } from '@/lib/helpApi'
import { segment, segmentGroup } from '@/lib/ui'
import type { ThreadDetail } from '@/types/support'
import { stage } from './orderStage'
import AskTab, { type AskContext } from './help/AskTab'
import PlaybookTab from './help/PlaybookTab'
import ManageTab from './help/ManageTab'

/**
 * Support > Help (server/domain/support/helpCenter.js), for a rep with a
 * customer waiting (Matt, 2026-11-24: too long and wordy, nobody reads it).
 * Ask: explain the situation, get a short answer and a reply. Playbook: one
 * screen per kind of message. Manage, admins only: questions, corrections
 * and the full articles.
 */
type Tab = 'ask' | 'playbook' | 'manage'
// Kept between openings, so the playbook is there at once; read again each time Help opens.
let cached: Topic[] | null = null

/** The open conversation in a few words: "Bizzy · #10849 · Not sent to production yet". */
function contextOf(thread: ThreadDetail | null, first: string): AskContext | null {
  if (!thread) return null
  const order = thread.context?.orders?.[0]
  const at = order ? stage(order)?.label : null
  return { threadId: thread.id, label: [first || 'This conversation', order ? `#${String(order.number).replace(/^#/, '')}` : null, at].filter(Boolean).join(' · ') }
}

export default function HelpCenter({ thread, rep, onUseReply, onOpenThread, onClose }: {
  thread: ThreadDetail | null; rep: string | null; onUseReply: (body: string) => void; onOpenThread: (id: string) => void; onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('ask')
  const [topics, setTopicsState] = useState<Topic[] | null>(cached)
  const setTopics = (t: Topic[]) => { cached = t; setTopicsState(t) }
  const [isAdmin, setIsAdmin] = useState(false)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    helpApi.topics().then(r => { setTopics(r.topics); setIsAdmin(r.isAdmin); if (r.isAdmin) helpApi.log().then(l => setPending(l.pending.length)).catch(() => {}) }).catch(e => toast.error((e as Error).message))
  }, [])
  const name = (thread?.customerName || '').trim().split(/\s+/)[0]
  const first = /^[A-Za-z][A-Za-z'.-]+$/.test(name) ? name[0].toUpperCase() + name.slice(1) : ''
  const use = (body: string) => { onUseReply(body); onClose() }
  return (
    <ActionModal icon={BookOpen} title="Help" size="xl" bare onClose={onClose}
      actions={
        <div className={segmentGroup}>
          <button className={segment(tab === 'ask', 'md')} onClick={() => setTab('ask')}>Ask</button>
          <button className={segment(tab === 'playbook', 'md')} onClick={() => setTab('playbook')}>Playbook</button>
          {isAdmin && <button className={`${segment(tab === 'manage', 'md')} hidden md:inline-block`} onClick={() => setTab('manage')}>Manage{pending ? ` (${pending})` : ''}</button>}
        </div>
      }>
      <div className="h-[70dvh] md:h-[calc(80vh-84px)] min-h-0 overflow-hidden">
        {tab === 'ask' && <AskTab key={thread?.id || 'none'} context={contextOf(thread, first)} onUseReply={use} onOpenThread={id => { onClose(); onOpenThread(id) }} />}
        {tab === 'playbook' && <PlaybookTab topics={topics} onTopics={setTopics} isAdmin={isAdmin} names={{ first, rep }} onUseReply={thread ? use : undefined} />}
        {tab === 'manage' && isAdmin && <ManageTab onPending={setPending} />}
      </div>
    </ActionModal>
  )
}
