/**
 * Irish Life Dublin Marathon (Dublin, Ireland). Marathon only.
 *
 * Results: the race's own site, raceresults.dublinmarathon.ie, which
 * irishlifedublinmarathon.ie/results links as "Race Results"
 * (platforms/DublinMarathonScraper.js).
 *
 * Race ids are the values of the "Race" select on raceresults.dublinmarathon.ie,
 * read 2026-11-26 off the option text ("2025 Irish Life Dublin Marathon" is
 * 1167). They are not sequential (2022 is 126, 2023 is 1129). Skip the
 * Wheelchair and VI entries; they are separate races. The results-page slugs
 * are the site's "View results" links.
 *
 * 2020 and 2021 were not run in person (virtual only), so neither is on the
 * site. The site has 2019 and older; never configure a year before 2020.
 */
export default {
  platform: 'dublinmarathon',
  raceName: 'Dublin Marathon',
  tag: 'Dublin',
  location: 'Dublin, Ireland',
  raceDates: {
    2022: '2022-10-30',
    2023: '2023-10-29',
    2024: '2024-10-27',
    2025: '2025-10-26',
    2026: '2026-10-25',
  },
  raceDateSources: {
    2022: 'Athletics Ireland: 2022 National Marathon Championships with the Irish Life Dublin Marathon, Sunday October 30th',
    2023: 'Transport for Ireland event page "Dublin Marathon 29 Oct 2023" + marathonguide 2023 details (Oct 29, 2023)',
    2024: 'irishlifedublinmarathon.ie: "It will take place on Sunday 27th October 2024"',
    2025: 'RTE race report dated 2025-10-26 (rte.ie/sport/athletics/2025/1026) + World Athletics results for 26 Oct 2025',
    2026: 'Transport for Ireland and dublin.ie listings: Sunday 25 October 2026',
  },
  dublinRaceIds: {
    2022: 126,
    2023: 1129,
    2024: 1150,
    2025: 1167,
    2026: 1173,
  },
  dublinResultSlugs: {
    2022: '2022-irish-life-dublin-marathon',
    2023: '2023-irish-life-dublin-marathon',
    2024: '2024-irish-life-dublin-marathon',
    2025: '2025-irish-life-dublin-marathon',
    2026: '2026-irish-life-dublin-marathon',
  },
  eventTypes: ['Marathon'],
  defaultEventType: 'Marathon',
  distanceMiles: 26.2,
  aliases: [
    'Dublin Marathon',
    'Irish Life Dublin Marathon',
    'Dublin City Marathon',
    'KBC Dublin Marathon',
    'SSE Airtricity Dublin Marathon',
  ],
  keywords: ['dublin'],
  keywordRequiresMarathon: true,
}
