/**
 * Richmond Marathon weekend (Richmond, VA) - RunSignUp race 53399, results by
 * Dennis Joffe. One Saturday, three distances, all sold and searched: the
 * Allianz Richmond Marathon, CarMax Richmond Half Marathon and Capital One
 * (formerly VCU Health) Richmond 8k. A name found in more than one of them
 * comes back ambiguous for a person to pick; it is never auto-picked.
 *
 * Where the results live: richmondmarathon.org/results/ lists every year with
 * "Searchable Results: Marathon, Half Marathon & 8k". 2021-2025 all link
 * https://runsignup.com/Race/Results/53399 (2021 with #resultSetId-227238);
 * 2020 (virtual) and 2019 link Xacte (results2.xacte.com/#/e/2331,
 * results.xacte.com/?id=2210) and are not wired (2020 was virtual; 2019 is
 * outside the window). Never wire a year before 2020.
 *
 * Per-year ids (read 2026-11-12, not derivable from each other):
 *   1. RunSignUp event ids per year: GET
 *      https://runsignup.com/Rest/race/53399?format=json&most_recent_events_only=F
 *      lists every event with its name and start time. Take the three
 *      in-person ones ("<year> Allianz (Partners) Richmond Marathon",
 *      "<year> CarMax Richmond Half Marathon", "<year> VCU Health / Capital
 *      One Richmond 8k"), never the "Virtual - ..." or "Medal Mailed" ones.
 *   2. Result set ids per event: GET
 *      https://runsignup.com/Rest/race/53399/results/get-result-sets?format=json&event_id=<event>
 *      Use the overall set ("Marathon Results", "Full Results", "Half
 *      Results", "8K Results"...). The Wheelchair and Non-Binary sets are not
 *      sold; the overall sets already include the non-binary finishers
 *      (2023: Whit Blair is 3rd in 425037; 2025: Austin Nevins is in 621927).
 *   2022: events 553994 / 553995 / 553996 (start 11/12/2022)
 *         sets   360677 "Full Results" / 360477 "Half Marathon" / 355411 "8K Results"
 *   2023: events 665695 / 665696 / 665697 (start 11/11/2023)
 *         sets   425037 "Marathon Results" / 425038 "Half Results" / 425041 "8K Results"
 *   2024: events 784052 / 784053 / 784054 (start 11/16/2024)
 *         sets   516136 "Marathon Results" / 520173 "Half Marathon Results" / 511318 "8K Results"
 *   2025: events 923215 / 923216 / 923217 (start 11/15/2025)
 *         sets   621927 "Marathon Results" / 636597 "Half Marathon Results" / 636609 "8K Results"
 *   2021 (events 455493 / 455494 / 455495) is on RunSignUp too but is outside
 *   the last-four window; add it the same way if a 2021 order comes in.
 *
 * 2026 (Saturday Nov 14): events 1078283 (marathon) / 1078284 (half) /
 * 1078285 (8K), with empty result sets already created (754052 "Allianz
 * Richmond Marathon Overall Results", 754064 "CarMax Richmond Half Marathon
 * Overall Results", 754065 "Capital One Richmond 8K Overall Results"). The race
 * has not run, so they are NOT configured. Once results are posted: re-run the
 * get-result-sets call for each 2026 event (the set ids can change when the
 * timer republishes), pull a runner through get-results to confirm the set is
 * filled with 2026 finishers, then add
 *   eventIds[2026]   = { marathon: 1078283, halfMarathon: 1078284, eightK: 1078285 }
 *   resultSets[2026] = { marathon: <set>, halfMarathon: <set>, eightK: <set> }
 *
 * Times: the official page (runsignup.com/Race/Results/53399) prints whole
 * seconds, and the REST chip_time matches it. "Clock Time" is gun time and is
 * never used. The page's Pace column is the overall pace and is what prints
 * (the scraper takes it as shown); the 8K's pace is against 4.97 mi
 * (24:19 -> 4:54). Splits on the page are cumulative times, not paces.
 *
 * Event labels are exactly 'Marathon', 'Half Marathon' and '8K'.
 */
export default {
  platform: 'runsignup',
  raceName: 'Richmond Marathon',
  tag: 'Richmond',
  raceId: 53399,
  location: 'Richmond, VA',
  raceDates: {
    2022: '2022-11-12',
    2023: '2023-11-11',
    2024: '2024-11-16',
    2025: '2025-11-15',
    2026: '2026-11-14',
  },
  raceDateSources: {
    2022: 'RunSignUp race 53399 event 553994 start 11/12/2022 07:45 + richmondmarathon.org/results "November 12, 2022"',
    2023: 'RunSignUp race 53399 event 665695 start 11/11/2023 07:00 + richmondmarathon.org/results "November 11, 2023"',
    2024: 'RunSignUp race 53399 event 784052 start 11/16/2024 07:00 + richmondmarathon.org/results "November 16, 2024"',
    2025: 'RunSignUp race 53399 event 923215 start 11/15/2025 07:00 + richmondmarathon.org/results "November 15, 2025" + WTVR race-day coverage 2025-11-15',
    2026: 'RunSignUp race 53399 event 1078283 start 11/14/2026 07:00 (race page "Saturday November 14, 2026")',
  },
  eventTypes: ['Marathon', 'Half Marathon', '8K'],
  eventSearchOrder: ['marathon', 'halfMarathon', 'eightK'],
  eventLabels: {
    marathon: 'Marathon',
    halfMarathon: 'Half Marathon',
    eightK: '8K',
  },
  // Pace divides by these only when the page prints none. 8K = 4.97 mi, the
  // distance RunSignUp's own 8K pace uses.
  distances: { marathon: 26.2, halfMarathon: 13.1, eightK: 4.97 },
  aliases: [
    'Richmond Marathon',
    'Allianz Richmond Marathon',
    'Allianz Partners Richmond Marathon',
    'VCU Health Richmond Marathon',
    'Richmond Half Marathon',
    'CarMax Richmond Half Marathon',
    'Richmond 8K',
    'Capital One Richmond 8K',
    'VCU Health Richmond 8K',
    'Richmond Marathon 8K',
    'Richmond',
  ],
  keywords: ['richmond'],
  keywordRequiresMarathon: true,
  eventIds: {
    2022: { marathon: 553994, halfMarathon: 553995, eightK: 553996 },
    2023: { marathon: 665695, halfMarathon: 665696, eightK: 665697 },
    2024: { marathon: 784052, halfMarathon: 784053, eightK: 784054 },
    2025: { marathon: 923215, halfMarathon: 923216, eightK: 923217 },
  },
  resultSets: {
    2022: { marathon: 360677, halfMarathon: 360477, eightK: 355411 },
    2023: { marathon: 425037, halfMarathon: 425038, eightK: 425041 },
    2024: { marathon: 516136, halfMarathon: 520173, eightK: 511318 },
    2025: { marathon: 621927, halfMarathon: 636597, eightK: 636609 },
  },
}
