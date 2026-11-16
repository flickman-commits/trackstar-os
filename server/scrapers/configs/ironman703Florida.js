/**
 * IRONMAN 70.3 Florida (Haines City, FL). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-florida/results
 * Parent event 5198aa20-f278-e111-b16a-005056956277 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/5198aa20-f278-e111-b16a-005056956277 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 Florida",
  tag: 'IM703Florida',
  location: "Haines City, FL",
  ironman: { slug: 'im703-florida', eventId: '5198aa20-f278-e111-b16a-005056956277', half: true, places: ["florida", "haines city"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 Florida", "Ironman 70.3 Florida"],
  raceDates: {
    2022: '2022-12-11',
    2023: '2023-12-10',
    2024: '2024-12-15',
    2025: '2025-12-14',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 Florida\" wtc_eventdate 2022-12-11",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 Florida\" wtc_eventdate 2023-12-10",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 Florida\" wtc_eventdate 2024-12-15",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 Florida\" wtc_eventdate 2025-12-14",
  },
  eventIds: {
    2022: '2c2f87f2-b6bf-4651-a968-3fc6266601aa',
    2023: '9724bb90-98af-4c92-af18-16fbd42c4981',
    2024: '3a9f941e-b4bf-4ff6-aa46-baa71a86e27d',
    2025: 'a5bd95df-bec2-413e-ba85-8f79657905e1',
  },
}
