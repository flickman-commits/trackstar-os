/**
 * Where a print is in "add photo after the race", worked out from the Order
 * row alone, so the pipeline (pure) and the render gate can both ask without
 * touching the database. The emails, the upload page and the deadline live in
 * photoLater.js.
 */

const DAY = 24 * 60 * 60 * 1000

// The upload email goes out this long after race day, a reminder this long
// after that, and the print goes ahead without a photo this long after the
// first email. Matt, 2026-11-04: email the day after, one reminder, 7 days.
export const REQUEST_AFTER_RACE_MS = 1 * DAY
export const REMIND_AFTER_MS = 4 * DAY
export const DEADLINE_AFTER_MS = 7 * DAY

/** Paid for a photo it does not have yet, and still waiting for it. */
export function awaitingLaterPhoto(order) {
  return Boolean(order?.photoLater && !order.photoPath && !order.photoLaterClosedAt)
}

/** When the print goes ahead without a photo, or null before the first email. */
export function photoLaterDeadline(order) {
  if (!order?.photoLaterEmailedAt) return null
  return new Date(new Date(order.photoLaterEmailedAt).getTime() + DEADLINE_AFTER_MS)
}

/**
 * What the scheduler owes this print now: 'request' (first email), 'remind',
 * 'deadline' (print without it, refund), or null.
 * @param {object} order
 * @param {Date|string|null} raceDate the verified race day, or null when there is none
 * @param {number} [now]
 */
export function photoLaterDue(order, raceDate, now = Date.now()) {
  if (!awaitingLaterPhoto(order) || order.status === 'completed') return null
  if (!order.photoLaterEmailedAt) {
    if (!raceDate) return null
    return new Date(raceDate).getTime() + REQUEST_AFTER_RACE_MS <= now ? 'request' : null
  }
  const sent = new Date(order.photoLaterEmailedAt).getTime()
  if (sent + DEADLINE_AFTER_MS <= now) return 'deadline'
  if (!order.photoLaterRemindedAt && sent + REMIND_AFTER_MS <= now) return 'remind'
  return null
}
