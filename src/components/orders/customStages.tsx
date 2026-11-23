import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink, Loader2, CheckCircle2, Truck, FileText } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { approvedProof, day, useTimeline, type StageProof, type TimelineEvent } from './customStage'

/** The stage pieces OrderDetail lays out; which stage is which: ./customStage.ts. */

/** The stage's card: one sentence on where it stands, then its action. */
export function StageCard({ title, sub, tone = 'plain', children }: { title: ReactNode; sub?: ReactNode; tone?: 'plain' | 'done'; children?: ReactNode }) {
  return (
    <section className={`rounded-lg border p-4 space-y-3 ${tone === 'done' ? 'border-emerald-200 bg-emerald-50/40' : 'border-off-black/15 bg-white'}`}>
      <div>
        <h3 className="text-[15px] font-semibold text-off-black leading-snug">{title}</h3>
        {sub && <p className="text-xs text-off-black/55 mt-0.5">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

/** Something one click away: a quiet line that opens in place. */
export function Fold({ label, open, onToggle, children, icon }: { label: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; icon?: ReactNode }) {
  return (
    <div>
      <button type="button" onClick={onToggle} className="inline-flex items-center gap-1.5 px-1 text-[12px] text-off-black/50 hover:text-off-black">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />{icon}{label}
        <span className="font-medium text-off-black/60 hover:underline">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

/** A proof, large, opening full size in a new tab. */
export function ProofImage({ proof, className = 'w-44', badge }: { proof: StageProof; className?: string; badge?: ReactNode }) {
  const isPdf = proof.imageUrl.toLowerCase().includes('.pdf')
  return (
    <a href={proof.imageUrl} target="_blank" rel="noopener noreferrer" className={`relative block shrink-0 ${className}`} title="Open full size">
      {isPdf
        ? <span className="flex aspect-[3/4] w-full items-center justify-center rounded-md border border-border-gray bg-subtle-gray text-xs text-off-black/50"><FileText className="w-5 h-5 mr-1" />{proof.fileName || `v${proof.version}`}</span>
        : <img src={proof.imageUrl} alt={`Proof v${proof.version}`} className="w-full h-auto rounded-md border border-border-gray bg-white hover:opacity-95" />}
      {badge && <span className="absolute top-1.5 left-1.5">{badge}</span>}
    </a>
  )
}

export function ApprovedBadge() {
  return <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800"><CheckCircle2 className="w-3 h-3" />Approved</span>
}

const STATUS_CHIP: Record<StageProof['status'], [string, string]> = {
  approved: ['Approved', 'bg-emerald-100 text-emerald-800'],
  revision_requested: ['Revision', 'bg-amber-100 text-amber-800'],
  rejected: ['Rejected', 'bg-red-100 text-red-700'],
  pending: ['Not answered', 'bg-subtle-gray text-off-black/55'],
}

/** Every proof but the approved one, small, with what the customer said to each. */
export function EarlierVersions({ proofs, open, onToggle }: { proofs: StageProof[]; open: boolean; onToggle: () => void }) {
  if (!proofs.length) return null
  return (
    <Fold label={`${proofs.length} earlier version${proofs.length === 1 ? '' : 's'}`} open={open} onToggle={onToggle}>
      <div className="flex flex-wrap gap-3 pl-5">
        {[...proofs].reverse().map(p => {
          const [label, cls] = STATUS_CHIP[p.status] || STATUS_CHIP.pending
          return (
            <div key={p.id} className="w-16">
              <a href={p.imageUrl} target="_blank" rel="noopener noreferrer" title={p.customerFeedback || `v${p.version}`}>
                <img src={p.thumbnailUrl || p.imageUrl} alt={`v${p.version}`} className="w-16 h-16 object-cover rounded border border-border-gray opacity-80 hover:opacity-100" />
              </a>
              <span className={`mt-1 inline-block rounded px-1 py-0.5 text-[9px] font-semibold ${cls}`}>{label}</span>
            </div>
          )
        })}
      </div>
    </Fold>
  )
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative space-y-2.5">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="grid grid-cols-[3.25rem_0.75rem_minmax(0,1fr)] gap-2 text-[13px]">
          <span className="text-off-black/45 tabular-nums">{day(e.at)}</span>
          <span className="relative flex justify-center">
            <span className="mt-1.5 h-2 w-2 rounded-full bg-off-black/40" />
            {i < events.length - 1 && <span className="absolute top-3.5 -bottom-3 w-px bg-border-gray" />}
          </span>
          <span className="min-w-0 text-off-black">
            {e.url ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{e.label}</a> : e.label}
            {e.by && <span className="text-off-black/45"> · {e.by}</span>}
            {e.quote && <span className="block text-xs text-off-black/55 italic mt-0.5">“{e.quote}”</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * The Sent stage: a record for coming back to an order that went wrong. The
 * approved design large, what was printed, where the files and the print
 * are, and every step with its date.
 */
export function SentRecord({ orderId, proofs, rows, sentAt, footer }: {
  orderId: string
  proofs: StageProof[] | null
  /** What was printed: label and value. */
  rows: [string, ReactNode][]
  sentAt?: string | null
  footer?: ReactNode
}) {
  const tl = useTimeline(orderId)
  const [finalPdf, setFinalPdf] = useState<{ pdfUrl: string | null; driveUrl: string | null } | null>(null)
  useEffect(() => {
    let live = true
    apiFetch(`/api/orders/final-pdf?orderId=${encodeURIComponent(orderId)}`).then(r => (r.ok ? r.json() : null)).then(d => { if (live) setFinalPdf(d?.finalPdf || null) }).catch(() => {})
    return () => { live = false }
  }, [orderId])
  const approved = approvedProof(proofs)
  // When it went: the timeline's send (Artelo, or marked by hand), else what the order says.
  const wentAt = [...(tl?.events || [])].reverse().find(e => e.kind === 'sent')?.at || sentAt
  const prod = tl?.production
  const track = prod?.tracking?.[0]
  const link = 'inline-flex items-center gap-1 text-[#4600D6] hover:underline underline-offset-2'
  return (
    <>
      <StageCard tone="done" title={`Sent to production${wentAt ? ` ${day(wentAt)}` : ''}`} sub={prod?.stage ? `Now: ${prod.stage}${track?.company ? ` · ${track.company}` : ''}` : tl ? undefined : 'Checking Artelo and shipping…'}>
        <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
          {proofs === null ? <div className="aspect-[3/4] rounded-md bg-subtle-gray flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-off-black/30" /></div>
            : approved ? <ProofImage proof={approved} className="w-full" badge={<ApprovedBadge />} />
            : <div className="aspect-[3/4] rounded-md border border-dashed border-border-gray flex items-center justify-center text-xs text-off-black/45 text-center px-3">No approved proof on file</div>}
          <div className="min-w-0 space-y-3">
            <dl className="divide-y divide-border-gray text-[13px]">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-1.5"><dt className="text-off-black/55">{k}</dt><dd className="text-right text-off-black min-w-0">{v}</dd></div>
              ))}
            </dl>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              {finalPdf?.pdfUrl && <a href={finalPdf.pdfUrl} target="_blank" rel="noopener noreferrer" className={link}>Final PDF <ExternalLink className="w-3 h-3" /></a>}
              {finalPdf?.driveUrl && <a href={finalPdf.driveUrl} target="_blank" rel="noopener noreferrer" className={link}>Drive <ExternalLink className="w-3 h-3" /></a>}
              {prod?.url && <a href={prod.url} target="_blank" rel="noopener noreferrer" className={link}>Artelo order <ExternalLink className="w-3 h-3" /></a>}
              {track?.url && <a href={track.url} target="_blank" rel="noopener noreferrer" className={link}><Truck className="w-3.5 h-3.5" />Tracking</a>}
            </div>
          </div>
        </div>
      </StageCard>
      <section className="rounded-lg border border-border-gray bg-white p-4">
        <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-3">Timeline</h4>
        {!tl ? <div className="flex items-center gap-2 text-xs text-off-black/45"><Loader2 className="w-3 h-3 animate-spin" />Loading</div>
          : <>
              <Timeline events={tl.events} />
              {tl.errors.length > 0 && <p className="mt-3 text-xs text-amber-700">{tl.errors.join('. ')}, so shipping may be missing.</p>}
            </>}
      </section>
      {footer}
    </>
  )
}
