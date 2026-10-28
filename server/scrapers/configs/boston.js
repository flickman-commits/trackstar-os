/**
 * Boston Marathon - Mika Timing platform
 * Results: https://boston.r.mikatiming.com/{year}
 * Marathon-only event (no associated half, 5K, etc. on this timing site)
 *
 * Years on the site (checked 2026-10-20, one list search per year):
 *   - 2018 onward: the <li> list layout.
 *   - 2010 to 2017: the older <table class="list-table"> layout, columns
 *     HALF | Finish Net | Finish Gun (2010 to 2013 also "Prj. Finish"). The
 *     scraper takes Finish Net, the chip time.
 *   - 2009 and earlier are not on Mika: /2009/ (and 2008, 2005, 2002, 2001,
 *     2000, 1999) redirects to /{year}/2026/, the live edition. Those years
 *     return year_not_configured ("results not available") without a request.
 * Discovery: open https://boston.r.mikatiming.com/{year}/?pid=list&event_main_group={year}&event=R
 * and check the page's "meeting_year" and that the URL did not redirect.
 */
export default {
  platform: 'mika',
  raceName: 'Boston Marathon',
  tag: 'Boston Marathon',
  location: 'Boston, MA',
  baseUrlPattern: 'https://boston.r.mikatiming.com/{year}',
  // Boston's Mika Timing instance uses `event=R` rather than `MAR`
  eventCode: 'R',
  // First edition the Mika site hosts; earlier years redirect to 2026.
  firstResultsYear: 2010,
  eventTypes: ['Marathon'],
  defaultEventType: 'Marathon',
  distanceMiles: 26.2,
  // The printed pace is the detail page's "min/mile" (see MikaTimingScraper._withDetailPace).
  detailPace: true,
  aliases: [
    'Boston Marathon',
    'BAA Boston Marathon',
    'Bank of America Boston Marathon',
  ],
  keywords: ['boston'],
  keywordRequiresMarathon: true,
  /**
   * Verified dates, not computed ones. The "third Monday of April" rule is
   * Patriots' Day and has held so far, but a rule that happens to be right is
   * still a guess: the date is printed on the poster, so it is looked up.
   *
   * Source: the per-year Wikipedia articles for each edition and the BAA's own
   * marathon-dates page.
   */
  raceDates: {
    2010: '2010-04-19',
    2015: '2015-04-20',
    2018: '2018-04-16',
    2022: '2022-04-18',
    2023: '2023-04-17',
    2024: '2024-04-15',
    2025: '2025-04-21',
    2026: '2026-04-20',
  },
  raceDateSources: {
    2010: 'Wikipedia 2010 Boston Marathon edition article + MarathonGuide 2010 Boston results archive',
    2015: 'Wikipedia 2015 Boston Marathon edition article ("Monday, April 20 (Patriots\' Day in Massachusetts)")',
    2018: 'Wikipedia 2018 Boston Marathon edition article + ESPN race report on Kawauchi win',
    2022: 'Boston Globe race-day report dated 2022/04/18 + CNN race-day report dated 2022/04/18',
    2023: 'Washington Post race-day live coverage dated 2023/04/17 + UPI race-day report dated 2023/04/17',
    2024: 'Washington Post race-day live coverage dated 2024/04/15 + CNN race-day report dated 2024/04/15',
    2025: 'Wikipedia 2025 Boston Marathon edition article + BAA 129th Boston Marathon media resources page',
    2026: 'Boston Globe race-day report dated 2026/04/20 + NBC Boston 2026 results page',
  },
}
