/**
 * IRONMAN 70.3 Augusta (Augusta, GA). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-augusta/results
 * Parent event 3398aa20-f278-e111-b16a-005056956277 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/3398aa20-f278-e111-b16a-005056956277 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 Augusta",
  tag: 'IM703Augusta',
  location: "Augusta, GA",
  ironman: { slug: 'im703-augusta', eventId: '3398aa20-f278-e111-b16a-005056956277', half: true, places: ["augusta"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 Augusta", "Ironman 70.3 Augusta"],
  raceDates: {
    2022: '2022-09-25',
    2023: '2023-09-24',
    2025: '2025-09-28',
    2026: '2026-09-27',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 Augusta\" wtc_eventdate 2022-09-25",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 Augusta\" wtc_eventdate 2023-09-24",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 Augusta\" wtc_eventdate 2025-09-28",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 Augusta\" wtc_eventdate 2026-09-27",
  },
  noEdition: {
    2024: "IRONMAN 70.3 Augusta 2024 was cancelled (Hurricane Helene); IRONMAN lists no 2024 race.",
  },
  eventIds: {
    2022: '64085fc2-d99f-4aff-ac3e-3c8a5c7777fd',
    2023: '0e770043-0f42-4201-ba12-db3db74776cb',
    2025: '1671d800-f7fe-4ef2-9321-041dadb04d7b',
    2026: '9ef62436-f5df-455c-b97b-e96fe5afe36c',
  },
}
