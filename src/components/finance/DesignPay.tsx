import { useState } from 'react'
import { Send } from 'lucide-react'
import { btnPrimary } from '@/lib/ui'
import { financeApi, usd, dayLabel } from '@/lib/financeApi'
import type { MonthLine, PayoutMethod } from '@/types/finance'
import { card, StatusChip, num } from './bits'
import { PayModal } from './PayPeriods'

/**
 * The design team's pay for the month, one row per designer: their customs
 * and, for the head designer, the fee, paid together on the last day of the
 * month (server/domain/finance/monthPayouts.js payDesigner). Pay approves
 * what is not approved yet at today's amount and records the payment made in
 * Wise or Payoneer.
 */
type Designer = { userId: string; name: string; lines: MonthLine[]; method: PayoutMethod | null }

export default function DesignPay({ month, label, lines, today, payday, onChanged }: {
  month: string; label: string; lines: MonthLine[]; today: string; payday: string; onChanged: () => void
}) {
  const [paying, setPaying] = useState<Designer | null>(null)
  const people = new Map<string, Designer>()
  for (const l of lines) {
    if ((l.kind !== 'customs' && l.kind !== 'designer_fee') || !l.userId) continue
    const d = people.get(l.userId) || { userId: l.userId, name: l.name, lines: [], method: l.payoutMethod ?? null }
    d.lines.push(l)
    people.set(l.userId, d)
  }
  const list = [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
  if (!list.length) return null
  const isPayday = today >= payday
  const allPaid = list.every(d => d.lines.every(l => l.paid))
  const total = (ls: MonthLine[]) => ls.reduce((n, l) => n + (l.amountCents || 0), 0)
  const what = (ls: MonthLine[]) => ls.map(l => (l.kind === 'designer_fee' ? `fee ${usd(l.amountCents || 0)}` : `${l.detail} ${usd(l.amountCents || 0)}`)).join(' + ')
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 border-b border-border-gray">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-off-black">Design team</h3>
          <span className={`text-[11px] ${!allPaid && isPayday ? 'text-amber-700' : 'text-off-black/45'}`}>
            {allPaid ? `Paid for ${label}` : today === payday ? 'Payday today, for the whole month' : isPayday ? `Payday was ${dayLabel(payday, 'weekday')}` : `Paid ${dayLabel(payday, 'weekday')}, the last day of the month`}
          </span>
        </div>
        <span className="text-sm font-semibold tabular-nums">{usd(list.reduce((n, d) => n + total(d.lines), 0))}</span>
      </div>
      <table className="w-full text-xs"><tbody>
        {list.map(d => {
          const unpaid = d.lines.filter(l => !l.paid)
          const paidLine = d.lines.find(l => l.paid)
          return (
            <tr key={d.userId} className="border-b border-border-gray/60 last:border-0">
              <td className="px-4 py-2 font-medium whitespace-nowrap w-44">{d.name}</td>
              <td className="py-2 text-off-black/65">{what(d.lines)}</td>
              <td className={`py-2 px-3 ${num} font-semibold whitespace-nowrap w-28`}>{usd(total(d.lines))}</td>
              <td className="py-2 whitespace-nowrap w-40">
                <StatusChip status={!unpaid.length ? 'paid' : isPayday ? 'submitted' : 'in_progress'} />
                {!unpaid.length && paidLine?.paidRef && <span className="ml-1.5 text-[11px] text-off-black/50">{paidLine.paidRef}</span>}
              </td>
              <td className="py-2 pr-4 whitespace-nowrap text-right w-44">
                {unpaid.length > 0 && isPayday && <button onClick={() => setPaying(d)} className={btnPrimary}><Send className="w-3.5 h-3.5" /> Pay {usd(total(unpaid))}</button>}
              </td>
            </tr>
          )
        })}
      </tbody></table>
      {paying && (() => {
        const unpaid = paying.lines.filter(l => !l.paid)
        return (
          <PayModal name={paying.name} sub={label} method={paying.method} cents={total(unpaid)}
            description={`For ${label}: ${what(unpaid)}.${month === today.slice(0, 7) ? ' Customs and the fee count through today; this amount is what is recorded.' : ''}`}
            onClose={() => setPaying(null)}
            onPay={async (method, ref) => { await financeApi.payoutAction({ action: 'pay_designer', userId: paying.userId, month, method, paidRef: ref }); setPaying(null); onChanged() }} />
        )
      })()}
    </div>
  )
}
