/**
 * /api/support/attachment - a customer's file, straight from Gmail.
 *
 *   GET ?message=<SupportMessage id>&i=<index>[&download=1]
 *
 * The page shows photos inline from here, so a rep sees what the customer
 * sent without opening Gmail. Only files on a message we stored, by their
 * place in its list. Raster images are served inline; anything else (SVG
 * included, which can carry script) only as a download.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability } from '../../_lib/users.js'
import { messageAttachment } from '../../../server/domain/support/mailbox.js'

const INLINE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/avif'])

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  const messageId = String(req.query?.message || '')
  const index = Number(req.query?.i)
  if (!messageId || !Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'message and i are required' })
  try {
    const a = await messageAttachment(messageId, index)
    if (!a) return res.status(404).json({ error: 'No such attachment' })
    const mime = String(a.mimeType || '').toLowerCase()
    const inline = INLINE.has(mime) && req.query?.download !== '1'
    const name = String(a.filename || 'attachment').replace(/["\\\r\n]/g, '_')
    res.setHeader('Content-Type', inline ? mime : 'application/octet-stream')
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(a.filename || 'attachment')}`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    // A message's files never change; the browser may keep them for this person.
    res.setHeader('Cache-Control', 'private, max-age=86400')
    return res.status(200).send(a.bytes)
  } catch (err) {
    console.error('[support/attachment]', err)
    return res.status(500).json({ error: 'Could not load that file from Gmail' })
  }
}
