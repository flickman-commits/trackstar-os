/**
 * Artelo's hold names, in our words. Artelo calls Trackstar its "customer",
 * so "Customer Unpaid" means Artelo could not charge OUR account for the
 * print, not that the shopper did not pay (they pay us at checkout). Used by
 * the Slack alert (orders/arteloMismatch.js) and the Action queue (pipeline.js).
 */
export function arteloHoldText(hold) {
  const h = String(hold || '')
  if (/unpaid/i.test(h)) return {
    label: 'Artelo billing failed',
    why: 'Artelo could not charge Trackstar\'s card for this print (our Artelo billing, not the customer: they paid at checkout)',
    fix: 'Artelo could not charge Trackstar\'s card for this print. This is our Artelo billing, not the customer (they paid at checkout). Fix the payment method in Artelo\'s billing settings and retry the charge; it prints once Artelo is paid.',
  }
  if (/address/i.test(h)) return {
    label: 'Artelo: address review',
    why: 'Artelo could not verify the shipping address',
    fix: 'Artelo could not verify the shipping address and will not print until it is reviewed. Open the order in Artelo, fix or confirm the address, then send it to production.',
  }
  return { label: `Artelo: ${h}`, why: `Artelo has it as "${h}"`, fix: `Artelo is holding this order (${h}). Sort it out in Artelo; nothing prints until then.` }
}
