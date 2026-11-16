/**
 * IRONMAN 70.3 Chattanooga (Chattanooga, TN). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-chattanooga/results
 * Parent event e2352999-586b-e411-93fa-005056951bf1 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/e2352999-586b-e411-93fa-005056951bf1 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 Chattanooga",
  tag: 'IM703Chattanooga',
  location: "Chattanooga, TN",
  ironman: { slug: 'im703-chattanooga', eventId: 'e2352999-586b-e411-93fa-005056951bf1', half: true, places: ["chattanooga"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 Chattanooga", "Ironman 70.3 Chattanooga"],
  raceDates: {
    2022: '2022-05-22',
    2023: '2023-05-21',
    2024: '2024-05-19',
    2025: '2025-05-18',
    2026: '2026-05-17',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 Chattanooga\" wtc_eventdate 2022-05-22",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 Chattanooga\" wtc_eventdate 2023-05-21",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 Chattanooga\" wtc_eventdate 2024-05-19",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 Chattanooga\" wtc_eventdate 2025-05-18",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 Chattanooga\" wtc_eventdate 2026-05-17",
  },
  eventIds: {
    2022: '8980bc3f-3694-4e37-b53f-d2378a26d7c9',
    2023: '91fa1be8-3002-4755-a8ef-01b8254d5d44',
    2024: 'c644b569-80b0-4346-ab8d-42d46b037abc',
    2025: 'd4ab9ef4-8b7f-43c2-a594-c432415d8f90',
    2026: '82cf961d-85e6-40bb-8e86-209517a2602d',
  },
}
