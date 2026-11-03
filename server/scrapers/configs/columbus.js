/**
 * Columbus Marathon (Nationwide Children's Hospital Columbus Marathon) —
 * marathon + half. MTEC Results; each distance is a separate raceId under the
 * same event slug.
 *
 * Per-year raceIds (read off the year menu on any MTEC Columbus race page):
 *   2021: M=12016  H=12017  (no 2020: that edition was virtual and MTEC has no results)
 *   2022: M=14101  H=14102  (read off MTEC's year menus on the 2023 race pages)
 *   2023: M=15918  H=15919
 *   2024: M=17889  H=17890
 *   2025: M=19623  H=19624  (event 6011, read off MTEC's event search)
 *   2026: M=21870  H=21871  (event 6762, read off MTEC's event listing before race day)
 *
 * Verified finisher: Benjamen Smith, bib 3734, 3:57:08 (2024 Marathon, raceId 17889).
 */
export default {
  platform: 'mtec',
  raceName: 'Columbus Marathon',
  tag: 'Columbus',
  location: 'Columbus, OH',
  raceDates: {
    2021: '2021-10-17',
    2022: '2022-10-16',
    2023: '2023-10-15',
    2024: '2024-10-20',
    2025: '2025-10-19',
    2026: '2026-10-18',
  },
  raceDateSources: {
    2021: 'MTEC race page (its startDate reads a day early, as it does for 2022: 2021-10-16 vs Sunday 2021-10-17)',
    2022: 'columbusmarathon.com + findmymarathon.com',
    2023: 'columbusmarathon.com + runguides.com',
    2024: 'columbusmarathon.com + vdoto2.com',
    2025: 'columbusmarathon.com + vdoto2.com',
    2026: 'columbusmarathon.com + ahotu.com',
  },
  eventTypes: ['Marathon', 'Half Marathon'],
  eventSearchOrder: ['marathon', 'half'],
  eventLabels: { marathon: 'Marathon', half: 'Half Marathon' },
  distances: { marathon: 26.2, half: 13.1 },
  aliases: [
    'Columbus Marathon',
    "Nationwide Children's Hospital Columbus Marathon",
    'Columbus Half Marathon',
  ],
  keywords: ['columbus'],
  keywordRequiresMarathon: true,
  raceIds: {
    2021: { marathon: 12016, half: 12017 },
    2022: { marathon: 14101, half: 14102 },
    2023: { marathon: 15918, half: 15919 },
    2024: { marathon: 17889, half: 17890 },
    2025: { marathon: 19623, half: 19624 },
    2026: { marathon: 21870, half: 21871 },
  },
  raceSlugs: {
    2021: { marathon: '2021_Columbus_Marathon-Marathon', half: '2021_Columbus_Marathon-Half_Marathon' },
    2022: { marathon: '2022_Columbus_Marathon-Marathon', half: '2022_Columbus_Marathon-Half_Marathon' },
    2023: { marathon: '2023_Columbus_Marathon-Marathon', half: '2023_Columbus_Marathon-Half_Marathon' },
    2024: { marathon: '2024_Columbus_Marathon-Marathon', half: '2024_Columbus_Marathon-Half_Marathon' },
    2025: { marathon: '2025_Columbus_Marathon-Marathon', half: '2025_Columbus_Marathon-Half_Marathon' },
    2026: { marathon: '2026_Columbus_Marathon-Marathon', half: '2026_Columbus_Marathon-Half_Marathon' },
  }
}
