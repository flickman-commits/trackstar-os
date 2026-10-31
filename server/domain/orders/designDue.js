/**
 * Designers work to the design due date: two days before the date the
 * customer was promised (Order.dueDate), so first designs go out early
 * instead of on the day. The app shows designers only this date and admins
 * both (src/components/orders/orderFormat.ts designDueDate, same rule);
 * the design reminders in Slack count from it. Anything the customer sees
 * (the delay notice, the approval timeline) keeps the real date.
 */
export const DESIGN_LEAD_DAYS = 2

/** The design due date for a custom order's due date; null without one. */
export function designDueDate(dueDate) {
  if (!dueDate) return null
  return new Date(new Date(dueDate).getTime() - DESIGN_LEAD_DAYS * 86400000)
}
