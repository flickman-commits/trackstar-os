/**
 * /api/public/bulk-intake - the partner's side of a bulk order.
 *
 *   GET  ?token=            who this is for, the race, how many are in so far
 *   POST { token, runners: [{ firstName, lastName, email?, address:{...} }] }
 *
 * The link is the credential. It says nothing about who has already been
 * entered beyond a count, and it never returns an error message from
 * underneath; a partner sees "something went wrong", the log sees why.
 */
import prisma from '../_lib/prisma.js'
import { setCors } from '../_lib/auth.js'
import { recordAudit } from '../_lib/users.js'
import { checkRateLimitDurable } from '../../server/lib/publicRateLimit.js'
import { addRunners, addressComplete, orgShipTo } from '../../server/domain/bulk/bulkOrders.js'

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  return (Array.isArray(fwd) ? fwd[0] : String(fwd || '').split(',')[0]).trim() || req.socket?.remoteAddress || 'unknown'
}

const MAX_PER_SUBMIT = 500

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS', allowPublic: true })) return

  const limit = await checkRateLimitDurable(clientIp(req), { bucket: 'bulk_intake', max: 60 })
  if (!limit.allowed) {
    res.setHeader('Retry-After', Math.ceil(limit.retryAfterMs / 1000))
    return res.status(429).json({ error: 'rate_limited' })
  }

  try {
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})) : {}
    const token = String((req.method === 'GET' ? req.query?.token : body.token) || '')
    if (!token || token.length > 80) return res.status(404).json({ error: 'not_found' })
    // Two links: the partner's (whole list) and the runner's (one person,
    // their own address). The runner link never reveals the count.
    const kind = String((req.method === 'GET' ? req.query?.kind : body.kind) || 'partner') === 'runner' ? 'runner' : 'partner'
    const bulk = await prisma.bulkOrder.findUnique({ where: kind === 'runner' ? { runnerToken: token } : { intakeToken: token } })
    if (!bulk || bulk.status === 'submitted') return res.status(404).json({ error: 'not_found' })

    if (req.method === 'GET') {
      const count = kind === 'runner' ? null : await prisma.order.count({ where: { bulkOrderId: bulk.id } })
      // The partner sees who is on the list, names only; nobody's address
      // is echoed back over a link.
      const received = kind === 'runner' ? null : (await prisma.order.findMany({ where: { bulkOrderId: bulk.id }, orderBy: { lineItemIndex: 'asc' }, select: { orderNumber: true, runnerName: true, shippingAddress: true, createdAt: true } }))
        .map(r => ({ id: r.orderNumber, name: r.runnerName, city: r.shippingAddress?.city || null, at: r.createdAt }))
      let previewImageUrl = null
      if (kind === 'partner') {
        previewImageUrl = bulk.previewImageUrl || null
        if (!previewImageUrl && bulk.partnerOrderId) {
          const proof = await prisma.proof.findFirst({ where: { orderId: bulk.partnerOrderId, status: 'approved' }, select: { thumbnailUrl: true, imageUrl: true } })
          previewImageUrl = proof?.imageUrl || proof?.thumbnailUrl || null
        }
      }
      return res.status(200).json({
        received,
        previewImageUrl,
        partnerName: bulk.partnerName,
        raceName: bulk.raceName,
        raceYear: bulk.raceYear,
        quantity: kind === 'runner' ? null : bulk.quantity,
        entered: count,
        note: bulk.intakeNote || null,
        product: `${bulk.productSize} ${bulk.frameType === 'Unframed' ? 'unframed' : `framed in ${bulk.frameType.toLowerCase()}`}`,
        event: bulk.eventType || null,
        // Every print ships to the organization: the list is names only.
        namesOnly: Boolean(await orgShipTo(bulk)),
        runnerLink: kind === 'partner' ? `/runner/${bulk.runnerToken}` : null,
      })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

    // The partner can take someone off their own list. Partner link only,
    // and only a runner that belongs to this order and has no print yet.
    if (body.action === 'remove') {
      if (kind !== 'partner') return res.status(404).json({ error: 'not_found' })
      const runner = await prisma.order.findFirst({ where: { bulkOrderId: bulk.id, orderNumber: String(body.id || '') }, select: { id: true, productionFileUrl: true, status: true } })
      if (!runner) return res.status(404).json({ error: 'not_found' })
      if (runner.productionFileUrl || runner.status === 'completed') return res.status(409).json({ error: 'in_production' })
      await prisma.runnerResearch.deleteMany({ where: { orderId: runner.id } })
      await prisma.order.delete({ where: { id: runner.id } })
      await recordAudit({ action: 'bulk.intake_remove', summary: `${bulk.partnerName} removed a runner from ${bulk.number} through the partner intake link`, detail: { bulkOrderId: bulk.id, orderNumber: String(body.id) }, actor: { isSystem: true, email: 'partner intake link' } })
      const count = await prisma.order.count({ where: { bulkOrderId: bulk.id } })
      return res.status(200).json({ removed: true, entered: count })
    }

    const list = Array.isArray(body.runners) ? body.runners.slice(0, kind === 'runner' ? 1 : MAX_PER_SUBMIT) : []
    const namesOnly = Boolean(await orgShipTo(bulk))
    const rows = []
    const rejected = []
    for (const r of list) {
      const first = String(r?.firstName || '').trim().slice(0, 60)
      const last = String(r?.lastName || '').trim().slice(0, 60)
      const a = r?.address || {}
      const address = {
        line1: String(a.line1 || '').trim().slice(0, 150),
        line2: String(a.line2 || '').trim().slice(0, 150),
        city: String(a.city || '').trim().slice(0, 80),
        state: String(a.state || '').trim().slice(0, 80),
        zip: String(a.zip || '').trim().slice(0, 20),
        country: String(a.country || 'United States').trim().slice(0, 60),
      }
      const email = String(r?.email || '').trim().slice(0, 120) || null
      if (!first || !last) { rejected.push({ row: rows.length + rejected.length + 1, reason: 'name' }); continue }
      if (!namesOnly && !addressComplete(address)) { rejected.push({ row: rows.length + rejected.length + 1, reason: 'address', name: `${first} ${last}` }); continue }
      rows.push({ runnerName: `${first} ${last}`, email, address })
    }
    const created = await addRunners(bulk, rows)
    // Who entered what is otherwise invisible: a partner's whole list arrives in one request.
    if (created.length) {
      const via = kind === 'runner' ? 'runner self-serve link' : 'partner intake link'
      await recordAudit({ action: 'bulk.intake', summary: `${kind === 'runner' ? 'A runner' : bulk.partnerName} added ${created.length} runner${created.length === 1 ? '' : 's'} to ${bulk.number} through the ${via}`, detail: { bulkOrderId: bulk.id, added: created.length, duplicates: rows.length - created.length, rejected: rejected.length }, actor: { isSystem: true, email: via } })
    }
    const count = kind === 'runner' ? null : await prisma.order.count({ where: { bulkOrderId: bulk.id } })
    return res.status(200).json({ added: created.length, duplicates: rows.length - created.length, rejected, entered: count })
  } catch (error) {
    console.error('[API /public/bulk-intake]', error)
    return res.status(500).json({ error: 'server_error' })
  }
}
