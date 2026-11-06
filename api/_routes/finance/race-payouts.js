/**
 * Race payouts: what each partnered race is owed from its prints. Admin only.
 *
 * GET  /api/finance/race-payouts                       every won race deal, soonest due first
 * POST /api/finance/race-payouts { action: 'compute', dealId }     pull the race's sales from Shopify
 *                               { action: 'compute_due' }          every race due and not yet sent
 *                               { action: 'sent' | 'paid' | 'reopen', dealId, paidRef?, note? }
 *                               { action: 'set_terms', dealId, structure: 'percent' | 'per_order', pct?, perOrder? }   written to the Attio deal
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { listRacePayouts, computeRacePayout, computeDue, setRacePayoutStatus, setRaceTerms, reportFor, DAYS_BEFORE, DAYS_AFTER, DUE_DAYS, DEFAULT_PCT } from '../../../server/domain/finance/racePayouts.js'
import { answerError, body } from '../../_lib/finance.js'

const withReport = r => ({ ...r, report: reportFor(r) })
const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'GET') {
      const races = (await listRacePayouts()).map(withReport)
      return res.status(200).json({ races, rules: { daysBefore: DAYS_BEFORE, daysAfter: DAYS_AFTER, dueDays: DUE_DAYS, defaultPct: DEFAULT_PCT } })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const b = body(req)
    if (b.action === 'compute') {
      const r = withReport(await computeRacePayout(String(b.dealId || '')))
      await recordAudit({ action: 'race_payout.compute', summary: `Pulled ${r.name}'s sales: ${r.sales.unitsSold} units, ${usd(r.sales.netSalesCents)} net, payout ${usd(r.payoutCents)}`, detail: { dealId: r.dealId, sales: r.sales, terms: r.termsUsed }, actor })
      return res.status(200).json({ race: r })
    }
    if (b.action === 'compute_due') {
      const out = await computeDue()
      await recordAudit({ action: 'race_payout.compute_due', summary: `Pulled sales for ${out.computed} race${out.computed === 1 ? '' : 's'} due a payout${out.failed.length ? ` (${out.failed.length} failed)` : ''}`, detail: out, actor })
      return res.status(200).json(out)
    }
    if (b.action === 'set_terms') {
      const r = withReport(await setRaceTerms(String(b.dealId || ''), { structure: b.structure, pct: b.pct, perOrder: b.perOrder }))
      const t = r.terms.structure === 'per_order' ? `${usd(r.terms.perOrderCents)} per order` : `${r.terms.pct}% of net sales`
      await recordAudit({ action: 'race_payout.set_terms', summary: `Set ${r.name}'s payout terms to ${t} (written to the Attio deal)`, detail: { dealId: r.dealId, terms: r.terms }, actor })
      return res.status(200).json({ race: r })
    }
    if (['sent', 'paid', 'reopen'].includes(b.action)) {
      const r = withReport(await setRacePayoutStatus(String(b.dealId || ''), b.action, { paidRef: b.paidRef, note: b.note }))
      const verb = { sent: 'Marked the report sent for', paid: 'Marked paid:', reopen: 'Reopened the payout for' }[b.action]
      await recordAudit({ action: `race_payout.${b.action}`, summary: `${verb} ${r.name}${b.action === 'paid' ? ` (${usd(r.payoutCents)}${b.paidRef ? `, ${String(b.paidRef).slice(0, 60)}` : ''})` : ''}`, detail: { dealId: r.dealId, paidRef: b.paidRef || null, attio: r.attio }, actor })
      return res.status(200).json({ race: r })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) { return answerError(res, error, '/finance/race-payouts') }
}
