/**
 * Honolulu Marathon (JAL Honolulu Marathon), second Sunday of December.
 * Athlinks platform. Master: https://www.athlinks.com/event/3321
 *
 * The race's own results page (honolulumarathon.org/results) links to Pacific
 * Sport Events & Timing (pseresults.com/events/1207|1215|1216/results), and
 * as of 2026-10 those links 404. Athlinks carries the full history, so it is
 * the scrapeable source.
 *
 * Discovery: per-year raceIDs and course names read off the master events API
 *   https://alaska.athlinks.com/MasterEvents/Api/3321  (eventRaces[])
 *   2022: 1042068  course "Honolulu Marathon"
 *   2023: 1068315  course "Honolulu Marathon"
 *   2024: 1098986  course "Marathon"
 *   2025: 1132344  course "Marathon"
 * Each was opened and its edition date checked. The API's date for 2022 and
 * 2023 is the Saturday before race day, so the raceDates below come from press
 * coverage, not the API.
 *
 * Course matching is anchored so it never takes the "Marathon Wheelchair",
 * "Hand Cycle", "Virtual Honolulu Marathon (...)", 10K or mile courses.
 *
 * Chip vs gun: Athlinks shows a single "TIME RUN" for this race and ranks it
 * as CHIP (overallBracketRaceRankType: CHIP); no gun time is published, so it
 * cannot be cross-checked here. Each result is a single leg (no splits).
 *
 * Years NOT covered: 2021 (1st Dec, COVID edition) and earlier are on Athlinks
 * from 1997 on but are not wired. 1979 is not on Athlinks or any timer
 * site found (oldest Athlinks edition is 1997); those orders need manual
 * research.
 *
 * No defaultEventId on purpose: an unconfigured year fails loudly.
 */
export default {
  platform: 'athlinks',
  raceName: 'Honolulu Marathon',
  tag: 'Honolulu',
  location: 'Honolulu, HI',
  masterEventId: 3321,
  eventTypes: ['Marathon'],
  eventSearchOrder: ['marathon'],
  eventLabels: { marathon: 'Marathon' },
  courseMap: {
    marathon: /^(honolulu )?marathon$/i,
  },
  distances: { marathon: 26.2 },
  // Official 2025 results are RaceResult's list: Pace floors, over 42.195 km in miles.
  pagePace: { 2025: { rule: 'floor', miles: { marathon: 26.21875 } } },
  distanceMiles: 26.2,
  aliases: [
    'Honolulu Marathon',
    'JAL Honolulu Marathon',
  ],
  keywords: ['honolulu'],
  keywordRequiresMarathon: true,
  eventIds: {
    2022: 1042068,
    2023: 1068315,
    2024: 1098986,
    2025: 1132344,
  },
  raceDates: {
    2022: '2022-12-11',
    2023: '2023-12-10',
    2024: '2024-12-08',
    2025: '2025-12-14',
    2026: '2026-12-13',
  },
  raceDateSources: {
    2022: 'honolulumarathon.org "Ethiopians Mengstu, Ayalew prevail at 50th Honolulu Marathon" + staradvertiser.com results published 2022-12-12 (race Sunday Dec 11)',
    2023: 'spectrumlocalnews.com 2023/12/10 "Kenya\'s Paul Lonyangata, Cynthia Limo take Honolulu Marathon titles" + hawaiinewsnow.com 2023/12/10',
    2024: 'Athlinks result page for event 1098986 ("December 08, 2024") + master events API raceDate 12/8/2024 (a Sunday)',
    2025: 'hawaiinewsnow.com 2025/12/14 "Rain-soaked 2025 Honolulu Marathon produces pair of first-time winners" + spectrumlocalnews.com 2025/12/14 (Weldlibanos, Hauger-Thackery win)',
    2026: 'honolulumarathon.org/events/honolulu-marathon: "The 2026 JAL Honolulu Marathon is on December 13, 2026" (not yet run; no eventIds)',
  },
}
