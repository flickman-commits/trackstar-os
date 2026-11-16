/**
 * IRONMAN Canada-Ottawa (Ottawa, ON, Canada). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im-canada-ottawa/results
 * Parent event b8e35e3d-f89a-4545-86e8-327e1a93ff93 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/b8e35e3d-f89a-4545-86e8-327e1a93ff93 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN Canada-Ottawa",
  tag: 'IMCanadaOttawa',
  location: "Ottawa, ON, Canada",
  ironman: { slug: 'im-canada-ottawa', eventId: 'b8e35e3d-f89a-4545-86e8-327e1a93ff93', half: false, places: ["ottawa", "canada-ottawa"] },
  eventTypes: ['IRONMAN'],
  defaultEventType: 'IRONMAN',
  distanceMiles: 140.6,
  aliases: ["IRONMAN Canada-Ottawa", "Ironman Canada-Ottawa", "Ironman Ottawa", "Ottawa Ironman"],
  raceDates: {
    2025: '2025-08-03',
    2026: '2026-08-02',
  },
  raceDateSources: {
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN Canada-Ottawa\" wtc_eventdate 2025-08-03",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN Canada-Ottawa\" wtc_eventdate 2026-08-02",
  },
  noEdition: {
    2022: "IRONMAN Canada-Ottawa first ran in 2025.",
    2023: "IRONMAN Canada-Ottawa first ran in 2025.",
    2024: "IRONMAN Canada-Ottawa first ran in 2025.",
  },
  eventIds: {
    2025: '4435b4ed-8e34-4703-9a77-50e43201412b',
    2026: 'bf442555-30b5-4228-bfa4-5f8e621b6dd4',
  },
}
