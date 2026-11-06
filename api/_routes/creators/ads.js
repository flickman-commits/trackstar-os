/**
 * /api/creators/ads - winning ads for the Creators page.
 *   GET                 list
 *   POST   { title, url, imageUrl?, notes? }   add
 *   DELETE ?id=         remove (admin)
 * Creators read the same list through their portal data.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, requireAdminRole, recordAudit } from '../../_lib/users.js'
import { listWinningAds, addWinningAd, removeWinningAd } from '../../../server/domain/creators/winningAds.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return
  const user = await requireCapability(req, res, 'creators')
  if (!user) return

  try {
    if (req.method === 'GET') return res.status(200).json({ ads: await listWinningAds() })

    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      const ad = await addWinningAd(b, user.id)
      await recordAudit({ action: 'creators.winning-ad-added', summary: `Added winning ad "${ad.title}"`, detail: { adId: ad.id }, actor: user })
      return res.status(200).json({ ad })
    }

    if (req.method === 'DELETE') {
      const admin = await requireAdminRole(req, res, user)
      if (!admin) return
      const ad = await removeWinningAd(req.query.id)
      await recordAudit({ action: 'creators.winning-ad-removed', summary: `Removed winning ad "${ad.title}"`, detail: { adId: ad.id }, actor: admin })
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message })
    if (error.code === 'P2025') return res.status(404).json({ error: 'Ad not found' })
    console.error('[API /creators/ads]', error)
    return res.status(500).json({ error: 'Could not update winning ads' })
  }
}
