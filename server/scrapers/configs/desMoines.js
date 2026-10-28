/**
 * IMT Des Moines Marathon (Des Moines, IA) — marathon + half marathon.
 * Athlinks platform. Master event: https://www.athlinks.com/event/2138
 *
 * Timed by TrueTime Racing (results.truetimeracing.com, CId=16535); Athlinks
 * mirrors it. Per-year Athlinks race ids, read off
 * alaska.athlinks.com/events/race/api/find?searchTerm=Des%20Moines%20Marathon
 * (master 2138) and checked against each race's date:
 *   2022: 1033835 (10/16/2022)  2023: 1063937 (10/15/2023)
 *   2024: 1094088 (10/20/2024)  2025: 1126583 (10/19/2025)
 *
 * 2026 (ran Sun Oct 18 2026) is on TrueTime only (Athlinks had no 2026 race
 * on race day), so yearOverrides[2026] routes it to the 'truetime' platform:
 * results.truetimeracing.com/results.aspx?CId=16535&RId=1793, EIds read off
 * the race page's event list: 3 = "IMT DSM Marathon", 2 = "IMT DSM Half
 * Marathon" (4 = 5K, 5 = Marathon Relay, 6 = 10K: excluded). Gun 8:00 for both
 * (runsignup.com race 171802 events 1068634/1068635). TrueTime 2025 is
 * RId=1609 (served by Athlinks above).
 * Gun is reported (rawData only) as finish time of day minus gunStart. The
 * 2026 winners' finish time of day minus net is ~8:02:49 for both marathon and
 * half, so the real gun (or the timing clock) was ~2:49 off the published
 * 8:00; derived gun times run that much long. Chip is unaffected.
 *
 * Courses: "Marathon", "Half Marathon", "Marathon Relay", "5K Run" (2022 also
 * "* Virtual"). Anchored regexes keep relay/virtual out.
 * Athlinks time = TrueTime "Net Time" truncated to the second (chip). The
 * TrueTime start offset (e.g. Start 8:00:57 on an 8:00 gun) proves it is net.
 */
export default {
  platform: 'athlinks',
  raceName: 'Des Moines Marathon',
  tag: 'DesMoines',
  location: 'Des Moines, IA',
  masterEventId: 2138,
  raceDates: {
    2022: '2022-10-16',
    2023: '2023-10-15',
    2024: '2024-10-20',
    2025: '2025-10-19',
    2026: '2026-10-18',
  },
  raceDateSources: {
    2022: 'Athlinks race 1033835 date 10/16/2022 (master event 2138)',
    2023: 'Athlinks race 1063937 date 10/15/2023 (master event 2138)',
    2024: 'Athlinks race 1094088 date 10/20/2024 + runsignup.com race 171802 events dated 10/20/2024',
    2025: 'Athlinks race 1126583 date 10/19/2025 + runsignup.com race 171802 event 903489 (10/19/2025 08:00) + marathonguide 2025 details',
    2026: 'runsignup.com race 171802 event 1068634 "IMT Des Moines Marathon" 10/18/2026 08:00 + TrueTime results RId=1793 posted race day',
  },
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'half'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  courseMap: {
    marathon: /^marathon$/i,
    half: /^half marathon$/i,
  },
  distances: { marathon: 26.2, half: 13.1 },
  // Official 2025 results are TrueTime, whose pace floors (hundredths over 26.2 / 13.1).
  pagePace: { 2025: { rule: 'floor' } },
  distanceMiles: 26.2,
  aliases: [
    'Des Moines Marathon',
    'IMT Des Moines Marathon',
    'Des Moines Half Marathon',
    'IMT Des Moines Half Marathon',
  ],
  keywords: ['des moines'],
  keywordRequiresMarathon: true,
  eventIds: {
    2022: 1033835,
    2023: 1063937,
    2024: 1094088,
    2025: 1126583,
  },
  yearOverrides: {
    2026: {
      platform: 'truetime',
      trueTime: { cid: 16535, rid: 1793, gunStart: '08:00:00', events: { marathon: 3, half: 2 } },
    },
  },
}
