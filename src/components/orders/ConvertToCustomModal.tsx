import { useState } from 'react'
import { Loader2, Palette } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { fieldLabel, modalCancel, modalInput, modalPrimary } from '@/lib/ui'
import ActionModal from '@/components/ActionModal'

/**
 * Convert a standard print to a custom one (server/domain/orders/convertToCustom.js):
 * for a runner who ran a race we have no design for, when we would rather
 * design it than refund. Shopify is not changed. The print moves to the
 * custom queue, due with the order's other custom prints if it has any.
 */
export default function ConvertToCustomModal({ order, onClose, onDone }: {
  order: { id: string; displayOrderNumber?: string | null; runnerName?: string | null; effectiveRaceName?: string | null; raceName?: string | null; effectiveRaceYear?: number | null; raceYear?: number | null; customerBib?: string | null; customerFinishTime?: string | null }
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [race, setRace] = useState('')
  const [year, setYear] = useState(String(order.effectiveRaceYear || order.raceYear || ''))
  const [bib, setBib] = useState(order.customerBib || '')
  const [time, setTime] = useState(order.customerFinishTime || '')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const from = `${order.effectiveRaceName || order.raceName || 'this race'} ${order.effectiveRaceYear || order.raceYear || ''}`.trim()

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await apiFetch('/api/orders/convert-to-custom', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, raceName: race, raceYear: year, bib, time, creativeDirection: notes, reason }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not convert it')
      const due = d.dueDate ? new Date(d.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null
      onDone(`Now a custom order${due ? `, due ${due}` : ''}${d.matchedSiblings ? ' with the order’s other custom prints' : ''}. It is in the Custom view.`)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <ActionModal icon={Palette} title="Convert to a custom order" sub={order.displayOrderNumber || undefined} onClose={onClose} busy={busy}
      description={`For a runner who ran a race we do not carry. The ${from} print becomes a custom print and goes to the designer. Shopify is not changed: same price, same item.`}
      footer={<>
        <button className={modalCancel} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={modalPrimary} onClick={submit} disabled={busy || !race.trim() || !reason.trim()}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Convert to custom</button>
      </>}>
      <div className="grid grid-cols-[1fr_112px] gap-3">
        <label className="block min-w-0"><span className={fieldLabel}>Race they ran</span><input className={modalInput} value={race} onChange={e => setRace(e.target.value)} placeholder="e.g. Foot Traffic Flat" autoFocus /></label>
        <label className="block min-w-0"><span className={fieldLabel}>Year</span><input className={modalInput} value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} inputMode="numeric" /></label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block min-w-0"><span className={fieldLabel}>Bib</span><input className={modalInput} value={bib} onChange={e => setBib(e.target.value)} /></label>
        <label className="block min-w-0"><span className={fieldLabel}>Finish time</span><input className={modalInput} value={time} onChange={e => setTime(e.target.value)} placeholder="3:53:29" /></label>
      </div>
      <label className="block"><span className={fieldLabel}>What the customer wants (for the designer)</span>
        <textarea className={`${modalInput} resize-none`} rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={`Runner ${order.runnerName || ''}; course, colors, anything they asked for`} />
      </label>
      <label className="block"><span className={fieldLabel}>Why (kept on the order)</span>
        <input className={modalInput} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ran a race we do not carry; big customer, designing instead of refunding" />
      </label>
      {err && <p className="text-red-700">{err}</p>}
    </ActionModal>
  )
}
