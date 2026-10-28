/**
 * A person picked one of the finishers research found for an order: save it
 * as the order's result. Moved here from api/orders/actions.js (accept-match)
 * unchanged, so the MCP tool does the same thing.
 */
import prisma from '../../db.js'

/** Wrong input or nothing found; `status` is the HTTP status the API answers with. */
export class AcceptMatchError extends Error {
  constructor(message, status) { super(message); this.status = status }
}

/**
 * @param {{ orderNumber: string, match: { name?: string, bib?: string, time?: string, pace?: string, eventType?: string, resultsUrl?: string } }} p
 * @returns the updated RunnerResearch row
 */
export async function acceptMatch({ orderNumber, match }) {
  if (!orderNumber || !match) throw new AcceptMatchError('orderNumber and match are required', 400)

  const order = await prisma.order.findFirst({ where: { orderNumber } })
  if (!order) throw new AcceptMatchError(`Order not found: ${orderNumber}`, 404)

  const research = await prisma.runnerResearch.findFirst({
    where: { orderId: order.id },
    orderBy: { createdAt: 'desc' }
  })
  if (!research) throw new AcceptMatchError('No research record found for this order', 404)

  // Some scrapers (RTRT, MultiSport Australia, Tokyo) don't include time/pace
  // in their search results — those require a per-runner detail fetch. When
  // a user accepts a match without time data, re-run the scraper with the
  // matched runner's exact name so it can pull the full details (which IS
  // an exact match → returns time + pace).
  let enrichedTime = match.time || null
  let enrichedPace = match.pace || null
  let enrichedEventType = match.eventType || null
  let enrichedResultsUrl = match.resultsUrl || null

  if (!enrichedTime && match.name) {
    try {
      const { getScraperForRace } = await import('../../scrapers/index.js')
      const { ensureOverridesLoaded } = await import('../../scrapers/scraperOverrides.js')
      await ensureOverridesLoaded()  // CLAUDE.md: dashboard event-id overrides before getScraperForRace
      const raceName = order.raceNameOverride || order.raceName
      const raceYear = order.yearOverride || order.raceYear
      const scraper = getScraperForRace(raceName, raceYear)
      // By the accepted bib first: a name search for a shared name ("Erin
      // Smith", Columbus 2026) comes back with the same two runners and no
      // time, which saved the match timeless (order 6265).
      let enriched = null
      if (match.bib) {
        console.log(`[accept-match] Enriching match by bib ${match.bib}`)
        enriched = await scraper.searchRunnerByBib(match.bib).catch(() => null)
        if (enriched?.found && String(enriched.bibNumber || '').trim() !== String(match.bib).trim()) enriched = null
      }
      if (!enriched?.found) {
        console.log(`[accept-match] Enriching match by re-searching "${match.name}"`)
        enriched = await scraper.searchRunner(match.name)
        // Still several of that name: the one with the accepted bib, if it carries a time.
        if (!enriched.found && match.bib) {
          const same = (enriched.possibleMatches || []).find(c => String(c?.bib || '').trim() === String(match.bib).trim() && c.time)
          if (same) enriched = { found: true, officialTime: same.time, officialPace: same.pace, eventType: same.eventType, resultsUrl: same.resultsUrl || enriched.resultsUrl }
        }
      }
      if (enriched.found) {
        enrichedTime = enriched.officialTime || enrichedTime
        enrichedPace = enriched.officialPace || enrichedPace
        enrichedEventType = enriched.eventType || enrichedEventType
        enrichedResultsUrl = enriched.resultsUrl || enrichedResultsUrl
        console.log(`[accept-match] Enriched: time=${enrichedTime} pace=${enrichedPace}`)
      } else {
        console.log(`[accept-match] Re-search did not return a unique match - saving with available data`)
      }
    } catch (err) {
      // Don't fail the accept — just save with what we have
      console.warn(`[accept-match] Enrichment failed: ${err.message}`)
    }
  }

  const updatedResearch = await prisma.runnerResearch.update({
    where: { id: research.id },
    data: {
      bibNumber: match.bib || null,
      officialTime: enrichedTime,
      officialPace: enrichedPace,
      eventType: enrichedEventType || research.eventType || null,
      resultsUrl: enrichedResultsUrl || research.resultsUrl || null,
      researchStatus: 'found',
      // Keep the order's runnerName as the customer's original — don't change it.
      // The match name only goes in researchNotes for the audit trail.
      researchNotes: `Accepted match: "${match.name}" (original search: "${order.runnerName}")`,
      // Clear the persisted candidate list so the picker stops showing on this order
      possibleMatches: null,
    }
  })

  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'ready', researchedAt: new Date() }
  })

  console.log(`[accept-match] Match accepted for order ${orderNumber}: ${match.name} (time: ${enrichedTime || 'n/a'})`)
  return updatedResearch
}
