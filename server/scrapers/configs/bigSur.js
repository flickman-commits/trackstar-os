/**
 * Big Sur International Marathon (Carmel / Big Sur, CA) — last Sunday-ish of
 * April. SVE Timing platform. Results (linked from bigsurmarathon.org/results):
 *   https://results.svetiming.com/Big-Sur/events/{year}/Big-Sur-International-Marathon/results
 *
 * The year IS the path segment, so there is no per-year id to look up. Each
 * year 2022-2026 was opened and its page title checked ("Race Results for
 * April 26, 2026 Big Sur International Marathon"). 2020-2021 were not held in
 * person. Pre-2022 slugs differ (e.g. "Big-Sur-International-Marathon-2019")
 * and are out of scope.
 *
 * Only the full MARATHON is mapped. The same event page also holds the
 * 21 MILER, 11 MILER, 12K, 5K, relay and "ALSO PARTICIPATING" divisions,
 * which we do not sell marathon prints for; the anchored regex keeps them out.
 * Special divisions and Boston 2 Big Sur are separate SVE events, not read.
 *
 * Columns: "Gun Elapsed" then "Chip Elapsed"; the scraper reads chip. SVE has
 * no per-athlete splits, so pace is computed from chip ÷ 26.2.
 *
 * Verified finishers: see chip-time-fixtures.js (Big Sur 2026).
 */
export default {
  platform: 'svetiming',
  // Earlier years use other slugs and are not wired up: they answer HTTP 500,
  // which read as "Timing site down" (orders 7260, 4224473488).
  firstYear: 2022,
  raceName: 'Big Sur Marathon',
  tag: 'BigSur',
  location: 'Big Sur, CA',
  organizer: 'Big-Sur',
  eventSlug: 'Big-Sur-International-Marathon',
  eventTypes: ['Marathon'],
  eventLabels: { marathon: 'Marathon' },
  divisionMap: {
    // Anchored: excludes 21 MILER, 11 MILER, 12K, 5K, RELAY and others.
    marathon: /^\s*MARATHON\s*$/i,
  },
  distances: { marathon: 26.2 },
  distanceMiles: 26.2,
  aliases: [
    'Big Sur Marathon',
    'Big Sur International Marathon',
  ],
  keywords: ['big sur'],
  keywordRequiresMarathon: true,
  raceDates: {
    2022: '2022-04-24',
    2023: '2023-04-30',
    2024: '2024-04-28',
    2025: '2025-04-27',
    2026: '2026-04-26',
  },
  raceDateSources: {
    2022: 'results.svetiming.com "Race Results for April 24, 2022 Big Sur International Marathon"',
    2023: 'results.svetiming.com "Race Results for April 30, 2023 Big Sur International Marathon"',
    2024: 'results.svetiming.com "Race Results for April 28, 2024 Big Sur International Marathon"',
    2025: 'results.svetiming.com "Race Results for April 27, 2025 Big Sur International Marathon"',
    2026: 'results.svetiming.com "Race Results for April 26, 2026 Big Sur International Marathon" + bigsurmarathon.org "Event Date: April 26, 2026"',
  },
}
