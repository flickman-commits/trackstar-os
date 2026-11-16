/**
 * IRONMAN 70.3 Wisconsin (Madison, WI). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-wisconsin/results
 * Parent event adaedbb8-6095-e611-9410-005056951bf1 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/adaedbb8-6095-e611-9410-005056951bf1 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 Wisconsin",
  tag: 'IM703Wisconsin',
  location: "Madison, WI",
  ironman: { slug: 'im703-wisconsin', eventId: 'adaedbb8-6095-e611-9410-005056951bf1', half: true, places: ["wisconsin", "madison"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 Wisconsin", "Ironman 70.3 Wisconsin"],
  raceDates: {
    2022: '2022-09-10',
    2023: '2023-09-09',
    2024: '2024-09-07',
    2025: '2025-09-06',
    2026: '2026-09-12',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 Wisconsin\" wtc_eventdate 2022-09-10",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 Wisconsin\" wtc_eventdate 2023-09-09",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 Wisconsin\" wtc_eventdate 2024-09-07",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 Wisconsin\" wtc_eventdate 2025-09-06",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 Wisconsin\" wtc_eventdate 2026-09-12",
  },
  eventIds: {
    2022: 'ecbd42b2-1144-4a60-84cd-19d5e7029e69',
    2023: 'afe146c0-9e49-4a8e-b320-f2ed0ce4c619',
    2024: '2ab591b3-84fa-4abe-96ea-f8d5d20b8eb3',
    2025: 'f574a527-2f31-4bb3-8b45-d1908a220996',
    2026: '251f9699-d503-41d8-986a-b102eeeabd7e',
  },
}
