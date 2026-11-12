/**
 * Philadelphia Marathon weekend - MyChipTime platform (2024+), Athlinks 2021-23.
 * Three distances are sold and searched: Marathon (Sunday), Half Marathon and
 * 8K (Saturday). A name found in more than one of them comes back ambiguous
 * for a person to pick; it is never auto-picked.
 * Results: https://www.mychiptime.com/searchevent.php?id={eventId}
 *
 * Per-year event IDs (each year is a separate MCT event, NOT shared). Each
 * distance is a CHILD of the per-year weekend landing id and is not derivable
 * from it - read the ids off the landing page's own child links
 * (searchevent.php?id=<landing>), then open each child and check its title
 * and date are that year:
 *   2024: landing 16124 "Philadelphia Marathon Weekend 2024"
 *         marathon 16165 "Marathon 2024" (11/24/2024)
 *         half     16164 "Half Marathon 2024" (11/23/2024)
 *         8K       16166 "8K 2024" (11/23/2024)
 *   2025: landing 16895 "Philadelphia Marathon Weekend 2025"
 *         marathon 16897 "2025 Marathon 2025", half 16896 "2025 Half
 *         Marathon 2025", 8K 16898 "2025 8K 2025" (the pages all say
 *         11/22/2025). philadelphiamarathon.com links 16896/16897/16898
 *         directly as "View 2025 Results".
 *   2026: landing 17291. Children appeared by 2026-11-12 (marathon 17626,
 *         half 17625, 8K 17627) but the race (Nov 22) has not run, so they
 *         are NOT configured. Once results are posted: re-read the landing
 *         page, open each child to confirm the title and the 2026 results,
 *         then add `2026: { marathon, halfMarathon, eightK }` below.
 * Wheelers, Challenge (Freedom / Independence / Liberty Bell / Patriot)
 * children are not sold and are left out.
 *
 * MyChipTime does NOT host 2021, 2022 or 2023 - searching their event index
 * for "Philadelphia" returns only the 2024, 2025 and 2026 weekends. Those
 * years are routed to ATHLINKS via `yearOverrides` below (master event
 * 156909). raceIDs and course names were read off the master events API
 * https://alaska.athlinks.com/MasterEvents/Api/156909 (eventRaces[].eventCourses[],
 * needs a browser User-Agent):
 *   2021: 996156  "Marathon  Runner" (two spaces, sic), "Half Marathon Runner", "8K Runner"
 *   2022: 1039197 "Marathon", "Half Marathon", "8K Run"
 *   2023: 1068740 "Marathon", "Half Marathon", "8K Run"
 * The leaderboard call (results.athlinks.com/event/<id>) omits some courses
 * (2022's Marathon), so read the course names off the master API instead.
 * The API's date is the Saturday of race weekend; the marathon is Sunday.
 * Athlinks carries the CHIP time for Philadelphia: on 2024 (event 1097791)
 * Andrew Garcia bib 559 shows 2:47:25 on Athlinks, which is MyChipTime's
 * chip time (gun 2:47:39). 2020 was virtual only and is not wired.
 * The course regexes are anchored so the wheelchair, handcycle, virtual,
 * elite and challenge courses never match.
 *
 * Event labels are exactly 'Marathon', 'Half Marathon' and '8K': the render
 * picks "Philadelphia Marathon", "Philadelphia Marathon / Half Marathon" and
 * "Philadelphia Marathon / 8K" from them (server/domain/render/spec.js).
 *
 * There is deliberately no defaultEventId. It used to fall back to the most
 * recent edition, which meant any unconfigured year scraped that edition's
 * page and inherited its date - that is how 2026 ended up stamped Nov 2025
 * and reported as "runner not found" instead of "race not run yet".
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
      courseMap: { marathon: /^marathon\s+runner$/i, halfMarathon: /^half marathon\s+runner$/i, eightK: /^8k\s+runner$/i },
      distanceMiles: 26.2,
    },
    2022: {
      platform: 'athlinks',
      masterEventId: 156909,
      eventIds: { 2022: 1039197 },
      courseMap: { marathon: /^marathon$/i, halfMarathon: /^half marathon$/i, eightK: /^8k run$/i },
      distanceMiles: 26.2,
    },
    2023: {
      platform: 'athlinks',
      masterEventId: 156909,
      eventIds: { 2023: 1068740 },
      courseMap: { marathon: /^marathon$/i, halfMarathon: /^half marathon$/i, eightK: /^8k run$/i },
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
  eventTypes: ['Marathon', 'Half Marathon', '8K'],
  eventSearchOrder: ['marathon', 'halfMarathon', 'eightK'],
  eventLabels: {
    marathon: 'Marathon',
    halfMarathon: 'Half Marathon',
    eightK: '8K',
  },
  // Pace divides by these when the page prints none (Athlinks always; MyChipTime
  // prints a Total Pace, which is used as shown). 8K = 4.97 mi, the distance
  // MyChipTime's own Total Pace uses (29:15 -> 5:53/M).
  distances: { marathon: 26.2, halfMarathon: 13.1, eightK: 4.97 },
  aliases: [
    'Philadelphia Marathon',
    'Philadelphia Marathon (Full)',
    'Philly Marathon',
    'Philadelphia Half Marathon',
    'Philly Half Marathon',
    'Philadelphia 8K',
    'Philly 8K',
    'Philadelphia Marathon 8K',
    // The Shopify product dropped "Marathon" from its title on 2026-11-11.
    'Philadelphia',
    'Philly'
  ],
  keywords: ['philadelphia', 'philly'],
  keywordRequiresMarathon: true,
  eventIds: {
    2024: { marathon: '16165', halfMarathon: '16164', eightK: '16166' },
    2025: { marathon: '16897', halfMarathon: '16896', eightK: '16898' },
  }
}
