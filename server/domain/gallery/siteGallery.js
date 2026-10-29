/**
 * Site Gallery: approved custom designs that can go up in "Our Favorite
 * Designs" on the custom product page (trackstar-art,
 * sections/trackstar-favorite-customs.liquid).
 *
 * Every custom the customer approved is a suggestion, unless the customer
 * answered No to "Can we feature this design on our site?" on the approval
 * page (Order.featureConsent). Designers star the ones they rate; starred
 * ones sit at the top of Settings > Site Gallery, where an admin adds each to
 * the site or skips it. The hand-picked images already in the theme stay
 * where they are; added designs show before them, newest first.
 *
 * On the site an added design is a Shopify metaobject entry of type
 * custom_gallery_item (segment, race, image). The image is uploaded to
 * Shopify Files when the app has the write_files scope; until then the entry
 * links the proof image in our own storage (image_url) and the theme uses
 * whichever is set.
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'

const TYPE = 'custom_gallery_item'
const API = { version: '2025-01' }
export const SEGMENTS = ['marathon', 'ultra', 'other']

/** Which tab a race belongs in, from its name: Ultras, Other (tri, bike), else Marathons. Changeable per design. */
export function guessSegment(raceName) {
  const s = String(raceName || '').toLowerCase()
  if (/\bultras?\b|\b(50|60|80|100|120|160|200)\s?(k|km|mi|mile|miler|miles|m)?\b|backyard|utmb/.test(s)) return 'ultra'
  if (/triathlon|ironman|70\.3|gran ?fondo|cycl|bike|ride\b|swim|duathlon|\bski|laps\b/.test(s)) return 'other'
  // Everything else is a road race (marathons, halves, 10Ks), most customs.
  return 'marathon'
}

const userName = u => (u ? `${u.firstName} ${u.lastName || ''}`.trim() : null)

/**
 * The approved design for each custom, newest approval first, with its pick.
 * @param {{ status?: 'suggested'|'live'|'skipped', limit?: number }} opts
 */
export async function listGallery({ status = 'suggested', limit = 120 } = {}) {
  const pickWhere = status === 'suggested'
    ? { OR: [{ galleryPick: null }, { galleryPick: { status: 'suggested' } }] }
    : { galleryPick: { status } }
  const orders = await prisma.order.findMany({
    where: {
      trackstarOrderType: 'custom',
      proofs: { some: { status: 'approved' } },
      // Null (approved before the question existed) counts as a yes; `not:
      // false` alone would drop those, since SQL compares NULL as unknown.
      AND: [pickWhere, ...(status === 'live' ? [] : [{ OR: [{ featureConsent: null }, { featureConsent: true }] }])],
    },
    select: {
      id: true, orderNumber: true, parentOrderNumber: true, runnerName: true, customerName: true,
      raceName: true, raceYear: true, featureConsent: true, shopifyOrderData: true, assigneeId: true,
      proofs: { where: { status: 'approved' }, orderBy: { updatedAt: 'desc' }, take: 1, select: { id: true, imageUrl: true, thumbnailUrl: true, version: true, updatedAt: true } },
      galleryPick: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 600,
  })
  const ids = new Set(orders.flatMap(o => [o.assigneeId, o.galleryPick?.starredById, o.galleryPick?.decidedById]).filter(Boolean))
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, firstName: true, lastName: true } })
  const byId = new Map(users.map(u => [u.id, u]))
  const items = orders
    .filter(o => o.proofs[0] && !/\.pdf(\?|$)/i.test(o.proofs[0].imageUrl))
    .map(o => {
      const p = o.galleryPick
      const proof = o.proofs[0]
      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        display: String(o.shopifyOrderData?.name || `#${o.parentOrderNumber}`),
        race: [o.raceName, o.raceYear].filter(Boolean).join(' '),
        runner: o.runnerName || o.customerName,
        designer: userName(byId.get(o.assigneeId)),
        imageUrl: proof.imageUrl,
        thumbnailUrl: proof.thumbnailUrl || proof.imageUrl,
        approvedAt: proof.updatedAt.toISOString(),
        consent: o.featureConsent,
        segment: p?.segment || guessSegment(o.raceName),
        starredBy: userName(byId.get(p?.starredById)),
        starredAt: p?.starredAt?.toISOString() || null,
        decidedBy: userName(byId.get(p?.decidedById)),
        decidedAt: p?.decidedAt?.toISOString() || null,
      }
    })
    .sort((a, b) => status === 'suggested'
      ? (b.starredAt ? 1 : 0) - (a.starredAt ? 1 : 0) || (b.starredAt || '').localeCompare(a.starredAt || '') || b.approvedAt.localeCompare(a.approvedAt)
      : (b.decidedAt || '').localeCompare(a.decidedAt || ''))
  const counts = await galleryCounts()
  return { items: items.slice(0, limit), counts }
}

async function galleryCounts() {
  const [live, skipped, starred] = await Promise.all([
    prisma.galleryPick.count({ where: { status: 'live' } }),
    prisma.galleryPick.count({ where: { status: 'skipped' } }),
    prisma.galleryPick.count({ where: { status: 'suggested', starredAt: { not: null } } }),
  ])
  return { live, skipped, starred }
}

/** One order's gallery state, for the star on the order. */
export async function pickForOrder(orderId) {
  const o = await prisma.order.findUnique({ where: { id: String(orderId) }, select: { featureConsent: true, galleryPick: { select: { status: true, starredAt: true, starredById: true } } } })
  if (!o) return null
  const p = o.galleryPick
  const by = p?.starredById ? await prisma.user.findUnique({ where: { id: p.starredById }, select: { firstName: true, lastName: true } }) : null
  return { consent: o.featureConsent, status: p?.status || 'suggested', starred: Boolean(p?.starredAt), starredBy: userName(by) }
}

/** A designer's star: "this one should be on the site". */
export async function setStar(orderId, userId, starred) {
  const data = starred ? { starredById: userId, starredAt: new Date() } : { starredById: null, starredAt: null }
  await prisma.galleryPick.upsert({ where: { orderId: String(orderId) }, update: data, create: { orderId: String(orderId), ...data } })
  return pickForOrder(orderId)
}

export async function setSegment(orderId, segment) {
  if (!SEGMENTS.includes(segment)) throw new GalleryError('Pick Marathons, Ultras or Other')
  const pick = await prisma.galleryPick.upsert({ where: { orderId: String(orderId) }, update: { segment }, create: { orderId: String(orderId), segment } })
  if (pick.status === 'live' && pick.metaobjectId) {
    await gql(`mutation($id: ID!, $m: MetaobjectUpdateInput!) { metaobjectUpdate(id: $id, metaobject: $m) { userErrors { message } } }`,
      { id: pick.metaobjectId, m: { fields: [{ key: 'segment', value: segment }] } }, 'metaobjectUpdate')
  }
  return { segment }
}

/** Something the admin should read (bad input, Shopify refused). */
export class GalleryError extends Error {
  constructor(message) { super(message); this.expose = true; this.status = 400 }
}

async function gql(query, variables, root) {
  const data = await shopifyGraphQL(query, variables, API)
  const errs = data?.[root]?.userErrors || []
  if (errs.length) throw new GalleryError(`Shopify: ${errs.map(e => e.message).join('; ')}`)
  return data[root]
}

let definitionReady = false
/** The metaobject type the theme reads, created the first time it is needed. */
async function ensureDefinition() {
  if (definitionReady) return
  const found = await shopifyGraphQL(`{ metaobjectDefinitionByType(type: "${TYPE}") { id } }`, {}, API)
  if (!found.metaobjectDefinitionByType) {
    await gql(`mutation($d: MetaobjectDefinitionCreateInput!) { metaobjectDefinitionCreate(definition: $d) { metaobjectDefinition { id } userErrors { message } } }`, {
      d: {
        type: TYPE,
        name: 'Custom gallery item',
        description: 'An approved custom design shown in Our Favorite Designs on the custom product page. Added and removed from TrackstarOS (Settings > Site Gallery).',
        displayNameKey: 'race',
        access: { storefront: 'PUBLIC_READ' },
        fieldDefinitions: [
          { key: 'race', name: 'Race', type: 'single_line_text_field' },
          { key: 'segment', name: 'Segment', type: 'single_line_text_field', description: 'marathon, ultra or other: the tab it shows under' },
          { key: 'image', name: 'Image', type: 'file_reference', validations: [{ name: 'file_type_options', value: '["Image"]' }] },
          { key: 'image_url', name: 'Image URL', type: 'url', description: 'Used when there is no uploaded image' },
          { key: 'added_at', name: 'Added', type: 'date_time' },
        ],
      },
    }, 'metaobjectDefinitionCreate')
  }
  definitionReady = true
}

/** Upload to Shopify Files; null when the app is not allowed to (no write_files). */
async function uploadImage(url, alt) {
  try {
    const out = await gql(`mutation($f: [FileCreateInput!]!) { fileCreate(files: $f) { files { id } userErrors { message } } }`,
      { f: [{ originalSource: url, contentType: 'IMAGE', alt }] }, 'fileCreate')
    return out.files?.[0]?.id || null
  } catch (error) {
    if (/ACCESS_DENIED|Access denied/.test(error.message)) return null
    throw error
  }
}

/** Put an approved custom on the site. */
export async function addToSite(orderId, userId, { segment } = {}) {
  const o = await prisma.order.findUnique({
    where: { id: String(orderId) },
    select: { id: true, raceName: true, raceYear: true, featureConsent: true, trackstarOrderType: true, galleryPick: true,
      proofs: { where: { status: 'approved' }, orderBy: { updatedAt: 'desc' }, take: 1, select: { imageUrl: true } } },
  })
  if (!o || o.trackstarOrderType !== 'custom') throw new GalleryError('That is not a custom order')
  if (o.featureConsent === false) throw new GalleryError('The customer asked us not to feature this design')
  if (o.galleryPick?.status === 'live') return { status: 'live' }
  const imageUrl = o.proofs[0]?.imageUrl
  if (!imageUrl) throw new GalleryError('This order has no approved design yet')
  const seg = SEGMENTS.includes(segment) ? segment : (o.galleryPick?.segment || guessSegment(o.raceName))
  const race = [o.raceName, o.raceYear].filter(Boolean).join(' ')

  await ensureDefinition()
  const fileId = await uploadImage(imageUrl, `${race} custom print`)
  const fields = [
    { key: 'race', value: race || 'Custom race' },
    { key: 'segment', value: seg },
    { key: 'added_at', value: new Date().toISOString() },
    fileId ? { key: 'image', value: fileId } : { key: 'image_url', value: imageUrl },
  ]
  const created = await gql(`mutation($m: MetaobjectCreateInput!) { metaobjectCreate(metaobject: $m) { metaobject { id } userErrors { message } } }`,
    { m: { type: TYPE, fields } }, 'metaobjectCreate')
  const data = { status: 'live', segment: seg, decidedById: userId, decidedAt: new Date(), metaobjectId: created.metaobject.id, shopifyFileId: fileId }
  await prisma.galleryPick.upsert({ where: { orderId: o.id }, update: data, create: { orderId: o.id, ...data } })
  return { status: 'live', segment: seg }
}

/** Skip a suggestion (it leaves the list), or put a skipped one back. */
export async function setSkipped(orderId, userId, skipped) {
  const data = skipped
    ? { status: 'skipped', decidedById: userId, decidedAt: new Date() }
    : { status: 'suggested', decidedById: null, decidedAt: null }
  await prisma.galleryPick.upsert({ where: { orderId: String(orderId) }, update: data, create: { orderId: String(orderId), ...data } })
  return { status: data.status }
}

/** Take a design off the site. It goes back to the suggestions. */
export async function removeFromSite(orderId) {
  const pick = await prisma.galleryPick.findUnique({ where: { orderId: String(orderId) } })
  if (!pick || pick.status !== 'live') return { status: pick?.status || 'suggested' }
  if (pick.metaobjectId) {
    await gql(`mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { message } } }`, { id: pick.metaobjectId }, 'metaobjectDelete')
  }
  if (pick.shopifyFileId) {
    await gql(`mutation($ids: [ID!]!) { fileDelete(fileIds: $ids) { deletedFileIds userErrors { message } } }`, { ids: [pick.shopifyFileId] }, 'fileDelete').catch(() => null)
  }
  await prisma.galleryPick.update({ where: { id: pick.id }, data: { status: 'suggested', metaobjectId: null, shopifyFileId: null, decidedById: null, decidedAt: null } })
  return { status: 'suggested' }
}
