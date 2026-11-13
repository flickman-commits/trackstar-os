import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

/** Bulk order refunds (server/domain/bulk/refunds.js): the state and the calls. Used by components/bulk/BulkRefunds.tsx. */

const API_BASE = import.meta.env.VITE_API_URL || ''

export type Refund = {
  id: string; kind: 'full' | 'unfilled' | 'custom'; prints: number | null; amountCents?: number | null; paidCents?: number | null
  reason: string; via: 'shopify' | 'stripe'; status: 'requested' | 'approved' | 'refunded' | 'declined' | 'failed'
  requestedBy: string | null; decidedBy: string | null; createdAt: string; decidedAt: string | null; refundedAt: string | null; error: string | null
}
export type RefundState = {
  bulkOrderId: string; number: string; paid: boolean; via: 'shopify' | 'stripe'; quantity: number; making: number; dnf: number; unfilled: number
  open: Refund | null; refunds: Refund[]
  paidCents?: number | null; paidFrom?: 'shopify' | 'entered' | 'estimate' | null; refundedCents?: number
  fullCents?: number | null; unfilledCents?: number | null; perPrintCents?: number | null; leftCents?: number | null
}

export const usd = (c?: number | null) => (c == null ? '–' : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
export const toCents = (v: string) => { const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) && v.trim() ? Math.round(n * 100) : undefined }
export const dollars = (c?: number | null) => (c == null ? '' : (c / 100).toFixed(2))
export const day = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

export async function postRefund(body: Record<string, unknown>): Promise<RefundState> {
  const res = await apiFetch(`${API_BASE}/api/bulk/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export function useRefunds(id: string) {
  const [state, setState] = useState<RefundState | null>(null)
  const load = useCallback(async () => {
    const res = await apiFetch(`${API_BASE}/api/bulk/refund?id=${encodeURIComponent(id)}`)
    if (res.ok) setState(await res.json())
  }, [id])
  useEffect(() => { load() }, [load])
  return { state, setState, load }
}

