/**
 * Errors a person is meant to read.
 *
 * Our own code throws UserError with plain-English text ("Gmail is not
 * connected. Open Settings..."), and the endpoints return that text as is.
 * Anything else (Prisma, Shopify, Gmail, a TypeError) may carry table names,
 * tokens or a customer's details, so the endpoint logs it and returns a
 * fixed message instead. Support and Sales share this file.
 */
import { systemProblem } from '../../lib/systemProblem.js'
export class UserError extends Error {
  constructor(message, { status = 400, ...extra } = {}) {
    super(message)
    this.name = 'UserError'
    this.expose = true
    this.status = status
    Object.assign(this, extra)
  }
}

/** Whether this error's message was written for the person using the app. */
export function isUserError(err) {
  return Boolean(err && err.expose === true && typeof err.message === 'string')
}

/** The message to put in a response: ours as is, anything else replaced. */
export function publicMessage(err, fallback = 'Something went wrong. Try again, and tell Matt if it keeps happening.') {
  if (isUserError(err)) return err.message
  // A database that is out of date, unreachable or full gets named (server/lib/systemProblem.js).
  return systemProblem(err)?.message || fallback
}

/** The status to answer with: a UserError's own, else 500. */
export function publicStatus(err) {
  return isUserError(err) ? (err.status || 400) : (systemProblem(err)?.status || 500)
}
