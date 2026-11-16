import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, Copy, ExternalLink, Loader2, Send, Undo2 } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { btnPrimary, btnGhost, fieldLabel, modalCancel, modalChip, modalInput, modalPrimary } from '@/lib/ui'
import { financeApi, usd, dayLabel } from '@/lib/financeApi'
import type { MonthLine, PayoutMethod } from '@/types/finance'
import { StatusChip, num } from './bits'

/**
 * Hours on Finance > Payouts, by two-week pay period (Monday to the Sunday
 * it is paid; server/domain/finance/periods.js payPeriodOf). One row per
 * person per period: their weeks, the total, and the next step: approve the
 * submitted weeks, then on payday Pay, which records the payment made in
 * Wise or Payoneer (nothing moves money from here).
 */

const METHODS: { key: PayoutMethod; label: string; url?: string }[] = [
  { key: 'wise', label: 'Wise', url: 'https://wise.com/send' },
  { key: 'payoneer', label: 'Payoneer', url: 'https://myaccount.payoneer.com/' },
  { key: 'other', label: 'Other' },
]
const hm = (m = 0) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m` }
const rateText = (c?: number | null) => (c == null ? 'no rate set' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}/h`)

type Person = { userId: string; name: string; weeks: MonthLine[]; cents: number; method: PayoutMethod | null }
type Period = { start: string; end: string; people: Person[]; cents: number }

function group(lines: MonthLine[]): Period[] {
  const periods = new Map<string, Period>()
  for (const l of lines) {
    if (!l.period || !l.userId) continue
    const p = periods.get(l.period.start) || { ...l.period, people: [], cents: 0 }
    let person = p.people.find(x => x.userId === l.userId)
    if (!person) { person = { userId: l.userId, name: l.name, weeks: [], cents: 0, method: l.payoutMethod ?? null }; p.people.push(person) }
    person.weeks.push(l)
    person.cents += l.amountCents || 0
    p.cents += l.amountCents || 0
    periods.set(l.period.start, p)
  }
  return [...periods.values()].sort((a, b) => a.start.localeCompare(b.start)).map(p => ({ ...p, people: p.people.sort((a, b) => a.name.localeCompare(b.name)) }))
}

export default function PayPeriods({ lines, today, busy, onApprove, onUndo, onChanged }: {
  lines: MonthLine[]; today: string; busy: boolean
  onApprove: (weeks: MonthLine[]) => void; onUndo: (weeks: MonthLine[]) => void; onChanged: () => void
}) {
  const [paying, setPaying] = useState<{ period: Period; person: Person } | null>(null)
  const periods = group(lines)
  if (!periods.length) return <p className="px-4 py-3 text-xs text-off-black/45">No hours logged for the pay periods paid this month.</p>
  return (
    <>
      {periods.map(p => {
        const payday = today >= p.end
        const allPaid = p.people.every(x => x.weeks.every(w => w.paid))
        return (
          <div key={p.start} className="border-b border-border-gray last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 bg-subtle-gray/60">
              <span className="text-xs font-semibold text-off-black">{dayLabel(p.start)} to {dayLabel(p.end)}
                <span className={`ml-2 font-normal ${!allPaid && payday ? 'text-amber-700' : 'text-off-black/45'}`}>{allPaid ? 'Paid' : today === p.end ? 'Payday today' : payday ? `Payday was ${dayLabel(p.end, 'weekday')}` : `Payday ${dayLabel(p.end, 'weekday')}`}</span>
              </span>
              <span className="text-xs font-semibold tabular-nums">{usd(p.cents)}</span>
            </div>
            <table className="w-full text-xs"><tbody>
              {p.people.map(person => {
                const unpaid = person.weeks.filter(w => !w.paid)
                const submitted = unpaid.filter(w => w.status === 'submitted')
                const open = unpaid.filter(w => w.status === 'in_progress')
                const paidWeek = person.weeks.find(w => w.paid)
                const state = !unpaid.length ? 'paid' : submitted.length ? 'submitted' : open.length ? 'in_progress' : 'approved'
                return (
                  <tr key={person.userId} className="border-b border-border-gray/60 last:border-0">
                    <td className="px-4 py-2 font-medium whitespace-nowrap w-44">{person.name}</td>
                    <td className="py-2 text-off-black/65">{person.weeks.map(w => `${dayLabel(w.weekStart || '')} week ${hm(w.minutes)}`).join(', ')} at {rateText(person.weeks[0]?.rateCents)}</td>
                    <td className={`py-2 px-3 ${num} font-semibold whitespace-nowrap w-28`}>{usd(person.cents)}</td>
                    <td className="py-2 whitespace-nowrap w-40">
                      <StatusChip status={state} />
                      {state === 'paid' && paidWeek?.paidRef && <span className="ml-1.5 text-[11px] text-off-black/50">{paidWeek.paidRef}</span>}
                      {person.weeks.some(w => w.sentBack) && <span className="ml-1.5 text-[11px] text-rose-700">sent back</span>}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-right w-44">
                      {state === 'submitted' ? <button onClick={() => onApprove(submitted)} disabled={busy} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Approve{submitted.length > 1 ? ` ${submitted.length} weeks` : ''}</button>
                        : state === 'in_progress' ? <Link to="/finance/timesheets" className="text-[11px] text-blue-600 hover:underline">Timesheets</Link>
                        : state === 'approved' ? (
                          <span className="inline-flex items-center gap-1">
                            <button onClick={() => onUndo(unpaid)} disabled={busy} className={btnGhost} title="Take the approval back"><Undo2 className="w-3.5 h-3.5" /></button>
                            {payday && <button onClick={() => setPaying({ period: p, person })} disabled={busy} className={btnPrimary}><Send className="w-3.5 h-3.5" /> Pay {usd(unpaid.reduce((n, w) => n + (w.amountCents || 0), 0))}</button>}
                          </span>
                        ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody></table>
          </div>
        )
      })}
      {paying && (() => {
        const weeks = paying.person.weeks.filter(w => !w.paid)
        return (
          <PayModal name={paying.person.name} sub={`${dayLabel(paying.period.start)} to ${dayLabel(paying.period.end)}`} method={paying.person.method}
            cents={weeks.reduce((n, w) => n + (w.amountCents || 0), 0)}
            description={`For ${weeks.map(w => `${hm(w.minutes)} the week of ${dayLabel(w.weekStart || '')}`).join(' and ')}.`}
            onClose={() => setPaying(null)}
            onPay={async (method, ref) => { await financeApi.payoutAction({ action: 'pay_period', userId: paying.person.userId, periodStart: paying.period.start, method, paidRef: ref }); setPaying(null); onChanged() }} />
        )
      })()}
    </>
  )
}

/**
 * Record a payment made in Wise or Payoneer: pick how, an optional
 * reference, Mark paid. The person's last way of paying comes preselected.
 */
export function PayModal({ name, sub, cents, description, method: initial, onClose, onPay }: {
  name: string; sub: string; cents: number; description: string; method: PayoutMethod | null
  onClose: () => void; onPay: (method: PayoutMethod, ref: string) => Promise<void>
}) {
  const [method, setMethod] = useState<PayoutMethod | null>(initial)
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const m = METHODS.find(x => x.key === method)
  // The bare number (340.80, no $ or commas) pastes cleanly into Wise and Payoneer.
  const plain = (cents / 100).toFixed(2)
  const copy = () => navigator.clipboard.writeText(plain).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => toast.error('Could not copy'))
  const pay = async () => {
    if (!method) return
    setBusy(true)
    try { await onPay(method, ref); toast.success(`Marked ${name.split(' ')[0]} paid ${usd(cents)}`) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <ActionModal icon={Send} title={`Pay ${name}`} sub={sub} onClose={onClose} busy={busy} size="sm"
      description={description}
      hint="Send it in Wise or Payoneer, then mark it paid here."
      footer={<><button onClick={onClose} className={modalCancel}>Cancel</button><button onClick={pay} disabled={busy || !method} className={modalPrimary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Mark {usd(cents)} paid</button></>}>
      <div>
        <span className={fieldLabel}>Amount</span>
        <button onClick={copy} title="Copy the amount" className="group flex w-full items-center justify-between rounded-xl border border-border-gray bg-subtle-gray/60 px-3.5 py-2.5 text-left hover:border-off-black/25">
          <span className="text-xl font-semibold tabular-nums text-off-black">{usd(cents)}</span>
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${copied ? 'text-emerald-700' : 'text-blue-600 group-hover:underline'}`}>
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied {plain}</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
          </span>
        </button>
      </div>
      <div>
        <span className={fieldLabel}>Paid with</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {METHODS.map(x => <button key={x.key} onClick={() => setMethod(x.key)} className={modalChip(method === x.key)}>{x.label}</button>)}
          {m?.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">Open {m.label} <ExternalLink className="w-3 h-3" /></a>}
        </div>
      </div>
      <label className="block">
        <span className={fieldLabel}>Reference</span>
        <input value={ref} onChange={e => setRef(e.target.value)} placeholder={method === 'payoneer' ? 'Invoice number (optional)' : 'Transfer number (optional)'} className={modalInput} />
      </label>
    </ActionModal>
  )
}
