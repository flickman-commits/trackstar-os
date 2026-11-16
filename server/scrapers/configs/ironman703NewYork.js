/**
 * IRONMAN 70.3 New York (Jones Beach, NY). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-new-york/results
 * Parent event c7c8f92c-9cb1-4d76-9700-20c57ae28f17 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/c7c8f92c-9cb1-4d76-9700-20c57ae28f17 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 New York",
  tag: 'IM703NewYork',
  location: "Jones Beach, NY",
  ironman: { slug: 'im703-new-york', eventId: 'c7c8f92c-9cb1-4d76-9700-20c57ae28f17', half: true, places: ["new york", "jones beach"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 New York", "Ironman 70.3 New York"],
  raceDates: {
    2023: '2023-09-23',
    2024: '2024-09-28',
    2025: '2025-09-20',
    2026: '2026-10-24',
  },
  raceDateSources: {
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 New York\" wtc_eventdate 2023-09-23",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 New York\" wtc_eventdate 2024-09-28",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 New York\" wtc_eventdate 2025-09-20",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 New York\" wtc_eventdate 2026-10-24",
  },
  noEdition: {
    2022: "IRONMAN 70.3 New York first ran in 2023 (Jones Beach); IRONMAN lists no earlier race.",
  },
  eventIds: {
    2023: '969f5eca-6c39-47d1-955c-a0868ac38a58',
    2024: 'e4e5605e-9fd5-4aa6-ab3e-7fe1d7871327',
    2025: 'd6d5f967-fe97-49ea-b497-c80584cce98c',
    2026: 'c1a7ef77-dfd8-4cd7-a2dd-b22ab9e9d776',
  },
}
