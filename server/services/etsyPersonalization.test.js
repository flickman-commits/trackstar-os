import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEtsyPersonalization, decodeHtmlEntities } from './etsyPersonalization.js'

// Golden set: the shapes of every distinct Personalization box on the 94
// most recent Etsy orders (read from production on 2026-10-20, 81 distinct
// strings), with every name replaced by a made-up one. Each row
// is [text, runnerName, raceYear, needsAttention].
//
// These parsed correctly before the 2026-10-20 change and must keep parsing
// the same.
const UNCHANGED = [
  ["Fenholt Lormore", "Fenholt Lormore", null, true],
  ["Selsby Kelford 2026", "Selsby Kelford", 2026, false],
  ["Seldale Selwick 2026", "Seldale Selwick", 2026, false],
  ["Mardale Brenton 2026", "Mardale Brenton", 2026, false],
  ["Roston Fendale 2026", "Roston Fendale", 2026, false],
  ["Wenford Norsby", "Wenford Norsby", null, true],
  ["Lordale Holmont", "Lordale Holmont", null, true],
  ["Jasdale Jasholt 2026 #11", "Jasdale Jasholt", 2026, false],
  ["Brenwin Jasholt 2026 #22", "Brenwin Jasholt", 2026, false],
  ["Roston Brenholt 2026", "Roston Brenholt", 2026, false],
  ["Davford Garmore 2026", "Davford Garmore", 2026, false],
  ["Corholt Jasmore 2026\n\n4:30:40\n\n#79991", "Corholt Jasmore", 2026, false],
  ["Davmont Norton\n2026\n58139\n3:14:49", "Davmont Norton", 2026, false],
  ["Davwick 2026", "Davwick", 2026, false],
  ["Fenmore Wenmont 2026", "Fenmore Wenmont", 2026, false],
  ["Norholt Pelley 2024", "Norholt Pelley", 2024, false],
  ["Varmont Norley 2026", "Varmont Norley", 2026, false],
  ["Lorton Garmont 2026", "Lorton Garmont", 2026, false],
  ["Lorley Marton 2026", "Lorley Marton", 2026, false],
  ["Lorley Marton 2022", "Lorley Marton", 2022, false],
  ["Talley Davholt 2026", "Talley Davholt", 2026, false],
  ["Gardale Lorwick 2026", "Gardale Lorwick", 2026, false],
  ["Cormont Pelsby, 2022", "Cormont Pelsby", 2022, false],
  ["Holdale Pelley 2026", "Holdale Pelley", 2026, false],
  ["Jaswin Marsby, 2025", "Jaswin Marsby", 2025, false],
  ["Talmont Torwin 2026", "Talmont Torwin", 2026, false],
  ["Talton Holwick 2026", "Talton Holwick", 2026, false],
  ["Normore Wenton 2026", "Normore Wenton", 2026, false],
  ["Vardale Garford 2026", "Vardale Garford", 2026, false],
  ["Varwin Talmore 2026", "Varwin Talmore", 2026, false],
  ["Holley Kelholt 2026", "Holley Kelholt", 2026, false],
  ["Pelton Kelton 2026", "Pelton Kelton", 2026, false],
  ["Fensby Marholt 2026", "Fensby Marholt", 2026, false],
  ["Rosholt Kelley", "Rosholt Kelley", null, true],
  ["Holton Norwick 2026", "Holton Norwick", 2026, false],
  ["Selmont Brendale 2026", "Selmont Brendale", 2026, false],
  ["Holholt L. Varford, 2025", "Holholt L. Varford", 2025, false],
  ["Peldale G. Varford, 2025", "Peldale G. Varford", 2025, false],
  ["Torton Rosdale", "Torton Rosdale", null, true],
  ["Talwick talwin 2026", "Talwick talwin", 2026, false],
  ["Jaston Torley 2026", "Jaston Torley", 2026, false],
  ["Varley Corton 2026", "Varley Corton", 2026, false],
  ["Pelford Corton 2026", "Pelford Corton", 2026, false],
  ["Jasford Lormont 2025", "Jasford Lormont", 2025, false],
  ["Kelmont Davsby", "Kelmont Davsby", null, true],
  ["Wenholt Tormont 2015", "Wenholt Tormont", 2015, false],
  ["Rosford Torford April 2026", "Rosford Torford", 2026, false],
  ["Selmore Marmont 2026", "Selmore Marmont", 2026, false],
  ["Brenford Holsby 2026", "Brenford Holsby", 2026, false],
  ["Norford Pelmore June 2025", "Norford Pelmore", 2025, false],
  ["Roswin Cormore 2026", "Roswin Cormore", 2026, false],
  ["Fenmont Holford 2026", "Fenmont Holford", 2026, false],
  ["Talsby Varmore 2026", "Talsby Varmore", 2026, false],
  ["Rossby Fenwin 2023", "Rossby Fenwin", 2023, false],
  ["Talford Garsby 2026", "Talford Garsby", 2026, false],
  ["Varholt and Rosmont Garholt 2026", "Varholt and Rosmont Garholt", 2026, false],
  ["Fenford Jasmont 2024", "Fenford Jasmont", 2024, false],
  ["Kelmore Jaswick", "Kelmore Jaswick", null, true],
]

// These parsed wrong before (the old name is in the comment) and are what the
// change fixes. [text, runnerName, raceYear, needsAttention, bib, hadNoTime]
const FIXED = [
  // was: "Rosmore Pelley 30 (Bib: 54772) I would prefer to leave off the time if that is okay! Thank you"
  ["Rosmore Pelley 30\nAugust 2026 (Bib: 54772) I would prefer to leave off the time if that is okay! Thank you!", "Rosmore Pelley", 2026, false, "54772", true],
  // was: "Torton Fenley BIB: 69894 TIME"
  ["Torton Fenley BIB: 69894 TIME: 4:05:45", "Torton Fenley", null, true, "69894", false],
  // was: "Tormore Torholt 10 11 Bib # 19864 Time"
  ["Tormore Torholt \n10-11-2026\nBib # 19864\nTime : 3:12:14", "Tormore Torholt", 2026, false, "19864", false],
  // was: "Garwin Wenmore Bib #10616 Half"
  ["Garwin Wenmore 2026 Bib #10616 \n\nHalf Marathon", "Garwin Wenmore", 2026, false, "10616", false],
  // was: "Cordale Lorholt bib# 30625 finish time 3:44:54 pace"
  ["Cordale Lorholt 2026 bib# 30625, finish time 3:44:54, pace 5:16", "Cordale Lorholt", 2026, false, "30625", false],
  // was: "Jasholt Selton Twin Cities Bib #5413 Time: 4:27:07 Pace"
  ["Jasholt Selton, Twin Cities 2026, Bib #5413, Time: 4:27:07, Pace: 10:12", "Jasholt Selton", 2026, false, "5413", false],
  // was: "Lorwin Davdale Normont Bib#6191 Time"
  ["Lorwin Davdale Normont 2026,  Bib#6191            Time 06:19:53", "Lorwin Davdale Normont", 2026, false, "6191", false],
  // was: "Eugene 27 Corwick Corwin Finish Time 3:57:05 Bib"
  ["Eugene Marathon\nApril 27, 2025\nCorwick Corwin\nFinish Time 3:57:05\nBib #4947", "Corwick Corwin", 2025, false, "4947", false],
  // was: "Rosmore Pelley 30 (Bib: 54772) I would prefer to leave off the time if that is okay! Thank you"
  ["Rosmore Pelley 30 August 2026 (Bib: 54772) I would prefer to leave off the time if that is okay! Thank you!", "Rosmore Pelley", 2026, false, "54772", true],
  // was: "Varwick Selford Pelwick bib"
  ["Varwick Selford-Pelwick -2023 -bib 38673", "Varwick Selford-Pelwick", 2023, false, "38673", false],
  // was: "Wenwick Pelwin 11 Race : POCONOS Spartan Sprint Bib Number : 14808 Miles : 2.98 miles Time: 1hr 42 mins Please add the weather from that day. Background : Dark Blue and black with Orange like for race track"
  ["Name: Wenwick Pelwin\nYear : 11 July 2026\nRace : POCONOS Spartan 5K Sprint\nBib Number : 14808\nMiles : 2.98 miles \nTime: 1hr 42 mins\n\nPlease add the weather from that  day.\nBackground : Dark Blue and black with Orange like for race track.", "Wenwick Pelwin", 2026, false, "14808", false],
  // was: "No race info only race name and route"
  ["No race info, only race name and route", "No race info", null, true, null, false],
  // was: "no race info only race name and route"
  ["no race info, only race name and route", "no race info", null, true, null, false],
  // was: "Wenley Taldale BIB"
  ["Name: Wenley Taldale Year: 2023 BIB: 499", "Wenley Taldale", 2023, false, "499", false],
  // was: "Torsby Wensby please include finishing time but not pace"
  ["Torsby Wensby 2026\nplease include finishing time but not pace", "Torsby Wensby", 2026, false, null, false],
  // was: "Varsby Nordale 04 26 Bib #8859 Time 6:01:17 Pace 13:47 (please confirm official results"
  ["Varsby Nordale, 04-26-2026, Bib #8859, Time 6:01:17, Pace 13:47 (please confirm official results!)", "Varsby Nordale", 2026, false, "8859", false],
  // was: "Humboldt Redwoods 2. Selmore Marmont 3. 251 4. 3:23:20 5. It\u2019s in the woods so was thinking a dark green pelley component? Open to your suggestion but I like the style of the Boston etc poster (which I also bought for him) so want to match"
  ["1. Humboldt Redwoods Marathon 2025\n2. Selmore Marmont\n3. 251 \n4. 3:23:20\n5. It’s in the woods so was thinking a dark green/pelley component? Open to your suggestion, but I like the style of the Boston etc poster (which I also bought for him) so want to match", "Selmore Marmont", 2025, false, "251", false],
  // was: "Tordale Jasley Tokyo Bib"
  ["Tordale Jasley  Tokyo 2023  Bib #38930", "Tordale Jasley Tokyo", 2023, false, "38930", false],
  // was: "Coast Guard 2. Pelmont Davley 3. 1003 4. 5:53:57 5. you provided a few options for the last personalized print I bought. The theme of the race was light house. The course was changed off base due to the war"
  ["1. Coast Guard Marathon 2026   2. Pelmont Davley     3. 1003     4. 5:53:57      5. you provided a few options for the last personalized print I bought. The theme of the race was light house. The course was changed off base due to the war.", "Pelmont Davley", 2026, false, "1003", false],
  // was: "Davton Rosley #1709 3:17:05 15th"
  ["Davton Rosley, #1709, 3:17:05, October 15th, 2023", "Davton Rosley", 2023, false, null, false],
  // was: "Marford Fenton (year"
  ["Marford Fenton (year 2023)", "Marford Fenton", 2023, false, null, false],
]

test('golden: real strings that parsed correctly still parse the same', () => {
  for (const [text, runnerName, raceYear, needsAttention] of UNCHANGED) {
    const r = parseEtsyPersonalization(text)
    assert.deepEqual([r.runnerName, r.raceYear, r.needsAttention], [runnerName, raceYear, needsAttention], text)
  }
})

test('golden: real strings that parsed wrong now give the name, bib and no-time request', () => {
  for (const [text, runnerName, raceYear, needsAttention, bib, hadNoTime] of FIXED) {
    const r = parseEtsyPersonalization(text)
    assert.deepEqual(
      [r.runnerName, r.raceYear, r.needsAttention, r.bib, r.hadNoTime],
      [runnerName, raceYear, needsAttention, bib, hadNoTime],
      text,
    )
  }
})

test('Sydney order 4205933663: date, bib and the request come out of the name', () => {
  const r = parseEtsyPersonalization('Rosmore Pelley 30\nAugust 2026 (Bib: 54772) I would prefer to leave off the time if that is okay! Thank you!')
  assert.equal(r.runnerName, 'Rosmore Pelley')
  assert.equal(r.raceYear, 2026)
  assert.equal(r.bib, '54772')
  assert.equal(r.hadNoTime, true)
  assert.equal(r.needsAttention, false)
  // The same text on one line, month after the day or before it
  assert.equal(parseEtsyPersonalization('Rosmore Pelley August 30 2026 (Bib: 54772) I would prefer to leave off the time if that is okay! Thank you').runnerName, 'Rosmore Pelley')
})

test('Roston Brenholt 2026 stays a plain name and year', () => {
  const r = parseEtsyPersonalization('Roston Brenholt 2026')
  assert.deepEqual([r.runnerName, r.raceYear, r.bib, r.hadNoTime, r.needsAttention], ['Roston Brenholt', 2026, null, false, false])
})

test('bib written several ways', () => {
  for (const text of ['Fenwick Holmore 2025 Bib: 54772', 'Fenwick Holmore 2025 bib #54772', 'Fenwick Holmore 2025 Bib 54772', 'Fenwick Holmore, 2025, BIB#54772', 'Fenwick Holmore 2025 Bib Number: 54772']) {
    const r = parseEtsyPersonalization(text)
    assert.equal(r.bib, '54772', text)
    assert.equal(r.runnerName, 'Fenwick Holmore', text)
  }
  assert.equal(parseEtsyPersonalization('Fenwick Holmore 2025').bib, null)
})

test('date fragments: month with a day, day with a month, ordinal days', () => {
  for (const text of ['Fenwick Holmore October 15th 2023', 'Fenwick Holmore 15 October 2023', 'Fenwick Holmore Oct 15, 2023', 'Fenwick Holmore 2023 15th', 'Fenwick Holmore 15th of October 2023']) {
    assert.equal(parseEtsyPersonalization(text).runnerName, 'Fenwick Holmore', text)
  }
})

test('no-time requests set hadNoTime; asking for the time does not', () => {
  for (const text of ['Fenwick Holmore 2025 no time', 'Fenwick Holmore 2025 please leave off the time', 'Fenwick Holmore 2025 without the time please', 'Fenwick Holmore 2025, leave out my finish time', "Fenwick Holmore 2025. Don't include the time"]) {
    const r = parseEtsyPersonalization(text)
    assert.equal(r.hadNoTime, true, text)
    assert.equal(r.runnerName, 'Fenwick Holmore', text)
  }
  assert.equal(parseEtsyPersonalization('Torsby Wensby 2026\nplease include finishing time but not pace').hadNoTime, false)
})

test('a name still too long or carrying digits is sent for review', () => {
  const long = parseEtsyPersonalization('Fenwick Marley Ann Elizabeth Holmore 2025')
  assert.equal(long.nameNeedsReview, true)
  assert.equal(long.needsAttention, true)
  const digits = parseEtsyPersonalization('Fenwick 3 Holmore 2025')
  assert.equal(digits.nameNeedsReview, true)
  assert.equal(digits.needsAttention, true)
  const fine = parseEtsyPersonalization('Varholt and Rosmont Garholt 2026')
  assert.equal(fine.nameNeedsReview, false)
  assert.equal(fine.needsAttention, false)
})

test('initials and hyphenated names survive the sentence cut', () => {
  assert.equal(parseEtsyPersonalization('Holholt L. Varford, 2025').runnerName, 'Holholt L. Varford')
  assert.equal(parseEtsyPersonalization('Marley-Kelwick Wenwin 2024').runnerName, 'Marley-Kelwick Wenwin')
  assert.equal(parseEtsyPersonalization('Lorsby Kelwin. 1983.').runnerName, 'Lorsby Kelwin')
})

// Etsy receipt 4222621106 (2026-11-06): imported as missing_year with the name
// "Daniel O&#39;Brien". The entity left digits in the name, which sent it for
// review, and the time on the next line was never read.
const OBRIEN = 'Daniel O&#39;Brien 2026\n\n2:51:51, 6:33/mile\n\nIf able, can you include &quot;BQ&quot; ...'

test('receipt 4222621106: entities decoded, year off the name line, typed time kept', () => {
  const r = parseEtsyPersonalization(OBRIEN)
  assert.equal(r.runnerName, "Daniel O'Brien")
  assert.equal(r.raceYear, 2026)
  assert.equal(r.customerTime, '2:51:51')
  assert.equal(r.nameNeedsReview, false)
  assert.equal(r.needsAttention, false)
  assert.equal(r.rawText, 'Daniel O\'Brien 2026\n\n2:51:51, 6:33/mile\n\nIf able, can you include "BQ" ...')
})

test('HTML entities: named, decimal and hex, decoded once', () => {
  assert.equal(decodeHtmlEntities('O&#39;Brien &amp; &quot;BQ&quot; &lt;3 &#x27;hi&#x27; &apos;x&apos;'), 'O\'Brien & "BQ" <3 \'hi\' \'x\'')
  assert.equal(decodeHtmlEntities('&amp;#39;'), '&#39;')
  assert.equal(decodeHtmlEntities('AT&T &unknown;'), 'AT&T &unknown;')
  assert.equal(parseEtsyPersonalization('Kelwin D&#39;Arcy-Holmore, 2025').runnerName, "Kelwin D'Arcy-Holmore")
  assert.equal(parseEtsyPersonalization('Keldale &amp; Jassby Garton 2026').runnerName, 'Keldale & Jassby Garton')
})

test('a year on the name line, 1970 through next year, is the race year and leaves the name', () => {
  const next = new Date().getFullYear() + 1
  for (const [text, name, year] of [
    ['Lorsby Kelwin. 1983.', 'Lorsby Kelwin', 1983],
    ['Keldale & Jassby Garton - 1990', 'Keldale & Jassby Garton', 1990],
    ['Fenwick Holmore 1970', 'Fenwick Holmore', 1970],
    [`Fenwick Holmore ${next}`, 'Fenwick Holmore', next],
    ['2019 Fenwick Holmore', 'Fenwick Holmore', 2019],
  ]) {
    const r = parseEtsyPersonalization(text)
    assert.deepEqual([r.runnerName, r.raceYear, r.needsAttention], [name, year, false], text)
  }
  // Out of range: not a year, and the name goes to review with the number in it
  const old = parseEtsyPersonalization('Fenwick Holmore 1969')
  assert.equal(old.raceYear, null)
  assert.equal(old.needsAttention, true)
  assert.equal(parseEtsyPersonalization(`Fenwick Holmore ${next + 1}`).raceYear, null)
  // The name line wins over a year further down
  assert.equal(parseEtsyPersonalization('Fenwick Holmore 2024\nran it again in 2025').raceYear, 2024)
})

test('typed finish time: as typed, anywhere in the box, never a pace or a clock time', () => {
  for (const [text, time] of [
    ['Corholt Jasmore 2026\n\n4:30:40\n\n#79991', '4:30:40'],
    ['Davmont Norton\n2026\n58139\n3:14:49', '3:14:49'],
    ['Torton Fenley BIB: 69894 TIME: 4:05:45', '4:05:45'],
    ['Fenwick Holmore 2025 4:59.22', '4:59.22'],
    ['Fenwick Holmore 2025 pace 8:10, time 3:34:12', '3:34:12'],
    ['Fenwick Holmore 2025 8:10 per mile 3:34:12', '3:34:12'],
    ['Fenwick Holmore 2025 5K 25:30', '25:30'],
    ['Fenwick Holmore 2025, 6:33/mile', null],
    ['Fenwick Holmore 2025 started at 7:00 am', null],
    ['Fenwick Holmore 2025', null],
  ]) {
    assert.equal(parseEtsyPersonalization(text).customerTime, time, text)
  }
})

test('empty text needs attention', () => {
  assert.equal(parseEtsyPersonalization('').needsAttention, true)
  assert.equal(parseEtsyPersonalization(null).runnerName, null)
})
