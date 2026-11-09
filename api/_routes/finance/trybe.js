/**
 * GET /api/finance/trybe[?refresh=1] - admin only. Is Trybe paying for itself,
 * week by week: the Meta ads running Trybe creators' content against the rest
 * of the account, after Trybe's commission (server/domain/finance/trybeCheck.js).
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { trybeCheck } from '../../../server/domain/finance/trybeCheck.js'
import { answerError } from '../../_lib/finance.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    return res.status(200).json(await trybeCheck({ refresh: req.query?.refresh === '1' }))
  } catch (error) {
    if (error?.name === 'TrybeError' || error?.constructor?.name === 'TrybeError') return res.status(502).json({ error: 'Trybe did not answer. Try again in a minute.' })
    return answerError(res, error, '/finance/trybe')
  }
}
