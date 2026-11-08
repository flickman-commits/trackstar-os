import type { Order } from '@/components/orders/orderModel'

export type SameRunnerOrder = {
  id: string; parentOrderNumber: string; lineItemIndex: number; displayOrderNumber: string
  status: string; source: string; createdAt: string; size: string | null
  customerName: string | null; customerEmail: string | null; sameBuyer: boolean
}

const firstName = (s?: string | null) => String(s || '').trim().split(/\s+/)[0] || ''

/**
 * The email that checks with the customer before two of the same print go
 * out. The other buyer is not named: it is often a surprise gift.
 */
export function sameRunnerEmail(order: Order, others: SameRunnerOrder[], rep: string) {
  const number = String(order.displayOrderNumber || order.parentOrderNumber).replace(/^#/, '')
  const runner = order.effectiveRunnerName || order.runnerName || 'the runner'
  const race = [order.effectiveRaceName || order.raceName, order.effectiveRaceYear || order.raceYear].filter(Boolean).join(' ')
  const who = firstName(order.customerName)
  const mine = others.every(o => o.sameBuyer)
  const text = mine
    ? `Hey${who ? ` ${who}` : ''},

Quick check before we print: we have ${others.length + 1} orders from you for ${runner}'s ${race} print (${[number, ...others.map(o => o.displayOrderNumber)].map(n => `#${n}`).join(', ')}). Did you mean to order more than one, or should we cancel the extra and refund it?

Just reply and let us know, and we'll take it from there.

Thanks,
${rep || 'The team'} from Trackstar`
    : `Hey${who ? ` ${who}` : ''},

Quick heads up before we print your order #${number}: someone else has also ordered ${runner}'s ${race} print, so two of the same print are about to go out.

We wanted to check with you first. Would you like to keep your order, or cancel it for a full refund? Just reply and let us know, and we'll take care of it.

Thanks,
${rep || 'The team'} from Trackstar`
  return { subject: `Trackstar Order ${number} (Quick Question)`, text }
}

