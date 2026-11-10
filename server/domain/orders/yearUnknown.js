/**
 * An order whose customer gave no race year. The import stores the current
 * year in raceYear as a placeholder and sets status missing_year
 * (processOrders.js), so raceYear on such an order is a guess, not the
 * customer's race. Researching it finds this year's finisher of the same
 * name, which is a stranger's time. Nothing researches it until a person sets
 * the year (yearOverride). Pure, so the rule can be tested on its own.
 */
export function yearUnknown(order) {
  return order?.status === 'missing_year' && order?.yearOverride == null
}

/** The same rule as a Prisma filter, for queries that pick orders to research. */
export const KNOWN_YEAR = { NOT: { status: 'missing_year', yearOverride: null } }

export class YearUnknownError extends Error {
  constructor(orderNumber) {
    super(`Order ${orderNumber} has no race year from the customer. Set the year on the order before researching it.`)
    this.name = 'YearUnknownError'
    this.status = 409
    this.expose = true
  }
}
