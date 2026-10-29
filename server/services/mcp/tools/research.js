/**
 * Runner research for one order: look the runner up again, and accept one
 * of the finishers it suggested. Any signed-in person may, the same as the
 * order view (api/orders/research-runner.js, accept-match).
 */
import { z } from 'zod'
import prisma from '../../../../api/_lib/prisma.js'
import { ToolError } from '../server.js'
import { acceptMatch, AcceptMatchError } from '../../../domain/research/acceptMatch.js'
import { pipelinesFor } from '../../../domain/orders/pipelineStatus.js'
import { findOrdersByNumber, displayNumber, pickItem, pipelineShape } from './orders.js'
import { checkRateLimitDurable } from '../../../lib/publicRateLimit.js'
import { researchQueue, runResearchAgent } from '../../../domain/research/researchAgent.js'

const ITEM = z.number().int().min(1).optional().describe('Which item on a multi-item order; the first by default.')

function candidates(list) {
  return (Array.isArray(list) ? list : []).slice(0, 15).map((m, i) => ({ candidate: i + 1, name: m.name || null, bib: m.bib || null, time: m.time || null, pace: m.pace || null, event: m.eventType || null, city: m.city || undefined }))
}

const PER_RACE_PER_HOUR = 10
const HOUR = 60 * 60 * 1000

/**
 * A durable budget per race, shared by both tools and every key, so an agent
 * working through a race's orders cannot hammer its timing site (Sydney's
 * firewall blocked us after dozens of rapid loads).
 */
async function raceBudget(o) {
  const race = String(o.raceNameOverride || o.raceName || 'unknown').trim().toLowerCase()
  const limit = await checkRateLimitDurable(race, { bucket: 'mcp-research-race', max: PER_RACE_PER_HOUR, windowMs: HOUR })
  if (!limit.allowed) {
    throw new ToolError(`Research for ${o.raceNameOverride || o.raceName} has run ${PER_RACE_PER_HOUR} times this hour already. Try again in ${Math.max(1, Math.ceil(limit.retryAfterMs / 60000))} minute(s).`)
  }
}

async function standardItem(orderNumber, item) {
  const rows = (await findOrdersByNumber(orderNumber)).filter(o => o.trackstarOrderType === 'standard')
  if (!rows.length) throw new ToolError(`No standard order matching "${orderNumber}".`)
  const o = pickItem(rows, item)
  return { o, n: displayNumber(o) + (o.lineItemIndex ? `-${o.lineItemIndex + 1}` : '') }
}

export const researchTools = [
  {
    name: 'rerun_research',
    title: 'Re-run research',
    description: 'Look one order\'s runner up on the results site again. Answers with what was found, or the candidates to pick from with accept_match.',
    scope: 'write',
    readOnly: false,
    openWorld: true,
    input: { orderNumber: z.string().max(40), item: ITEM },
    async handler({ orderNumber, item }) {
      const { o, n } = await standardItem(orderNumber, item)
      await raceBudget(o)
      // Loaded here, not at the top: it brings the scrapers (and Puppeteer) with it.
      const { researchService } = await import('../../../services/ResearchService.js')
      let out
      try { out = await researchService.researchOrder(o.orderNumber) }
      catch (err) {
        if (/No scraper available/.test(String(err?.message))) throw new ToolError(`There is no scraper for ${o.raceNameOverride || o.raceName}. A developer adds one, or research the runner by hand.`)
        throw err
      }
      const r = out.runnerResearch
      const pipeline = (await pipelinesFor([o.id])).get(o.id)
      return {
        summary: `Re-ran research for ${n}: ${r.researchStatus}`,
        orderNumber: n,
        status: r.researchStatus,
        result: r.researchStatus === 'found' ? { bib: r.bibNumber || null, time: r.officialTime || null, pace: r.officialPace || null, event: r.eventType || null } : undefined,
        notes: r.researchNotes || undefined,
        candidates: r.possibleMatches?.length ? candidates(r.possibleMatches) : undefined,
        pipeline: pipelineShape(pipeline),
      }
    },
  },
  {
    name: 'accept_match',
    title: 'Accept match',
    description: 'Save one of the finishers research suggested as the order\'s result: a candidate number from rerun_research, or the match itself.',
    scope: 'write',
    readOnly: false,
    openWorld: true,
    input: {
      orderNumber: z.string().max(40),
      item: ITEM,
      candidate: z.number().int().min(1).optional().describe('The candidate number from rerun_research.'),
      match: z.object({
        name: z.string().min(1).max(120),
        bib: z.string().max(20).optional(),
        time: z.string().max(20).optional(),
        pace: z.string().max(20).optional(),
        eventType: z.string().max(60).optional(),
        resultsUrl: z.string().url().max(500).optional(),
      }).optional().describe('The finisher, when it is not one of the candidates.'),
    },
    async handler({ orderNumber, item, candidate, match }) {
      if (!candidate === !match) throw new ToolError('Give either a candidate number or a match, not both.')
      const { o, n } = await standardItem(orderNumber, item)
      let pick = match
      if (candidate) {
        const latest = await prisma.runnerResearch.findFirst({ where: { orderId: o.id }, orderBy: { createdAt: 'desc' }, select: { possibleMatches: true } })
        const list = Array.isArray(latest?.possibleMatches) ? latest.possibleMatches : []
        if (!list.length) throw new ToolError(`${n} has no candidates on file. Run rerun_research first.`)
        pick = list[candidate - 1]
        if (!pick) throw new ToolError(`${n} has ${list.length} candidate(s); there is no number ${candidate}.`)
      }
      await raceBudget(o)
      let r
      try { r = await acceptMatch({ orderNumber: o.orderNumber, match: pick }) }
      catch (err) {
        if (err instanceof AcceptMatchError) throw new ToolError(err.status === 404 ? `${n} has not been researched yet. Run rerun_research first.` : 'That match is missing what it needs.')
        throw err
      }
      return {
        summary: `Accepted ${pick.name} as the result for ${n}`,
        orderNumber: n,
        accepted: { name: pick.name, bib: r.bibNumber || null, time: r.officialTime || null, pace: r.officialPace || null, event: r.eventType || null },
        status: 'ready',
      }
    },
  },
  {
    name: 'research_queue',
    title: 'Research queue',
    description: 'The Action queue items that are a runner result to look up (Runner not found, Timing site down, No time, No bib, Needs a scraper, Research by hand...), with what research has on each and the research agent\'s last note.',
    scope: 'read',
    readOnly: true,
    input: {},
    async handler() {
      const q = await researchQueue()
      return {
        count: q.length,
        items: q.map(i => ({ orderNumber: i.display, reason: i.reason, runner: i.runner, race: i.race, year: i.year, hasScraper: i.hasScraper, research: i.research || undefined, lastAgentNote: i.lastAgentNote?.text?.slice(0, 300) || undefined })),
      }
    },
  },
  {
    name: 'run_research_agent',
    title: 'Run research agent',
    description: 'Work the research queue on the server: research again through the scraper, try other spellings of the name, and for races with no scraper look for the official results page on the web. A time is written only when our server read it off the official page (chip time, the page\'s own pace); everything else becomes a note on the order for a person. Pre-2020 years go to the web step (no scraper is built for them). dryRun looks without writing.',
    scope: 'write',
    readOnly: false,
    openWorld: true,
    input: {
      orderNumbers: z.array(z.string().max(40)).max(20).optional().describe('Only these orders (and ignore the one-note-a-week rule for them).'),
      limit: z.number().int().min(1).max(25).default(10),
      dryRun: z.boolean().default(false),
    },
    async handler({ orderNumbers, limit = 10, dryRun = false }, { principal }) {
      const actor = principal?.user ? { id: principal.user.id, email: principal.user.email } : { isSystem: true, email: 'mcp' }
      return runResearchAgent({ orderNumbers: orderNumbers || null, limit, dryRun, actor })
    },
  },
]
