/**
 * Hall of Fame watch: an order whose official marathon time would crack the
 * Trackstar Hall of Fame is flagged once, with an order comment and a Slack
 * line in #trackstar-alerts, so someone checks it and sends the $50 card
 * (support/hallOfFame.js) and updates the site.
 *
 * The board is the ten `hall_of_fame_athlete` metaobjects in Shopify (Male 1-5,
 * Female 1-5, marathon times to the minute), read here and never written. We
 * do not know a runner's sex from the order, so a time is checked against both
 * lists and the flag says which one it would make. A time on the same minute
 * as fifth place counts: the site rounds to the minute, so a person decides.
 *
 * Runs at the end of every auto-import. Each order is flagged once
 * (SystemConfig hall_of_fame_flag:<orderId>).
 */
import prisma from '../../db.js'
import { shopifyGraphQL } from '../../services/shopifyAuth.js'
import { slackTo, slackLink, slackText } from '../../lib/slack.js'
import { orderAppUrl } from '../../lib/links.js'

const FLAG = orderId => `hall_of_fame_flag:${orderId}`
const BOARD = `{ metaobjects(type: "hall_of_fame_athlete", first: 50) { nodes { fields { key value } } } }`
// Results found from the day this started. Older ones were checked by hand
// once on 2026-11-15 and reported to Matt, so the first run does not post
// a backlog to Slack.
const SINCE = new Date('2026-11-15T00:00:00Z')

/** "2:24" or "2:24:31" as seconds, or null. */
export function toSeconds(t) {
  const p = String(t || '').trim().split(':').map(Number)
  if (p.some(n => !Number.isFinite(n))) return null
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2]
  if (p.length === 2) return p[0] * 3600 + p[1] * 60
  return null
}

/** The board as { Male: [{ name, seconds }], Female: [...] }, fastest first. */
export async function readBoard() {
  const nodes = (await shopifyGraphQL(BOARD))?.metaobjects?.nodes || []
  const board = { Male: [], Female: [] }
  for (const n of nodes) {
    const f = Object.fromEntries((n.fields || []).map(x => [x.key, x.value]))
    const list = board[String(f.gender || '').trim()]
    const seconds = toSeconds(f.time_text)
    if (list && seconds != null) list.push({ name: String(f.name_text || '').trim(), seconds })
  }
  for (const k of Object.keys(board)) board[k].sort((a, b) => a.seconds - b.seconds)
  return board
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '')

// We do not know the runner's sex. Most sub-2:45 marathoners are men who
// only "make" the women's list, so a common man's first name skips that
// list (the men's list still applies). Anyone else, a person checks.
const MEN = new Set(`aaron adam aidan alan alec alex alexander andrew andy anthony austin ben benjamin barrett blake bobby brad braeden bradley brandon brendan brett brian bryce caleb cade cameron carl carlos carson chad charles charlie chase chris christian christopher cody cole colin conner connor corey craig dan daniel david derek dominic doug douglas drew dustin dylan ed eddie edward eli elijah eric ethan evan gabe gabriel garrett garth gary gavin george grant greg gregory hayden henry hunter ian isaac jack jackson jacob jake james jared jason jeff jeffrey jeremy jesse joe joel john jon jonathan jordan joseph josh joshua juan johnny jude justin keegan keith ken kevin kyle landon liam logan luis luke marcus mark matt matthew max michael miguel mike mitch mitchell nate nathan nathaniel nicholas nick noah owen patrick paul peter phil philip quinn reid richard rick rob robert roger ross ryan sam samuel scott sean seth shane spencer stephen steve steven thomas tim timothy todd tom tommy tony travis trevor tyler vincent wes will william zach zachary`.split(' '))
export const likelyMan = name => MEN.has(String(name || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, ''))

/**
 * Where a time would place on each list, or null where it would not. The
 * board shows minutes, so a finish counts against a listed time when it is
 * under the end of that minute (2:24:59 against "2:24").
 */
export function placings(seconds, board) {
  const out = {}
  for (const [sex, list] of Object.entries(board)) {
    if (!list.length) continue
    const beats = list.filter(r => seconds <= r.seconds + 59).length
    const place = list.length - beats + 1
    if (place <= 5) out[sex] = place
  }
  return out
}

export async function watchHallOfFame({ limit = 200 } = {}) {
  const found = await prisma.runnerResearch.findMany({
    where: { researchStatus: 'found', eventType: 'Marathon', officialTime: { not: null }, createdAt: { gte: SINCE } },
    select: { orderId: true, officialTime: true },
    orderBy: { createdAt: 'desc' },
    take: 2000,
  })
  // Sub-3:00 only: anything slower is nowhere near either list.
  const fast = found.filter(r => { const s = toSeconds(r.officialTime); return s != null && s < 3 * 3600 })
  if (!fast.length) return { flagged: 0 }
  const board = await readBoard()
  const onBoard = new Set([...board.Male, ...board.Female].map(r => norm(r.name)))
  let flagged = 0
  for (const r of fast.slice(0, limit)) {
    const where = placings(toSeconds(r.officialTime), board)
    if (!Object.keys(where).length) continue
    const key = FLAG(r.orderId)
    if (await prisma.systemConfig.findUnique({ where: { key } }).catch(() => null)) continue
    const order = await prisma.order.findUnique({ where: { id: r.orderId }, select: { id: true, runnerName: true, raceName: true, raceYear: true, lineItemIndex: true, parentOrderNumber: true, shopifyOrderData: true, trackstarOrderType: true } })
    if (!order || order.trackstarOrderType !== 'standard') continue
    if (onBoard.has(norm(order.runnerName))) { await mark(key, r); continue }
    if (likelyMan(order.runnerName)) delete where.Female
    if (!Object.keys(where).length) { await mark(key, r); continue }
    const either = ` (would place ${Object.entries(where).map(([sex, place]) => `${sex === 'Male' ? "men's" : "women's"} #${place}`).join(' / ')})`
    const ref = `${String(order.shopifyOrderData?.name || order.parentOrderNumber).replace(/^#/, '')}${order.lineItemIndex ? `-${order.lineItemIndex + 1}` : ''}`
    const text = `Possible Hall of Fame: ${r.officialTime} official marathon time${either}. Check the runner and the result; if it holds, send the $50 card from Email customer > Hall of Fame and add them to the Hall of Fame on the site.`
    await prisma.orderComment.create({ data: { orderId: order.id, text, authorName: 'Trackstar' } })
    await slackTo('alerts', `🏆 *Possible Hall of Fame:* ${slackLink(orderAppUrl(ref), `#${ref}`)} ${slackText(order.runnerName)}, ${slackText(order.raceName)} ${order.raceYear || ''}: *${slackText(r.officialTime)}*${slackText(either)}`).catch(() => {})
    await mark(key, r)
    flagged++
  }
  return { flagged }
}

async function mark(key, r) {
  const value = JSON.stringify({ time: r.officialTime, at: new Date().toISOString() })
  await prisma.systemConfig.upsert({ where: { key }, create: { key, value }, update: { value } })
}
