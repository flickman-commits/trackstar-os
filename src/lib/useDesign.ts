import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'

/** State for the open order's automated print. Read by the pieces in components/DesignPanel.tsx. */

export type Job = {
  id: string; version: number; status: 'queued' | 'rendering' | 'done' | 'failed'; requestedBy: 'admin' | 'system' | 'customer'
  spec: { file: string; name: string; bib: string; time: string | null; pace: string | null; date: string; condition: string; temp: string; size: string; noTime: boolean; photoPath: string | null; dateSource?: string | null; dateSourceUrl?: string | null; template?: string | null; altSize?: boolean }
  notes: string | null; error: string | null; createdAt: string; finishedAt: string | null
  review: 'pending' | 'approved' | 'rejected' | 'closed'; reviewNote: string | null; reviewer: string | null; reviewedAt: string | null
  deliveredAt: string | null; deliveredPath: string | null; deliveryError: string | null
  arteloUploadedAt: string | null; arteloUrl: string | null; arteloError: string | null
  // On its way to Artelo production (server/domain/render/arteloSend.js); null when approved without sending.
  send: { state: 'queued' | 'held' | 'support' | 'waiting' | 'blocked' | 'manual' | 'sent'; at?: string | null; by?: string | null; reason?: string; next?: string | null; inHold?: boolean; threadId?: string | null } | null
  output: { trimIn: string | null; bleedIn: { left: number; right: number; top: number; bottom: number } | null; color: 'CMYK' | 'RGB' | 'mixed' | null } | null
  pdfUrl: string | null; previewUrl: string | null
}
type State = { eligible: boolean; reasons: string[]; job: Job | null; workersOnline: string[]; autoSend?: boolean }

async function post(body: Record<string, unknown>) {
  const res = await apiFetch('/api/render/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export type Design = ReturnType<typeof useDesign>

/** Everything the design pieces read. Pass null for an order that has no automated print. */
export function useDesign(orderId: string | null, canManage: boolean) {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  // Re-render has its own flag, so approving or rejecting does not spin the Re-render button.
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // The order on screen. J/K can move on before a request for the last
  // order comes back; that answer must not land on the new order.
  const current = useRef(orderId)
  current.current = orderId
  const load = useCallback(async () => {
    if (!orderId) return
    try {
      const res = await apiFetch(`/api/render/jobs?orderId=${encodeURIComponent(orderId)}`)
      if (!res.ok) return
      const data = await res.json()
      if (current.current === orderId) setState(data)
    } catch { /* leave what we have */ }
  }, [orderId])

  useEffect(() => { setState(null); setErr(null); load() }, [load])

  // While a render is in flight, or an approved print is still on its way to
  // Drive and Artelo (that happens after Approve answers), ask again every few seconds.
  const j = state?.job
  const uploading = Boolean(j && j.review === 'approved' && ((!j.deliveredAt && !j.deliveryError) || (!j.arteloUploadedAt && !j.arteloError)))
  const inFlight = j && (j.status === 'queued' || j.status === 'rendering' || uploading)
  useEffect(() => {
    if (!inFlight) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [inFlight, load])
  // On its way to production: the sender runs once a minute, so a slower check is enough.
  const sending = Boolean(!inFlight && j?.review === 'approved' && (j.send?.state === 'queued' || j.send?.state === 'waiting'))
  useEffect(() => {
    if (!sending) return
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [sending, load])

  const create = async () => {
    setBusy(true); setCreating(true); setErr(null)
    // Straight to the loading state; the next poll brings the real job.
    setState(s => s && s.job ? { ...s, job: { ...s.job, status: 'queued', previewUrl: null, pdfUrl: null, review: 'pending', output: null } } : s)
    try { await post({ action: 'create', orderId }); await load() } catch (e) { setErr(e instanceof Error ? e.message : 'Could not start') } finally { setBusy(false); setCreating(false) }
  }
  // designNeed: a rejection for a problem in the production file, which goes on Settings > Design Needs.
  // send: false is Approve only (it waits at Attach); otherwise an approval goes to production after the hold.
  const review = async (decision: 'approved' | 'rejected', note?: string, designNeed = false, send = true) => {
    if (!state?.job) return false
    setBusy(true); setErr(null)
    try { await post({ action: 'review', jobId: state.job.id, decision, note, designNeed, send }); await load(); return true }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); return false } finally { setBusy(false) }
  }
  // Hold an approved print from production, or send it now.
  const sendAction = async (action: 'hold' | 'send-now') => {
    if (!orderId) return false
    setBusy(true); setErr(null)
    try {
      const res = await apiFetch('/api/orders/artelo-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, orderId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Request failed')
      await load(); return true
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); return false } finally { setBusy(false) }
  }

  const job = state?.job || null
  // People without orders.render only ever see an approved print.
  const visible = Boolean(orderId && state && (canManage || job?.review === 'approved'))
  // Room is held for the design from the moment the order opens, so the layout does not jump when it loads.
  const reserved = Boolean(orderId && (canManage || job?.review === 'approved'))
  return { state, job, busy, creating, err, create, review, sendAction, autoSend: state?.autoSend !== false && !job?.spec?.altSize, reload: load, uploading, canManage, visible, reserved, offline: !state || state.workersOnline.length === 0 }
}

