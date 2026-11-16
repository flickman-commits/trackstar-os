/**
 * IRONMAN Wisconsin (Madison, WI). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im-wisconsin/results
 * Parent event e598aa20-f278-e111-b16a-005056956277 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/e598aa20-f278-e111-b16a-005056956277 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN Wisconsin",
  tag: 'IMWisconsin',
  location: "Madison, WI",
  ironman: { slug: 'im-wisconsin', eventId: 'e598aa20-f278-e111-b16a-005056956277', half: false, places: ["wisconsin", "madison"] },
  eventTypes: ['IRONMAN'],
  defaultEventType: 'IRONMAN',
  distanceMiles: 140.6,
  aliases: ["IRONMAN Wisconsin", "Ironman Wisconsin"],
  raceDates: {
    2022: '2022-09-11',
    2023: '2023-09-10',
    2024: '2024-09-08',
    2025: '2025-09-07',
    2026: '2026-09-13',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN Wisconsin\" wtc_eventdate 2022-09-11",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN Wisconsin\" wtc_eventdate 2023-09-10",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN Wisconsin\" wtc_eventdate 2024-09-08",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN Wisconsin\" wtc_eventdate 2025-09-07",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN Wisconsin\" wtc_eventdate 2026-09-13",
  },
  eventIds: {
    2022: '00d24264-8938-4a98-a10f-56dc3473e541',
    2023: 'f81b2e11-ec16-43ac-941b-4386106a9a28',
    2024: '2589106a-7c4e-4218-9922-fc5443c1b29e',
    2025: '3bd630ca-4c2a-4775-87bd-b0d2c2764c53',
    2026: '1226621d-a297-4b14-aa34-f08811a460f3',
  },
}
