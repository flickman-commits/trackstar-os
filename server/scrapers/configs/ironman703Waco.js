/**
 * IRONMAN 70.3 Waco (Waco, TX). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-waco/results
 * Parent event ed0ed7f4-3fca-e711-941b-005056951bf1 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/ed0ed7f4-3fca-e711-941b-005056951bf1 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 Waco",
  tag: 'IM703Waco',
  location: "Waco, TX",
  ironman: { slug: 'im703-waco', eventId: 'ed0ed7f4-3fca-e711-941b-005056951bf1', half: true, places: ["waco"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 Waco", "Ironman 70.3 Waco"],
  raceDates: {
    2022: '2022-10-16',
    2023: '2023-10-15',
    2024: '2024-10-06',
    2025: '2025-10-05',
    2026: '2026-10-04',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 Waco\" wtc_eventdate 2022-10-16",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 Waco\" wtc_eventdate 2023-10-15",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 Waco\" wtc_eventdate 2024-10-06",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 Waco\" wtc_eventdate 2025-10-05",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 Waco\" wtc_eventdate 2026-10-04",
  },
  eventIds: {
    2022: '21e399c5-51c5-4420-8b7f-aa2c91dfe83d',
    2023: 'cc0a2ef2-daa0-47a8-a1a5-29d3159ad63f',
    2024: 'e42f12ce-2366-4beb-aadf-844c9142c76f',
    2025: 'a34c72f5-d303-4b85-bd36-bcc44f46c1c7',
    2026: '190ed93a-7bd5-420b-ae54-46e9c970e9b1',
  },
}
