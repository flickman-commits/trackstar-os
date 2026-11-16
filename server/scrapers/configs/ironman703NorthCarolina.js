/**
 * IRONMAN 70.3 North Carolina (Wilmington, NC). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-north-carolina/results
 * Parent event e4a5a6b8-0d92-e511-9409-005056951bf1 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/e4a5a6b8-0d92-e511-9409-005056951bf1 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 North Carolina",
  tag: 'IM703NorthCarolina',
  location: "Wilmington, NC",
  ironman: { slug: 'im703-north-carolina', eventId: 'e4a5a6b8-0d92-e511-9409-005056951bf1', half: true, places: ["north carolina", "wilmington"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 North Carolina", "Ironman 70.3 North Carolina"],
  raceDates: {
    2022: '2022-10-15',
    2023: '2023-10-21',
    2024: '2024-10-19',
    2025: '2025-10-25',
    2026: '2026-10-17',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 North Carolina\" wtc_eventdate 2022-10-15",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 North Carolina\" wtc_eventdate 2023-10-21",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 North Carolina\" wtc_eventdate 2024-10-19",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 North Carolina\" wtc_eventdate 2025-10-25",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 North Carolina\" wtc_eventdate 2026-10-17",
  },
  eventIds: {
    2022: '7c8387a8-1512-4357-a32f-5ca16dea9fab',
    2023: '3493d41f-2d4d-4075-a7ed-18c2798a976d',
    2024: 'e12fd041-e7e7-499c-9cb4-37887b5b40c2',
    2025: '2abe8e28-df19-4ec5-9ddc-9e2c86277ce4',
    2026: '151a488f-08ca-4b08-a63a-c9272aab277e',
  },
}
