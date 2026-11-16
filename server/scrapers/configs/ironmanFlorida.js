/**
 * IRONMAN Florida (Panama City Beach, FL). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im-florida/results
 * Parent event b998aa20-f278-e111-b16a-005056956277 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/b998aa20-f278-e111-b16a-005056956277 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN Florida",
  tag: 'IMFlorida',
  location: "Panama City Beach, FL",
  ironman: { slug: 'im-florida', eventId: 'b998aa20-f278-e111-b16a-005056956277', half: false, places: ["florida", "panama city", "panama city beach"] },
  eventTypes: ['IRONMAN'],
  defaultEventType: 'IRONMAN',
  distanceMiles: 140.6,
  aliases: ["IRONMAN Florida", "Ironman Florida"],
  raceDates: {
    2022: '2022-11-05',
    2023: '2023-11-04',
    2024: '2024-11-02',
    2025: '2025-11-01',
    2026: '2026-11-07',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN Florida\" wtc_eventdate 2022-11-05",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN Florida\" wtc_eventdate 2023-11-04",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN Florida\" wtc_eventdate 2024-11-02",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN Florida\" wtc_eventdate 2025-11-01",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN Florida\" wtc_eventdate 2026-11-07",
  },
  eventIds: {
    2022: 'f1d7fbf8-7bd7-44cf-bd37-9492d1eddc1e',
    2023: '811402c9-91a1-4ebb-b102-e083a44876e7',
    2024: 'af3f560c-494c-464d-9ed9-c0fbd05ef73b',
    2025: '83af8238-4ace-4d88-a3d3-0371f9b88294',
    2026: 'b46acafa-1a50-4aab-9b39-b1cf344ac41e',
  },
}
