/**
 * /api/orders/comments
 *
 * GET    ?orderId=xxx            — List comments for an order (newest first)
 * POST   { orderId, text?, imageUrl? } — Add a comment
 * DELETE { commentId }           — Delete a comment + its image from storage
 */

import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { loadActiveUser, recordAudit, fullName } from '../../_lib/users.js'
import { slackTo } from '../../../server/lib/slack.js'
import { sendPublicError } from '../../../server/lib/publicError.js'
import { storage } from '../../../server/lib/storage.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return

  try {
    if (req.method === 'GET') {
      const { orderId } = req.query
      if (!orderId) return res.status(400).json({ error: 'orderId is required' })

      const comments = await prisma.orderComment.findMany({
        where: { orderId },
        orderBy: { createdAt: 'desc' }
      })

      return res.status(200).json({ comments })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      const { orderId, text, imageData, imageName } = body

      if (!orderId) return res.status(400).json({ error: 'orderId is required' })
      if (!text && !imageData) return res.status(400).json({ error: 'text or imageData is required' })

      const order = await prisma.order.findUnique({ where: { id: orderId } })
      if (!order) return res.status(404).json({ error: 'Order not found' })

      // Upload image to Supabase Storage if provided (server-side with service role key)
      let imageUrl = null
      if (imageData) {
        const supabase = storage()
        // Raster images only: the bucket is public, and an SVG (or anything a
        // browser sniffs as HTML) served from it would run script.
        const ext = String((imageName || 'image.png').split('.').pop() || 'png').toLowerCase()
        const COMMENT_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic' }
        if (!COMMENT_TYPES[ext]) return res.status(400).json({ error: 'Attach a PNG, JPG, GIF, WebP or HEIC image.' })
        const timestamp = Date.now()
        const randomSuffix = Math.random().toString(36).substring(2, 8)
        const filePath = `${orderId}/${timestamp}-${randomSuffix}.${ext}`

        // Convert base64 to buffer
        const buffer = Buffer.from(imageData, 'base64')
        const { error: uploadErr } = await supabase.storage
          .from('order-comments')
          .upload(filePath, buffer, { contentType: COMMENT_TYPES[ext], upsert: false })

        if (uploadErr) {
          console.error('[comments] Image upload failed:', uploadErr.message)
          return res.status(500).json({ error: 'The image did not upload. Try again.' })
        }

        const { data: { publicUrl } } = supabase.storage
          .from('order-comments')
          .getPublicUrl(filePath)
        imageUrl = publicUrl
      }

      // The session token carries no name, only id/email/role, so read the
      // author rather than stamping an email onto every comment. authorName is
      // denormalised alongside authorId so a comment still says who wrote it
      // after that person's account is deleted.
      const author = await loadActiveUser(actor)
      const comment = await prisma.orderComment.create({
        data: {
          orderId,
          text: text || null,
          imageUrl,
          authorId: author?.isSystem ? null : author?.id ?? null,
          authorName: (author && !author.isSystem ? fullName(author) : null) || actor.email || null,
        }
      })

      console.log(`[comments] Added to order ${order.orderNumber}: ${text ? 'text' : ''}${imageUrl ? ' +image' : ''}`)

      // Slack notification to Dan when a comment is added (fire and forget)
      if (text && order.trackstarOrderType === 'custom') {
        const shopifyData = order.shopifyOrderData
        const displayNum = (shopifyData && typeof shopifyData === 'object' && 'name' in shopifyData)
          ? String(shopifyData.name) : `#${order.parentOrderNumber}`
        const truncated = text.length > 200 ? text.substring(0, 200) + '...' : text
        slackTo('alerts', `💬 <@U04KBDJH5C3> New comment on order *${displayNum}*:\n> _"${truncated}"_`)
      }

      return res.status(201).json({ success: true, comment })
    }

    if (req.method === 'DELETE') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      const { commentId } = body

      if (!commentId) return res.status(400).json({ error: 'commentId is required' })

      const comment = await prisma.orderComment.findUnique({ where: { id: commentId } })
      if (!comment) return res.status(404).json({ error: 'Comment not found' })

      // Anyone may delete their own comment; deleting someone else's is an
      // admin action. Tidying up after yourself should not need a promotion,
      // and editing the record of what a colleague said should not be casual.
      const me = await loadActiveUser(actor)
      if (!me) return res.status(401).json({ error: 'Your account is no longer active. Sign in again.' })
      const isOwn = comment.authorId && comment.authorId === me.id
      if (!isOwn && me.role !== 'admin') {
        return res.status(403).json({ error: 'Only an admin can delete someone else\'s comment.' })
      }

      // Clean up image from Supabase Storage if present
      if (comment.imageUrl) {
        try {
          const supabase = storage()
          const match = comment.imageUrl.match(/\/storage\/v1\/object\/public\/order-comments\/(.+)$/)
          if (match?.[1]) {
            await supabase.storage.from('order-comments').remove([decodeURIComponent(match[1])])
          }
        } catch (e) {
          console.warn('[comments] Failed to delete image from storage:', e.message)
        }
      }

      await prisma.orderComment.delete({ where: { id: commentId } })
      console.log(`[comments] Deleted comment ${commentId}`)
      await recordAudit({
        action: 'comment.delete',
        summary: `Deleted a comment on order ${comment.orderId}${isOwn ? ' (their own)' : ` by ${comment.authorName || 'unknown'}`}`,
        detail: { commentId, orderId: comment.orderId, text: comment.text },
        actor: me,
      })
      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('[comments] Error:', error)
    return sendPublicError(res, error)
  }
}
