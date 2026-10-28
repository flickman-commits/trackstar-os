/**
 * Ann Arbor Marathon (Trinity Health Probility Ann Arbor Marathon) - Athlinks,
 * with a RunSignUp fallback.
 *
 * Athlinks master 360782 ("Probility Ann Arbor Marathon"). Per-year event ids
 * were read off the Athlinks event finder
 *   https://alaska.athlinks.com/events/race/api/find?term=Ann%20Arbor%20Marathon
 * (master 360782 races[]) and each one opened through
 *   https://alaska.athlinks.com/Events/Race/Result/Api/{id}/Search?search=...
 * to confirm it holds that year's Marathon / Half Marathon courses.
 * Athlinks' own eventDate is the Saturday kids-race day (or earlier), not the
 * Sunday marathon, so dates below are NOT taken from it.
 *
 * Timing: RunSignUp results for 2022-2024 (race 29595); for 2025 the marathon
 * was published on RaceResult (my.raceresult.com/365741) and only the half on
 * RunSignUp. Athlinks mirrors all four years with the CHIP time: checked
 * against RaceResult 2025 (Elizabeth Smith chip 5:26:10 / gun 5:38:01 ->
 * Athlinks 5:26:10) and RunSignUp 2024 (Jessica Johnson chip 5:05:06.6 /
 * clock 5:06:22.9 -> Athlinks 5:05:06).
 *
 * Courses are anchored: the same events list "Pacers Marathon", "Lakefront
 * Marathon" (2022), "Half Marathon Walk", "Pacer Half Marathon", 10K and 5K.
 *
 * 2026 (Oct 4) is on RaceResult (my.raceresult.com/425548, header "Trinity
 * Health Probility Ann Arbor Marathon 2026, 10/04/2026") and not mirrored to
 * Athlinks yet, so 2026 uses yearOverrides -> platform 'raceresult'. List
 * "Result Lists|Overall Results" (contest 0, from /425548/results/config).
 * Its first grouping level is the contest short name: "Marathon", "Early
 * Marathon" (contest 2, "Early Start Option: Marathon (26.2)"), "Pacer
 * Marathon" (contest 11, Epic Pace Team), "Half Marathon", "Pacer Half",
 * "Half - Walk", "10K", "5K"; the relay (contest 3) is filtered out of the
 * list by RaceResult itself. Early Start and Pacer marathoners run the full
 * 26.2 on their own chip (detail view shows ChipTime from their own start), so
 * they count as marathon. Walk, 10K, 5K never match. The list's "Finish"
 * column is chip (Katherine Smith Finish 05:13:43 = detail ChipTime; GunTime
 * 05:15:18), but the scraper reads chip from the detail view anyway.
 *
 * Fallback: RunSignUp REST, used when Athlinks errors (it intermittently
 * answers "An error has occurred." for a valid search). Result set ids from
 * /Rest/race/29595/results/get-result-sets?event_id={eventId}. There is no
 * RunSignUp marathon set for 2025.
 */
export default {
  platform: 'athlinks',
  raceName: 'Ann Arbor Marathon',
  tag: 'AnnArbor',
  location: 'Ann Arbor, MI',
  masterEventId: 360782,
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'half'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  courseMap: {
    marathon: /^marathon$/i,
    half: /^half marathon$/i,
  },
  distances: { marathon: 26.2, half: 13.1 },
  // Official 2025 results are RaceResult's list, whose Pace column floors.
  pagePace: { 2025: { rule: 'floor' } },
  distanceMiles: 26.2,
  aliases: [
    'Ann Arbor Marathon',
    'Probility Ann Arbor Marathon',
    'Trinity Health Probility Ann Arbor Marathon',
    'Ann Arbor Half Marathon',
  ],
  keywords: ['ann arbor'],
  keywordRequiresMarathon: true,
  eventIds: {
    2022: 1032556,
    2023: 1063487,
    2024: 1093788,
    2025: 1125452,
  },
  yearOverrides: {
    2026: {
      platform: 'raceresult',
      raceResult: {
        eventId: 425548,
        listName: 'Result Lists|Overall Results',
        chipField: 'Finish',
        // The "Pace" column, about floor(chip / distance); read, not recomputed.
        paceField: 'Finish.PACE',
        contests: {
          marathon: /^(early |pacer )?marathon$/i,
          half: /^(half marathon|pacer half)$/i,
        },
      },
    },
  },
  raceDates: {
    2022: '2022-10-02',
    2023: '2023-10-01',
    2024: '2024-10-13',
    2025: '2025-10-12',
    2026: '2026-10-04',
  },
  raceDateSources: {
    2022: 'RunSignUp race 29595 event 548653 "Marathon (26.2)" start 10/2/2022 08:00 + Athlinks master 360782 2022 edition',
    2023: 'RunSignUp race 29595 event 654079 "Marathon (26.2)" start 10/1/2023 08:00 + Athlinks master 360782 2023 edition',
    2024: 'RunSignUp race 29595 event 773695 "Marathon (26.2)" start 10/13/2024 07:00 + racerepeat.com listing of the 13th running on October 13, 2024',
    2025: 'RunSignUp race 29595 event 942203 "Marathon (26.2)" start 10/12/2025 08:00 + my.raceresult.com event 365741 dated 2025-10-12',
    2026: 'RunSignUp race 29595 event 1116591 "Marathon (26.2)" start 10/4/2026 08:00 + my.raceresult.com event 425548 "Trinity Health Probility Ann Arbor Marathon 2026, 10/04/2026"',
  },
  fallback: {
    platform: 'runsignup',
    raceId: 29595,
    resultSets: {
      2022: { marathon: 344458, half: 344459 },
      2023: { marathon: 407130, half: 407131 },
      2024: { marathon: 497802, half: 497803 },
      2025: { half: 658537 },
    },
    eventIds: {
      2022: { marathon: 548653, half: 548655 },
      2023: { marathon: 654079, half: 654081 },
      2024: { marathon: 773695, half: 773699 },
      2025: { half: 942206 },
    },
  },
}
