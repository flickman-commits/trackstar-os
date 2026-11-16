/**
 * IRONMAN 70.3 Maine (Augusta, ME). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-maine/results
 * Parent event 40494fab-1aa5-e611-9410-005056951bf1 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/40494fab-1aa5-e611-9410-005056951bf1 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 Maine",
  tag: 'IM703Maine',
  location: "Augusta, ME",
  ironman: { slug: 'im703-maine', eventId: '40494fab-1aa5-e611-9410-005056951bf1', half: true, places: ["maine"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 Maine", "Ironman 70.3 Maine"],
  raceDates: {
    2022: '2022-07-31',
    2023: '2023-07-30',
    2024: '2024-07-28',
    2025: '2025-07-27',
    2026: '2026-07-26',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 Maine\" wtc_eventdate 2022-07-31",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 Maine\" wtc_eventdate 2023-07-30",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 Maine\" wtc_eventdate 2024-07-28",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 Maine\" wtc_eventdate 2025-07-27",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 Maine\" wtc_eventdate 2026-07-26",
  },
  eventIds: {
    2022: '8dfdbf2e-4730-44b6-ab0a-af6c4cb64988',
    2023: '79e68221-3d59-46a2-b042-f347e0692868',
    2024: '34bde565-2345-478c-8b8f-544d18f3c20d',
    2025: 'dbef5370-8d4c-49bd-9508-302990a539da',
    2026: 'cd9c9f3e-f50d-4488-9e3a-5603e616a985',
  },
}
