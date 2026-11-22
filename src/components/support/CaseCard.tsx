import { useEffect, useState } from 'react'
import { helpApi, type CaseTag, type Choice } from '@/lib/helpApi'
import { toast } from 'sonner'

/**
 * What this closed conversation was and what we did (server/domain/support/cases.js):
 * Claude files it a few minutes after it closes; anyone on Support corrects
 * it here, and their choice stands. Past cases power the Help answers and
 * Claude's drafts, so a right tag makes both better.
 */
export default function CaseCard({ threadId, status }: { threadId: string; status: string }) {
  const [tag, setTag] = useState<CaseTag | null>(null)
  const [types, setTypes] = useState<Choice[]>([])
  const [outcomes, setOutcomes] = useState<Choice[]>([])
  useEffect(() => {
    setTag(null)
    helpApi.caseOf(threadId).then(r => { setTag(r.case); setTypes(r.types); setOutcomes(r.outcomes) }).catch(() => {})
  }, [threadId, status])
  if (!tag) return null
  const set = async (patch: { type?: string; outcome?: string }) => {
    try { const r = await helpApi.setCase(threadId, patch); setTag(r.case); toast.success('Case updated') }
    catch (e) { toast.error((e as Error).message) }
  }
  if (!tag.caseTaggedAt) {
    return <div className="text-xs text-off-black/45">{status === 'closed' ? 'Filed as a case within a few minutes of closing.' : 'Filed as a case once it is closed.'}</div>
  }
  const select = 'w-full min-w-0 px-2 py-1 text-xs bg-white border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20'
  return (
    <div className="space-y-2 text-xs">
      <div className="grid grid-cols-[64px_1fr] items-center gap-x-2 gap-y-1.5">
        <span className="text-off-black/45">What</span>
        <select value={tag.caseType || ''} onChange={e => set({ type: e.target.value })} className={select}>
          {types.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <span className="text-off-black/45">We did</span>
        <select value={tag.caseOutcome || ''} onChange={e => set({ outcome: e.target.value })} className={select}>
          {outcomes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {tag.caseSummary && <div className="text-off-black/70">{tag.caseSummary}</div>}
      <div className="text-[11px] text-off-black/40">
        {tag.caseCostCents ? `Cost about $${(tag.caseCostCents / 100).toFixed(2)} · ` : ''}Filed by {tag.caseTaggedBy === 'claude' ? 'Claude' : tag.caseTaggedBy}. Fix it if it's wrong; past cases teach Help and the drafts.
      </div>
    </div>
  )
}
