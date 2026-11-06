/**
 * /api/sales/assets - the content library.
 *
 *   GET                                  every asset, each with a signed preview URL
 *   GET ?dealId=                         ...plus which image would be auto-attached for that deal
 *   POST { action:'upload-url', filename, contentType }   where the browser PUTs the bytes
 *   POST { action:'rename', id, name }                 new name, same extension; the id changes
 *   POST { action:'delete', id }
 *
 * Bytes never pass through here: the browser uploads straight to storage on
 * the signed URL, so a 20 MB deck is fine.
 */
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep, recordAudit } from '../../_lib/users.js'
import { listAssets, assetPreviewUrl, assetUploadUrl, deleteAsset, renameAsset, pickAssetFor, isAssetStorageConfigured } from '../../../server/domain/sales/assets.js'
import { getDeal } from '../../../server/domain/sales/attio.js'
import { publicMessage, publicStatus } from '../../../server/domain/sales/errors.js'

// Thumbnail links last 12 hours: Sales stays open in the background all day,
// and a 15-minute link left the library showing broken images.
const PREVIEW_SECONDS = 12 * 3600

async function withPreviews(files) {
  return Promise.all(files.map(async f => {
    try { return { ...f, previewUrl: await assetPreviewUrl(f.id, PREVIEW_SECONDS) } }
    catch { return { ...f, previewUrl: null } }
  }))
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  try {
    if (!isAssetStorageConfigured()) return res.status(200).json({ configured: false, assets: [], suggestedId: null })

    if (req.method === 'GET') {
      const files = await listAssets({ force: req.query?.refresh === '1' })
      let suggestedId = null
      if (req.query?.dealId) {
        const deal = await getDeal(String(req.query.dealId)).catch(() => null)
        if (deal) suggestedId = (await pickAssetFor(deal))?.id || null
      }
      return res.status(200).json({ configured: true, assets: await withPreviews(files), suggestedId })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      if (body.action === 'upload-url') {
        const out = await assetUploadUrl({ filename: String(body.filename || ''), contentType: String(body.contentType || '') })
        await recordAudit({ actor, action: 'sales.asset.upload', summary: `Added ${out.filename} to the sales library`, detail: { id: out.id } })
        return res.status(200).json(out)
      }
      if (body.action === 'rename') {
        if (!body.id) return res.status(400).json({ error: 'id is required' })
        try {
          const out = await renameAsset(String(body.id), String(body.name || ''))
          await recordAudit({ actor, action: 'sales.asset.rename', summary: `Renamed ${body.id} to ${out.filename} in the sales library`, detail: { from: body.id, to: out.id } })
          return res.status(200).json(out)
        } catch (e) {
          return res.status(publicStatus(e)).json({ error: publicMessage(e, 'Something went wrong with the sales library') })
        }
      }
      if (body.action === 'delete') {
        if (!body.id) return res.status(400).json({ error: 'id is required' })
        await deleteAsset(String(body.id))
        await recordAudit({ actor, action: 'sales.asset.delete', summary: `Removed ${body.id} from the sales library`, detail: { id: body.id } })
        return res.status(200).json({ success: true })
      }
      return res.status(400).json({ error: `Unknown action: ${body.action}` })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('[API /sales/assets]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Something went wrong with the sales library') })
  }
}
