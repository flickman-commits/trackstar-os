/**
 * The Las Vegas Marathon (vegasmarathon.com), first run in 2024. Brooksee.
 * Not Rock 'n' Roll Las Vegas, which has had only a half since 2019.
 *
 * Race ids from the year dropdown on vegasmarathon.com/results: 2024 166900,
 * 2025 167423 (2027 168099 is listed but has no results). 2022 and 2023 did
 * not exist, and there is no 2026 edition (the next is January 10, 2027).
 * Result columns: chip time, pace, gun time last; pace is computed from chip.
 */
export default {
  platform: 'brooksee',
  raceName: 'Las Vegas Marathon',
  tag: 'LasVegas',
  baseUrl: 'https://vegasmarathon.com',
  location: 'Las Vegas, NV',
  raceDates: {
    2024: '2024-11-03',
    2025: '2025-10-26',
    2027: '2027-01-10',
  },
  raceDateSources: {
    2024: 'Running USA: The Las Vegas Marathon held November 3, 2024 (winner JJ Santana 2:25:02, row 1 of race 166900)',
    2025: 'vegasmarathon.com result page for race 167423 dated October 26, 2025 + Athlinks master 390789 event 1129402 dated 10/26/2025',
    2027: 'marathonhandbook.com listing the next edition for January 10, 2027 (no 2026 race)',
  },
  // Years the race did not run: an order for one is the wrong year (pipeline.js).
  noEdition: {
    2026: 'The race moved from October 2025 to January 10, 2027; there was no 2026 edition.',
  },
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['Marathon', 'Half Marathon'],
  eventLabels: { Marathon: 'Marathon', 'Half Marathon': 'Half Marathon' },
  aliases: [
    'Las Vegas Marathon',
    'The Las Vegas Marathon',
    'Las Vegas Half Marathon',
  ],
  keywords: ['las vegas'],
  keywordRequiresMarathon: true,
  raceIds: {
    2024: '166900',
    2025: '167423',
  },
}
