/**
 * Philadelphia Marathon - MyChipTime platform
 * Results: https://www.mychiptime.com/searchevent.php?id={eventId}
 *
 * Per-year event IDs (each year is a separate MCT event, NOT shared). The
 * marathon id is a CHILD of the per-year weekend landing id and is not
 * derivable from it — read it off the landing page's own child links:
 *   2024: landing 16124 → marathon 16165 ("Marathon 2024")
 *   2025: landing 16895 → marathon 16897 ("2025 Marathon 2025")
 *   2026: landing 17291 → no children published yet (race is Nov 2026)
 *
 * MyChipTime does NOT host 2021, 2022 or 2023 — searching their event index
 * for "Philadelphia" returns only the 2024, 2025 and 2026 weekends. Those
 * years are routed to ATHLINKS via `yearOverrides` below (master event
 * 156909). raceIDs and course names were read off the master events API
 * https://alaska.athlinks.com/MasterEvents/Api/156909 (eventRaces[]):
 *   2021: 996156  course "Marathon  Runner" (two spaces, sic)
 *   2022: 1039197 course "Marathon"
 *   2023: 1068740 course "Marathon"
 * The API's date is the Saturday of race weekend; the marathon is Sunday.
 * Athlinks carries the CHIP time for Philadelphia: on 2024 (event 1097791)
 * Andrew Garcia bib 559 shows 2:47:25 on Athlinks, which is MyChipTime's
 * chip time (gun 2:47:39). 2020 was virtual only and is not wired.
 * The marathon course regexes are anchored so the wheelchair, handcycle,
 * virtual and challenge courses never match.
 *
 * There is deliberately no defaultEventId. It used to fall back to the most
 * recent edition, which meant any unconfigured year scraped that edition's
 * page and inherited its date — that is how 2026 ended up stamped Nov 2025
 * and reported as "runner not found" instead of "race not run yet".
 *
 * Half marathon is a separate event ID under the same weekend.
 */
export default {
  platform: 'mychiptime',
  raceName: 'Philadelphia Marathon',
  tag: 'Philadelphia',
  location: 'Philadelphia, PA',
  parseMode: 'simple',
  endpoint: 'searchResultGen.php',
  yearOverrides: {
    2021: {
      platform: 'athlinks',
      masterEventId: 156909,
      eventIds: { 2021: 996156 },
      courseMap: { marathon: /^marathon\s+runner$/i },
      distances: { marathon: 26.2 },
      distanceMiles: 26.2,
    },
    2022: {
      platform: 'athlinks',
      masterEventId: 156909,
      eventIds: { 2022: 1039197 },
      courseMap: { marathon: /^marathon$/i },
      distances: { marathon: 26.2 },
      distanceMiles: 26.2,
    },
    2023: {
      platform: 'athlinks',
      masterEventId: 156909,
      eventIds: { 2023: 1068740 },
      courseMap: { marathon: /^marathon$/i },
      distances: { marathon: 26.2 },
      distanceMiles: 26.2,
    },
  },
  raceDates: {
    2021: '2021-11-21',
    2022: '2022-11-20',
    2023: '2023-11-19',
    2024: '2024-11-24',
    2025: '2025-11-23',
    2026: '2026-11-22',
  },
  raceDateSources: {
    2021: '6abc.com "Philadelphia Marathon returns to the city following COVID hiatus" (Chesire, Sexton win) + marathonguide.com 2021 race details, Sunday Nov 21 2021',
    2022: 'Philadelphia Inquirer race report published 2022-11-20 (Zimmerman wins) + FOX 29 Philadelphia 2022 full-results report',
    2023: 'Philadelphia Inquirer race report published 2023-11-19 (Koech/Kwambai win) + V.O2 (vdoto2.com) event listing dated 2023-11-19',
    2024: 'PhiladelphiaMarathon.com race info + RunHive event listing',
    2025: 'PhiladelphiaMarathon.com race info + RunHive event listing',
    2026: 'PhiladelphiaMarathon.com race info + RunHive event listing',
  },
  eventTypes: ['Marathon'],
  eventSearchOrder: ['marathon'],
  eventLabels: {
    marathon: 'Marathon'
  },
  aliases: [
    'Philadelphia Marathon',
    'Philadelphia Marathon (Full)',
    'Philly Marathon',
    // The Shopify product dropped "Marathon" from its title on 2026-11-11.
    'Philadelphia',
    'Philly'
  ],
  keywords: ['philadelphia', 'philly'],
  keywordRequiresMarathon: true,
  eventIds: {
    2024: { marathon: '16165' },
    2025: { marathon: '16897' },
  }
}
