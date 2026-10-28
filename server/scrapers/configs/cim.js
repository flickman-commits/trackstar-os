/**
 * California International Marathon (CIM) - MyRace.ai platform
 * Results: https://myrace.ai/races/cim_{year}/results
 */
export default {
  platform: 'myrace',
  raceName: 'California International Marathon',
  tag: 'CIM',
  /**
   * Sacramento, not the course description.
   *
   * This read "Folsom to Sacramento, CA", which is true of the route and
   * useless to a geocoder: the weather lookup could not resolve it, so CIM
   * orders arrived with no weather and Eli was retyping the city by hand on
   * every one. The race finishes at the State Capitol in Sacramento, so that
   * is the city whose weather belongs on the print.
   */
  location: 'Sacramento, CA',
  raceIdPattern: 'cim_{year}',
  eventTypes: ['Marathon'],
  defaultEventType: 'Marathon',
  distanceMiles: 26.2,
  // The results list runcim.org links shows pace as round(chip / 42.195 km in
  // miles); MyRace's own paceTime floors it and its athlete page uses 26.2.
  // The printed pace matches the list.
  listPaceMiles: 26.21875,
  aliases: [
    'California International Marathon',
    'CIM Marathon',
    'CIM',
    // How these rows are actually named in the database.
    'California International Marathon (CIM)',
  ],
  keywords: ['california international', 'cim'],
  keywordRequiresMarathon: false, // 'cim' alone is enough
  /**
   * Verified dates. There is no calculateDate here on purpose.
   *
   * The old rule was "first Sunday of December", and it is wrong in exactly
   * the years December 1st is itself a Sunday: it returns Dec 1 for 2019 and
   * for 2024, when the race was actually held on Dec 8 both times. That is a
   * full week off, on the date printed on the poster and on the date the
   * weather is looked up from, and it looks entirely plausible.
   *
   * A year not listed here now resolves to no date at all rather than to a
   * confident guess. That is the point: a missing date is visible and gets
   * fixed, a wrong one ships.
   *
   * Sources: Wikipedia's edition table, corroborated by the race's own
   * listings for the recent years.
   */
  raceDates: {
    // 2017: marathonguide.com MIDD=687171203 + chronotrack event-31790 live results
    2017: '2017-12-03',
    // 2018: runningusa.org "7,831 marathon runners crossed the finish line on December 2" + flotrack 2018 CIM results
    2018: '2018-12-02',
    // 2019: NOT SOURCED. Three searches found only the weekday rule, never a
    //       page naming the day, and the blocking sites are unreachable from CI.
    //       This one year is why cim.js still has no raceDateSources block.
    2019: '2019-12-08',
    // 2020 was cancelled (COVID). No date, because there was no race.
    // 2021: world-track.org 2021 recap "Sunday, December 5 at 7:00 a.m. PST" + letsrun.com 2021 CIM results
    2021: '2021-12-05',
    // 2022: watchathletics.com "took place on Sunday, December 4" + pausatf.org CIM recap
    2022: '2022-12-04',
    // 2023: carmichaeltimes.com "On Sunday, December 3, 11,000 runners" + marathonguide.com MIDD=687231203
    2023: '2023-12-03',
    // 2024: my.raceresult.com/319471 "California International Marathon, 12/08/2024" + pausatf.org 2024 overall results
    2024: '2024-12-08',
    // 2025: my.raceresult.com/374113 "California International Marathon, 12/07/2025" + abc10.com 2025 winners story
    2025: '2025-12-07',
    // 2026: raceroster.com 2026 event 112918 + marathonscout.com "Sunday, December 6, 2026"
    2026: '2026-12-06',
  },
}
