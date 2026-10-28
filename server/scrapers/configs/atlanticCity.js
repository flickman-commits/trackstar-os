/**
 * Atlantic City Marathon (AmeriHealth Atlantic City Marathon) - Athlinks, with
 * a RunSignUp fallback.
 *
 * Athlinks master 5181 ("Atlantic City Marathon & Half Marathon"). Event ids
 * read off https://alaska.athlinks.com/events/race/api/find?term=Atlantic%20City%20Marathon
 * (master 5181 races[]); each opened via /Events/Race/Result/Api/{id}/Search to
 * confirm it holds that year's Marathon and Half Marathon courses. Athlinks
 * dates each edition on the Saturday (5K/10K day); the marathon is Sunday.
 *
 * Timing: Second Wind Results. 2023-2024 published on RunSignUp (race 120555),
 * 2025 on RaceResult (my.raceresult.com/365346). Athlinks carries the CHIP
 * time: RaceResult 2025 Chandler Smith chip 5:08:17 / gun 5:11:46 -> Athlinks
 * 5:08:17. Note RaceResult's "Overall Results by Chip" list shows a gun-based
 * pace column (Brandon Smith 10:56 for a 2:21:41 chip half); pace here is
 * always computed from chip time / matched distance.
 *
 * 2022: RunSignUp race 120555 event 545390 has no result set; Athlinks only.
 * 2026 (Oct 18) is on RaceResult (my.raceresult.com/430762, "AmeriHealth
 * Atlantic City Marathon Weekend - Sunday - 10/18/2026"), wired through
 * yearOverrides -> platform 'raceresult'. List "Large Race Reports|Overall
 * Results by Chip" (contest 0, from /430762/results/config); first grouping
 * level is the contest name. Contests: 1 5K, 2 10K, 3 Half Marathon,
 * 4 Marathon, 5-8 King Neptune Challenge combos, but this list only carries
 * "Half Marathon" and "Marathon" groups (checked with term=an, 925 rows).
 * Only those two match. Chip is read from the detail view's Finish split (Chip vs Gun); the
 * list's "Chip Pace" is gun-based (Luddy Johnson chip 2:25:07, gun 2:28:31,
 * list pace 11:20 = gun / 13.1) and is ignored.
 */
export default {
  platform: 'athlinks',
  raceName: 'Atlantic City Marathon',
  tag: 'AtlanticCity',
  location: 'Atlantic City, NJ',
  masterEventId: 5181,
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
    'Atlantic City Marathon',
    'AmeriHealth Atlantic City Marathon',
    'Atlantic City Half Marathon',
  ],
  keywords: ['atlantic city'],
  keywordRequiresMarathon: true,
  eventIds: {
    2022: 1034563,
    2023: 1064611,
    2024: 1094085,
    2025: 1126179,
  },
  yearOverrides: {
    2026: {
      platform: 'raceresult',
      raceResult: {
        eventId: 430762,
        listName: 'Large Race Reports|Overall Results by Chip',
        chipField: 'Finish.CHIP',
        // The page's "Chip Pace" column, which is ceil(gun / distance); printed as shown.
        paceField: 'Finish.SPEEDORPACE',
        contests: {
          marathon: /^marathon$/i,
          half: /^half marathon$/i,
        },
      },
    },
  },
  raceDates: {
    2022: '2022-10-23',
    2023: '2023-10-22',
    2024: '2024-10-20',
    2025: '2025-10-19',
    2026: '2026-10-18',
  },
  raceDateSources: {
    2022: 'RunSignUp race 120555 event 545390 "Marathon" start 10/23/2022 08:00 + Athlinks master 5181 2022 weekend (Sat 10/22)',
    2023: 'RunSignUp race 120555 event 660055 "Marathon" start 10/22/2023 08:00 + Athlinks master 5181 2023 weekend (Sat 10/21)',
    2024: 'RunSignUp race 120555 event 777865 "Marathon" start 10/20/2024 08:00 + Athlinks master 5181 2024 weekend (Sat 10/19)',
    2025: 'RunSignUp race 120555 event 911551 "Marathon" start 10/19/2025 08:00 + my.raceresult.com 365346 "Atlantic City Marathon Weekend, 10/18/2025-10/19/2025" + mybestruns.com race date October 19th, 2025',
    2026: 'RunSignUp race 120555 event 1067572 "Marathon" start 10/18/2026 08:00 + my.raceresult.com 430762 "AmeriHealth Atlantic City Marathon Weekend - Sunday" 10/18/2026',
  },
  fallback: {
    platform: 'runsignup',
    raceId: 120555,
    resultSets: {
      2023: { marathon: 420047, half: 420048 },
      2024: { marathon: 505979, half: 505980 },
    },
    eventIds: {
      2023: { marathon: 660055, half: 660056 },
      2024: { marathon: 777865, half: 777866 },
    },
  },
}
