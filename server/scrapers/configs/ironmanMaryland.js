/**
 * IRONMAN Maryland (Cambridge, MD). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im-maryland/results
 * Parent event 52f9c915-31ca-e311-b5f4-005056956277 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/52f9c915-31ca-e311-b5f4-005056956277 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN Maryland",
  tag: 'IMMaryland',
  location: "Cambridge, MD",
  ironman: { slug: 'im-maryland', eventId: '52f9c915-31ca-e311-b5f4-005056956277', half: false, places: ["maryland", "cambridge"] },
  eventTypes: ['IRONMAN'],
  defaultEventType: 'IRONMAN',
  distanceMiles: 140.6,
  aliases: ["IRONMAN Maryland", "Ironman Maryland"],
  raceDates: {
    2022: '2022-09-17',
    2023: '2023-09-16',
    2024: '2024-09-21',
    2025: '2025-09-20',
    2026: '2026-09-19',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN Maryland\" wtc_eventdate 2022-09-17",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN Maryland\" wtc_eventdate 2023-09-16",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN Maryland\" wtc_eventdate 2024-09-21",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN Maryland\" wtc_eventdate 2025-09-20",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN Maryland\" wtc_eventdate 2026-09-19",
  },
  eventIds: {
    2022: '59b45753-2b07-4b24-a32e-2f72b7c47023',
    2023: '4a35d978-53d0-4897-b718-ce8299b53a92',
    2024: 'd4fd21c6-c504-42fa-b9a6-bfa3e66231bb',
    2025: 'bc4f3a18-945f-493b-a363-9e993a41636d',
    2026: '46e754db-2cb0-4a75-b9ad-2b9d0140a90e',
  },
}
