/**
 * Santa Barbara Half Marathon, a Sunday in early November. Timed by SVE
 * Timing, results on RaceRoster (not results.svetiming.com).
 *
 * The 2024 event code came from the KEYT race report's results link
 * (keyt.com/?p=1172952); the other years from that event's relatedEvents.
 * Each confirmed by /v2/api/events/{code}; sub-ids read off
 * /v2/api/events/{code}/sub-events/{id}, using only the one named
 * "HALF MARATHON" (excluded: 5K, HALF CHAIR, remote/virtual half and 5K).
 * The API's distance fields are junk (1 km), so pace uses 13.1.
 *
 * No clean date rule (2022-24 the first Sunday of November, 2025 the second),
 * so each year is pinned. 2026 (the second Sunday again) came from the 2025
 * event's relatedEvents once results posted, same checks.
 *
 * There is no full marathon: the event has been the Half and a 5K since
 * 2020. A "Santa Barbara Marathon" order is this half.
 */
export default {
  platform: 'raceroster',
  raceName: 'Santa Barbara Half Marathon',
  tag: 'SantaBarbara',
  location: 'Santa Barbara, CA',
  eventTypes: ['Half Marathon'],
  eventSearchOrder: ['halfMarathon'],
  eventLabels: { halfMarathon: 'Half Marathon' },
  distances: { halfMarathon: 13.1 },
  distanceMiles: 13.1,
  aliases: [
    'Santa Barbara Half Marathon',
    'Santa Barbara Half',
    'Santa Barbara Marathon',
    'Santa Barbara Half Marathon & 5K',
  ],
  keywords: ['santa barbara'],
  eventCodes: {
    2022: 'hr5nptfhhnhwp2f4',
    2023: 'p9sp9wtxs3crf9ct',
    2024: 'ukzsexrkn93qpfek',
    2025: '3ygc7zccvxdfgrb2',
    2026: 'nw7x4k7ksgdmww6m',
  },
  subEventIds: {
    2022: { halfMarathon: 152659 },
    2023: { halfMarathon: 186061 },
    2024: { halfMarathon: 215325 },
    2025: { halfMarathon: 247019 },
    2026: { halfMarathon: 385187 },
  },
  raceDates: {
    2022: '2022-11-06',
    2023: '2023-11-05',
    2024: '2024-11-03',
    2025: '2025-11-09',
    2026: '2026-11-08',
  },
  raceDateSources: {
    2022: 'RaceRoster event hr5nptfhhnhwp2f4 eventDate 2022-11-06 (Sunday), HALF MARATHON sub-event 152659',
    2023: 'RaceRoster event p9sp9wtxs3crf9ct eventDate 2023-11-05 (Sunday), sub-event 186061',
    2024: 'RaceRoster event ukzsexrkn93qpfek eventDate 2024-11-03 + KEYT race report (keyt.com/?p=1172952) and endurancesportswire 2024 report',
    2025: 'RaceRoster event 3ygc7zccvxdfgrb2 eventDate 2025-11-09 (Sunday), sub-event 247019',
    2026: 'RaceRoster event nw7x4k7ksgdmww6m eventDate 2026-11-08 (Sunday), HALF MARATHON sub-event 385187 (4956 results)',
  },
}
