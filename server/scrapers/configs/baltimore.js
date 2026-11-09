/**
 * Baltimore Running Festival (Baltimore Marathon) — marathon + half, October.
 * SVE Timing platform (US Sports Timing), organizer Corrigan Sports.
 * Results: https://results.svetiming.com/Corrigan-Sports-Enterprises/events/{year}/baltimore-running-festival/results
 *
 * Every year from 2021 to 2026 is live at that URL with no per-year id to look
 * up — the year IS the path segment — so there is no eventIds map here and no
 * chance of a year silently borrowing another year's event.
 *
 * Division names are stable across years but the field includes a lot we do
 * not sell prints for: MARATHON RIM and HALF MARATHON RIM (wheelchair),
 * HANDCYCLE variants, 10K, 5K and the "Balti-MORON-a-thon" novelty entry. The
 * patterns below are anchored so "MARATHON" cannot swallow "MARATHON RIM" or
 * "MARATHON HANDCYCLE" and hand back a wheelchair time as a running time.
 *
 * Verified finisher: see chip-time-fixtures.js (Baltimore 2025).
 */
export default {
  platform: 'svetiming',
  firstYear: 2021,
  raceName: 'Baltimore Marathon',
  tag: 'Baltimore',
  location: 'Baltimore, MD',
  organizer: 'Corrigan-Sports-Enterprises',
  eventSlug: 'baltimore-running-festival',
  eventTypes: ['Marathon', 'Half Marathon'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  divisionMap: {
    // Anchored — excludes RIM (wheelchair) and HANDCYCLE divisions.
    marathon: /^\s*MARATHON\s*$/i,
    half: /^\s*HALF MARATHON\s*$/i,
  },
  distances: { marathon: 26.2, half: 13.1 },
  distanceMiles: 26.2,
  aliases: [
    'Baltimore Marathon',
    'Baltimore Running Festival',
    'Baltimore Half Marathon',
  ],
  keywords: ['baltimore'],
  keywordRequiresMarathon: true,
  /**
   * Real dates, read off each year's own results page title
   * ("Race Results for October 18, 2025 Baltimore Running Festival").
   *
   * The scraper re-reads that title at run time and prefers it, so these are
   * the safety net for a year whose page is unreachable. Baltimore is a
   * single-day Saturday event, so unlike Athlinks' weekend-start dates this
   * page date really is race day.
   */
  raceDates: {
    2021: '2021-10-09',
    2022: '2022-10-15',
    2023: '2023-10-14',
    2024: '2024-10-19',
    2025: '2025-10-18',
    2026: '2026-10-17',
  },
  raceDateSources: {
    2021: 'results.svetiming.com "Race Results for October 9, 2021 Baltimore Running Festival" + thebaltimoremarathon.com 2021/10 news archive',
    2022: 'results.svetiming.com "Race Results for October 15, 2022 Baltimore Running Festival" + marathonview.net 2022 (38th running, Creese/Roman-Duval)',
    2023: 'baltimoresun.com race report dated 2023-10-14 (22nd annual) + results.svetiming.com "Race Results for October 14, 2023"',
    2024: 'baltimoresun.com race report dated 2024-10-19 (Fink/Kenefick) + results.svetiming.com "Race Results for October 19, 2024"',
    2025: 'baltimoresun.com race report dated 2025-10-18 (Mance/Cluett, 25th annual) + results.svetiming.com "Race Results for October 18, 2025"',
    2026: 'marathonguide.com 2026 details page (26th annual, October 17 2026) + findarace.com "Baltimore Running Festival 2026 | Sat 17 Oct"',
  },
}
