/**
 * The body and status for an unexpected error in an endpoint: a fixed
 * sentence, except for errors written to be read (a service switched off in
 * Settings > Connections, or anything else marked `expose`).
 */
import { systemProblem } from './systemProblem.js'

export const GENERIC_ERROR = 'Something went wrong. Try again, and tell Matt if it keeps happening.'

export function publicError(error) {
  if (error && error.expose === true && typeof error.message === 'string') {
    return { status: error.status || 400, body: { error: error.message } }
  }
  // A database that is out of date, unreachable or full gets named, not a shrug.
  const sys = systemProblem(error)
  if (sys) return { status: sys.status, body: { error: sys.message, code: `system_${sys.kind}` } }
  return { status: 500, body: { error: GENERIC_ERROR } }
}

/** Answer `res` with publicError(error). */
export function sendPublicError(res, error) {
  const out = publicError(error)
  return res.status(out.status).json(out.body)
}
