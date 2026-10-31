/**
 * Designers work to the design due date: two business days before the date
 * the customer was promised (Order.dueDate), so first designs go out early
 * instead of on the day (a Monday customer date is a Thursday design date).
 * The app shows designers only this date and admins both
 * (src/components/orders/orderFormat.ts designDueDate, same rule); the
 * design reminders in Slack count from it. Anything the customer sees (the
 * delay notice, the approval timeline) keeps the real date.
 */
export const DESIGN_LEAD_DAYS = 2

const weekdayET = d => new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay()

/** The design due date for a custom order's due date; null without one. */
export function designDueDate(dueDate) {
  if (!dueDate) return null
  let d = new Date(dueDate)
  for (let left = DESIGN_LEAD_DAYS; left > 0;) {
    d = new Date(d.getTime() - 86400000)
    const w = weekdayET(d)
    if (w !== 0 && w !== 6) left--
  }
  return d
}
