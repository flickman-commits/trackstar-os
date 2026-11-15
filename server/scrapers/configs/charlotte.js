/**
 * Charlotte Marathon (Novant Health Charlotte Marathon) - RaceRoster, with an
 * Athlinks fallback.
 *
 * RaceRoster (official results, chip + gun): event codes found from the race's
 * own result links (runningusa.org / runcharlotte.com press releases) and
 * confirmed by /v2/api/events/{code} returning "Novant Health Charlotte
 * Marathon" with eventDate 2024-11-16 and 2025-11-15. Sub-event ids read off
 * /v2/api/events/{code}/sub-events/{id} (name + distance):
 *   2025 3vgp2qeac5c9rhab: 248066 Marathon 26.2 mi, 248067 Half Marathon 13.1 mi
 *   2024 554nhffagcfxre7m: 216680 Marathon 26.2 mi, 216682 Half Marathon 13.1 mi
 *   2026 e5kbhszx7m2nxjc7: 385288 Marathon 26.2 mi, 385289 Half Marathon 13.1 mi
 *        (event "Novant Health Charlotte Marathon", eventDate 2026-11-14, timer
 *        Start 2 Finish Charlotte; read 2026-11-15 off /v2/api/events/{code},
 *        link from Matt. Excluded: 385290 Half Marathon Ruck, 385291 5K,
 *        385657 a second 59-runner marathon set)
 *   (excluded: 5K, Marathon Pacer, ruck, etc.)
 * RaceRoster chip times carry tenths (4:59:37.1).
 *
 * Athlinks master 20296 ("Charlotte Marathon, Half, and 5K"), ids from
 * https://alaska.athlinks.com/MasterEvents/Api/20296 eventRaces[]. 2022 and
 * 2023 are served only from here (2023 is the results link in the race's own
 * press release). 2024/2025 search on Athlinks currently errors, which is why
 * RaceRoster is primary.
 *
 */
export default {
  platform: 'raceroster',
  raceName: 'Charlotte Marathon',
  tag: 'Charlotte',
  location: 'Charlotte, NC',
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'halfMarathon'],
  eventLabels: { marathon: 'Marathon', halfMarathon: 'Half Marathon' },
  distances: { marathon: 26.2, halfMarathon: 13.1 },
  distanceMiles: 26.2,
  aliases: [
    'Charlotte Marathon',
    'Novant Health Charlotte Marathon',
    'Charlotte Half Marathon',
  ],
  keywords: ['charlotte'],
  keywordRequiresMarathon: true,
  eventCodes: {
    2024: '554nhffagcfxre7m',
    2025: '3vgp2qeac5c9rhab',
    2026: 'e5kbhszx7m2nxjc7',
  },
  subEventIds: {
    2024: { marathon: 216680, halfMarathon: 216682 },
    2025: { marathon: 248066, halfMarathon: 248067 },
    2026: { marathon: 385288, halfMarathon: 385289 },
  },
  raceDates: {
    2022: '2022-11-12',
    2023: '2023-11-04',
    2024: '2024-11-16',
    2025: '2025-11-15',
    2026: '2026-11-14',
  },
  raceDateSources: {
    2022: 'RunSignUp race 17795 event 554002 "MARATHON" start 11/12/2022 07:20 + Athlinks master 20296 race 1013358 dated 2022-11-12',
    2023: 'RunSignUp race 17795 event 665682 "MARATHON" start 11/4/2023 07:20 + runningusa.org "Rager, Fulcher win ... 19th Novant Health Charlotte Marathon" (Saturday race, article dated 2023-11-05)',
    2024: 'RaceRoster event 554nhffagcfxre7m eventDate 2024-11-16 + wfae.org "Thousands race in 20th annual Charlotte Marathon" dated 2024-11-17 + RunSignUp event 781339 start 11/16/2024',
    2025: 'RaceRoster event 3vgp2qeac5c9rhab eventDate 2025-11-15 + runningusa.org 2025 results release (held November 15, 2025) + RunSignUp event 923240 start 11/15/2025',
    2026: 'RunSignUp race 17795 event 1078452 "MARATHON" start 11/14/2026 07:20 + RaceRoster 2025 results page noting registration for the November 14, 2026 race',
  },
  fallback: {
    platform: 'athlinks',
    masterEventId: 20296,
    courseMap: {
      marathon: /^marathon$/i,
      halfMarathon: /^half marathon$/i,
    },
    eventIds: {
      2022: 1013358,
      2023: 1045578,
      2024: 1096472,
      2025: 1135457,
    },
  },
}
