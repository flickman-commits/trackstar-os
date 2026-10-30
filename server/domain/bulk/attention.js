/**
 * Bulk runs that need someone, so they are not forgotten on the Bulk tab.
 *
 * A run counts from a week before its race until it is submitted to Artelo.
 * Each comes with what is still in the way (runners missing, the design not
 * approved, no co-branded file, research not done or not found), shown at
 * the top of the Standard orders view and posted to Slack each morning
 * (api/cron/bulk-runs.js), which also researches the runners once the race
 * has been run.
 */
import prisma from '../../db.js'
import { addressComplete, orgShipTo, researchPending } from './bulkOrders.js'
import { templateKey } from '../render/templates.js'
import { postSlack, slackText } from '../../lib/slack.js'

const DAY = 864e5
const LEAD_DAYS = 7
const APPROVED = ['approved_by_customer', 'final_pdf_uploaded', 'sent_to_production']
const TZ = 'America/New_York'
const day = d => new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ })

/** @returns {Promise<object[]>} open runs near or past race day, soonest due first */
export async function bulkNeedingAttention(now = new Date()) {
  const runs = await prisma.bulkOrder.findMany({
    where: { status: { not: 'submitted' }, raceDate: { not: null, lte: new Date(now.getTime() + LEAD_DAYS * DAY) } },
    orderBy: [{ dueDate: 'asc' }, { raceDate: 'asc' }],
    include: { assignee: { select: { firstName: true } } },
  })
  if (!runs.length) return []
  const runners = await prisma.order.findMany({
    where: { bulkOrderId: { in: runs.map(r => r.id) } },
    select: { bulkOrderId: true, shippingAddress: true, researchedAt: true, productionFileUrl: true, runnerResearch: { select: { researchStatus: true }, take: 1, orderBy: { createdAt: 'desc' } } },
  })
  const designs = await prisma.order.findMany({ where: { id: { in: runs.map(r => r.partnerOrderId).filter(Boolean) } }, select: { id: true, designStatus: true } })
  const templates = await prisma.printTemplate.findMany({ where: { key: { in: runs.map(r => templateKey(r.raceName, r.number)) } }, select: { key: true, lastCheckOk: true } })

  const out = []
  for (const run of runs) {
    const rs = runners.filter(r => r.bulkOrderId === run.id)
    const raced = run.raceDate.getTime() <= now.getTime()
    const namesOnly = Boolean(await orgShipTo(run))
    const researched = rs.filter(r => r.researchedAt).length
    const found = rs.filter(r => r.runnerResearch[0]?.researchStatus === 'found').length
    const files = rs.filter(r => r.productionFileUrl).length
    const blockers = []
    if (!run.paidAt) blockers.push('not paid')
    if (rs.length < run.quantity) blockers.push(`${rs.length} of ${run.quantity} runners entered`)
    const noAddress = namesOnly ? 0 : rs.filter(r => !addressComplete(r.shippingAddress)).length
    if (noAddress) blockers.push(`${noAddress} without an address`)
    if (run.partnerOrderId) {
      const d = designs.find(x => x.id === run.partnerOrderId)
      if (!d || !APPROVED.includes(d.designStatus)) blockers.push(d?.designStatus === 'in_revision' ? 'design in revision' : 'design not approved')
    }
    if (run.printKind === 'cobranded') {
      const t = templates.find(x => x.key === templateKey(run.raceName, run.number))
      if (!t) blockers.push('no co-branded production file')
      else if (t.lastCheckOk === false) blockers.push('production file failed its check')
    }
    if (raced) {
      if (researched < rs.length) blockers.push(`${rs.length - researched} not researched yet`)
      if (researched - found > 0) blockers.push(`${researched - found} not found`)
      if (found && files < rs.length) blockers.push(`${files} of ${rs.length} prints made`)
    }
    out.push({
      id: run.id, number: run.number, partnerName: run.partnerName, race: `${run.raceName} ${run.raceYear}`,
      raceDate: run.raceDate.toISOString(), dueDate: run.dueDate?.toISOString() || null, raced,
      // A run made after its due date (gifts for a race long past) is not overdue by that date.
      overdue: Boolean(run.dueDate && run.dueDate.getTime() < now.getTime() && run.createdAt < run.dueDate),
      quantity: run.quantity, entered: rs.length, researched, found, files,
      owner: run.assignee?.firstName || null, blockers,
    })
  }
  return out
}

/**
 * The morning pass: research runners for every run whose race is over, then
 * post one Slack message listing every run that needs attention.
 */
export async function bulkMorning({ budgetMs = 240_000, now = new Date() } = {}) {
  const started = Date.now()
  const researched = {}
  // Half a day after the start, so the timer has posted results.
  const raced = await prisma.bulkOrder.findMany({ where: { status: { not: 'submitted' }, raceDate: { not: null, lte: new Date(now.getTime() - DAY / 2) } }, orderBy: { dueDate: 'asc' } })
  for (const run of raced) {
    while (Date.now() - started < budgetMs) {
      const out = await researchPending(run, { limit: 5 })
      researched[run.number] = (researched[run.number] || 0) + out.done.length
      if (!out.done.length || !out.remaining) break
    }
  }
  const runs = await bulkNeedingAttention(now)
  if (runs.length && process.env.SLACK_PROOF_WEBHOOK_URL) {
    const lines = runs.map(r => {
      const when = r.raced ? `due ${r.dueDate ? day(r.dueDate) : 'unset'}${r.overdue ? ' (OVERDUE)' : ''}` : `race ${day(r.raceDate)}`
      const did = researched[r.number] ? ` Researched ${researched[r.number]} this morning.` : ''
      return `• *${slackText(r.number)} ${slackText(r.partnerName)}*, ${slackText(r.race)}, ${when}${r.owner ? `, ${slackText(r.owner)}` : ''}: ${r.blockers.length ? slackText(r.blockers.join(', ')) : 'ready to submit to Artelo'}.${did}`
    })
    await postSlack(process.env.SLACK_PROOF_WEBHOOK_URL, `:package: *Bulk orders this week* (Fulfillment > Bulk):\n${lines.join('\n')}`)
  }
  return { researched, runs: runs.map(r => ({ number: r.number, blockers: r.blockers })) }
}
