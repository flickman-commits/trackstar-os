/**
 * /api/creators/manage - the team's side of the creator program.
 *
 *   GET  ?action=home-metrics | list-creators | list-briefs
 *   POST { action: update-creator | create-brief | update-brief | create-creator-invite
 *                | approve-creator-sample | decline-creator-sample | set-creator-sample-tracking
 *                | delete-creator }
 *
 * Moved out of api/_routes/orders/actions.js, which had become the home of every
 * small action whether or not it was about orders. Everything needs the
 * Creators capability; deleting a creator also needs an admin and is logged.
 * The creator's own side (apply, portal, onboarding) is api/_routes/public/creator.js.
 */
import prisma from '../../_lib/prisma.js'
import { setCors } from '../../_lib/auth.js'
import { seesMoney } from '../../_lib/money.js'
import { requireCapability, requireAdminRole, recordAudit } from '../../_lib/users.js'
import { sendCreatorSample, linkCreatorSamples } from '../../../server/domain/creators/creatorSample.js'
import { makeInviteToken } from '../../../server/domain/creators/portal.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

const GET_ACTIONS = {
  'home-metrics': (res, money) => handleCreatorHomeMetrics(res, money),
  'list-creators': (res, money) => handleListCreators(res, money),
  'list-briefs': res => handleListBriefs(res),
}

const POST_ACTIONS = {
  'update-creator': (body, res, actor) => handleUpdateCreator(body, res, seesMoney(actor)),
  'create-brief': (body, res) => handleCreateBrief(body, res),
  'update-brief': (body, res) => handleUpdateBrief(body, res),
  'create-creator-invite': (body, res) => handleCreateCreatorInvite(body, res),
  'approve-creator-sample': (body, res, actor) => handleApproveCreatorSample(body, res, actor),
  'decline-creator-sample': (body, res) => handleDeclineCreatorSample(body, res),
  'set-creator-sample-tracking': (body, res) => handleSetCreatorSampleTracking(body, res),
  'delete-creator': (body, res) => handleDeleteCreator(body, res),
}

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'creators')
  if (!user) return

  try {
    if (req.method === 'GET') {
      const run = GET_ACTIONS[String(req.query?.action || '')]
      if (!run) return res.status(400).json({ error: 'Unknown action' })
      return await run(res, seesMoney(user))
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const run = POST_ACTIONS[String(body.action || '')]
    if (!run) return res.status(400).json({ error: 'Unknown action' })

    if (body.action === 'delete-creator') {
      const admin = await requireAdminRole(req, res, user)
      if (!admin) return
      const out = await run(body, res, admin)
      if (res.statusCode < 400) {
        await recordAudit({ action: 'creator.delete', summary: `Deleted creator ${body.creatorId || '?'}`, detail: { creatorId: body.creatorId }, actor: admin })
      }
      return out
    }
    return await run(body, res, user)
  } catch (error) {
    console.error('[API /creators/manage]', error)
    if (error.code === 'P2025') return res.status(404).json({ error: 'Not found' })
    return sendPublicError(res, error)
  }
}

// --- creator-home-metrics ---
// Aggregates the homepage tiles for /creators.

// Internal-only sample COGS by size + frame. Do not surface to creators.
// Source: 2026 vendor pricing from Matt.
const SAMPLE_COST_USD = {
  '8x10':  { unframed: 10.40, framed: 31.94 },
  '12x18': { unframed: 13.42, framed: 44.81 },
}
function sampleCostUsd(size, frame) {
  const sizeRow = SAMPLE_COST_USD[size]
  if (!sizeRow) return 0
  const isFramed = frame && frame !== 'Unframed'
  return isFramed ? sizeRow.framed : sizeRow.unframed
}

async function handleCreatorHomeMetrics(res, money) {
  // Run aggregations in parallel
  const [
    activeCount,
    invitedCount,
    appliedCount,
    pausedCount,
    sampleOrders,
    thisMonthApplications,
  ] = await Promise.all([
    prisma.creator.count({ where: { status: 'active' } }),
    // Exclude unfinished public applications (blank rows) from the invited count
    // so they don't inflate the "total in program" rollup.
    prisma.creator.count({ where: { status: 'invited', NOT: { source: 'public_apply', onboardedAt: null } } }),
    prisma.creator.count({ where: { status: 'applied' } }),
    prisma.creator.count({ where: { status: 'paused' } }),
    prisma.order.findMany({
      where: { source: 'creator_sample' },
      select: { id: true, status: true, productSize: true, frameType: true }
    }),
    prisma.creator.count({
      where: {
        // onboardedAt column name preserved — it stamps when the wizard
        // is submitted, which under the new naming is the "applied" moment.
        onboardedAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      }
    }),
  ])

  const samplesShipped = sampleOrders.filter(o => o.status === 'completed').length
  const samplesPending = sampleOrders.length - samplesShipped
  const samplesCostEstimatedUsd = sampleOrders.reduce(
    (sum, o) => sum + sampleCostUsd(o.productSize, o.frameType),
    0
  )

  return res.status(200).json({
    creators: {
      total: activeCount + invitedCount + appliedCount + pausedCount,
      active: activeCount,
      invited: invitedCount,
      applied: appliedCount,
      paused: pausedCount,
      appliedThisMonth: thisMonthApplications,
    },
    samples: {
      total: sampleOrders.length,
      shipped: samplesShipped,
      pending: samplesPending,
      // Sample cost is money: admins only (api/_lib/money.js).
      costEstimatedUsd: money ? samplesCostEstimatedUsd : null,
      costIsPlaceholder: false,
    },
    // Placeholders for Week 3 when Meta + attribution land
    ads: { running: 0, isPlaceholder: true },
    revenue: { attributedThisMonthUsd: 0, isPlaceholder: true },
    commission: { pendingUsd: 0, isPlaceholder: true },
  })
}

// --- list-creators ---
// Returns all creators with their sample-order status joined in. Ordered by
// invite date descending so the most recent shows up first.
async function handleListCreators(res, money) {
  // Samples sent as Shopify orders: link each to its order once it has been imported.
  await linkCreatorSamples(await prisma.creator.findMany({ where: { NOT: { sampleShopifyOrderIds: { isEmpty: true } } }, select: { id: true, sampleOrderId: true, sampleShopifyOrderIds: true } }))
  const creators = await prisma.creator.findMany({
    // Hide abandoned public applications — someone clicked "Apply" on the public
    // landing page but never submitted the wizard. They're blank rows (no name,
    // never onboarded) and only clutter the table. Once they submit, onboardedAt
    // is set and they reappear in the Applied queue.
    where: {
      NOT: { source: 'public_apply', onboardedAt: null },
    },
    orderBy: { invitedAt: 'desc' },
    include: {
      sampleOrder: {
        select: {
          id: true, orderNumber: true, status: true, createdAt: true,
          trackingNumber: true, trackingCarrier: true, shippedAt: true,
        }
      },
      briefAssignments: {
        include: { brief: { select: { id: true, title: true, status: true } } }
      }
    }
  })
  // Attach internal-only sample cost per creator. Drives the COGS rollup
  // in the admin drawer; never surfaced in the creator-facing portal.
  // Cost and commission terms are money: admins only (api/_lib/money.js).
  const enriched = creators.map(c => {
    if (money) return { ...c, sampleCostUsd: sampleCostUsd(c.productSize, c.frameType) }
    const { commissionModel: _m, commissionConfig: _c, commissionNotes: _n, ...rest } = c
    return rest
  })
  return res.status(200).json({ creators: enriched })
}

// --- update-creator ---
// Updates editable fields on a creator. Only allow-listed fields can be
// changed through this endpoint — protects against accidental overwrite of
// inviteToken, onboardedAt, sampleOrderId, etc.
const CREATOR_EDITABLE_FIELDS = [
  // Profile
  'name', 'email', 'instagramHandle', 'tiktokHandle',
  // Application questions — editable post-application so Matt can fix typos
  'bestContentLinks', 'whyWorkWithUs',
  // Sample details — editable after onboarding in case the creator emails
  // a correction (different race, size, bib, etc.)
  'raceName', 'raceYear', 'bibNumber', 'finishTime',
  'productTitle', 'productSize', 'frameType',
  // Shipping — these get re-mirrored onto the linked fulfillment Order below
  // so the dashboard reflects the corrected address.
  'shippingName', 'shippingAddress1', 'shippingAddress2',
  'shippingCity', 'shippingState', 'shippingZip', 'shippingCountry',
  // Commissions / whitelisting / lifecycle
  'commissionModel', 'commissionConfig', 'commissionNotes',
  'whitelistingEnabled', 'metaPageId',
  'status', 'contentStatus',
  // Free-form admin notes
  'notes',
]

// Shipping-field subset — used to detect when we also need to mirror the
// change onto the linked fulfillment Order so Elí ships to the right place.
const CREATOR_SHIPPING_FIELDS = [
  'shippingName', 'shippingAddress1', 'shippingAddress2',
  'shippingCity', 'shippingState', 'shippingZip', 'shippingCountry',
]

const CREATOR_MONEY_FIELDS = new Set(['commissionModel', 'commissionConfig', 'commissionNotes'])
async function handleUpdateCreator({ creatorId, updates }, res, money) {
  if (!creatorId) {
    return res.status(400).json({ error: 'creatorId is required' })
  }
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'updates object is required' })
  }

  const data = {}
  for (const key of CREATOR_EDITABLE_FIELDS) {
    if (!money && CREATOR_MONEY_FIELDS.has(key)) continue
    if (key in updates) data[key] = updates[key]
  }

  // Coerce raceYear to an int if present — frontend may send it as string.
  if (data.raceYear != null && data.raceYear !== '') {
    data.raceYear = parseInt(data.raceYear, 10) || null
  } else if (data.raceYear === '') {
    data.raceYear = null
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'no editable fields provided' })
  }

  const updated = await prisma.creator.update({
    where: { id: creatorId },
    data,
    include: {
      sampleOrder: {
        select: {
          id: true, orderNumber: true, status: true, createdAt: true,
          trackingNumber: true, trackingCarrier: true, shippedAt: true,
        }
      },
      briefAssignments: {
        include: { brief: { select: { id: true, title: true, status: true } } }
      }
    }
  })

  // If shipping changed AND there's a linked fulfillment Order, re-mirror the
  // address into arteloOrderData.shipping so the Dashboard's creator banner
  // and Elí's queue both reflect the corrected destination.
  const shippingTouched = CREATOR_SHIPPING_FIELDS.some(k => k in updates)
  if (shippingTouched && updated.sampleOrderId) {
    const existing = await prisma.order.findUnique({
      where: { id: updated.sampleOrderId },
      select: { arteloOrderData: true }
    })
    const nextArtelo = {
      ...(existing?.arteloOrderData || {}),
      shipping: {
        name: updated.shippingName || updated.name || null,
        address1: updated.shippingAddress1 || null,
        address2: updated.shippingAddress2 || null,
        city: updated.shippingCity || null,
        state: updated.shippingState || null,
        zip: updated.shippingZip || null,
        country: updated.shippingCountry || 'US',
      },
    }
    await prisma.order.update({
      where: { id: updated.sampleOrderId },
      data: { arteloOrderData: nextArtelo },
    })
    console.log(`[actions/update-creator] Mirrored shipping → order ${updated.sampleOrderId}`)
  }

  console.log(`[actions/update-creator] Updated creator ${creatorId}: ${Object.keys(data).join(', ')}`)
  if (!money) {
    const { commissionModel: _m, commissionConfig: _c, commissionNotes: _n, ...rest } = updated
    return res.status(200).json({ success: true, creator: rest })
  }
  return res.status(200).json({ success: true, creator: updated })
}

// --- list-briefs ---
async function handleListBriefs(res) {
  const briefs = await prisma.brief.findMany({
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: {
      _count: { select: { assignments: true } }
    }
  })
  return res.status(200).json({ briefs })
}

// --- create-brief ---
const BRIEF_EDITABLE_FIELDS = [
  'title', 'description', 'styleOfVideo', 'angle',
  'targetLength', 'hooks', 'emotion', 'fomo', 'persona',
  'examplesNotes', 'status',
]

async function handleCreateBrief(body, res) {
  if (!body.title || !String(body.title).trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  const data = { title: String(body.title).trim() }
  for (const key of BRIEF_EDITABLE_FIELDS) {
    if (key !== 'title' && key in body) data[key] = body[key]
  }
  const created = await prisma.brief.create({ data })
  console.log(`[actions/create-brief] Created ${created.id}: ${created.title}`)
  return res.status(201).json({ success: true, brief: created })
}

// --- update-brief ---
async function handleUpdateBrief({ briefId, updates }, res) {
  if (!briefId) return res.status(400).json({ error: 'briefId is required' })
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'updates object is required' })
  }
  const data = {}
  for (const key of BRIEF_EDITABLE_FIELDS) {
    if (key in updates) data[key] = updates[key]
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'no editable fields provided' })
  }
  const updated = await prisma.brief.update({ where: { id: briefId }, data })
  console.log(`[actions/update-brief] Updated ${briefId}: ${Object.keys(data).join(', ')}`)
  return res.status(200).json({ success: true, brief: updated })
}

// --- create-creator-invite ---
// Creates a new Creator row in "invited" state. Matt picks which briefs
// should appear in the creator's onboarding (optional multi-select).
//
// Token is URL-safe random 20 chars — short enough to DM, long enough to
// resist guessing. Doubles as the creator's persistent portal access token.

async function handleCreateCreatorInvite({ name, email, instagramHandle, briefIds }, res) {
  // All fields optional except the implicit token. Matt may not know the
  // creator's name yet when generating the link.
  const data = {
    inviteToken: makeInviteToken(),
    status: 'invited',
    source: 'admin_invite',
  }
  if (name && String(name).trim()) data.name = String(name).trim()
  if (email && String(email).trim()) data.email = String(email).trim()
  if (instagramHandle && String(instagramHandle).trim()) {
    data.instagramHandle = String(instagramHandle).trim()
  }

  const created = await prisma.creator.create({ data })

  // Attach brief assignments if any were picked
  if (Array.isArray(briefIds) && briefIds.length > 0) {
    await prisma.briefAssignment.createMany({
      data: briefIds.map(briefId => ({ creatorId: created.id, briefId })),
      skipDuplicates: true,
    })
  }

  console.log(`[actions/create-creator-invite] Created ${created.id} with ${briefIds?.length || 0} brief(s)`)
  return res.status(201).json({ success: true, creator: created })
}

// --- approve-creator-sample ---
// Admin clicks "Approve" on a creator who applied. The sample goes out as a
// free Shopify order through the Samples flow (server/domain/creators/creatorSample.js).
async function handleApproveCreatorSample({ creatorId }, res, actor) {
  if (!creatorId) return res.status(400).json({ error: 'creatorId is required' })

  const creator = await prisma.creator.findUnique({ where: { id: creatorId } })
  if (!creator) return res.status(404).json({ error: 'Creator not found' })
  if (!creator.onboardedAt) return res.status(400).json({ error: 'Creator has not onboarded yet' })
  if (creator.sampleOrderId || creator.sampleShopifyOrderIds?.length) return res.status(400).json({ error: 'Sample already approved for this creator' })

  // A free Shopify order through the Samples flow: Shopify emails the creator,
  // Artelo makes it like any order, and the cost goes into the sample spend.
  // (It used to be a manual Artelo order Eli built from a Slack message.)
  try {
    const out = await sendCreatorSample({ creatorId, actor })
    console.log(`[actions/approve-creator-sample] Approved ${creatorId} -> Shopify ${out.name}`)
    return res.status(200).json({ success: true, orderNumber: out.name, shopifyUrl: out.adminUrl })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    throw err
  }
}

// --- decline-creator-sample ---
// Admin clicks "Decline" on a Sample Request. Marks the creator 'denied' — they
// drop out of the admin table but stay in the DB so they can be un-denied later.
async function handleDeclineCreatorSample({ creatorId }, res) {
  if (!creatorId) return res.status(400).json({ error: 'creatorId is required' })

  const creator = await prisma.creator.findUnique({ where: { id: creatorId } })
  if (!creator) return res.status(404).json({ error: 'Creator not found' })
  if (creator.sampleOrderId) return res.status(400).json({ error: 'Sample already approved - cannot decline' })

  await prisma.creator.update({
    where: { id: creatorId },
    data: { status: 'denied' }
  })

  console.log(`[actions/decline-creator-sample] Declined sample for ${creatorId} (${creator.name || 'unnamed'})`)
  return res.status(200).json({ success: true })
}

// --- set-creator-sample-tracking ---
// Admin pastes a tracking # in the creator drawer. Setting it = "shipped"
// in the creator portal (no separate status flip). Empty string clears it.
async function handleSetCreatorSampleTracking({ creatorId, trackingNumber, trackingCarrier }, res) {
  if (!creatorId) return res.status(400).json({ error: 'creatorId is required' })

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    select: { sampleOrderId: true }
  })
  if (!creator) return res.status(404).json({ error: 'Creator not found' })
  if (!creator.sampleOrderId) return res.status(400).json({ error: 'No sample order yet - approve first' })

  const trimmed = (trackingNumber || '').trim()
  const carrier = (trackingCarrier || '').trim()

  const order = await prisma.order.update({
    where: { id: creator.sampleOrderId },
    data: {
      trackingNumber: trimmed || null,
      trackingCarrier: carrier || null,
      shippedAt: trimmed ? new Date() : null,
    },
    select: { orderNumber: true, trackingNumber: true, trackingCarrier: true, shippedAt: true }
  })

  console.log(`[actions/set-creator-sample-tracking] ${creatorId} → ${trimmed || '(cleared)'}`)
  return res.status(200).json({ success: true, order })
}

// --- delete-creator ---
// Removes a creator. BriefAssignment rows cascade away with them. If they
// have a linked sample Order that hasn't shipped yet (no tracking number, not
// completed), we delete that too so it stops cluttering Elí's queue. If the
// order is already shipped or completed, we keep it for fulfillment history
// — only the creator's back-pointer goes.
async function handleDeleteCreator({ creatorId }, res) {
  if (!creatorId) return res.status(400).json({ error: 'creatorId is required' })

  const creator = await prisma.creator.findUnique({
    where: { id: creatorId },
    include: {
      sampleOrder: {
        select: { id: true, orderNumber: true, status: true, trackingNumber: true, shippedAt: true }
      }
    }
  })
  if (!creator) return res.status(404).json({ error: 'Creator not found' })

  const sampleOrder = creator.sampleOrder
  const isShipped = !!(sampleOrder?.trackingNumber || sampleOrder?.shippedAt)
  const isCompleted = sampleOrder?.status === 'completed'
  const shouldDeleteOrder = sampleOrder && !isShipped && !isCompleted

  // Order is deleted first so the Creator's FK doesn't block deletion. The
  // Order's cascades (comments, proofs, research) handle their own cleanup.
  if (shouldDeleteOrder) {
    // Detach the back-pointer before deleting the Order to avoid the FK conflict.
    await prisma.creator.update({
      where: { id: creatorId },
      data: { sampleOrderId: null }
    })
    await prisma.order.delete({ where: { id: sampleOrder.id } })
  }

  await prisma.creator.delete({ where: { id: creatorId } })

  console.log(`[actions/delete-creator] Deleted ${creatorId} (${creator.name || 'unnamed'})${shouldDeleteOrder ? ` + order ${sampleOrder.orderNumber}` : ''}`)
  return res.status(200).json({
    success: true,
    deletedOrderNumber: shouldDeleteOrder ? sampleOrder.orderNumber : null,
    orderKept: sampleOrder && !shouldDeleteOrder ? sampleOrder.orderNumber : null,
  })
}

