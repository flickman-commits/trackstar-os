/**
 * IRONMAN 70.3 Alcúdia-Mallorca (Alcúdia, Spain). IRONMAN platform (IronmanScraper).
 * Official results: https://www.ironman.com/races/im703-mallorca/results
 * Parent event 5d98aa20-f278-e111-b16a-005056956277 on labs-v2.competitor.com (the id in that
 * page's results embed). Each year below is a subevent read off
 * https://labs-v2.competitor.com/results/event/5d98aa20-f278-e111-b16a-005056956277 (__NEXT_DATA__
 * subevents: wtc_eventid, wtc_name, wtc_eventdate), read 2026-11-16. To add a
 * year, read the new subevent there; never guess an id.
 * 2023 IRONMAN 70.3 Mallorca DO-NOT-USE (see notes) (a1b28f02-7139-4135-80f9-1857a7aad524) left out.
 */
export default {
  platform: 'ironman',
  raceName: "IRONMAN 70.3 Alcúdia-Mallorca",
  tag: 'IM703Mallorca',
  location: "Alc\u00fadia, Spain",
  ironman: { slug: 'im703-mallorca', eventId: '5d98aa20-f278-e111-b16a-005056956277', half: true, places: ["mallorca", "alcudia", "alcúdia"] },
  eventTypes: ['IRONMAN 70.3'],
  defaultEventType: 'IRONMAN 70.3',
  distanceMiles: 70.3,
  aliases: ["IRONMAN 70.3 Alcúdia-Mallorca", "IRONMAN 70.3 Alcudia-Mallorca", "IRONMAN 70.3 Mallorca", "Zafiro Ironman - Alcudia-Mallorca", "Zafiro IRONMAN 70.3 Alcudia-Mallorca"],
  raceDates: {
    2022: '2022-05-07',
    2023: '2023-05-13',
    2024: '2024-05-11',
    2025: '2025-05-10',
    2026: '2026-05-09',
  },
  raceDateSources: {
    2022: "labs-v2.competitor.com subevent \"2022 IRONMAN 70.3 Mallorca\" wtc_eventdate 2022-05-07",
    2023: "labs-v2.competitor.com subevent \"2023 IRONMAN 70.3 Mallorca\" wtc_eventdate 2023-05-13",
    2024: "labs-v2.competitor.com subevent \"2024 IRONMAN 70.3 Alcúdia-Mallorca\" wtc_eventdate 2024-05-11",
    2025: "labs-v2.competitor.com subevent \"2025 IRONMAN 70.3 Alcúdia-Mallorca\" wtc_eventdate 2025-05-10",
    2026: "labs-v2.competitor.com subevent \"2026 IRONMAN 70.3 Alcúdia-Mallorca\" wtc_eventdate 2026-05-09",
  },
  eventIds: {
    2022: 'f29efe58-05b8-4106-9c17-704fc2d80208',
    2023: '566d3149-da1e-4842-abbb-2b95dae023cf',
    2024: '65614825-bc08-495a-9d77-cab42c8265ae',
    2025: '4db17435-c87f-45ce-b8f8-64260d4ff21f',
    2026: '646075b9-b1b7-4144-b33b-8faa4ab118d5',
  },
}
