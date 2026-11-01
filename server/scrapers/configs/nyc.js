/**
 * NYC Marathon - NYRR platform
 * Results: https://results.nyrr.org/event/M{year}/finishers
 */
export default {
  platform: 'nyrr',
  raceName: 'NYC Marathon',
  tag: 'NYC Marathon',
  location: 'New York, NY',
  eventCodePattern: 'M{year}',
  eventTypes: ['Marathon'],
  defaultEventType: 'Marathon',
  aliases: [
    'NYC Marathon',
    'New York City Marathon',
    'New York Marathon',
    'TCS New York City Marathon',
    'NYRR NYC Marathon'
  ],
  keywords: ['new york', 'nyc'],
  keywordRequiresMarathon: true,
  /**
   * Verified dates, not computed ones.
   *
   * Source: the per-year Wikipedia articles for the 2023-2025 editions; 2026
   * (the 50th running of the five-borough course) is confirmed as Sunday
   * November 1 by NYRR listings.
   */
  // Years the race did not run (pipeline.js flags an order for one as the wrong year).
  noEdition: {
    2012: 'It was cancelled in 2012 (Hurricane Sandy).',
  },
  raceDates: {
    2006: '2006-11-05',
    2015: '2015-11-01',
    // NYRR's own listing (startDateTime) and Wikipedia's edition page agree.
    2019: '2019-11-03',
    2022: '2022-11-06',
    2023: '2023-11-05',
    2024: '2024-11-03',
    2025: '2025-11-02',
    2026: '2026-11-01',
  },
  raceDateSources: {
    2006: 'Wikipedia 2006 New York City Marathon edition article + Fox News race report on the Gomes dos Santos win',
    2015: 'Wikipedia 2015 New York City Marathon edition article + CNN race-day gallery dated 2015/11/01',
    2019: 'NYRR event listing startDateTime + Wikipedia 2019 New York City Marathon edition article',
    2022: 'NYRR event listing startDateTime + Wikipedia 2022 New York City Marathon edition article',
    2023: 'Washington Post race-day live coverage dated 2023/11/05 + Wikipedia 2023 New York City Marathon edition article',
    2024: 'NYRR event listing startDateTime + Wikipedia 2024 New York City Marathon edition article',
    2025: 'NYRR press release 2025_1103_marathonmonday + Wikipedia 2025 New York City Marathon edition article',
    2026: 'NYRR tcsnycmarathon official race page + ABC7NY report on the 2026 professional field announcement',
  },
}
