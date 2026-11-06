/**
 * The creator's side of the program: applying, the portal, onboarding.
 *
 * Everything here is reached without a login (api/_routes/public/creator.js). The
 * invite token is the credential, so nothing returns more than that creator's
 * own row, and every field a stranger can write is coerced and length-capped
 * before it reaches the database or Slack.
 */
import crypto from 'crypto'
import prisma from '../../db.js'
import { linkCreatorSamples } from './creatorSample.js'
import { listWinningAds } from './winningAds.js'
import { publicPrintCatalog } from '../catalog/printCatalog.js'
import { slackTo, slackText } from '../../lib/slack.js'
import { productionStatus } from '../orders/productionStatus.js'

/** A mistake the applicant can fix; the message is safe to show them. */
export class PortalError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

/**
 * URL-safe random 20 chars: short enough to DM, long enough to resist
 * guessing. Doubles as the creator's persistent portal access token.
 */
export function makeInviteToken() {
  return crypto.randomBytes(15).toString('base64url')
}

/**
 * Apply Now: a fresh Creator row and its token. Every active brief is
 * assigned so the applicant sees the content directives while onboarding.
 */
export async function createPublicInvite() {
  const created = await prisma.creator.create({
    data: { inviteToken: makeInviteToken(), status: 'invited', source: 'public_apply' },
  })
  const activeBriefs = await prisma.brief.findMany({ where: { status: 'active' }, select: { id: true } })
  if (activeBriefs.length) {
    await prisma.briefAssignment.createMany({
      data: activeBriefs.map(b => ({ creatorId: created.id, briefId: b.id })),
      skipDuplicates: true,
    })
  }
  console.log(`[creators/portal] public apply: creator ${created.id}`)
  return created.inviteToken
}

/**
 * Where their sample is, in the creator's words: approved, in production,
 * shipped or delivered, with the tracking link once it ships. Read live from
 * Artelo and Shopify (orders/productionStatus.js, the same view the team
 * has). Only the stage and the tracking leave here; if either service is down
 * the portal falls back to what it knew before.
 */
async function sampleStatus(orderId) {
  try {
    const st = await productionStatus(orderId)
    if (!st) return null
    const stage = st.stage === 'Delivered' ? 'delivered'
      : /^(Shipped|In transit|Out for delivery)$/.test(st.stage || '') ? 'shipped'
      : /^In production|^Sent to Artelo/.test(st.stage || '') ? 'in_production'
      : 'approved'
    const t = st.tracking.find(x => x.url) || st.tracking[0] || null
    return {
      stage,
      tracking: t ? { url: t.url, carrier: t.company, number: t.number, shippedAt: t.shippedAt, deliveredAt: t.deliveredAt, estimatedAt: t.estimatedAt } : null,
    }
  } catch (err) {
    console.warn(`[creators.portal] sample status: ${err.message}`)
    return null
  }
}

/** What the portal renders: their own profile, briefs, sample, and the pickers. */
export async function portalData(token) {
  const pending = await prisma.creator.findUnique({ where: { inviteToken: token }, select: { id: true, sampleOrderId: true, sampleShopifyOrderIds: true } })
  if (!pending) throw new PortalError('Invite not found or revoked', 404)
  await linkCreatorSamples([pending])

  const creator = await prisma.creator.findUnique({
    where: { inviteToken: token },
    include: {
      briefAssignments: { include: { brief: true }, orderBy: { assignedAt: 'asc' } },
      sampleOrder: { select: { id: true, orderNumber: true, status: true, createdAt: true, trackingNumber: true, trackingCarrier: true, shippedAt: true } },
    },
  })
  if (!creator) throw new PortalError('Invite not found or revoked', 404)

  // Archived briefs never surface, even if they were assigned once.
  const briefs = creator.briefAssignments.map(a => a.brief).filter(b => b.status === 'active')
  const races = await prisma.race.findMany({ orderBy: [{ year: 'desc' }, { raceName: 'asc' }], select: { id: true, raceName: true, year: true } })

  return {
    // Their own fields only; commission, notes and the rest stay internal.
    creator: Object.fromEntries([...PUBLIC_FIELDS, 'id', 'status', 'onboardedAt'].map(k => [k, creator[k]])),
    briefs,
    sampleOrder: creator.sampleOrder,
    sampleStatus: creator.sampleOrder ? await sampleStatus(creator.sampleOrder.id) : null,
    races,
    catalog: await publicPrintCatalog().catch(() => []),
    winningAds: await listWinningAds(),
  }
}

/**
 * The onboarding fields a creator may write, with the longest value each may
 * hold. Anything else in the submission is ignored.
 */
const ONBOARD_FIELDS = {
  name: 120, email: 200, instagramHandle: 80, tiktokHandle: 80,
  bestContentLinks: 2000, whyWorkWithUs: 4000,
  raceName: 160, raceYear: 4, bibNumber: 20, finishTime: 20,
  productTitle: 200, productSize: 40, frameType: 60,
  shippingName: 120, shippingAddress1: 200, shippingAddress2: 200,
  shippingCity: 120, shippingState: 80, shippingZip: 20, shippingCountry: 80,
}
const PUBLIC_FIELDS = Object.keys(ONBOARD_FIELDS)

export function cleanOnboarding(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PortalError('Send the application fields.')
  const out = {}
  for (const [key, max] of Object.entries(ONBOARD_FIELDS)) {
    if (!(key in data)) continue
    const raw = data[key]
    if (raw == null || raw === '') { out[key] = null; continue }
    if (typeof raw !== 'string' && typeof raw !== 'number') throw new PortalError(`${key} must be text.`)
    const value = String(raw).trim().slice(0, max)
    out[key] = value || null
  }
  if (out.raceYear != null) {
    const year = parseInt(out.raceYear, 10)
    out.raceYear = year >= 1970 && year <= 2100 ? year : null
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new PortalError('That email address does not look right.')
  return out
}

/** Save the application. The first submit flips them to applied and pings Matt. */
export async function submitOnboarding(token, data) {
  const creator = await prisma.creator.findUnique({ where: { inviteToken: token } })
  if (!creator) throw new PortalError('Invite not found or revoked', 404)
  const updates = cleanOnboarding(data)

  // A resubmit only updates fields; onboardedAt (really "applied at") is set once.
  const isFirst = !creator.onboardedAt
  if (isFirst) {
    updates.onboardedAt = new Date()
    updates.status = 'applied'
  }
  const updated = await prisma.creator.update({ where: { id: creator.id }, data: updates })
  console.log(`[creators/portal] ${creator.id} ${isFirst ? 'applied' : 'updated'}: ${Object.keys(updates).join(', ')}`)
  if (isFirst) await pingSampleRequested(updated)
  return { id: updated.id, status: updated.status }
}

async function pingSampleRequested(creator) {
  const mention = process.env.SLACK_USER_ID_MATT ? `<@${process.env.SLACK_USER_ID_MATT}> ` : ''
  const appUrl = process.env.APP_BASE_URL || ''
  const lines = [
    `${mention}🎬 *New Creator Sample Request*`,
    `Creator: *${slackText(creator.name || '(unnamed)')}*${creator.instagramHandle ? ` · ${slackText(creator.instagramHandle)}` : ''}`,
    `Race: ${slackText(creator.raceName || 'Unknown')}${creator.raceYear ? ` ${creator.raceYear}` : ''}`,
    `Print: ${slackText(creator.productSize || '-')} · ${slackText(creator.frameType || '-')}`,
    `Ships to: ${slackText([creator.shippingCity, creator.shippingState].filter(Boolean).join(', ') || 'address on file')}`,
    appUrl ? `\n\nReview & approve → ${appUrl}/creators` : '',
  ].filter(Boolean)
  await slackTo('creators', lines.join('\n'))
}
