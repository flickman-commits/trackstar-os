/**
 * The handful of failures that are not the person's fault and not a bug in
 * what they did, named for them instead of "Something went wrong".
 *
 *   schema      the app expects a database column or table that is not there:
 *               a schema change deployed without `npx prisma db push`
 *               (Order.photoLater, Nov 4 2026: Fulfillment and Support both
 *               stopped loading behind a generic toast)
 *   down        the database cannot be reached
 *   busy        every database connection is in use for the moment
 *
 * A schema mismatch also tells #trackstar-alerts what is missing and the one
 * command that fixes it, at most every ten minutes per instance, since every
 * page load hits it until it is fixed.
 */
const lastAlert = new Map()
const ALERT_EVERY_MS = 10 * 60 * 1000

function codeOf(err) {
  return String(err?.code || err?.errorCode || '')
}

/** { kind, status, message } for a known system failure, else null. */
export function systemProblem(err) {
  if (!err || typeof err !== 'object') return null
  const code = codeOf(err)
  const text = String(err.message || '')
  if (code === 'P2022' || code === 'P2021' || /column .* does not exist|table .* does not exist/i.test(text)) {
    const what = (/The (?:column|table) `([^`]+)`/.exec(text) || [])[1] || null
    alertSchema(what)
    return { kind: 'schema', status: 503, what, message: 'TrackstarOS was just updated but its database was not, so this cannot load yet. Matt has been sent the fix; it works again as soon as he runs it.' }
  }
  if (['P1001', 'P1002', 'P1017'].includes(code) || /Can't reach database server|Server has closed the connection|ECONNREFUSED|ENOTFOUND/i.test(text)) {
    return { kind: 'down', status: 503, message: 'TrackstarOS cannot reach its database right now. It usually comes back within a minute; try again shortly.' }
  }
  if (code === 'P2024' || /Timed out fetching a new connection|too many (clients|connections)/i.test(text)) {
    return { kind: 'busy', status: 503, message: 'The database is busy for a moment. Try again in a few seconds.' }
  }
  return null
}

function alertSchema(what) {
  const key = what || 'unknown'
  const last = lastAlert.get(key) || 0
  if (Date.now() - last < ALERT_EVERY_MS) return
  lastAlert.set(key, Date.now())
  import('./slack.js')
    .then(({ slackTo }) => slackTo('admin', `:rotating_light: *Database out of date*: the app expects ${what ? `\`${what}\`` : 'a column or table'} and the database does not have it, so every page that reads it fails. A schema change went out without \`npx prisma db push\`. Run it from the repo to fix.`, { timeoutMs: 8000 }))
    .catch(() => {})
}
