import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

/**
 * The custom order view, one layout per stage (2026-11-23). Each stage has
 * one job and one main action; the designer gets what that action needs and
 * nothing else, and the rest folds away. OrderDetail lays the stages out with
 * these pieces:
 *
 *   designing  Not started / In progress: make the first proofs and send them
 *   proofs     Awaiting review: wait, and follow up from day 3
 *   revision   In revision: make the change they asked for and send it back
 *   approved   Approved by customer: export and upload the final PDF
 *   final      Final PDF uploaded: nothing for the designer; it goes on its own
 *   sent       Sent to production: a record to come back to when something went wrong
 */
export type CustomStage = 'designing' | 'proofs' | 'revision' | 'approved' | 'final' | 'sent'

export function customStage(designStatus?: string | null): CustomStage {
  switch (designStatus) {
    case 'awaiting_review': return 'proofs'
    case 'in_revision': return 'revision'
    case 'approved_by_customer': return 'approved'
    case 'final_pdf_uploaded': return 'final'
    case 'sent_to_production': return 'sent'
    default: return 'designing'
  }
}

export interface StageProof {
  id: string
  version: number
  batch: number
  imageUrl: string
  thumbnailUrl: string | null
  fileName: string | null
  status: 'pending' | 'approved' | 'revision_requested' | 'rejected'
  customerFeedback: string | null
  createdAt: string
  updatedAt: string
}

/** The order's proofs, for the stages after approval (ProofManager has its own before that). */
export function useOrderProofs(orderId: string, enabled = true) {
  const [proofs, setProofs] = useState<StageProof[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    setProofs(null)
    apiFetch(`/api/proofs?orderId=${encodeURIComponent(orderId)}`)
      .then(r => (r.ok ? r.json() : { proofs: [] }))
      .then(d => { if (live) setProofs(d.proofs || []) })
      .catch(() => { if (live) setProofs([]) })
    return () => { live = false }
  }, [orderId, enabled])
  return proofs
}

/** The one proof the customer approved: the newest approved one. */
export function approvedProof(proofs: StageProof[] | null) {
  return [...(proofs || [])].reverse().find(p => p.status === 'approved') || null
}

export const day = (t?: string | null) => t ? new Date(t).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }) : ''

export interface TimelineEvent { at: string; label: string; by?: string | null; quote?: string | null; url?: string | null; kind?: string }
export interface Production { stage: string | null; url: string | null; tracking: { url: string | null; number: string | null; company: string | null }[] }

/** What happened on the order, oldest first (server/domain/orders/timeline.js). */
export function useTimeline(orderId: string) {
  const [data, setData] = useState<{ events: TimelineEvent[]; production: Production | null; errors: string[] } | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    apiFetch(`/api/orders/timeline?orderId=${encodeURIComponent(orderId)}`)
      .then(r => (r.ok ? r.json() : { events: [], production: null, errors: ['The timeline did not load'] }))
      .then(d => { if (live) setData(d) })
      .catch(() => { if (live) setData({ events: [], production: null, errors: ['The timeline did not load'] }) })
    return () => { live = false }
  }, [orderId])
  return data
}

