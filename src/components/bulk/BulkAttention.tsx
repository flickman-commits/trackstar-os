import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { Avatar } from '@/components/AssigneePicker'

const API_BASE = import.meta.env.VITE_API_URL || ''

type Run = {
  id: string; number: string; partnerName: string; race: string; raceDate: string; dueDate: string | null
  raced: boolean; overdue: boolean; quantity: number; entered: number; sent: number
  assignee: { id: string; firstName: string; lastName: string } | null; blockers: string[]
}

const day = (d: string) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })

/**
 * Bulk runs within a week of their race (or past it) that have not gone to
 * Artelo, as the first rows of the Standard orders table, in its columns:
 * the run, how many prints have gone to production, the customer and race,
 * who has it (server/domain/bulk/attention.js). What is in the way shows on
 * hover; the run itself has the detail.
 */
export default function BulkAttentionRows({ onOpen }: { onOpen: (number: string) => void }) {
  const [runs, setRuns] = useState<Run[]>([])
  useEffect(() => {
    apiFetch(`${API_BASE}/api/bulk?attention=1`).then(r => (r.ok ? r.json() : { runs: [] })).then(d => setRuns(d.runs || [])).catch(() => setRuns([]))
  }, [])
  if (!runs.length) return null
  return (
    <>
      {runs.map(r => {
        const total = r.quantity || r.entered || 0
        const pct = total ? Math.min(100, Math.round((r.sent / total) * 100)) : 0
        const due = r.raced ? (r.dueDate ? `Due ${day(r.dueDate)}` : 'No due date') : `Race ${day(r.raceDate)}`
        return (
          <tr key={r.id} onClick={() => onOpen(r.number)} title={r.blockers.length ? `In the way: ${r.blockers.join(', ')}` : 'Ready to send to Artelo'}
            className="bg-[#F6F5F2] hover:bg-[#EFEDE8] cursor-pointer transition-colors">
            <td className="pl-6 pr-2 py-4 text-center">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-white border border-border-gray" aria-label="Bulk order">
                <Package className="w-4 h-4 text-off-black/70" />
              </span>
            </td>
            <td className="px-3 py-4">
              <div className="text-sm font-medium text-off-black">{r.number}</div>
              <div className={`mt-0.5 text-[11px] ${r.overdue ? 'text-red-600 font-semibold' : 'text-off-black/50'}`}>{due}{r.overdue ? ', overdue' : ''}</div>
            </td>
            <td className="px-3 py-4">
              <div className="mx-auto w-40">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-semibold text-off-black tabular-nums">{pct}%</span>
                  <span className="text-off-black/55 tabular-nums">{r.sent} of {total} sent</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-off-black/10 overflow-hidden">
                  <div className="h-full rounded-full bg-[#4600D6] transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </td>
            <td className="px-3 py-4">
              <div className="text-sm text-off-black">{r.partnerName}</div>
              <div className="text-xs text-off-black/50 mt-0.5">{r.race}</div>
            </td>
            <td className="px-3 py-4">
              {r.assignee
                ? <span className="inline-flex items-center gap-1.5 text-sm text-off-black whitespace-nowrap"><Avatar user={r.assignee} size={20} />{r.assignee.firstName}</span>
                : <span className="text-sm text-off-black/40">Unassigned</span>}
            </td>
            <td className="px-3 pr-6 py-4 hidden md:table-cell align-middle">
              <span className="inline-flex items-center px-2 py-0.5 rounded-md border border-border-gray bg-white text-xs font-medium text-off-black/70">Bulk order</span>
            </td>
          </tr>
        )
      })}
    </>
  )
}
