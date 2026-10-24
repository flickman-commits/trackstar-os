/**
 * API endpoint to research a runner's race results
 * Uses two-tier caching:
 *   1. Race-level data (date, location, weather) - cached once per race/year
 *   2. Runner-level data (bib, time, pace) - cached per order
 */
import { setCors, requireAdmin } from '../_lib/auth.js'
import { researchService } from '../../server/services/ResearchService.js'
import { hasScraperForRace, getSupportedRaces } from '../../server/scrapers/index.js'

const MAX_BATCH = 25

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  if (!(await requireAdmin(req, res))) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { orderNumber, orderNumbers, force } = req.body

    // Batch mode - research multiple orders
    if (orderNumbers && Array.isArray(orderNumbers)) {
      // Each order is a live scrape (often a browser launch); timing sites
      // start refusing us after a burst, so one request is capped.
      if (orderNumbers.length > MAX_BATCH) {
        return res.status(400).json({ error: `Research at most ${MAX_BATCH} orders at a time.` })
      }
      console.log(`[API] Batch research for ${orderNumbers.length} orders`)
      const results = await researchService.researchBatch(orderNumbers)
      return res.status(200).json({
        success: true,
        batchResults: results
      })
    }

    // Single order mode
    if (!orderNumber) {
      return res.status(400).json({ error: 'orderNumber is required' })
    }

    console.log(`[API] Research request for order: ${orderNumber}`)

    // A person's Research runner click searches again even over a saved result.
    const { race, runnerResearch, order } = await researchService.researchOrder(orderNumber, { force: force === true })

    // Also try to fetch weather if not already done
    const raceWithWeather = await researchService.fetchWeatherForRace(race.id)

    return res.status(200).json({
      success: true,
      found: runnerResearch.researchStatus === 'found',
      ambiguous: runnerResearch.researchStatus === 'ambiguous',
      // Race-level data (Tier 1)
      race: {
        id: raceWithWeather.id,
        raceName: raceWithWeather.raceName,
        year: raceWithWeather.year,
        raceDate: raceWithWeather.raceDate,
        location: raceWithWeather.location,
        weatherTemp: raceWithWeather.weatherTemp,
        weatherCondition: raceWithWeather.weatherCondition,
        eventTypes: raceWithWeather.eventTypes
      },
      // Runner-level data (Tier 2)
      results: {
        bibNumber: runnerResearch.bibNumber,
        officialTime: runnerResearch.officialTime,
        officialPace: runnerResearch.officialPace,
        eventType: runnerResearch.eventType,
        researchStatus: runnerResearch.researchStatus,
        researchNotes: runnerResearch.researchNotes
      },
      research: runnerResearch,
      // Searched again, found nothing, and left the saved result alone.
      kept: Boolean(runnerResearch.kept),
      possibleMatches: runnerResearch.possibleMatches || null
    })

  } catch (error) {
    console.error('[API] Error researching runner:', error)

    // Provide helpful error messages
    if (error.message.includes('No scraper available')) {
      return res.status(400).json({
        error: error.message,
        errorType: 'no_scraper',
        actionRequired: `Add a scraper config for "${error.message.replace(/^.*race:\s*/, '')}" - or add an alias to an existing one if this race should map to a config we already have.`,
        supportedRaces: getSupportedRaces()
      })
    }

    return res.status(500).json({
      error: 'Something went wrong. Try again, and tell Matt if it keeps happening.',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
}
