/**
 * Missoula Marathon (Missoula, MT) — full marathon + half marathon.
 * RunSignUp platform (timed by Competitive Timing). Each distance is a
 * separate event with its own resultSetId.
 *
 * Results: https://runsignup.com/Race/Results/8029
 *
 * Per-year event_ids / resultSetIds (Marathon + Half):
 *   2023: M event=643879 rsid=389373  ·  H event=643880 rsid=389374
 *   2024: M event=762190 rsid=469183  ·  H event=762191 rsid=469182
 *   2025: M event=890492 rsid=562587  ·  H event=890493 rsid=562511
 *   2026: M event=1029017 rsid=666091 ·  H event=1029018 rsid=666093
 *     (read 2026-11-17 from /Rest/race/8029?most_recent_events_only=F, both
 *     events start 6/28/2026, and get-result-sets per event). 2026 first ran
 *     off Competitive Timing's own site before it synced here; that site's
 *     races/missoula-marathon page now 404s, so 2026 reads RunSignUp too.
 *     2026 chip times carry hundredths or tenths (Tyler O'Neill 2:55:06.9).
 *
 * Verified 2025 finishers (chip times rounded to the second, pace = chip ÷ dist):
 *   Marathon — Jacob Verrue, bib 178, 2:45:56, 6:20/mi (positive split:
 *     1st half 5:55/mi, 2nd half 6:45/mi — confirms the `pace` field is the
 *     OVERALL average, not a per-segment value).
 *   Half — Brett Rosauer, bib 55, 1:10:52, 5:25/mi.
 */
export default {
  platform: 'runsignup',
  raceName: 'Missoula Marathon',
  tag: 'Missoula',
  raceId: 8029,
  // Competitive Timing slug (no year reads it now; kept for its fixtures).
  raceSlug: 'missoula-marathon',
  location: 'Missoula, MT',
  raceDates: {
    // 2022: runwildmissoula.org 2022 event page + raceraves 2022 review.
    2022: '2022-06-26',
    2023: '2023-06-25',
    2024: '2024-06-30',
    2025: '2025-06-29',
    2026: '2026-06-28',
  },
  raceDateSources: {
    2022: 'runwildmissoula.org + raceraves.com',
    2023: 'kpax.com coverage + goandrace.com + mybestruns.com',
    2024: 'runsignup.com results + missoula marathon official',
    2025: 'runsignup.com results + missoula marathon official',
    2026: 'missoulian.com "Photos: 2026 Missoula Marathon" race-day gallery + kpax.com race report (Nate Wellington wins the men\'s marathon; Owen Smith sets the men\'s half record)',
  },
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'half'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  distances: { marathon: 26.2, half: 13.1 },
  aliases: [
    'Missoula Marathon',
    'Missoula Half Marathon',
    'Missoula Marathon Half Marathon',
  ],
  keywords: ['missoula'],
  keywordRequiresMarathon: false, // 'missoula' alone is unique enough
  // event_ids enable the fast REST API path.
  eventIds: {
    2023: { marathon: 643879, half: 643880 },
    2024: { marathon: 762190, half: 762191 },
    2025: { marathon: 890492, half: 890493 },
    2026: { marathon: 1029017, half: 1029018 },
  },
  resultSets: {
    2023: { marathon: 389373, half: 389374 },
    2024: { marathon: 469183, half: 469182 },
    2025: { marathon: 562587, half: 562511 },
    2026: { marathon: 666091, half: 666093 },
  },
}
