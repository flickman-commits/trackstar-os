/**
 * Colorado Springs Marathon (Colorado Springs, CO) — marathon + half.
 * Athlinks platform. Master event: https://www.athlinks.com/event/174924
 *
 * Timed by High Altitude Race Timing. RunSignUp (race 95592) only carries
 * results for 2021, 2022 (gun only, empty chip_time) and 2026, so Athlinks is
 * used for every year. Per-year race ids read off
 * alaska.athlinks.com/events/race/api/find?searchTerm=Colorado%20Springs%20Marathon
 * (master 174924) and checked against each race's date:
 *   2022: 1026413 (10/1/2022)  2023: 1063058 (9/30/2023)
 *   2024: 1084564 (9/28/2024)  2025: 1124865 (10/4/2025)
 *   2026: 1147321 (10/3/2026)
 *
 * Courses: "Marathon", "Half Marathon", "5K"/"5K Run". Athlinks time equals
 * RunSignUp chip_time (2026: McCabe chip 3:43:34 vs clock 3:44:28).
 */
export default {
  platform: 'athlinks',
  raceName: 'Colorado Springs Marathon',
  tag: 'ColoradoSprings',
  location: 'Colorado Springs, CO',
  masterEventId: 174924,
  raceDates: {
    2022: '2022-10-01',
    2023: '2023-09-30',
    2024: '2024-09-28',
    2025: '2025-10-04',
    2026: '2026-10-03',
  },
  raceDateSources: {
    2022: 'Athlinks race 1026413 date 10/1/2022 + runsignup.com race 95592 event 541241 "Marathon" 10/1/2022',
    2023: 'Athlinks race 1063058 date 9/30/2023 + runsignup.com race 95592 event 655324 "Marathon" 9/30/2023',
    2024: 'Athlinks race 1084564 date 9/28/2024 + runsignup.com race 95592 event 769651 "Marathon" 9/28/2024',
    2025: 'Athlinks race 1124865 date 10/4/2025 + runsignup.com race 95592 event 905271 "Marathon" 10/4/2025',
    2026: 'runsignup.com race 95592 event 1077181 "Marathon" 10/3/2026 07:00 + Athlinks race 1147321 date 10/3/2026',
  },
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'half'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  courseMap: {
    marathon: /^marathon$/i,
    half: /^half marathon$/i,
  },
  distances: { marathon: 26.2, half: 13.1 },
  // Official 2026 results are RunSignUp, whose pace rounds up.
  pagePace: { 2026: { rule: 'ceil' } },
  distanceMiles: 26.2,
  aliases: [
    'Colorado Springs Marathon',
    'The Colorado Springs Marathon',
    'Colorado Springs Half Marathon',
  ],
  keywords: ['colorado springs'],
  keywordRequiresMarathon: true,
  eventIds: {
    2022: 1026413,
    2023: 1063058,
    2024: 1084564,
    2025: 1124865,
    2026: 1147321,
  },
}
