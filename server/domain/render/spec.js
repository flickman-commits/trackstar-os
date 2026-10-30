/**
 * What goes on the print, and whether an order is ready to be rendered.
 *
 * The render worker never looks anything up: it gets a spec and fills the
 * template. So the spec is the whole contract, and buildSpec is the one
 * place that decides an order qualifies. An order qualifies only when the
 * tool already has everything: a verified or hand-entered result (or the
 * customer asked for no time), the race's date and weather, a size we have
 * artboards for, a template for the race, and a paid photo if there is one.
 * Everything else stays with the designers, as today.
 */
import { formatRaceDate, formatTemp, formatTime, formatPace, formatCondition } from '../../lib/printFormat.js'
import { unpaidPhotoRows } from '../orders/photoPayment.js'
import { printBlockers } from '../races/verification.js'
import { isMainEvent, getCanonicalRaceName, namedEventsFor } from '../../scrapers/index.js'

export const SIZES = ['8x10', '12x18', '16x24']

/**
 * Which design a print uses. The World Majors edition is a different design
 * sold as its own product ("Personalized Chicago World Major Race Poster"),
 * rendered from its own template, so it is its own template key:
 * "Chicago Marathon / World Majors". Everything else is the race's standard print.
 */
function isBulkCobranded(order) {
  return order.trackstarOrderType === 'bulk' && order.bulkOrder?.printKind === 'cobranded' && Boolean(order.bulkOrder?.number)
}

export function editionOf(order) {
  const items = Array.isArray(order.shopifyOrderData?.line_items) ? order.shopifyOrderData.line_items : []
  // The row's position is in Artelo's item list; Artelo's item id is the Shopify
  // line id. Match by id: after an order edit Shopify still lists the removed
  // line, so its positions no longer line up with Artelo's.
  const itemId = order.arteloOrderData?.orderItems?.[order.lineItemIndex]?.orderItemId
  const li = (itemId && items.find(l => String(l.id) === String(itemId))) || items[order.lineItemIndex] || null
  const title = String(li?.title || li?.name || '')
  return /world\s*major/i.test(title) ? 'World Majors' : null
}

export function templateKey(raceName, edition) {
  return edition ? `${raceName} / ${edition}` : raceName
}

/** The standard name for an event, as template keys spell it. */
export function eventLabel(eventType) {
  const e = String(eventType || '').trim()
  if (/half/i.test(e)) return 'Half Marathon'
  if (/^10\s*k$/i.test(e)) return '10K'
  if (/^5\s*k$/i.test(e)) return '5K'
  if (/10\s*mile/i.test(e)) return '10 Miler'
  return e
}

/**
 * Which production file a print uses. A race's main event (the marathon, or
 * the event a race is named for) is "<race>"; any other event at the race has
 * its own file, "<race> / Half Marathon", "<race> / 10K". The World Majors
 * edition stacks in front: "Chicago Marathon / World Majors".
 */
/**
 * The production file for an order, given the files that exist: its race name
 * as written first, then the race's standard name, so an order that says
 * "Chicago" finds the "Chicago Marathon" file. Exact names win, so a race
 * keyed by its own spelling never moves.
 */
export function resolveTemplate(order, raceName, eventType, has) {
  const exact = templateFor(order, raceName, eventType)
  if (has(exact)) return exact
  const canonical = getCanonicalRaceName(raceName)
  if (canonical && canonical !== raceName) {
    const alt = templateFor(order, canonical, eventType)
    if (has(alt)) return alt
  }
  return exact
}

export function templateFor(order, raceName, eventType) {
  // A co-branded bulk line renders from its own uploaded file, keyed by its run (templates.js).
  if (isBulkCobranded(order)) return templateKey(raceName, order.bulkOrder.number)
  const edition = editionOf(order)
  // A named event (Detroit's International / Motor City halves) keeps its own name, so each gets its own file.
  const named = namedEventsFor(raceName).some(e => e.label === eventType)
  const ev = eventType && !isMainEvent(raceName, eventType) ? (named ? eventType : eventLabel(eventType)) : null
  return templateKey(raceName, [edition, ev].filter(Boolean).join(' / ') || null)
}

/** The order fields buildSpec reads. Use this select so callers cannot forget one. */
export const SPEC_SELECT = {
  id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, trackstarOrderType: true, status: true,
  raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true,
  runnerName: true, runnerNameOverride: true, productSize: true, hadNoTime: true,
  photoPath: true, photoAddedManually: true, photoFree: true, shopifyOrderData: true, arteloOrderData: true, lineItemIndex: true,
  bulkOrder: { select: { number: true, paidAt: true, printKind: true } },
  runnerResearch: { orderBy: { id: 'desc' }, select: { researchStatus: true, bibNumber: true, officialTime: true, officialPace: true, eventType: true, race: { select: { id: true, raceDate: true, raceDateSource: true, raceDateSourceUrl: true, raceDateEvidence: true, raceDateVerifiedAt: true, raceDateConfirmedByPerson: true, location: true, weatherCondition: true, weatherTemp: true, weatherFetchedAt: true, weatherConfirmedAt: true, firstPrintedAt: true } } } },
}

/**
 * @param order  an order loaded with SPEC_SELECT
 * @param templates  race names some online worker has a template for
 * @param noTimeGaps  "template|size" pairs that cannot print a no-time order yet (templates.js noTimeGaps)
 * @param raceRow  the Race row for this order's race and year, for orders that were never
 *                 researched (Instant Lookup verified them at checkout) and so have no
 *                 research record to reach the race through
 * @returns {{ ok: boolean, reasons: string[], spec: object|null }}
 */
export function buildSpec(order, templates = [], raceRow = null, noTimeGaps = new Set()) {
  const reasons = []
  const raceName = order.raceNameOverride ?? order.raceName
  const raceYear = order.yearOverride ?? order.raceYear
  const name = (order.runnerNameOverride ?? order.runnerName ?? '').trim()

  // A bulk order of standard prints (our race design) renders like a shop order;
  // a co-branded one from its own production file (server/domain/bulk/billing.js).
  // It renders once the order has an uploaded production file (templates.js).
  const bulkStandard = order.trackstarOrderType === 'bulk' && ['standard', 'cobranded'].includes(order.bulkOrder?.printKind)
  // An overseas sample (server/domain/samples/sampleDesign.js) is our standard race print too.
  if (!['standard', 'sample'].includes(order.trackstarOrderType) && !bulkStandard) reasons.push('Only standard race prints are rendered')
  if (!SIZES.includes(order.productSize)) reasons.push(`No artboard for size "${order.productSize}"`)
  const edition = editionOf(order)
  const research0 = order.runnerResearch?.find(r => r.researchStatus === 'found') || order.runnerResearch?.[0]
  const template = resolveTemplate(order, raceName, research0?.eventType, k => templates.includes(k))
  const eventTag = template.includes(' / ') && !edition && !isBulkCobranded(order) ? eventLabel(research0?.eventType) : null
  if (!templates.includes(template)) reasons.push(isBulkCobranded(order) ? `No checked co-branded production file for ${order.bulkOrder.number} yet` : `No prepared template for ${template}`)
  if (!name) reasons.push('No runner name')

  const research = order.runnerResearch?.find(r => r.researchStatus === 'found') || order.runnerResearch?.[0]
  const race = research?.race || raceRow
  // The research record is the only source of a result (customerResults.js).
  const bib = research?.bibNumber || null
  const time = formatTime(research?.officialTime)
  const pace = formatPace(research?.officialPace)
  if (!bib) reasons.push('No bib number yet')
  if (!order.hadNoTime && (!time || !pace)) reasons.push('No finish time and pace yet')
  if (order.photoPath && noTimeGaps.has(`photo|${template}|${order.productSize}`)) reasons.push(`The ${order.productSize} design has no photo window, so a print with a customer photo is made by hand`)
  if (order.hadNoTime && noTimeGaps.has(`${template}|${order.productSize}`)) reasons.push(`This ${order.productSize} design has details to the right of pace, so a no-time print needs a NO TIME layer in the file first`)

  const date = formatRaceDate(race?.raceDate)
  const condition = formatCondition(race?.weatherCondition)
  const temp = formatTemp(race?.weatherTemp)
  // Hard gate: a date prints only with evidence on file, and weather only when computed for that date.
  for (const b of printBlockers(race)) reasons.push(b)

  if (order.photoPath && order.shopifyOrderData) {
    const unpaid = unpaidPhotoRows([order], order.shopifyOrderData)
    if (unpaid.size) reasons.push('Photo add-on is not paid yet')
  }

  if (reasons.length) return { ok: false, reasons, spec: null }
  return {
    ok: true,
    reasons: [],
    spec: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      displayNumber: displayNumber(order),
      race: raceName,
      edition,
      template,
      raceYear,
      size: order.productSize,
      name,
      bib,
      time: order.hadNoTime ? null : time,
      pace: order.hadNoTime ? null : pace,
      noTime: Boolean(order.hadNoTime),
      date,
      condition,
      temp,
      photoPath: order.photoPath || null,
      raceId: race?.id || null,
      // Carried on the render so the review shows what the print was made from.
      dateSource: race?.raceDateSource || null,
      dateSourceUrl: race?.raceDateSourceUrl || null,
      // The filename convention the shop uses: 4551_Chicago_Bogard
      file: `${displayNumber(order)}${order.lineItemIndex ? `-${order.lineItemIndex + 1}` : ''}_${shortRace(raceName)}${edition ? '_WM' : ''}${eventTag ? `_${eventTag.replace(/ Marathon$/, '').replace(/\s+/g, '')}` : ''}_${lastName(name)}`,
    },
  }
}

function displayNumber(order) {
  const n = order.shopifyOrderData && typeof order.shopifyOrderData === 'object' && order.shopifyOrderData.name
  return String(n || order.parentOrderNumber).replace('#', '')
}

function shortRace(raceName) {
  return String(raceName || '').replace(/\s+Marathon$/i, '').replace(/[^A-Za-z0-9]+/g, '')
}

function lastName(name) {
  const parts = name.split(/\s+/)
  return parts[parts.length - 1].replace(/[^A-Za-z\-]/g, '') || 'Runner'
}
