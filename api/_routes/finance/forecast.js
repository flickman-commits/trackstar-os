/**
 * The forecast (server/domain/finance/forecast.js). Admin only.
 *
 * GET  /api/finance/forecast?scenario=base|upside|downside
 * POST /api/finance/forecast { action: 'set_driver', scenario, key, value | null }
 *                            { action: 'set_race', raceKey, orders | null }
 *                            { action: 'set_cash', banks?, bufferCents?, fixedCosts?, ownerDrawMonthlyCents? }
 *                            { action: 'set_target', month, revenueCents?, cmCents?, adSpendCents? }
 * Every POST answers with the forecast again, for the scenario it names.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { forecast, setDriver, setRaceOverride, setCash, setTarget } from '../../../server/domain/finance/forecast.js'
import { answerError, body } from '../../_lib/finance.js'

const usd = c => `$${(Number(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'GET') return res.status(200).json(await forecast({ scenario: String(req.query?.scenario || 'base') }))
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const b = body(req)
    let summary
    switch (b.action) {
      case 'set_driver':
        await setDriver(String(b.scenario || 'base'), String(b.key || ''), b.value)
        summary = b.value === null || b.value === '' ? `Forecast: ${b.key} back to the calculated value (${b.scenario})` : `Forecast: set ${b.key} to ${b.value} (${b.scenario})`
        break
      case 'set_race':
        await setRaceOverride(String(b.raceKey || ''), b.orders)
        summary = b.orders === null || b.orders === '' ? `Forecast: ${b.raceKey} back to last year's orders times growth` : `Forecast: expect ${b.orders} orders for ${b.raceKey}`
        break
      case 'set_cash':
        await setCash({ banks: b.banks, bufferCents: b.bufferCents, fixedCosts: b.fixedCosts, ownerDrawMonthlyCents: b.ownerDrawMonthlyCents })
        summary = `Forecast: updated the cash settings${Array.isArray(b.banks) ? ` (${b.banks.length} bank${b.banks.length === 1 ? '' : 's'}, ${usd(b.banks.reduce((n, x) => n + Number(x.cents || 0), 0))})` : ''}`
        break
      case 'set_target':
        await setTarget(String(b.month || ''), { revenueCents: b.revenueCents ?? null, cmCents: b.cmCents ?? null, adSpendCents: b.adSpendCents ?? null })
        summary = `Forecast: targets for ${b.month}${b.revenueCents != null ? `, revenue ${usd(b.revenueCents)}` : ''}${b.cmCents != null ? `, contribution margin ${usd(b.cmCents)}` : ''}${b.adSpendCents != null ? `, ad spend ${usd(b.adSpendCents)}` : ''}`
        break
      default:
        return res.status(400).json({ error: 'Unknown action' })
    }
    await recordAudit({ action: `forecast.${b.action}`, summary, detail: { ...b }, actor })
    return res.status(200).json(await forecast({ scenario: String(b.scenario || 'base') }))
  } catch (error) { return answerError(res, error, '/finance/forecast') }
}
