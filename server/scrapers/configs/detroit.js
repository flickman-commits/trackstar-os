/**
 * Detroit Free Press Marathon — marathon + half, mid-October.
 * Athlinks platform. Master: https://www.athlinks.com/event/154412
 *
 * Per-year event IDs and race dates both come from the master events API:
 *   https://alaska.athlinks.com/MasterEvents/Api/154412
 * That endpoint returns an `eventRaces[]` array carrying raceID, raceDateString
 * and eventCourses for every edition, so neither the ids nor the dates are
 * guessed here — they are read straight off the timer's own record.
 *
 * Course naming is the thing to be careful about. "Marathon" must be anchored:
 * the same event also lists "Marathon Relay" and "Kids Marathon", and a loose
 * /marathon/i would swallow both and hand back a relay leg as a marathon time.
 * The half has been renamed repeatedly — "International Half-Marathon" and
 * "Motor City Half-Marathon" (2024-25), "U.S.-Only Half-Marathon" (2022-23) —
 * so the half pattern matches on the suffix rather than any one brand name.
 *
 * 2026 MOVED TO CHRONOTRACK. Results: sites.chronotrack.com/event/95042/results
 * (same data as live.chronotrack.com/event/95042, read from the reignite API by
 * ChronoTrackScraper). `yearOverrides[2026]` below swaps platform for that one
 * year only; 2022-2025 still go through Athlinks exactly as before.
 *
 * ChronoTrack race ids for event 95042 were read off each race's own
 * `race.name` in the entry-result API (one entry per azpEventCourseId):
 *   252625 Marathon                    -> marathon
 *   252628 International Half-Marathon -> half
 *   252629 Motor City Half-Marathon    -> half
 *   excluded: 252627 Marathon Relay (MEMBER entries), 252630 5K, 252631 1 Mile,
 *             252632 Kids Marathon, 252633 DNF Designated Race
 * They are whitelisted with `courseIds`, because the event-wide name search
 * returns every race and the 5K / mile / kids / DNF rows are all IND entries
 * with a full-course time. Ids are per year; look them up again for 2027.
 *
 * Verified finishers: see chip-time-fixtures.js (Detroit 2024, Detroit 2026).
 */
export default {
  platform: 'athlinks',
  raceName: 'Detroit Marathon',
  tag: 'Detroit',
  location: 'Detroit, MI',
  masterEventId: 154412,
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'half'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  courseMap: {
    // Anchored — excludes "Marathon Relay" and "Kids Marathon".
    marathon: /^marathon$/i,
    // Matches International / Motor City / U.S.-Only Half-Marathon.
    half: /half-?marathon$/i,
  },
  distances: { marathon: 26.2, half: 13.1 },
  // Official results are RunnerTag (Enmotive): pace rounds up, over 42.195 km in
  // miles for 2023-24 and over 26.2 / 13.1 from 2025.
  pagePace: {
    2023: { rule: 'ceil', miles: { marathon: 26.21875, half: 13.109375 } },
    2024: { rule: 'ceil', miles: { marathon: 26.21875, half: 13.109375 } },
    2025: { rule: 'ceil' },
  },
  // Two half courses, two designs. The course a runner ran picks the file:
  // "Detroit Marathon / International Half Marathon" crosses into Canada; the
  // U.S.-only course was renamed Motor City in 2024 and uses that design.
  namedEvents: [
    { match: /international/i, label: 'International Half Marathon' },
    { match: /motor city|u\.?s\.?-?\s*only/i, label: 'Motor City Half Marathon' },
  ],
  distanceMiles: 26.2,
  aliases: [
    'Detroit Marathon',
    'Detroit Free Press Marathon',
    'Detroit Free Press/TCF Bank Marathon',
    'Detroit Half Marathon',
  ],
  keywords: ['detroit'],
  keywordRequiresMarathon: true,
  eventIds: {
    2022: 1032947,
    2023: 1064221,
    2024: 1093379,
    2025: 1121712,
  },
  /**
   * MARATHON-DAY dates, verified against press coverage of each edition.
   *
   * Do NOT take these from the Athlinks master events API. Its `raceDate` is
   * the event WEEKEND start — a Saturday — while the marathon runs Sunday. It
   * reports 10/19/2024 and 10/18/2025 against actual marathon days of Oct 20
   * and Oct 19. Copying the API value would put the poster's weather on the
   * wrong day, every year, while looking authoritative.
   *
   * The lesson generalises: a date pulled from a timer is only trustworthy
   * once you have checked WHICH day it refers to.
   */
  raceDates: {
    2022: '2022-10-16',
    2023: '2023-10-15',
    2024: '2024-10-20',
    2025: '2025-10-19',
    2026: '2026-10-18',
  },
  raceDateSources: {
    2022: 'detroitnews.com race report dated 2022-10-16 (Ryan Corby repeats) + marathonview.net 2022 race page',
    2023: 'detroitnews.com race report dated 2023-10-15 (Mitch Klingler wins) + enmotive.com 2023 results hub',
    2024: 'wxyz.com "2024 Detroit Free Press Marathon set for October 20th" + marathonview.net/race/137370',
    2025: 'cbsnews.com/detroit 2025 winners story + Oakland Press/AOL naming the 48th annual on Sunday, Oct. 19, 2025',
    2026: 'ChronoTrack event 95042 race 252625 "Marathon" plannedStartTime 1792321200 = Sun 2026-10-18 07:00 EDT + marathonguide.com 2026 details page, marathon Sunday October 18 2026 7 a.m. + freepmarathon.com (weekend Oct 16-18; the full is the Sunday)',
  },
  /**
   * 2026 only: ChronoTrack. Shallow-merged over this config by the factory
   * (createScraper in server/scrapers/index.js), so these keys replace the
   * Athlinks ones for 2026 and nothing else. Pace = chip time ÷
   * distances[matched key] (26.2 / 13.1), same convention as the Athlinks years.
   */
  yearOverrides: {
    2026: {
      platform: 'chronotrack',
      eventIds: { 2026: 95042 },
      courseIds: {
        2026: { marathon: [252625], half: [252628, 252629] },
      },
    },
  },
}
