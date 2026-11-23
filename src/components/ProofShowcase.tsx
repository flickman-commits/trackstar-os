import { useEffect, useState, type ReactNode } from 'react'
import ProofFullscreen from '@/components/ProofFullscreen'
import { apiFetch } from '@/lib/api'

const API_BASE = import.meta.env.VITE_API_URL || ''
type Proof = { id: string; imageUrl: string; thumbnailUrl: string | null; status: 'pending' | 'approved' | 'revision_requested' | 'rejected'; createdAt?: string }

/**
 * A custom order on the phone leads with the work: the newest proofs, big,
 * swiped side to side. This is what gets shown to people ("look at this one").
 * The full proof manager stays below, behind Details. Tapping one opens the
 * full-screen viewer (ProofFullscreen, as the approval portal uses): swipe
 * between this order's designs, pinch or double-tap to zoom.
 */
export default function ProofShowcase({ orderId, empty = null }: { orderId: string; /** What shows when the order has no designs yet. */ empty?: ReactNode }) {
  const [proofs, setProofs] = useState<Proof[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    setProofs(null)
    apiFetch(`${API_BASE}/api/proofs?orderId=${encodeURIComponent(orderId)}`).then(r => r.ok ? r.json() : null)
      .then(d => { if (live) setProofs(((d?.proofs || []) as Proof[]).filter(p => !/\.pdf(\?|$)/i.test(p.imageUrl))) })
      .catch(() => { if (live) setProofs([]) })
    return () => { live = false }
  }, [orderId])
  if (proofs === null) return <div className="aspect-[4/5] rounded-lg bg-off-black/5 animate-pulse" />
  if (!proofs.length) return <>{empty}</>
  // Newest first (the current batch is what to show); an approved one leads.
  const sorted = [...proofs]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .sort((a, b) => (a.status === 'approved' ? -1 : b.status === 'approved' ? 1 : 0))
  const tone = (s: Proof['status']) => s === 'approved' ? 'bg-green-600 text-white' : s === 'revision_requested' ? 'bg-amber-500 text-white' : s === 'rejected' ? 'bg-red-600 text-white' : 'bg-white/90 text-off-black'
  const label = (s: Proof['status']) => s === 'approved' ? 'Approved' : s === 'revision_requested' ? 'Revision asked' : s === 'rejected' ? 'Rejected' : 'Pending'
  return (
    <div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 pb-1 [scrollbar-width:none]">
        {sorted.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setOpen(i)} className="relative shrink-0 snap-center w-[86%] rounded-lg overflow-hidden bg-[#ece9e2] border border-border-gray text-left">
            <img src={p.imageUrl} alt="" className="w-full aspect-[4/5] object-contain" loading="lazy" />
            <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-semibold shadow-sm ${tone(p.status)}`}>{label(p.status)}</span>
          </button>
        ))}
      </div>
      {sorted.length > 1 && <p className="mt-1.5 text-[11px] text-off-black/45 text-center">{sorted.length} proofs. Swipe, or tap one to see it full screen.</p>}
      {open !== null && (
        <ProofFullscreen
          proofs={sorted.map(p => ({ id: p.id, imageUrl: p.imageUrl }))}
          index={open}
          onIndexChange={setOpen}
          onClose={() => setOpen(null)}
          counterLabel={`${open + 1} of ${sorted.length}`}
          badge={<span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold ${tone(sorted[open].status)}`}>{label(sorted[open].status)}</span>}
        />
      )}
    </div>
  )
}
