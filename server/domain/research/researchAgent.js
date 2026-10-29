/**
 * The research agent: works through the Action queue's research items (Runner
 * not found, Timing site down, No time, No bib, Needs a scraper...) the way a
 * person would, and either fills in the result or leaves a note on the order
 * saying what it found and why a person has to finish it.
 *
 * Per order, in this order:
 *   1. Before 2020: left alone. Those years are researched by hand.
 *   2. The race has a scraper: run research again (ResearchService, the same
 *      lookup the import runs). A result the scraper reads is the official
 *      page through code that passed the add-race-scraper gates. Still not
 *      found: try other spellings of the name (no middle name, nickname), and
 *      save any finisher they turn up as a suggestion with an Accept button.
 *      A suggestion is never saved as the result: it is not the name ordered.
 *   3. No scraper (or the year is not wired up): ask the model to find the
 *      official results page and the runner's row (server/lib/llm.js, so the
 *      provider can change; web search needs Anthropic). The server fetches
 *      that page itself and agentRules.checkRowOnPage decides. Only a pass is
 *      written; anything else is a note with the evidence.
 *
 * Every note is an order comment from "Research agent", so a person sees it
 * where they work, and the agent does not try the same order again for a
 * week unless asked to by number. Runs from the daily cron
 * (api/cron/research-agent.js), the MCP tool run_research_agent, and
 * scripts/research-agent.js.
 */
import prisma from '../../db.js'
import { pipelinesFor } from '../orders/pipelineStatus.js'
import { hasScraperForRace, getCanonicalRaceName } from '../../scrapers/index.js'
import { ensureOverridesLoaded } from '../../scrapers/scraperOverrides.js'
import { checkRateLimitDurable } from '../../lib/publicRateLimit.js'
import { fetchTimingPage } from '../../lib/scraperTrace.js'
import { complete, canSearch, isLlmConfigured } from '../../lib/llm.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { RESEARCH_REASONS, planFor, nameVariants, sameName, checkRowOnPage } from './agentRules.js'

export const AGENT_NAME = 'Research agent'
const DAY = 24 * 60 * 60 * 1000
const QUIET_DAYS = 7
// Shared with the MCP research tools (server/services/mcp/tools/research.js):
// one budget per race, so no caller can hammer a timing site.
const PER_RACE_PER_HOUR = 10

const effective = o => ({
  runner: o.runnerNameOverride || o.runnerName,
  race: o.raceNameOverride ?? o.raceName,
  year: o.yearOverride ?? o.raceYear,
})

/**
 * The open standard orders whose Action-queue reason is a result to look up,
 * with what is known about each. Newest research row only.
 */
export async function researchQueue() {
  await ensureOverridesLoaded()
  const rows = await prisma.order.findMany({
    where: { trackstarOrderType: 'standard', status: { not: 'completed' } },
    select: {
      id: true, orderNumber: true, parentOrderNumber: true, lineItemIndex: true, runnerName: true, runnerNameOverride: true,
      raceName: true, raceNameOverride: true, raceYear: true, yearOverride: true, customerBib: true, hadNoTime: true,
      runnerResearch: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, researchStatus: true, source: true, researchNotes: true, resultsUrl: true, bibNumber: true, officialTime: true, officialPace: true, eventType: true, possibleMatches: true } },
      comments: { where: { authorName: AGENT_NAME }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, text: true } },
    },
  })
  const pipelines = await pipelinesFor(rows.map(r => r.id))
  const names = new Map((await prisma.$queryRaw`SELECT id, "shopifyOrderData"::jsonb->>'name' AS name FROM "Order" WHERE id = ANY(${rows.map(r => r.id)})`).map(r => [r.id, r.name]))
  const out = []
  for (const o of rows) {
    const p = pipelines.get(o.id)
    if (p?.stage !== 'action' || !RESEARCH_REASONS.has(p.reason)) continue
    const e = effective(o)
    const r = o.runnerResearch[0] || null
    out.push({
      id: o.id,
      orderNumber: o.orderNumber,
      display: String(names.get(o.id) || o.parentOrderNumber).replace(/^#/, '') + (o.lineItemIndex ? `-${o.lineItemIndex + 1}` : ''),
      reason: p.reason,
      ...e,
      hasScraper: e.race ? hasScraperForRace(e.race) : false,
      customerBib: o.customerBib || null,
      research: r && {
        status: r.researchStatus, source: r.source, notes: r.researchNotes || null, resultsUrl: r.resultsUrl || null,
        bib: r.bibNumber || null, time: r.officialTime || null, pace: r.officialPace || null, eventType: r.eventType || null,
        candidates: Array.isArray(r.possibleMatches) ? r.possibleMatches.length : 0,
      },
      lastAgentNote: o.comments[0] ? { at: o.comments[0].createdAt, text: o.comments[0].text } : null,
    })
  }
  return out
}

async function raceBudget(race) {
  const limit = await checkRateLimitDurable(String(race || 'unknown').trim().toLowerCase(), { bucket: 'mcp-research-race', max: PER_RACE_PER_HOUR, windowMs: 60 * 60 * 1000 })
  return limit.allowed
}

async function note(orderId, text, dryRun) {
  if (dryRun) return
  await prisma.orderComment.create({ data: { orderId, text: `${AGENT_NAME}: ${text}`.slice(0, 2000), authorId: null, authorName: AGENT_NAME } })
}

/** Step 2: research again through the race's scraper, then other spellings of the name. */
async function viaScraper(item, { dryRun }) {
  const { researchService } = await import('../../services/ResearchService.js')
  let status, r
  if (dryRun) {
    r = await researchService.findRunner(item.race, item.year, item.runner, { bib: item.research?.bib || item.customerBib || null })
    status = r.researchStatus || (r.found ? 'found' : r.ambiguous ? 'ambiguous' : 'not_found')
  } else {
    const res = await researchService.researchOrder(item.orderNumber)
    r = res.runnerResearch
    status = r.researchStatus
  }
  const after = dryRun ? null : (await pipelinesFor([item.id])).get(item.id)
  const cleared = dryRun ? (status === 'found' && (r.officialTime || r.bibNumber)) : !(after?.stage === 'action' && RESEARCH_REASONS.has(after.reason))
  if (cleared) return { outcome: 'cleared', detail: `research ran again: ${r.bibNumber ? `bib ${r.bibNumber}, ` : ''}${r.officialTime || 'no time'}${r.officialPace ? `, ${r.officialPace}/mi` : ''}`, url: r.resultsUrl || null }
  if (status === 'year_not_configured' || status === 'no_scraper') return { outcome: 'no_scraper_year' }
  if (status === 'upstream_error') return { outcome: 'person', text: `Ran research again and the timing site still failed (${(r.researchNotes || 'no detail').slice(0, 160)}). It tries again later.`, quiet: true }
  if (status !== 'not_found') return { outcome: 'person', text: `Ran research again: ${status}. ${after?.fix || r.researchNotes || ''}`.trim() }

  // Other spellings. Each is one more search on the timing site, so the budget applies.
  const found = []
  for (const v of nameVariants(item.runner)) {
    if (!(await raceBudget(item.race))) break
    const hit = await researchService.findRunner(item.race, item.year, v, { skipLastNameFallback: true }).catch(() => null)
    if (hit?.found) found.push({ name: hit.runnerName || hit.rawData?.name || v, bib: hit.bibNumber || null, time: hit.officialTime || null, pace: hit.officialPace || null, eventType: hit.eventType || null, resultsUrl: hit.resultsUrl || null, searched: v })
  }
  if (!found.length) return { outcome: 'person', text: `Ran research again and tried ${nameVariants(item.runner).join(', ') || 'no other spellings'}: ${item.runner} is not in the ${item.race} ${item.year} results. Check the name and year with the customer.` }
  if (!dryRun) {
    const latest = await prisma.runnerResearch.findFirst({ where: { orderId: item.id }, orderBy: { createdAt: 'desc' }, select: { id: true, possibleMatches: true } })
    if (latest) {
      const have = Array.isArray(latest.possibleMatches) ? latest.possibleMatches : []
      const merged = [...found.map(({ searched: _s, ...m }) => m), ...have.filter(h => !found.some(f => f.bib && f.bib === h.bib))]
      await prisma.runnerResearch.update({ where: { id: latest.id }, data: { possibleMatches: merged.slice(0, 15) } })
    }
  }
  const list = found.map(f => `"${f.name}" (searched as ${f.searched})${f.bib ? `, bib ${f.bib}` : ''}${f.time ? `, ${f.time}` : ''}`).join('; ')
  return { outcome: 'suggested', text: `${item.runner} is not in the results under that name, but ${list} is. It is on the order as a suggestion: confirm it is the same person (ask the customer if unsure), then Accept.` }
}

const SYSTEM = `You find one runner's race result on the race's official results page.
Rules:
- Only the official results: the timing company the race uses that year (Athlinks, RunSignup, ChronoTrack, MikaTiming, mychiptime, Race Roster, SportStats and the like) or the race's own results site. Never MarathonGuide, Strava, news, blogs or social media.
- Timing companies change from year to year. Search "<race> <year> results" first.
- The time is the chip (net) finish time, never gun or clock time. If the page only shows one time and does not say which, say so in notes.
- Copy the time, pace and bib exactly as the page shows them. If the page shows no pace, leave pace empty. Never calculate anything.
- resultsUrl must be the page that shows this runner's row: their individual result page if there is one, otherwise the results list filtered to them.
- If you are not sure it is the same person, set found to false and explain in notes.`

/** Step 3: the web, checked on our own fetch of the page. */
async function viaWeb(item, { dryRun }) {
  if (!isLlmConfigured() || !canSearch()) return { outcome: 'untouched', detail: 'no model with web search configured' }
  const prompt = `Race: ${item.race}
Year: ${item.year}
Runner: ${item.runner}${item.customerBib || item.research?.bib ? `\nBib the customer gave: ${item.customerBib || item.research.bib}` : ''}${item.research?.time ? `\nTime the customer gave (unverified): ${item.research.time}` : ''}

Return JSON: { "found": boolean, "resultsUrl": string|null, "nameOnPage": string|null, "bib": string|null, "chipTime": string|null, "pace": string|null, "eventType": "Marathon"|"Half Marathon"|"10K"|"5K"|null, "timingCompany": string|null, "notes": string }`
  let claim, sources = []
  try {
    const res = await complete({ system: SYSTEM, prompt, json: true, webSearch: true, maxSearches: 6, effort: 'medium', maxTokens: 3000, purpose: 'research.agent', cacheSystem: true })
    claim = res.json || {}
    sources = res.sources || []
  } catch (e) {
    console.warn(`[research-agent] ${item.orderNumber}: model call failed: ${e.message}`)
    return { outcome: 'untouched', detail: 'the model call failed' }
  }
  const seen = sources.slice(0, 4).join(', ')
  if (!claim.found || !claim.resultsUrl) {
    return { outcome: 'person', text: `Searched the web for ${item.runner} in ${item.race} ${item.year} and did not find an official result. ${claim.notes || ''}${seen ? ` Looked at: ${seen}.` : ''} Research by hand or ask the customer.` }
  }
  const said = `${claim.nameOnPage || item.runner}${claim.bib ? `, bib ${claim.bib}` : ''}, ${claim.chipTime || 'no time'}${claim.pace ? `, ${claim.pace}/mi` : ''}${claim.eventType ? ` (${claim.eventType})` : ''}`
  const handOff = why => ({ outcome: 'person', text: `Found what looks like the result: ${said}, at ${claim.resultsUrl}${claim.timingCompany ? ` (${claim.timingCompany})` : ''}. Not entered because ${why} Check it on that page and enter it under Runner > Edit.${claim.notes ? ` Model notes: ${claim.notes}` : ''}` })
  if (!sameName(claim.nameOnPage || '', item.runner)) return handOff(`the page lists "${claim.nameOnPage}", not "${item.runner}".`)
  if (!claim.chipTime) return handOff('it has no chip time.')

  const page = await fetchTimingPage({ url: claim.resultsUrl, limit: 400_000 })
  if (!page.ok) return handOff(`our server could not read that page (${page.error || `HTTP ${page.status}`}).`)
  const check = checkRowOnPage({ text: page.body, url: page.finalUrl || claim.resultsUrl, runner: item.runner, raceName: item.race, year: item.year, time: claim.chipTime, pace: claim.pace, bib: claim.bib, eventType: claim.eventType })
  if (!check.ok) return handOff(`${check.why.replace(/\.$/, '')}.${check.row ? ` The row: "${check.row.slice(0, 200)}"` : ''}`)

  if (!dryRun) await writeVerified(item, { bib: claim.bib, time: claim.chipTime, pace: claim.pace, eventType: claim.eventType, url: page.finalUrl || claim.resultsUrl, row: check.row })
  return { outcome: 'cleared', detail: `read off ${page.finalUrl || claim.resultsUrl}: ${said}`, url: page.finalUrl || claim.resultsUrl }
}

/** The race row for an order's race and year, the way hand entry finds it (api/orders/update.js). */
async function raceRowFor(name, year) {
  const canonical = getCanonicalRaceName(name) || name
  return await prisma.race.findUnique({ where: { raceName_year: { raceName: name, year } } })
    || (canonical !== name && await prisma.race.findUnique({ where: { raceName_year: { raceName: canonical, year } } }))
    || prisma.race.create({ data: { raceName: canonical, year, raceDate: null, eventTypes: ['Marathon'] } })
}

/** A result that passed checkRowOnPage: on the research row, with where it was read. */
async function writeVerified(item, { bib, time, pace, eventType, url, row }) {
  const data = {
    bibNumber: bib || null, officialTime: time, officialPace: pace, eventType: eventType || null, resultsUrl: url,
    researchStatus: 'found', source: 'research_agent', possibleMatches: null,
    researchNotes: `Read off the official results page by the research agent: ${url}. Row: "${row.slice(0, 300)}"`,
  }
  const latest = await prisma.runnerResearch.findFirst({ where: { orderId: item.id }, orderBy: { id: 'desc' }, select: { id: true } })
  if (latest) await prisma.runnerResearch.update({ where: { id: latest.id }, data })
  else await prisma.runnerResearch.create({ data: { ...data, orderId: item.id, raceId: (await raceRowFor(item.race, item.year)).id, runnerName: item.runner } })
  await prisma.order.update({ where: { id: item.id }, data: { status: 'ready', researchedAt: new Date() } })
}

/**
 * Work the queue. Returns what it cleared, what it suggested, what it left
 * for a person and why, and what it skipped.
 * @param {{ limit?: number, dryRun?: boolean, orderNumbers?: string[]|null, actor?: object }} opts
 */
export async function runResearchAgent({ limit = 15, dryRun = false, orderNumbers = null, actor = { isSystem: true, email: 'research-agent' } } = {}) {
  const queue = await researchQueue()
  const wanted = orderNumbers?.length ? new Set(orderNumbers.map(n => String(n).replace(/^#/, '').trim())) : null
  const out = { dryRun, queue: queue.length, cleared: [], suggested: [], person: [], untouched: [], skipped: [] }
  let worked = 0
  for (const item of queue) {
    if (wanted && !wanted.has(item.display) && !wanted.has(item.display.split('-')[0]) && !wanted.has(item.orderNumber)) continue
    const tag = { order: item.display, runner: item.runner, race: `${item.race} ${item.year}`, reason: item.reason }
    const plan = planFor(item)
    if (plan.action === 'skip') { out.skipped.push({ ...tag, why: plan.why }); continue }
    if (!wanted && item.lastAgentNote && Date.now() - new Date(item.lastAgentNote.at).getTime() < QUIET_DAYS * DAY) { out.skipped.push({ ...tag, why: 'Noted by the agent this week already.' }); continue }
    if (worked >= limit) { out.untouched.push({ ...tag, why: 'Over this run\'s limit.' }); continue }
    if (plan.action === 'person') {
      worked++
      await note(item.id, `${plan.why} Not researched automatically.`, dryRun)
      out.person.push({ ...tag, why: plan.why })
      continue
    }
    if (!(await raceBudget(item.race))) { out.untouched.push({ ...tag, why: `${item.race} has had ${PER_RACE_PER_HOUR} lookups this hour.` }); continue }
    worked++
    let res
    try {
      res = plan.action === 'rerun' ? await viaScraper(item, { dryRun }) : { outcome: 'no_scraper_year' }
      if (res.outcome === 'no_scraper_year') res = await viaWeb(item, { dryRun })
    } catch (e) {
      console.warn(`[research-agent] ${item.orderNumber}: ${e.message}`)
      res = { outcome: 'untouched', detail: 'the lookup threw an error' }
    }
    if (res.outcome === 'cleared') { await note(item.id, `Filled in the result: ${res.detail}.`, dryRun); out.cleared.push({ ...tag, result: res.detail, url: res.url || undefined }) }
    else if (res.outcome === 'suggested') { await note(item.id, res.text, dryRun); out.suggested.push({ ...tag, why: res.text }) }
    else if (res.outcome === 'person') { if (!res.quiet) await note(item.id, res.text, dryRun); out.person.push({ ...tag, why: res.text }) }
    else out.untouched.push({ ...tag, why: res.detail })
  }
  out.summary = `Research agent${dryRun ? ' (dry run)' : ''}: ${out.cleared.length} cleared, ${out.suggested.length} suggested, ${out.person.length} left for a person, ${out.untouched.length} untouched, ${out.skipped.length} skipped of ${queue.length} in the queue`
  if (!dryRun && (out.cleared.length || out.suggested.length || out.person.length)) {
    await recordAudit({ action: 'research.agent', summary: out.summary, detail: { cleared: out.cleared, suggested: out.suggested.map(s => s.order), person: out.person.map(p => p.order) }, actor })
  }
  return out
}
