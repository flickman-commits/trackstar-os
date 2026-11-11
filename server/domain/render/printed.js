/**
 * What a print is made from, and the decision the sender makes with it.
 * Pure: no database, so the rules can be tested on their own.
 */
import { sameDesign } from './designSwitch.js'

// Two specs that agree on these would print the same.
export const PRINTED = ['template', 'size', 'name', 'bib', 'time', 'pace', 'noTime', 'date', 'condition', 'temp', 'photoPath']

/**
 * The printed fields where two specs disagree, in PRINTED order. `a` is what
 * the order should print now, `b` what a design was made from; `renderedAt`
 * (when that design was queued) lets a design made before a race's design
 * switch count as the old design it is (designSwitch.js).
 */
export function changedPrintedFields(a, b, { renderedAt = null } = {}) {
  return PRINTED.filter(k => k === 'template' ? !sameDesign(a?.template, b?.template, renderedAt) : (a?.[k] ?? null) !== (b?.[k] ?? null))
}

export function printedDiffers(a, b, opts) {
  return changedPrintedFields(a, b, opts).length > 0
}

/** Field names as a person reads them, for a note or a Slack line. */
const WORDS = { template: 'design', size: 'size', name: 'name', bib: 'bib', time: 'time', pace: 'pace', noTime: 'no-time', date: 'race date', condition: 'weather', temp: 'temperature', photoPath: 'photo' }
export function describeFields(fields) {
  return fields.map(f => WORDS[f] || f).join(', ')
}

/**
 * Is this approved design still what the order says should print?
 *
 * An approved standard print waits out the customer's change window before
 * it goes to Artelo, and the order can change under it in that time (the
 * customer fixes the name, a person corrects the time or the race date). The
 * design is checked against the order once more just before it is sent.
 *
 *   job    the approved render about to be sent
 *   check  checkOrder's answer for the order as it is now: { ok, reasons, spec }
 *
 * Returns:
 *   { action: 'send' }                       not a rendered design (a custom final PDF), or nothing changed
 *   { action: 'stale', fields: [...] }       the order now prints differently: never send this file
 *   { action: 'wait', reasons: [...] }       the order cannot be checked right now: hold it, do not close it
 */
export function sendDecision(job, check) {
  // Only a design rendered from a spec can be compared. A custom order's final
  // PDF is made by hand and carries { kind: 'custom_final' }.
  if (!job?.spec?.template) return { action: 'send' }
  if (!check?.ok || !check.spec) return { action: 'wait', reasons: check?.reasons?.length ? check.reasons : ['the order could not be checked'] }
  const fields = changedPrintedFields(check.spec, job.spec, { renderedAt: job.createdAt })
  return fields.length ? { action: 'stale', fields } : { action: 'send' }
}
