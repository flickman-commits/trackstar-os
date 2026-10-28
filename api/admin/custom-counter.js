/**
 * GET  /api/admin/custom-counter?month=YYYY-MM
 * POST /api/admin/custom-counter { orderId, repeat: true | false | null }
 * GET  /api/admin/custom-counter?rates=1          each designer's rates (cents)
 * POST /api/admin/custom-counter { action: 'rates', userId, newCents, repeatCents }  null = level default
 *
 * Admin only. Custom designs each designer made in a month, for payouts: the
 * month the first proof went to the customer (Eastern), credited to the
 * assigned designer; a repeat pays half. POST sets whether one custom is a
 * repeat (null = back to automatic). See server/domain/orders/customCounter.js.
 */
import { setCors } from '../_lib/auth.js'
import { requireAdminOnly } from '../_lib/users.js'
import { customCounter, setDesignRepeat, customRates, setCustomRates } from '../../server/domain/orders/customCounter.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  if (!(await requireAdminOnly(req, res))) return
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (body.action === 'rates') {
      try {
        await setCustomRates(body.userId, { newCents: body.newCents ?? null, repeatCents: body.repeatCents ?? null })
        return res.status(200).json({ rates: await customRates() })
      } catch (error) {
        return res.status(400).json({ error: /whole cents/.test(error.message) ? error.message : 'Could not save the rates' })
      }
    }
    if (!body.orderId || ![true, false, null].includes(body.repeat)) return res.status(400).json({ error: 'orderId and repeat (true, false or null) are required' })
    try {
      return res.status(200).json(await setDesignRepeat(body.orderId, body.repeat))
    } catch (error) {
      console.error('[API /admin/custom-counter POST] Error:', error)
      return res.status(500).json({ error: 'Could not save' })
    }
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (req.query?.rates) return res.status(200).json({ rates: await customRates() })
  const month = String(req.query?.month || '')
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' })
  try {
    return res.status(200).json(await customCounter(month))
  } catch (error) {
    console.error('[API /admin/custom-counter] Error:', error)
    return res.status(500).json({ error: 'Could not load the counter' })
  }
}
