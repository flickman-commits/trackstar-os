/**
 * Humboldt Redwoods Marathon (Weott/Redcrest, CA) — marathon + half.
 * Athlinks platform. Master event: https://www.athlinks.com/event/1462
 *
 * Per-year race ids read off
 * alaska.athlinks.com/events/race/api/find?searchTerm=Humboldt%20Redwoods
 * (master 1462) and checked against each race's date:
 *   2022: 1037405 (10/9/2022)  2023: 1088166 (10/8/2023)
 *   2024: 1097117 (10/13/2024) 2025: 1138722 (10/12/2025)
 * (2021 was the "Avenue 2.0" half-only edition; 2020 not held.)
 *
 * 2026 (ran Sun Oct 11 2026) reads Huber Timing, the race's timer, directly
 * (yearOverrides below): as of 2026-10-28 Athlinks still has no 2026 race and
 * RunSignUp (race 109736) has no result sets. Found by searching "humboldt
 * redwoods marathon 2026 results"; the race site links no results page.
 * Huber names each distance's page by a cert id: <year>HRMMar is the
 * marathon, <year>HRM the half (<year>HRM5K the 5K). Huber also hosts
 * 2022-2025 (the Athlinks copies are its mirror); those years stay on
 * Athlinks, whose fixtures pass.
 *
 * Courses: "Marathon", "Half Marathon", "5K Run". Athlinks carries one time,
 * the chip: 2025 winner Breene is 2:29:09 here vs 2:29:11 (gun) on
 * marathonguide.
 */
export default {
  platform: 'athlinks',
  raceName: 'Humboldt Redwoods Marathon',
  tag: 'HumboldtRedwoods',
  location: 'Weott, CA',
  masterEventId: 1462,
  raceDates: {
    2022: '2022-10-09',
    2023: '2023-10-08',
    2024: '2024-10-13',
    2025: '2025-10-12',
    2026: '2026-10-11',
  },
  raceDateSources: {
    2022: 'Athlinks race 1037405 date 10/9/2022 + runsignup.com race 109736 event 551094 "Marathon" 10/9/2022',
    2023: 'Athlinks race 1088166 date 10/8/2023 + runsignup.com race 109736 event 673827 "Marathon" 10/8/2023',
    2024: 'Athlinks race 1097117 date 10/13/2024 + runsignup.com race 109736 event 780233 "Marathon" 10/13/2024',
    2025: 'Athlinks race 1138722 date 10/12/2025 + runsignup.com race 109736 event 931233 "Marathon" 10/12/2025 + marathonguide 2025 details',
    2026: 'runsignup.com race 109736 "2026 Humboldt Redwoods Marathon, Half Marathon, 5K" event 1078233 "Marathon" 10/11/2026 08:30',
  },
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'half'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  courseMap: {
    marathon: /^marathon$/i,
    half: /^half marathon$/i,
  },
  distances: { marathon: 26.2, half: 13.1 },
  distanceMiles: 26.2,
  aliases: [
    'Humboldt Redwoods Marathon',
    'Humboldt Redwoods Half Marathon',
    'Humboldt Redwoods Marathon, Half Marathon, 5K',
  ],
  keywords: ['humboldt redwoods'],
  keywordRequiresMarathon: false,
  eventIds: {
    2022: 1037405,
    2023: 1088166,
    2024: 1097117,
    2025: 1138722,
  },
  yearOverrides: {
    2026: {
      platform: 'hubertiming',
      huberCerts: { marathon: '2026HRMMar', half: '2026HRM' },
    },
  },
}
