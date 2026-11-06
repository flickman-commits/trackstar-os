/**
 * POST /api/support/backfill - one chunk of the one-time import of the
 * mailbox's history. Admin only. The page calls it again until `done`;
 * progress survives between calls in SystemConfig.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly } from '../../_lib/users.js'
import { backfill } from '../../../server/domain/support/mailbox.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireAdminOnly(req, res)
  if (!user) return
  try {
    const out = await backfill({ pages: 3, pageSize: 100 })
    console.log(`[support.backfill] imported ${out.imported}, total ${out.total}${out.done ? ', done' : ''}`)
    return res.status(200).json(out)
  } catch (error) {
    console.error('[API /support/backfill]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'The mailbox import failed. Try again in a minute.') })
  }
}
