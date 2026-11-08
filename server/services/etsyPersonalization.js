/**
 * Etsy Personalization Parser
 *
 * Etsy listing titles follow patterns like:
 *   "Grandma's Marathon Poster | Personalized Race Map, Runner Gift"
 *   "Personalized Las Vegas Marathon Poster | Runner Gift"
 *   "Personalized Marine Corps Marathon Race Map Poster: Runner Gift"
 *
 * Buyer personalization is a single freeform text box. Common formats:
 *   "John Smith, 2024"
 *   "Jane Doe / 2025"
 *   "Runner: Mike Jones Year: 2024"
 *   "Sarah Wilson 2024"
 *   "2025 Tom Brady"
 */

const NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' }

/**
 * Decode the HTML entities Etsy puts in its text fields. Etsy returns titles and
 * a buyer's formatted_value HTML-escaped ("O&#39;Brien", "&quot;BQ&quot;").
 * One pass, so "&amp;#39;" stays "&#39;" rather than decoding twice.
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function decodeHtmlEntities(text) {
  if (!text) return text || ''
  return String(text).replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole
    }
    const named = NAMED_ENTITIES[code.toLowerCase()]
    return named ?? whole
  })
}

/**
 * Extract race name from Etsy listing title
 *
 * Etsy titles are SEO-optimized and follow patterns like:
 *   "Personalized Boston Marathon Map Poster | Runner Gift"
 *   "Custom Twin Cities Marathon Poster | Personalized Marathon Race Map | ..."
 *   "Grandma&#39;s Marathon Poster | Personalized Race Map, Runner Gift"
 *   "CIM Marathon Poster | Personalized Race Map, Runner Gift"
 *   "Any Race - Custom Trackstar Print"  (custom order, special case)
 *   "Custom Triathlon Poster | IRONMAN Print | Triathlon Gift"  (custom order, special case)
 *
 * @param {string} listingTitle - Full Etsy listing title
 * @returns {string|null} - Cleaned race name, e.g. "Twin Cities Marathon"
 */
export function parseEtsyRaceName(listingTitle) {
  if (!listingTitle) return null

  // Decode HTML entities (Etsy returns &#39; for apostrophes, etc.)
  let name = decodeHtmlEntities(listingTitle)

  // Special cases: custom order products. Normalized to the Shopify product
  // titles so processOrders classifies both channels the same way.
  if (/any\s+race/i.test(name) && /custom\s+trackstar/i.test(name)) {
    return 'Custom Trackstar Print (Any Race)'
  }
  // "Custom Triathlon Poster | IRONMAN Print | Triathlon Gift"
  if (/custom\s+triathlon/i.test(name)) {
    return 'Custom Triathlon Print'
  }

  // Split on | or : and take the first part (the actual race info)
  name = name.split(/[|:]/).map(s => s.trim())[0]

  if (!name) return null

  // Strip known suffixes (order matters — longest first)
  const suffixes = [
    'Personalized Race Map Poster',
    'Personalized Runner Gift',
    'Personalized Race Print',
    'Personalized Race Map',
    'Race Map Poster',
    'Race Map Print',
    'Course Map',
    'Map Poster',
    'Map Print',
    'Race Print',
    'Race Map',
    'Poster',
    'Print',
    'Runner Gift',
  ]
  for (const suffix of suffixes) {
    if (name.toLowerCase().endsWith(suffix.toLowerCase())) {
      name = name.slice(0, -suffix.length).trim()
      // Remove trailing comma or dash
      name = name.replace(/[,\-–-]\s*$/, '').trim()
      break
    }
  }

  // Strip "Personalized" or "Custom" prefixes
  name = name.replace(/^(Personalized|Custom)\s+/i, '').trim()

  return name || null
}

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?'
const ORDINAL = '\\d{1,2}(?:st|nd|rd|th)?'
// "August 30", "Aug 30th,", "October 15th" and "30 August", "11 July", "15th of June".
// The day and month may sit on different lines ("30\nAugust 2026").
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+${ORDINAL}\\b,?`, 'gi')
const DAY_MONTH = new RegExp(`\\b${ORDINAL}\\s+(?:of\\s+)?${MONTH}(?=\\s|,|$)`, 'gi')
const LONE_ORDINAL = /\b\d{1,2}(?:st|nd|rd|th)\b/gi
// 04-26-2026, 10/11/2026, 26.04.26
const NUMERIC_DATE = /\b\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})\b/g
// "Bib: 54772", "bib #54772", "Bib 54772", "bib# 30625", "Bib Number : 14808"
const BIB = /\bbib\s*(?:number|num|no\.?)?\s*[:#]?\s*#?\s*(\d{1,6})\b/i
// "leave off the time", "no time", "without the time", "don't include my time"
const NO_TIME = [
  /\bleav(?:e|ing)\s+(?:off|out)\s+(?:the\s+|my\s+)?(?:finish(?:ing)?\s+)?time\b/i,
  /\bno\s+(?:finish(?:ing)?\s+)?time\b/i,
  /\bwithout\s+(?:the\s+|a\s+|my\s+)?(?:finish(?:ing)?\s+)?time\b/i,
  /\b(?:don'?t|do\s+not)\s+(?:include|add|put|show|print)\s+(?:the\s+|my\s+)?(?:finish(?:ing)?\s+)?time\b/i,
  /\bomit\s+(?:the\s+|my\s+)?(?:finish(?:ing)?\s+)?time\b/i,
]
// A finish time the buyer typed: "2:51:51", "04:32:15", "25:30", "4:59.22".
// Not a pace ("6:33/mile", "pace 13:47", "8:10 per mile") or a clock time ("7:00 am").
const TYPED_TIME = /(?<![\d:.])(\d{1,2}:\d{2}(?:[:.]\d{2})?)(?![\d:])/g
const AFTER_PACE = /^\s*(?:\/|per\b|min(?:ute)?s?\s*\/|(?:min(?:ute)?s?\s+)?(?:pace|a\s+mile|mi\b|km\b)|[ap]\.?m\b)/i
const BEFORE_PACE = /\bpace\s*(?:of|was|is)?\s*[:=-]?\s*$/i

/** The first finish time typed anywhere in the box, exactly as typed, or null. */
function typedFinishTime(text) {
  for (const m of text.matchAll(TYPED_TIME)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 16)
    const before = text.slice(Math.max(0, m.index - 16), m.index)
    if (AFTER_PACE.test(after) || BEFORE_PACE.test(before)) continue
    return m[1]
  }
  return null
}

// A race year: 1970 through next year (a print can be ordered ahead of the race)
function isRaceYear(y) {
  return y >= 1970 && y <= new Date().getFullYear() + 1
}

// Where the name stops: a bracket, the end of a sentence (not an initial like
// "Darci L. Thompson"), a field label, or a request to us.
const NAME_STOPS = [
  /[([{]/,
  /(?<!\b(?:[A-Z]|St|Mr|Mrs|Ms|Dr|Jr|Sr))[.!?](?=\s|$)/,
  /\b(?:finish(?:ing)?\s+)?(?:time|pace|race|miles|distance|background|year|event)\s*:/i,
  /\b(?:finish(?:ing)?\s+)?(?:time|pace)\s+\d/i,
  /\b(?:please|pls|plz|i\s+would|i'?d|i\s+want|we\s+would|thank(?:s|\s+you)|can\s+you|could\s+you|if\s+possible|no\s+time|leave\s+off|leave\s+out|without\s+the)\b/i,
]

/**
 * Pull the name out of a numbered answer list like the custom listings ask for:
 *   "1. Coast Guard Marathon 2026  2. Lori Tucker  3. 1003  4. 5:53:57  5. notes"
 * (1 = race, 2 = name, 3 = bib). Returns null when the text is not one.
 */
function numberedAnswers(text) {
  if (!/^\s*1[.)]\s/.test(text) || !/\s2[.)]\s/.test(text)) return null
  const parts = {}
  const re = /(?:^|\s)([1-9])[.)]\s+/g
  const marks = []
  let m
  while ((m = re.exec(text))) marks.push({ n: m[1], start: m.index, end: re.lastIndex })
  marks.forEach((mk, i) => {
    parts[mk.n] = text.slice(mk.end, i + 1 < marks.length ? marks[i + 1].start : text.length).trim()
  })
  return parts
}

/**
 * Parse buyer personalization text to extract runner name and race year
 * @param {string} rawText - Freeform buyer text, e.g. "John Smith, 2024"
 * @returns {{ runnerName: string|null, raceYear: number|null, bib: string|null, customerTime: string|null, hadNoTime: boolean, rawText: string, needsAttention: boolean, nameNeedsReview: boolean }}
 *   rawText is the text with Etsy's HTML entities decoded. customerTime is a
 *   finish time the buyer typed anywhere in the box, exactly as typed (never a pace).
 *   needsAttention is set when the name or year is missing, or when the name
 *   left over still looks wrong (more than 4 words, or digits in it);
 *   nameNeedsReview says it was the name.
 */
export function parseEtsyPersonalization(rawText) {
  const result = {
    runnerName: null,
    raceYear: null,
    bib: null,
    customerTime: null,
    hadNoTime: false,
    rawText: decodeHtmlEntities(rawText),
    needsAttention: false,
    nameNeedsReview: false,
  }

  if (!rawText || !rawText.trim()) {
    result.needsAttention = true
    return result
  }

  // Etsy sends formatted_value HTML-escaped: decode before anything reads it
  let text = result.rawText.trim()

  // A finish time typed anywhere in the box ("Name 2026\n\n2:51:51, 6:33/mile")
  result.customerTime = typedFinishTime(text)

  // A request to leave the time off the poster
  result.hadNoTime = NO_TIME.some(re => re.test(text))

  // Numbered answers: the name is answer 2 and the bib answer 3
  const numbered = numberedAnswers(text)
  if (numbered) {
    const yearInList = text.match(/\b(20\d{2})\b/)
    if (yearInList) result.raceYear = parseInt(yearInList[1], 10)
    if (/^#?\d{1,6}$/.test(numbered['3'] || '')) result.bib = numbered['3'].replace('#', '')
    text = numbered['2'] || ''
  }

  // 1. Bib number, when the buyer labels it
  const bibMatch = text.match(BIB)
  if (bibMatch) {
    result.bib = bibMatch[1]
    text = text.replace(bibMatch[0], ' ')
  }

  // 2. The year. A 4-digit year on the name line (the first line with a letter)
  // wins, 1970 through next year: "Daniel O'Brien 2026", "Lorsby Kelwin. 1983."
  // Otherwise the first 20XX anywhere ("Davmont Norton\n2026").
  const nameLine = text.split(/\r?\n/).find(l => /[a-zA-Z]/.test(l)) || ''
  const onNameLine = [...nameLine.matchAll(/\b((?:19|20)\d{2})\b/g)].find(m => isRaceYear(parseInt(m[1], 10)))
  const yearMatch = onNameLine || [...text.matchAll(/\b(20\d{2})\b/g)].find(m => isRaceYear(parseInt(m[1], 10)))
  if (yearMatch) {
    result.raceYear = parseInt(yearMatch[1], 10)
    // Out of the line it was found on, so a bib or number elsewhere keeps its digits
    if (onNameLine) {
      text = text.replace(nameLine, nameLine.slice(0, onNameLine.index) + ' ' + nameLine.slice(onNameLine.index + onNameLine[0].length))
    }
    // Numeric dates go whole ("04-26-2026"), then the year itself
    text = text.replace(NUMERIC_DATE, ' ')
    if (!onNameLine) text = text.replace(yearMatch[0], '')
  }

  // 3. Date fragments: a month with a day number, and ordinal days
  text = text.replace(MONTH_DAY, ' ').replace(DAY_MONTH, ' ').replace(LONE_ORDINAL, ' ')
  text = text.replace(/[ \t]+/g, ' ').trim()

  // 4. Strip common label prefixes
  const labelPrefixes = [
    /^runner\s*:\s*/i,
    /^name\s*:\s*/i,
    /^year\s*:\s*/i,
    /^runner\s+name\s*:\s*/i,
    /^race\s+year\s*:\s*/i,
  ]
  for (const prefix of labelPrefixes) {
    text = text.replace(prefix, '').trim()
  }

  // Also strip inline labels (e.g. "Runner: John Year: 2024" -> after year removal: "Runner: John Year:")
  text = text.replace(/\byear\s*:\s*/gi, '').trim()
  text = text.replace(/\brunner\s*(name)?\s*:\s*/gi, '').trim()
  text = text.replace(/\bname\s*:\s*/gi, '').trim()

  // 5. Cut the name where it ends: the first line with a letter in it, then
  // the first bracket, sentence end, label or request, then a comma once at
  // least two words are in hand ("Teresa Duff, #1709, 3:17:05").
  // A line naming the race ("Eugene Marathon") is skipped when another line has words.
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => /[a-zA-Z]/.test(l))
  text = lines.find(l => !/\b(?:marathon|half|10k|5k|ultra)\b/i.test(l)) || lines[0] || ''
  for (const stop of NAME_STOPS) {
    const m = text.match(stop)
    if (m) text = text.slice(0, m.index)
  }
  const comma = text.indexOf(',')
  if (comma > 0 && text.slice(0, comma).trim().split(/\s+/).length >= 2) {
    text = text.slice(0, comma)
  }

  // 6. Strip common event type words that buyers sometimes include
  const eventTypes = [
    /\bmarathon\b/gi,
    /\bhalf\s+marathon\b/gi,
    /\b10k\b/gi,
    /\b5k\b/gi,
  ]
  // Only strip if the remaining text is long enough to still contain a name
  // (avoid stripping "Marathon" from someone literally named "Marathon Smith")
  for (const pattern of eventTypes) {
    const candidate = text.replace(pattern, '').trim()
    // Only strip if it leaves at least 2 chars (initials) and looks like a name
    if (candidate.length >= 2 && /[a-zA-Z]/.test(candidate)) {
      text = candidate
    }
  }

  // 7. Strip month names (buyers sometimes include race date)
  const months = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/gi
  text = text.replace(months, '').trim()
  // A trailing month abbreviation or race shorthand left after the year came
  // out: "Eli Yates Nov 2026", "Jessica Young NYC marathon 2026". Only with
  // three or more words, so a two-word name is never cut to one.
  const TRAILING_JUNK = /\s+(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|NYC|NYCM|MCM|CIM|BAA|TCM|LA|DC|SF)\.?$/i
  for (let i = 0; i < 2 && text.split(/\s+/).length >= 3 && TRAILING_JUNK.test(text); i++) text = text.replace(TRAILING_JUNK, '').trim()

  // 8. Clean up separators. A hyphen inside a name stays ("Scarbeary-Simmons").
  text = text
    .replace(/(?<![a-zA-Z])-+|-+(?![a-zA-Z])/g, ' ')
    .replace(/[,/|–]+/g, ' ')    // Replace separators with spaces
    .replace(/\s+/g, ' ')        // Collapse multiple spaces
    .trim()

  // 9. Remove leading/trailing non-alpha chars
  text = text.replace(/^[^a-zA-Z]+/, '').replace(/[^a-zA-Z]+$/, '').trim()

  if (text) {
    result.runnerName = text
    // Still carrying a note, a date or a number: a person reads it before it prints
    result.nameNeedsReview = text.split(/\s+/).length > 4 || /\d/.test(text)
  }

  // Flag if we couldn't extract both fields, or the name looks wrong
  if (!result.runnerName || !result.raceYear || result.nameNeedsReview) {
    result.needsAttention = true
  }

  return result
}
