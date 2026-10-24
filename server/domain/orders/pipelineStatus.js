/**
 * Everything pipelineFor (./pipeline.js) needs to know about the world, and
 * the pipeline for a set of standard orders by id. The orders list
 * (api/orders/index.js) loads the context once per request; the MCP tools
 * use pipelinesFor for a page of orders or the whole open backlog.
 */
import prisma from '../../db.js'
import { pipelineFor } from './pipeline.js'
import { unpaidPhotoRows } from './photoPayment.js'
import { noTimeGaps, onlineWorkers } from '../render/templates.js'
import { getCanonicalRaceName, hasScraperForRace } from '../../scrapers/index.js'
import { ensureOverridesLoaded } from '../../scrapers/scraperOverrides.js'

/** Race rows, checked production files, NO TIME gaps, and whether a render worker is on. */
export async function loadPipelineContext() {
  const [raceRows, okTemplates, gaps, workers] = await Promise.all([
    prisma.race.findMany(),
    prisma.printTemplate.findMany({ where: { enabled: true, lastCheckOk: true }, select: { key: true } }),
    noTimeGaps(),
    onlineWorkers(),
  ])
  const raceByKey = new Map(raceRows.map(r => [`${r.raceName}|${r.year}`, r]))
  const raceFor = (name, year) => {
    if (!name || !year) return null
    return raceByKey.get(`${name}|${year}`) || raceByKey.get(`${getCanonicalRaceName(name) || name}|${year}`) || null
  }
  return { raceFor, templateKeys: new Set(okTemplates.map(t => t.key)), gaps, workerOnline: workers.length > 0 }
}

/**
 * The pipeline ({ stage, reason, kind?, fix? }) of each standard order in
 * `ids`, computed the way the orders list computes it. Other types are left out.
 * @returns {Promise<Map<string, object>>}
 */
export async function pipelinesFor(ids) {
  const out = new Map()
  if (!ids.length) return out
  await ensureOverridesLoaded()
  const [ctx, orders] = await Promise.all([
    loadPipelineContext(),
    prisma.order.findMany({
      where: { id: { in: ids }, trackstarOrderType: 'standard' },
      include: {
        runnerResearch: { include: { race: true }, orderBy: { createdAt: 'desc' } },
        renderJobs: { orderBy: { version: 'desc' }, take: 1, select: { status: true, review: true, error: true, reviewNote: true, sendAfter: true, sendHeldAt: true, sendHeldBy: true, sendError: true, arteloSentAt: true } },
      },
      omit: { shopifyOrderData: true, etsyOrderData: true, arteloOrderData: true },
    }),
  ])

  // A photo attached by hand is unpaid until Shopify carries a paid add-on for it.
  // Only the orders with such a photo need their siblings and the Shopify payment.
  const parents = [...new Set(orders.filter(o => o.photoAddedManually).map(o => o.parentOrderNumber))]
  const unpaid = new Set()
  if (parents.length) {
    const siblings = await prisma.order.findMany({
      where: { parentOrderNumber: { in: parents } },
      select: { id: true, parentOrderNumber: true, photoPath: true, photoAddedManually: true, lineItemIndex: true, trackstarOrderType: true },
      orderBy: { lineItemIndex: 'asc' },
    })
    const pay = await prisma.$queryRaw`SELECT DISTINCT ON ("parentOrderNumber") "parentOrderNumber" AS p, "shopifyOrderData"::jsonb->'financial_status' AS fs, "shopifyOrderData"::jsonb->'line_items' AS li FROM "Order" WHERE "parentOrderNumber" = ANY(${parents}) ORDER BY "parentOrderNumber", "lineItemIndex" ASC`
    const payment = new Map(pay.map(r => [r.p, { financial_status: r.fs, line_items: r.li }]))
    for (const p of parents) {
      const rows = siblings.filter(s => s.parentOrderNumber === p && (s.photoAddedManually || s.photoPath))
      for (const id of unpaidPhotoRows(rows, payment.get(p) || null)) unpaid.add(id)
    }
  }

  for (const o of orders) {
    const research = o.runnerResearch?.find(r => r.researchStatus === 'found') || o.runnerResearch?.[0] || null
    const race = research?.race || ctx.raceFor(o.raceNameOverride ?? o.raceName, o.yearOverride ?? o.raceYear)
    out.set(o.id, pipelineFor({
      order: o, research, race, render: o.renderJobs?.[0] || null,
      hasScraper: hasScraperForRace(o.raceNameOverride ?? o.raceName),
      templates: ctx.templateKeys, noTimeGaps: ctx.gaps, photoUnpaid: unpaid.has(o.id), workerOnline: ctx.workerOnline,
    }))
  }
  return out
}
