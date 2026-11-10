/**
 * POST /api/support/upload { filename, contentType, size }
 *
 * A signed link for the browser to PUT one attachment into the private
 * support bucket; returns { ref, uploadUrl, filename }. The reply then
 * names the file by `ref` (server/domain/support/uploads.js).
 */
import { setCors } from '../../_lib/auth.js'
import { requireAnyCapability } from '../../_lib/users.js'
import { uploadSlot } from '../../../server/domain/support/uploads.js'

const SAFE = /^(Only images|That file is over)/

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  // Designers attach files to Email customer on custom orders too.
  const user = await requireAnyCapability(req, res, ['support', 'orders.message_customer'])
  if (!user) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    return res.status(200).json(await uploadSlot({ filename: body.filename, contentType: body.contentType, size: body.size }))
  } catch (error) {
    console.error('[API /support/upload]', error)
    const msg = String(error?.message || '')
    return res.status(SAFE.test(msg) ? 400 : 500).json({ error: SAFE.test(msg) ? msg : 'Could not start the upload' })
  }
}
