/**
 * GET /api/cron/finance-sync - each morning, hourly from 7am Eastern until
 * early afternoon: read the Daily Tracker's raw tabs into the ledger
 * (server/domain/finance/sheetSync.js). The whole year every time; only
 * changed days are written. Cron only.
 */
import { isCronRequest } from '../_lib/auth.js'
import { syncFromSheet } from '../../server/domain/finance/sheetSync.js'
import { alertError } from '../_lib/alerts.js'

export default async function handler(req, res) {
  if (!isCronRequest(req)) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const out = await syncFromSheet()
    console.log(`[cron/finance-sync] ${JSON.stringify(out)}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[cron/finance-sync]', error)
    await alertError('finance-sync', error)
    return res.status(500).json({ error: 'Sync failed' })
  }
}
