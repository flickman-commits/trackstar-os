/**
 * IRONMAN California (Sacramento, CA). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im-california/results
 * Parent event d74670f6-7fb2-4813-96e1-fae4ab1b948c on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/d74670f6-7fb2-4813-96e1-fae4ab1b948c (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN California",
  tag: 'IMCalifornia',
  location: "Sacramento, CA",
  ironman: { slug: 'im-california', eventId: 'd74670f6-7fb2-4813-96e1-fae4ab1b948c', half: false, places: ["california", "sacramento"] },
  eventTypes: ['IRONMAN'],
  defaultEventType: 'IRONMAN',
  distanceMiles: 140.6,
  aliases: ["IRONMAN California", "Ironman California"],
  raceDates: {
    2022: '2022-10-23',
    2023: '2023-10-22',
    2024: '2024-10-27',
    2025: '2025-10-19',
    2026: '2026-10-18',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN California\" wtc_eventdate 2022-10-23",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN California\" wtc_eventdate 2023-10-22",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN California\" wtc_eventdate 2024-10-27",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN California\" wtc_eventdate 2025-10-19",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN California\" wtc_eventdate 2026-10-18",
  },
  eventIds: {
    2022: 'd65cf230-9959-4305-89e0-1a6742d2547a',
    2023: 'a19ca236-64cb-4260-89b2-3235f8de33d2',
    2024: 'ae0e5d71-3d79-4515-a179-11f044dccb61',
    2025: '1fc58eb1-18fc-417d-bd3b-5aa674132777',
    2026: '0122afc0-ade5-44d5-991e-86f0fd4dec30',
  },
}
