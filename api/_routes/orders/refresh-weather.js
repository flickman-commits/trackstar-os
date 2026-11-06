/**
 * POST /api/orders/refresh-weather { raceId, reason? }
 *
 * Recompute one race year's weather through computeRaceWeather, the same
 * path the rest of the app treats as authoritative: it respects the print
 * lock (a printed race needs a reason, and the change is audited) and clears
 * the "confirmed" stamp when the numbers move.
 *
 * There used to be an all-races mode that blanked every race's weather and
 * then refetched within one function's time limit, leaving any race it did
 * not reach empty, stamping new numbers as already confirmed, and going
 * around the print lock. It is gone; weather is one race at a time.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { loadActiveUser } from '../../_lib/users.js'
import { computeRaceWeather } from '../../../server/domain/races/verification.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let body = {}
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch { return res.status(400).json({ error: 'Bad request' }) }
  const raceId = Number(body.raceId)
  if (!Number.isInteger(raceId) || raceId <= 0) {
    return res.status(400).json({ error: 'Pick a race. Weather is refreshed one race at a time.' })
  }

  const user = await loadActiveUser(actor)
  if (!user) return res.status(401).json({ error: 'Sign in again.' })

  try {
    const by = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
    const updated = await computeRaceWeather(raceId, { by, reason: body.reason, actor: user })
    return res.status(200).json({
      success: true,
      race: {
        id: updated.id,
        raceName: updated.raceName,
        year: updated.year,
        weatherTemp: updated.weatherTemp,
        weatherCondition: updated.weatherCondition,
        weatherFetchedAt: updated.weatherFetchedAt,
      },
    })
  } catch (error) {
    // computeRaceWeather and the print lock throw plain-English reasons.
    if (/not found|verify the date|needs a location|not happened|could not compute|printed|reason/i.test(error.message)) {
      return res.status(error.needsReason ? 409 : 400).json({ error: error.message, needsReason: Boolean(error.needsReason) })
    }
    console.error('[refresh-weather] Error:', error)
    return sendPublicError(res, error)
  }
}
