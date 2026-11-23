/**
 * Order notes are for what needs someone's attention: a spelling fix, a
 * reference photo, a print held, a refund that failed. A note that only
 * records something the order already shows (the proofs we emailed sit as
 * thumbnails under the proofs, an email to the customer sits in its
 * Conversation panel) is activity. Since 2026-11-23 nothing writes these;
 * the ones written before fold into a quiet "updates" line instead of the
 * amber box at the top of the order.
 */
const ACTIVITY: RegExp[] = [
  /^Emailed \d+ proofs? to the customer from fast@/,
  /^Emailed the customer from Support:/,
  /^Sent the design to the customer to approve:/,
  /^Designer question emailed to the customer/,
  /^Delay notice emailed to the customer/,
]

export function isActivityNote(text?: string | null): boolean {
  const t = String(text || '').trim()
  return ACTIVITY.some(re => re.test(t))
}
