import { useEffect, useState } from 'react'
import { Package, ChevronRight } from 'lucide-react'
import { apiFetch } from '@/lib/api'

const API_BASE = import.meta.env.VITE_API_URL || ''

type Run = {
  id: string; number: string; partnerName: string; race: string; raceDate: string; dueDate: string | null
  raced: boolean; overdue: boolean; quantity: number; entered: number; owner: string | null; blockers: string[]
}

const day = (d: string) => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' })

/**
 * Top of the Standard orders view: bulk runs within a week of their race (or
 * past it) that have not gone to Artelo, with what is in the way, so they
 * are not forgotten on the Bulk tab (server/domain/bulk/attention.js).
 */
export default function BulkAttention({ onOpen }: { onOpen: (id: string) => void }) {
  const [runs, setRuns] = useState<Run[]>([])
  useEffect(() => {
    apiFetch(`${API_BASE}/api/bulk?attention=1`).then(r => (r.ok ? r.json() : { runs: [] })).then(d => setRuns(d.runs || [])).catch(() => setRuns([]))
  }, [])
  if (!runs.length) return null
  return (
    <div className="border-b border-border-gray bg-amber-50/60">
      <div className="px-3 md:px-4 pt-2.5 pb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        <Package className="w-3.5 h-3.5" /> Bulk orders this week
      </div>
      <div className="divide-y divide-amber-200/70">
        {runs.map(r => (
          <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left px-3 md:px-4 py-2 hover:bg-amber-100/60 transition-colors flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-off-black truncate">
                <span className="font-semibold">{r.partnerName}</span>
                <span className="text-off-black/55"> · {r.race} · {r.entered} of {r.quantity} runners</span>
              </div>
              <div className="text-xs truncate">
                <span className={r.overdue ? 'text-red-600 font-semibold' : 'text-off-black/60'}>
                  {r.raced ? `Due ${r.dueDate ? day(r.dueDate) : 'date not set'}${r.overdue ? ', overdue' : ''}` : `Race ${day(r.raceDate)}`}
                </span>
                <span className="text-amber-800"> · {r.blockers.length ? r.blockers.join(' · ') : 'ready to submit to Artelo'}</span>
              </div>
            </div>
            <span className="hidden md:inline text-xs text-off-black/40">{r.number}{r.owner ? ` · ${r.owner}` : ''}</span>
            <ChevronRight className="w-4 h-4 text-off-black/30 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
