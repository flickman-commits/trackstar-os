/**
 * Cost, margin and committed-deal data for the internal Marathon Monopoly
 * model at /monopoly/model.
 *
 *   GET /api/admin/monopoly-model
 *
 * ⚠️ This is the only endpoint that emits true unit cost and per-tier margin.
 * Those figures would undercut every partnership negotiation if a race director
 * ever saw them, so this route sits behind requireAdmin — the same gate as the
 * rest of the merchant API — and nothing under api/public/ imports from it.
 *
 * It reads the same sheet as the partner page, so the model always starts from
 * the real board rather than a blank scenario: deals already sold or on hold
 * pre-fill the inputs, and Matt layers hypotheticals on top of reality.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { getBoardData, getInternalEconomics } from '../../../server/services/monopolyBoard.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  // Admin only: true unit cost and margin per tier.
  if (!(await requireAdminOnly(req, res))) return

  res.setHeader('Cache-Control', 'private, no-store, max-age=0')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const refresh = req.query.refresh === '1'
    const [board, economics] = await Promise.all([
      getBoardData({ refresh }),
      getInternalEconomics(),
    ])
    const { publicPayload } = board

    // No tiers in this response. The ladder is code (src/lib/monopolyCopy.ts)
    // and the model page imports it directly, so the fee Matt models against is
    // by construction the fee a race director is being quoted.
    // What's actually spoken for right now, per tier — the model's starting
    // point. `hold` counts as committed here because Matt is modelling the
    // pipeline he's working, not only the ink that's dry.
    const committedByTier = {}
    for (const sale of Object.values(publicPayload.spaceSales)) {
      if (!sale.tierKey) continue
      if (sale.status !== 'sold' && sale.status !== 'reserved' && sale.status !== 'hold') continue
      committedByTier[sale.tierKey] = (committedByTier[sale.tierKey] || 0) + 1
    }

    return res.status(200).json({
      ...economics,
      committed: Object.entries(committedByTier).map(([tierKey, count]) => ({ tierKey, count })),
      stale: publicPayload.stale,
      // Admin-only, and deliberately not on publicPayload: the raw Sheets error
      // can name the spreadsheet and the service account, so it stays behind
      // requireAdmin rather than riding along on the public response.
      staleReason: board.staleReason,
    })
  } catch (err) {
    console.error('[monopoly-model] request failed:', err)
    return res.status(500).json({ error: 'Unable to load model data' })
  }
}
