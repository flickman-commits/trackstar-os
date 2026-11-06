/**
 * POST /api/orders/import
 *
 * API endpoint for manual "Import Now" button.
 * Calls the shared processOrders function.
 *
 * Query params:
 *   - research=true: Also run research for supported races
 */

import { setCors, requireAdmin } from '../../_lib/auth.js'
import { processOrders } from '../../../server/processOrders.js'
import { runLockedImport, getLastImport } from '../../../server/lib/importStamp.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return

  // GET: when orders were last pulled in, for the "Last refreshed" line.
  if (req.method === 'GET') {
    try { return res.status(200).json({ lastImportedAt: await getLastImport() }) } catch { return res.status(500).json({ error: 'Failed to read last import' }) }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Check if research should be run
    const runResearch = req.query.research === 'true' || req.body?.research === true

    console.log(`[API /orders/import] Starting import (research: ${runResearch})`)

    const results = await runLockedImport(() => processOrders({
      runResearch,
      verbose: true
    }))

    return res.status(200).json(results)

  } catch (error) {
    console.error('[API /orders/import] Error:', error)
    return res.status(500).json({
      success: false,
      error: 'Something went wrong. Try again, and tell Matt if it keeps happening.',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
