/**
 * IRONMAN Chattanooga (Chattanooga, TN). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im-chattanooga/results
 * Parent event 0a742931-cf10-e311-9ec7-005056956277 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/0a742931-cf10-e311-9ec7-005056956277 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN Chattanooga",
  tag: 'IMChattanooga',
  location: "Chattanooga, TN",
  ironman: { slug: 'im-chattanooga', eventId: '0a742931-cf10-e311-9ec7-005056956277', half: false, places: ["chattanooga"] },
  eventTypes: ['IRONMAN'],
  defaultEventType: 'IRONMAN',
  distanceMiles: 140.6,
  aliases: ["IRONMAN Chattanooga", "Ironman Chattanooga"],
  raceDates: {
    2022: '2022-09-25',
    2023: '2023-09-24',
    2024: '2024-09-29',
    2025: '2025-09-28',
    2026: '2026-09-27',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN Chattanooga\" wtc_eventdate 2022-09-25",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN Chattanooga\" wtc_eventdate 2023-09-24",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN Chattanooga\" wtc_eventdate 2024-09-29",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN Chattanooga\" wtc_eventdate 2025-09-28",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN Chattanooga\" wtc_eventdate 2026-09-27",
  },
  eventIds: {
    2022: '71a620f4-b009-492e-b42d-ef4de60ef792',
    2023: 'd4796fc3-d1ac-4c69-9dc8-215d1ecb3853',
    2024: '545610b7-a7c5-4eea-ac20-ca75e220294f',
    2025: 'eecbddcc-fec9-4c52-ab35-28f77cb1c81b',
    2026: '002a44d9-34a7-4f44-bb46-dc254e3fcee9',
  },
}
