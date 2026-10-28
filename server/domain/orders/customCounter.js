/**
 * Custom designs made per designer in a month (Eastern time), for payouts.
 * See api/admin/custom-counter.js.
 *
 * A design counts in the month its first proof went to the customer, credited
 * to the designer assigned to the order. That is how the designers keep their
 * own lists ("sent for review"). It used to count the month the order was
 * sent to production, credited to whoever clicked that, which put Creed's
 * designs under Dan or Matt and moved a design's pay to whichever month the
 * customer approved it (October 2026: neither list matched). An order with
 * no proof (made before proofs, or by hand) falls back to when it was sent
 * to production.
 *
 * A repeat, a race we have designed before, pays the repeat rate. Decided automatically
 * (an earlier custom for the same race at the same distance) unless set by
 * hand in the counter (Order.designRepeat).
 */
import prisma from '../../db.js'

const TZ = 'America/New_York'
// Contractor rates (Notion "Contractor Rates"), cents per custom, new / repeat.
// Senior (head designer) $50 / $25, junior designer $40 / $20. A person's own
// rate, set in Settings > Custom Counter, wins (Creed: $50 / $25, agreed before
// the rate card). Anyone else (admins) is counted but not paid.
export const DEFAULT_RATES = { head_designer: { newCents: 5000, repeatCents: 2500 }, designer: { newCents: 4000, repeatCents: 2000 } }
export function ratesFor(u) {
  const d = (u && DEFAULT_RATES[u.role]) || { newCents: 0, repeatCents: 0 }
  return { newCents: u?.customRateCents ?? d.newCents, repeatCents: u?.customRepeatRateCents ?? d.repeatCents, custom: u?.customRateCents != null || u?.customRepeatRateCents != null }
}
const DESIGNERS = ['head_designer', 'designer']
const monthOf = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(d).slice(0, 7)

// Words that do not tell one race's design from another: sponsors, "marathon",
// years. "2026 Bank of America Chicago Marathon" and "Chicago Marathon" are
// one design; "Long Beach Half" and "Long Beach Marathon" are two.
const FILLER = new Set(['marathon', 'the', 'of', 'and', 'race', 'run', 'running', 'international', 'presented', 'by', 'bank', 'america', 'rbc', 'tcs', 'abbott', '2xu', 'guthrie', 'corning', 'new', 'york', 'custom', 'trackstar', 'print', 'any'])
function raceKey(name) {
  const s = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '')
  const half = /\bhalf\b|13\.1/.test(s)
  const words = s.replace(/[^a-z]+/g, ' ').split(' ').filter(w => w.length > 1 && !FILLER.has(w) && w !== 'half')
  return { half, words: new Set(words) }
}
function sameDesign(a, b) {
  if (a.half !== b.half || !a.words.size || !b.words.size) return false
  const [small, big] = a.words.size <= b.words.size ? [a.words, b.words] : [b.words, a.words]
  return [...small].every(w => big.has(w))
}

export async function customCounter(month) {
  // When each custom's design first went out: its first proof.
  const firsts = await prisma.$queryRaw`
    SELECT p."orderId" AS id, min(p."createdAt") AS first
    FROM "Proof" p JOIN "Order" o ON o.id = p."orderId"
    WHERE o."trackstarOrderType" = 'custom'
    GROUP BY p."orderId"`
  const firstProof = new Map(firsts.map(f => [f.id, new Date(f.first)]))

  const all = await prisma.order.findMany({
    where: { trackstarOrderType: 'custom' },
    select: {
      id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, runnerName: true, raceName: true, raceYear: true,
      customerName: true, isRushOrder: true, designStatus: true, designCompletedAt: true, designCompletedById: true, researchedAt: true,
      assigneeId: true, designRepeat: true, shopifyOrderData: true,
    },
  })
  const designedAt = o => firstProof.get(o.id)
    || (o.designStatus === 'sent_to_production' ? (o.designCompletedAt || o.researchedAt) : null)

  // Every custom designed before, oldest first, for the repeat check.
  const history = all.map(o => ({ id: o.id, at: designedAt(o), key: raceKey(o.raceName) })).filter(h => h.at).sort((a, b) => a.at - b.at)

  const users = await prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, role: true, customRateCents: true, customRepeatRateCents: true } })
  const byId = new Map(users.map(u => [u.id, u]))
  const groups = new Map()
  for (const o of all) {
    const at = designedAt(o)
    if (!at || monthOf(at) !== month) continue
    // The designer who made it: the assignee when that is a designer, else
    // whoever finished it.
    const assignee = o.assigneeId ? byId.get(o.assigneeId) : null
    const who = (assignee && DESIGNERS.includes(assignee.role) ? assignee.id : null) || o.designCompletedById || o.assigneeId || null
    if (!groups.has(who)) {
      const u = who ? byId.get(who) : null
      const r = ratesFor(u)
      groups.set(who, { userId: who, name: u ? `${u.firstName} ${u.lastName}`.trim() : 'Unattributed', rateCents: r.newCents, repeatRateCents: r.repeatCents, orders: [] })
    }
    const g = groups.get(who)
    const key = raceKey(o.raceName)
    const before = history.find(h => h.id !== o.id && h.at < at && sameDesign(h.key, key))
    const autoRepeat = Boolean(before)
    const repeat = o.designRepeat ?? autoRepeat
    const sd = o.shopifyOrderData
    const name = sd && typeof sd === 'object' && 'name' in sd ? String(sd.name) : `#${o.parentOrderNumber}`
    g.orders.push({
      id: o.id, orderNumber: o.orderNumber, display: name, item: o.lineItemIndex + 1,
      runnerName: o.runnerName, race: [o.raceName, o.raceYear].filter(Boolean).join(' '), customerName: o.customerName,
      rush: o.isRushOrder, completedAt: at.toISOString(), estimated: !firstProof.has(o.id),
      repeat, repeatSet: o.designRepeat !== null, autoRepeat,
      rateCents: repeat ? g.repeatRateCents : g.rateCents,
      sentToProduction: o.designStatus === 'sent_to_production',
    })
  }
  const designers = [...groups.values()]
    .map(g => ({ ...g, count: g.orders.length, repeats: g.orders.filter(o => o.repeat).length, payoutCents: g.orders.reduce((n, o) => n + o.rateCents, 0), orders: g.orders.sort((a, b) => a.completedAt.localeCompare(b.completedAt)) }))
    .sort((a, b) => (a.userId ? 0 : 1) - (b.userId ? 0 : 1) || b.count - a.count)
  return { month, total: designers.reduce((n, d) => n + d.count, 0), payoutCents: designers.reduce((n, d) => n + d.payoutCents, 0), designers }
}

/** Set (true/false) or clear (null, back to automatic) whether a custom is a repeat. */
export async function setDesignRepeat(orderId, repeat) {
  return prisma.order.update({ where: { id: String(orderId) }, data: { designRepeat: repeat === null ? null : Boolean(repeat) }, select: { id: true, designRepeat: true } })
}

/** Everyone paid per custom, with their rates, for the Rates editor. */
export async function customRates() {
  const users = await prisma.user.findMany({ where: { role: { in: Object.keys(DEFAULT_RATES) }, isActive: true }, select: { id: true, firstName: true, lastName: true, role: true, customRateCents: true, customRepeatRateCents: true }, orderBy: { firstName: 'asc' } })
  return users.map(u => ({ userId: u.id, name: `${u.firstName} ${u.lastName}`.trim(), level: u.role === 'head_designer' ? 'Senior' : 'Junior', ...ratesFor(u), defaults: DEFAULT_RATES[u.role] }))
}

/** Set a person's rates in cents; null puts one back to their level's default. */
export async function setCustomRates(userId, { newCents, repeatCents }) {
  const ok = v => v === null || (Number.isInteger(v) && v >= 0 && v <= 100000)
  if (!ok(newCents) || !ok(repeatCents)) throw new Error('Rates are whole cents between $0 and $1,000')
  return prisma.user.update({ where: { id: String(userId) }, data: { customRateCents: newCents, customRepeatRateCents: repeatCents }, select: { id: true } })
}
