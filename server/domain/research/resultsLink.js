/**
 * A runner's own results page, from the race and their bib, for results saved
 * without one: a match a person picked from the list (NYRR's candidate rows
 * carry no link), or a result entered by hand. The platforms that key a
 * runner's page by bib say how (runnerResultsUrl on NYRR, SVE Timing,
 * MultiSport Australia); for the rest there is nothing to build and the
 * order keeps its search link, if any. Never throws: a missing link is not
 * worth failing a save over.
 */
import { getScraperForRace } from '../../scrapers/index.js'
import { ensureOverridesLoaded } from '../../scrapers/scraperOverrides.js'

/** @param {{ raceName: string, raceYear: number|null, bib: string|null }} p */
export async function resultsLinkForBib({ raceName, raceYear, bib }) {
  const b = String(bib || '').trim()
  if (!b || !raceName || !raceYear) return null
  try {
    await ensureOverridesLoaded()
    const scraper = getScraperForRace(raceName, raceYear)
    return typeof scraper?.runnerResultsUrl === 'function' ? scraper.runnerResultsUrl(b) || null : null
  } catch {
    return null
  }
}
