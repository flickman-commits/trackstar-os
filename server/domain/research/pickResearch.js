/**
 * The research row that describes this order's result. An order keeps the
 * research rows of every race it was researched for: a person who corrects
 * the race (Chicago to NYC) leaves the Chicago row behind, and that row's
 * bib, time, date and weather must never print on the NYC design. Only a row
 * for the order's own race and year counts. Pure: `canonical` maps a race
 * name to its canonical spelling (scrapers/index.js getCanonicalRaceName).
 *
 * Returns the newest found row for the race, else the newest row for it,
 * else null. Rows must carry race: { raceName, year }.
 */
export function pickResearch(rows, raceName, year, canonical = n => n) {
  const want = canonical(raceName) || raceName
  const mine = (rows || []).filter(r => r?.race && Number(r.race.year) === Number(year) && (canonical(r.race.raceName) || r.race.raceName) === want)
  return mine.find(r => r.researchStatus === 'found') || mine[0] || null
}
