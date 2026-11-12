/**
 * Common English first-name nicknames → canonical name mappings.
 *
 * Used by BaseScraper.namesMatch() when an exact first-name match fails:
 * "Mike Smith" matches "Michael Smith" because Mike→Michael lives in here.
 *
 * Curated set focused on the names we actually see in race results — kept
 * intentionally smaller than full genealogy lists to reduce false positives.
 * Gender-ambiguous nicknames (Pat, Sam, Alex, Chris) are included; when they
 * produce multiple matches the scraper surfaces them as ambiguous rather
 * than auto-accepting, so Eli still verifies.
 */

// Canonical → array of nicknames (and vice-versa equivalence). Lowercase.
const RAW = {
  alexander: ['alex', 'al', 'lex', 'xander'],
  alexandra: ['alex', 'lexi', 'sandra', 'sandy'],
  andrew:    ['andy', 'drew'],
  anthony:   ['tony'],
  benjamin:  ['ben', 'benny'],
  bradley:   ['brad'],
  catherine: ['cathy', 'kate', 'katie', 'cat'],
  charles:   ['charlie', 'chuck', 'chas'],
  christopher: ['chris', 'topher'],
  christina: ['chris', 'tina', 'christy'],
  // Christian was missing here while Christopher was present, which is how the
  // London 2025 "Chris Baxter" order got Christopher Baxter's finish time: only
  // one of the two Baxters on the page survived the name filter, so it looked
  // unambiguous. BaseScraper.nameMatchTier now treats any first-name prefix as
  // a weak match so the table no longer has to be exhaustive, but these belong
  // here regardless.
  christian: ['chris'],
  christine: ['chris', 'chrissy', 'tina'],
  daniel:    ['dan', 'danny'],
  david:     ['dave', 'davey'],
  deborah:   ['deb', 'debbie'],
  donald:    ['don', 'donnie'],
  douglas:   ['doug'],
  edward:    ['ed', 'eddie', 'ted', 'ned'],
  elizabeth: ['liz', 'lizzy', 'beth', 'betty', 'eliza', 'ellie', 'libby'],
  emily:     ['em', 'emmy'],
  emma:      ['em', 'emmy'],
  frederick: ['fred', 'freddie'],
  gabriel:   ['gabe'],
  gabrielle: ['gabby', 'gabe'],
  geoffrey:  ['geoff', 'jeff'],
  george:    ['georgie'],
  gregory:   ['greg'],
  harold:    ['harry', 'hal'],
  henry:     ['hank', 'harry'],
  jacob:     ['jake'],
  james:     ['jim', 'jimmy', 'jamie'],
  jason:     ['jay'],
  jeffrey:   ['jeff'],
  jennifer:  ['jen', 'jenny', 'jenn'],
  jeremiah:  ['jerry', 'jay'],
  jeremy:    ['jerry', 'jer'],
  jessica:   ['jess', 'jessie'],
  // Jack Karl (6534) is "John Karl" in the NYRR results.
  john:      ['jack', 'johnny'],
  jonathan:  ['jon', 'jonny'],
  joseph:    ['joe', 'joey'],
  joshua:    ['josh'],
  katherine: ['kate', 'katie', 'kathy', 'kat'],
  kathleen:  ['kathy', 'kate', 'katie'],
  kenneth:   ['ken', 'kenny'],
  lawrence:  ['larry'],
  leonard:   ['leo', 'lenny'],
  margaret:  ['maggie', 'meg', 'peggy', 'margie'],
  matthew:   ['matt', 'matty'],
  michael:   ['mike', 'mikey', 'mick'],
  nathaniel: ['nate', 'nat'],
  nicholas:  ['nick', 'nicky'],
  patricia:  ['pat', 'patty', 'tricia', 'trish'],
  patrick:   ['pat', 'paddy', 'rick'],
  peter:     ['pete'],
  phillip:   ['phil'],
  philip:    ['phil'],
  rachel:    ['rae'],
  rebecca:   ['becca', 'becky'],
  richard:   ['rick', 'rich', 'dick', 'rickey', 'ricky'],
  robert:    ['bob', 'rob', 'bobby', 'robbie', 'bert'],
  ronald:    ['ron', 'ronnie'],
  samantha:  ['sam', 'sammy'],
  samuel:    ['sam', 'sammy'],
  stephen:   ['steve', 'stevie'],
  steven:    ['steve', 'stevie'],
  susan:     ['sue', 'suzy', 'susie'],
  theodore:  ['ted', 'teddy', 'theo'],
  thomas:    ['tom', 'tommy'],
  timothy:   ['tim', 'timmy'],
  victoria:  ['vicky', 'tori', 'vic'],
  vincent:   ['vince', 'vinny'],
  william:   ['will', 'bill', 'billy', 'willy', 'liam'],
  zachary:   ['zach', 'zack'],
}

// Build a lookup: any name → set of all equivalent names (including itself)
const EQUIVALENCE = new Map()

for (const [canonical, nicks] of Object.entries(RAW)) {
  const group = new Set([canonical, ...nicks])
  for (const name of group) {
    if (!EQUIVALENCE.has(name)) {
      EQUIVALENCE.set(name, new Set())
    }
    for (const other of group) {
      EQUIVALENCE.get(name).add(other)
    }
  }
}

/**
 * Returns true if two first names are equivalent — same name OR known nickname.
 * Case-insensitive. Trims whitespace.
 *
 * Examples:
 *   firstNamesEquivalent('Mike', 'Michael') → true
 *   firstNamesEquivalent('Liz', 'Elizabeth') → true
 *   firstNamesEquivalent('Pat', 'Patricia') → true
 *   firstNamesEquivalent('Sarah', 'Michael') → false
 */
export function firstNamesEquivalent(a, b) {
  const na = (a || '').toLowerCase().trim()
  const nb = (b || '').toLowerCase().trim()
  if (!na || !nb) return false
  if (na === nb) return true
  const groupA = EQUIVALENCE.get(na)
  if (groupA && groupA.has(nb)) return true
  return false
}

export default { firstNamesEquivalent }
