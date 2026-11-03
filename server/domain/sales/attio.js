/**
 * Attio is the CRM. This is the only file that talks to it.
 *
 * Workspace `trackstar-usa`, object `deals`. A deal is the unit of work: it
 * carries the stage, the motion (Race or Charity), the owner, the touch count
 * and the next action. The company and the people hang off it as record
 * references, and Attio's own enrichment (a description of the org, the
 * person's title and LinkedIn) lives on those records. The Sales tool reads
 * all of that live and never copies it anywhere.
 *
 * Reads: every open deal in one paged query, then the companies and people
 * those deals reference in a handful of batched queries. Cached for a short
 * while per process so a page load is not sixty round trips.
 *
 * Writes: exactly what a send changes. touch_count, next_action (only when
 * the field is empty or already carries the `[auto]` prefix, because a human
 * who typed a next action owns it), next_action_date, the stage from Not
 * Contacted to Reached Out and never further, and a note on the deal with the
 * email that went. A person changing the stage by hand from the tool is a
 * human decision and is written as given.
 *
 * API notes worth keeping: PATCH replaces single-value attributes and appends
 * to multiselects, so never PATCH a multiselect from here. Clear a value with
 * [] and never null. Status and select values are written by option title.
 * Filtering on select and status attributes has its own syntax and a wrong
 * guess silently returns nothing, which is why stage and motion are filtered
 * in JavaScript after a plain paged fetch.
 */
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import { UserError } from './errors.js'
import { requireConnection } from '../../lib/connections.js'

const BASE = process.env.ATTIO_BASE_URL || 'https://api.attio.com/v2'
const PAGE = 500
const CACHE_MS = 45_000
/** People change far less often than deals, and re-reading them is the expensive part. */
const PEOPLE_MS = 10 * 60_000

export const WORKSPACE_SLUG = 'trackstar-usa'

/** Stage titles the tool relies on. The full ordered list is read live; see stageTitles(). */
export const STAGES = ['Needs Enrichment', 'Not Contacted', 'Reached Out', 'In Conversation', 'Call Booked', 'Deck Sent', 'Awaiting Payment', 'Won', 'Revisit Next Year', 'Lost']
export const MOTIONS = ['Race', 'Charity', 'Corporate', 'PR']

/** Deal attributes the tool reads or writes. The settings check reports any that are missing. */
export const DEAL_ATTRIBUTES = {
  reads: ['name', 'stage', 'motion', 'owner', 'associated_company', 'associated_people', 'touch_count', 'next_action', 'next_action_date', 'race_date', 'runners', 'tier', 'size_tier', 'priority', 'races', 'deal_notes', 'value', 'units'],
  writes: ['stage', 'touch_count', 'next_action', 'next_action_date'],
}

export function isAttioConfigured() { return Boolean(process.env.ATTIO_API_KEY) }

/**
 * One Attio request. A 429 (rate or query-complexity limit) waits and tries
 * again, up to three times, honouring Retry-After when Attio sends one, so a
 * burst of clicks slows down instead of failing in front of the rep.
 */
async function attio(path, { method = 'GET', body } = {}) {
  await requireConnection('attio')
  if (!isAttioConfigured()) throw new UserError('Attio is not connected: ATTIO_API_KEY is not set')
  let res
  for (let attempt = 0; ; attempt++) {
    res = await fetchWithTimeout(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${process.env.ATTIO_API_KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, 20000)
    if (res.status !== 429 || attempt >= 3) break
    const after = Number(res.headers.get('retry-after'))
    const waitMs = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : 800 * 2 ** attempt
    await res.text().catch(() => {})
    await new Promise(r => setTimeout(r, waitMs))
  }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = null }
  if (!res.ok) {
    const err = new Error(`Attio ${method} ${path} -> ${res.status}: ${json?.message || text.slice(0, 200)}`)
    err.status = res.status
    throw err
  }
  return json
}

// ── Reading values off records ───────────────────────────────────────────────

/** The first entry of an attribute, whatever its type, or null. */
function first(record, slug) {
  const v = record?.values?.[slug]
  return Array.isArray(v) && v.length ? v[0] : null
}

/** A scalar: text, number, date, select title, status title. */
export function val(record, slug) {
  const f = first(record, slug)
  if (!f) return null
  if (f.status?.title) return f.status.title
  if (f.option?.title) return f.option.title
  if ('currency_value' in f) return f.currency_value
  if ('value' in f) return f.value
  return null
}

function refs(record, slug) {
  const v = record?.values?.[slug]
  return Array.isArray(v) ? v.map(x => x.target_record_id).filter(Boolean) : []
}

function actorId(record, slug) {
  const f = first(record, slug)
  return f?.referenced_actor_id || null
}

function personName(record) {
  const n = first(record, 'name')
  return { firstName: n?.first_name || '', lastName: n?.last_name || '', fullName: n?.full_name || '' }
}

function emails(record) {
  const v = record?.values?.email_addresses
  return Array.isArray(v) ? v.map(x => x.email_address).filter(Boolean) : []
}

function domain(record) {
  const f = first(record, 'domains')
  return f?.root_domain || f?.domain || null
}

function location(record) {
  const f = first(record, 'primary_location')
  if (!f) return null
  const parts = [f.locality, f.region].filter(Boolean)
  return parts.length ? parts.join(', ') : (f.country_code || null)
}

function interaction(record, slug) {
  const f = first(record, slug)
  return f?.interacted_at || null
}

function multi(record, slug) {
  const v = record?.values?.[slug]
  return Array.isArray(v) ? v.map(x => x.option?.title).filter(Boolean) : []
}

function recordId(record) { return record?.id?.record_id || null }

// ── Views: the shapes the rest of the app sees ───────────────────────────────

export function companyView(record) {
  if (!record) return null
  return {
    id: recordId(record),
    name: val(record, 'name'),
    domain: domain(record),
    description: val(record, 'description'),
    location: location(record),
    employeeRange: val(record, 'employee_range'),
    categories: multi(record, 'categories'),
    linkedin: val(record, 'linkedin'),
    twitter: val(record, 'twitter'),
    lastInteractionAt: interaction(record, 'last_interaction'),
    lastEmailAt: interaction(record, 'last_email_interaction'),
    nextCalendarAt: interaction(record, 'next_calendar_interaction'),
    webUrl: record.web_url || null,
  }
}

export function personView(record) {
  if (!record) return null
  const name = personName(record)
  const all = emails(record)
  return {
    id: recordId(record),
    firstName: name.firstName,
    lastName: name.lastName,
    fullName: name.fullName || `${name.firstName} ${name.lastName}`.trim(),
    email: all[0] || null,
    emails: all,
    title: val(record, 'job_title'),
    description: val(record, 'description'),
    linkedin: val(record, 'linkedin'),
    location: location(record),
    lastInteractionAt: interaction(record, 'last_interaction'),
    lastEmailAt: interaction(record, 'last_email_interaction'),
    companyId: refs(record, 'company')[0] || null,
    webUrl: record.web_url || null,
  }
}

export function dealView(record) {
  if (!record) return null
  return {
    id: recordId(record),
    name: val(record, 'name'),
    stage: val(record, 'stage'),
    motion: val(record, 'motion'),
    ownerId: actorId(record, 'owner'),
    companyId: refs(record, 'associated_company')[0] || null,
    personIds: refs(record, 'associated_people'),
    touchCount: Number(val(record, 'touch_count') || 0),
    nextAction: val(record, 'next_action'),
    nextActionDate: val(record, 'next_action_date'),
    raceDate: val(record, 'race_date'),
    runners: val(record, 'runners'),
    tier: val(record, 'tier'),
    sizeTier: val(record, 'size_tier'),
    // Titled "🔥 High" in the workspace; the emoji is decoration.
    priority: (val(record, 'priority') || '').replace(/[^\p{L}\s]/gu, '').trim() || null,
    // Charity deals: which marathons the team fields. Drives the mockup pick.
    races: multi(record, 'races'),
    notes: val(record, 'deal_notes'),
    value: val(record, 'value'),
    units: val(record, 'units'),
    // Optional: only present if someone adds these to the workspace.
    courseLandmark: val(record, 'course_landmark'),
    identity: val(record, 'identity'),
    // Race payouts (Finance > Payouts > Races): the share of net sales the
    // race gets (default 15 when empty), or a flat amount per order when
    // the workspace has payout_per_order set; the signed contract.
    revSharePct: val(record, 'rev_share_pct'),
    payoutPerOrder: val(record, 'payout_per_order'),
    contractUrl: val(record, 'contract_url'),
    createdAt: record.created_at || null,
    webUrl: record.web_url || null,
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────

async function queryAll(object, body = {}) {
  const out = []
  for (let offset = 0; ; offset += PAGE) {
    const res = await attio(`/objects/${object}/records/query`, { method: 'POST', body: { ...body, limit: PAGE, offset } })
    const data = res?.data || []
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

/**
 * One record by id. A plain read: Attio's query complexity limit does not
 * apply, unlike a filter with fifty $or clauses, which it refuses outright.
 */
async function getRecord(object, id) {
  try {
    const out = await attio(`/objects/${object}/records/${id}`)
    return out?.data || null
  } catch (err) {
    if (err.status === 404) return null
    throw err
  }
}

/** Run `fn` over `items` with at most `n` in flight; a 429 waits and retries once. */
async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      try {
        out[idx] = await fn(items[idx])
      } catch (err) {
        if (err.status !== 429) throw err
        await new Promise(r => setTimeout(r, 1500))
        out[idx] = await fn(items[idx])
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/**
 * Everyone in the workspace, indexed by record id.
 *
 * The people object holds a few thousand records from the inbox sync. Reading
 * them 500 at a time is a handful of requests; reading the ones a deal points
 * at one by one was four hundred, which is where the page load went. Filtering
 * by a list of ids instead is what Attio refuses as a complex query.
 */
async function peopleById({ fresh = false } = {}) {
  if (fresh) cache.delete('people')
  return cached('people', PEOPLE_MS, async () => {
    const records = await queryAll('people')
    return Object.fromEntries(records.map(r => [recordId(r), personView(r)]))
  })
}

const cache = new Map()
function cached(key, ms, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ms) return hit.value
  const value = fn().catch(err => { cache.delete(key); throw err })
  cache.set(key, { at: Date.now(), value })
  return value
}
export function forgetAttioCache() { cache.clear() }

/**
 * Every deal in the workspace, as views, with the companies and people they
 * point at. One paged fetch plus batched lookups; cached briefly.
 */
/**
 * Every deal in the workspace, as views, with its company and people. Three
 * paged reads, cached briefly, rather than one request per person.
 */
/** Every company, by id. Shared by the deals list and the PR list. */
async function companiesById({ fresh = false } = {}) {
  if (fresh) cache.delete('companies')
  return cached('companies', CACHE_MS, async () => {
    const records = await queryAll('companies')
    return Object.fromEntries(records.map(c => [recordId(c), companyView(c)]))
  })
}

export async function loadDeals({ fresh = false } = {}) {
  if (fresh) { cache.delete('deals'); cache.delete('members') }
  return cached('deals', CACHE_MS, async () => {
    const [dealRecords, companyById, personById] = await Promise.all([
      queryAll('deals'),
      companiesById({ fresh }),
      peopleById({ fresh }),
    ])
    return dealRecords.map(dealView).filter(d => d.id).map(d => ({
      ...d,
      company: companyById[d.companyId] || null,
      people: d.personIds.map(id => personById[id]).filter(Boolean),
    }))
  })
}

/**
 * One deal, read from Attio now, with its company and people: a handful of
 * requests rather than the whole workspace. This is what the send path uses
 * to check the deal has not moved under it, so a list that is a minute old
 * can never send against a stale stage or a stale touch count.
 */
export async function getDealNow(id) {
  const record = await getRecord('deals', id)
  if (!record) return null
  const deal = dealView(record)
  const [company, people] = await Promise.all([
    deal.companyId ? getRecord('companies', deal.companyId).then(companyView) : null,
    mapLimit(deal.personIds, 5, async pid => personView(await getRecord('people', pid))),
  ])
  return { ...deal, company, people: people.filter(Boolean) }
}

/**
 * One deal. If this server already holds the whole list (the queue just
 * loaded it), that copy is used. Otherwise it is read on its own: a few plain
 * record reads, never the workspace-wide query. Drafting, the library and
 * notes each run on their own serverless instance, so reading every deal,
 * company and person there to find one deal is what tripped Attio's
 * query-complexity limit when a rep clicked a row.
 */
export async function getDeal(id, { fresh = false } = {}) {
  if (isPrId(id)) return getPrContact(id, { fresh })
  if (fresh) {
    cache.delete(`deal:${id}`)
    const deal = await getDealNow(id)
    if (deal) cache.set(`deal:${id}`, { at: Date.now(), value: Promise.resolve(deal) })
    return deal
  }
  const all = cache.get('deals')
  if (all && Date.now() - all.at < CACHE_MS) {
    const deals = await all.value.catch(() => null)
    const hit = deals?.find(d => d.id === id)
    if (hit) return hit
  }
  return cached(`deal:${id}`, CACHE_MS, () => getDealNow(id))
}

/** People who can own a deal: id, name, email. Cached longer; the roster rarely changes. */
export async function workspaceMembers() {
  return cached('members', 10 * 60_000, async () => {
    const res = await attio('/workspace_members')
    return (res?.data || []).map(m => ({
      id: m.id?.workspace_member_id || null,
      email: (m.email_address || '').toLowerCase(),
      firstName: m.first_name || '',
      lastName: m.last_name || '',
      access: m.access_level || null,
    })).filter(m => m.id)
  })
}

/** The deal stages as the workspace defines them, in pipeline order. Cached; falls back to the known list. */
export async function stageTitles() {
  return cached('stages', 10 * 60_000, async () => {
    try {
      const attrs = await attio('/objects/deals/attributes')
      const stageAttr = (attrs?.data || []).find(a => a.api_slug === 'stage')
      const st = await attio(`/objects/deals/attributes/${stageAttr?.id?.attribute_id || 'stage'}/statuses`)
      const titles = (st?.data || []).filter(x => !x.is_archived).map(x => x.title)
      return titles.length ? titles : STAGES
    } catch { return STAGES }
  })
}

/** The workspace member whose email matches the signed-in person, or null. */
export async function memberForEmail(email) {
  if (!email) return null
  const want = String(email).toLowerCase()
  return (await workspaceMembers()).find(m => m.email === want) || null
}

// ── Writes ───────────────────────────────────────────────────────────────────

function day(d) { return new Date(d).toISOString().slice(0, 10) }

export async function patchDeal(id, values) {
  const out = await attio(`/objects/deals/records/${id}`, { method: 'PATCH', body: { data: { values } } })
  // We know exactly which deal changed, so update it in place rather than
  // dropping a list that costs seconds to rebuild.
  try {
    const cachedDeals = cache.get('deals')
    if (cachedDeals) {
      const list = await cachedDeals.value
      const i = list.findIndex(d => d.id === id)
      if (i >= 0) list[i] = { ...list[i], ...dealView(out?.data), company: list[i].company, people: list[i].people }
    }
  } catch { cache.delete('deals') }
  // The single-deal copy is cheap to re-read; drop it so the next look is current.
  cache.delete(`deal:${id}`)
  return out?.data || null
}

/** A note on a deal. Plain text; the title is what shows in the timeline. */
export async function addDealNote(id, { title, content }) {
  return attio('/notes', {
    method: 'POST',
    body: { data: { parent_object: 'deals', parent_record_id: id, title, format: 'plaintext', content } },
  })
}

/**
 * After a send. The email is gone by the time this runs, so nothing here
 * throws: the result says whether Attio now agrees, and the caller shows it.
 */
export async function recordSend(deal, { sentAt, touchNumber, nextAction, nextActionDate, subject, body, toEmail, sentBy }) {
  if (!isAttioConfigured()) return { ok: false, skipped: 'ATTIO_API_KEY not set' }
  if (isPrId(deal.id)) return recordPrSend(deal, { sentAt, touchNumber, subject, body, toEmail, sentBy })
  try {
    const values = { touch_count: touchNumber }
    if (nextActionDate) values.next_action_date = day(nextActionDate)
    // A next action a person typed is theirs. Only the tool's own are replaced.
    if (nextAction && (!deal.nextAction || /^\[auto\]/i.test(deal.nextAction))) values.next_action = `[auto] ${nextAction}`
    if (deal.stage === 'Not Contacted' || deal.stage === 'Needs Enrichment') values.stage = 'Reached Out'
    await patchDeal(deal.id, values)
    try {
      await addDealNote(deal.id, {
        title: `${day(sentAt)} Email ${touchNumber} sent: ${subject}`,
        content: `Sent from the Sales tool by ${sentBy || 'a rep'} to ${toEmail}.\nAlready counted in touch_count.\n\nSubject: ${subject}\n\n${body}`,
      })
    } catch (err) {
      console.warn(`[sales.attio] note failed for ${deal.name}: ${err.message}`)
    }
    return { ok: true }
  } catch (err) {
    console.error(`[sales.attio] send write failed for ${deal.name}: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

/** A person changed the stage from the tool. Written exactly. */
export async function setStage(dealId, stage) {
  if (!(await stageTitles()).includes(stage)) throw new UserError(`Unknown stage: ${stage}`)
  await patchDeal(dealId, { stage })
  return getDeal(dealId, { fresh: true })
}

/** A PR contact's list status, set by a person from the tool. */
async function setPrStatus(id, status) {
  if (!PR_STAGE[status]) throw new UserError(`Unknown PR status: ${status}`)
  const entryId = String(id).slice(PR_PREFIX.length)
  await attio(`/lists/${PR_LIST}/entries/${entryId}`, { method: 'PATCH', body: { data: { entry_values: { status } } } })
  cache.delete(`deal:${id}`)
  cache.delete('pr')
}

/**
 * "Remove": a person decides not to work this one. The deal goes to Lost in
 * Attio (a PR contact to Not interested), which takes it out of every list
 * in the tool and says so where the team looks. A stage move a person asked
 * for, so it is theirs, like any move made in Attio. Returns what it was, so
 * the page can offer Undo.
 */
export async function removeFromOutreach(id, { reason = null, byEmail = null } = {}) {
  const current = await getDeal(id, { fresh: true })
  if (!current) throw new UserError('That is not in Attio any more')
  const previous = isPrId(id) ? current.prStatus : current.stage
  if (isPrId(id)) await setPrStatus(id, 'Not interested')
  else await patchDeal(id, { stage: 'Lost' })
  try {
    await noteOnDeal(id, `Removed from outreach in the Sales tool${reason ? `: ${reason}` : ''}. Was ${previous}.`, byEmail)
  } catch (err) { console.warn(`[sales.attio] remove note failed for ${current.name}: ${err.message}`) }
  return { previous }
}

/** Undo "Remove": back to the stage (or PR status) it had. */
export async function restoreToOutreach(id, previous) {
  if (isPrId(id)) await setPrStatus(id, previous || 'To contact')
  else await setStage(id, previous || 'Not Contacted')
}

/** A rep's note on the deal, from the tool. */
export async function noteOnDeal(dealId, text, byEmail) {
  const title = `${day(new Date())} Note from ${byEmail || 'the Sales tool'}`
  if (isPrId(dealId)) {
    const contact = await getPrContact(dealId)
    const person = contact?.people?.[0]
    if (!person?.id) throw new UserError('That press contact is not in Attio any more')
    await addPersonNote(person.id, { title, content: text })
    return
  }
  await addDealNote(dealId, { title, content: text })
}

// ── PR: the people-based "PR Pipeline" list ──────────────────────────────────
//
// PR is worked from a list of people (journalists, editors, page owners),
// not from deals: one entry per person, several per outlet, with its own
// Status. Each entry is shaped like a deal so the queue, composer, sends and
// Send later work unchanged. Its id is "pr:<entry id>". The list's statuses
// map onto the deal stages the rest of the tool reasons about; the real
// status rides along as prStatus for display. Touches come from the tool's
// own send log, since the list has no touch count.

export const PR_LIST = process.env.ATTIO_PR_LIST || 'press_outreach'
const PR_PREFIX = 'pr:'
export function isPrId(id) { return String(id || '').startsWith(PR_PREFIX) }

/** PR Pipeline status -> the deal stage the queue logic understands. */
const PR_STAGE = {
  'To contact': 'Not Contacted',
  'Contacted': 'Reached Out',
  'Moving forward': 'In Conversation',
  'Published': 'Won',
  'Not interested': 'Lost',
  'On hold': 'Revisit Next Year',
  'Canceled': 'Lost',
}

function entryVal(entry, slug) {
  const x = entry?.entry_values?.[slug]?.[0]
  if (!x) return null
  return x.status?.title || x.option?.title || (x.value ?? null)
}

function prView(entry, person, company) {
  const status = entryVal(entry, 'status') || 'To contact'
  return {
    id: `${PR_PREFIX}${entry.id.entry_id}`,
    entryId: entry.id.entry_id,
    name: company?.name || person?.fullName || 'Press contact',
    stage: PR_STAGE[status] || 'Not Contacted',
    prStatus: status,
    motion: 'PR',
    ownerId: null,
    companyId: company?.id || null,
    personIds: person ? [person.id] : [],
    touchCount: 0,
    nextAction: null,
    nextActionDate: null,
    raceDate: null,
    runners: null,
    tier: null,
    sizeTier: null,
    priority: entryVal(entry, 'priority'),
    races: [],
    notes: entryVal(entry, 'notes'),
    value: null,
    units: null,
    courseLandmark: null,
    identity: null,
    publishedAt: entryVal(entry, 'date_of_publication'),
    publishedLink: entryVal(entry, 'link_to_published_piece'),
    createdAt: entry.created_at || null,
    webUrl: person?.webUrl || null,
    company: company || null,
    people: person ? [person] : [],
  }
}

/** Every entry on the PR list, as deal-shaped contacts. Cached like the deals. */
export async function loadPrContacts({ fresh = false } = {}) {
  if (fresh) cache.delete('pr')
  return cached('pr', CACHE_MS, async () => {
    const entries = []
    for (let offset = 0; ; offset += PAGE) {
      const res = await attio(`/lists/${PR_LIST}/entries/query`, { method: 'POST', body: { limit: PAGE, offset } })
      const data = res?.data || []
      entries.push(...data)
      if (data.length < PAGE) break
    }
    const [personById, companyById] = await Promise.all([peopleById({ fresh }), companiesById({ fresh })])
    return entries.map(e => {
      const person = personById[e.parent_record_id] || null
      return prView(e, person, person?.companyId ? companyById[person.companyId] : null)
    })
  })
}

/** One PR contact, from a warm list or read on its own: the entry, the person, the outlet. */
export async function getPrContact(id, { fresh = false } = {}) {
  if (!fresh) {
    const all = cache.get('pr')
    if (all && Date.now() - all.at < CACHE_MS) {
      const hit = (await all.value.catch(() => null))?.find(c => c.id === id)
      if (hit) return hit
    }
  }
  if (fresh) cache.delete(`deal:${id}`)
  return cached(`deal:${id}`, CACHE_MS, async () => {
    const entryId = String(id).slice(PR_PREFIX.length)
    let entry
    try { entry = (await attio(`/lists/${PR_LIST}/entries/${entryId}`))?.data } catch (err) { if (err.status === 404) return null; throw err }
    if (!entry) return null
    const person = personView(await getRecord('people', entry.parent_record_id))
    const company = person?.companyId ? companyView(await getRecord('companies', person.companyId)) : null
    return prView(entry, person, company)
  })
}

async function addPersonNote(personId, { title, content }) {
  return attio('/notes', {
    method: 'POST',
    body: { data: { parent_object: 'people', parent_record_id: personId, title, format: 'plaintext', content } },
  })
}

/** After a PR send: To contact becomes Contacted, and the email goes on the person as a note. */
async function recordPrSend(contact, { sentAt, touchNumber, subject, body, toEmail, sentBy }) {
  try {
    if (contact.prStatus === 'To contact') {
      await attio(`/lists/${PR_LIST}/entries/${contact.entryId}`, { method: 'PATCH', body: { data: { entry_values: { status: 'Contacted' } } } })
      cache.delete(`deal:${contact.id}`)
      try {
        const all = cache.get('pr')
        const list = all && await all.value
        const hit = list?.find(c => c.id === contact.id)
        if (hit) Object.assign(hit, { prStatus: 'Contacted', stage: PR_STAGE.Contacted })
      } catch { cache.delete('pr') }
    }
    const person = contact.person || contact.people?.[0]
    if (person?.id) {
      try {
        await addPersonNote(person.id, {
          title: `${day(sentAt)} Pitch ${touchNumber} sent: ${subject}`,
          content: `Sent from the Sales tool by ${sentBy || 'a rep'} to ${toEmail}.\n\nSubject: ${subject}\n\n${body}`,
        })
      } catch (err) { console.warn(`[sales.attio] PR note failed for ${contact.name}: ${err.message}`) }
    }
    return { ok: true }
  } catch (err) {
    console.error(`[sales.attio] PR write failed for ${contact.name}: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

// ── Health ───────────────────────────────────────────────────────────────────

/**
 * Can we reach the workspace, and does the deals object have the attributes
 * the tool expects. Missing ones are reported by slug so they can be added
 * in Attio settings; the tool keeps working without the optional ones.
 */
export async function checkAttio() {
  if (!isAttioConfigured()) return { configured: false, ok: false }
  try {
    const self = await attio('/self')
    const attrs = await attio('/objects/deals/attributes')
    const slugs = new Set((attrs?.data || []).map(a => a.api_slug))
    const missing = [...DEAL_ATTRIBUTES.reads, ...DEAL_ATTRIBUTES.writes].filter(s => !slugs.has(s))
    const stageAttr = (attrs?.data || []).find(a => a.api_slug === 'stage')
    let stages = null
    if (stageAttr) {
      try {
        const st = await attio(`/objects/deals/attributes/${stageAttr.id?.attribute_id || 'stage'}/statuses`)
        stages = (st?.data || []).map(s => s.title)
      } catch { stages = null }
    }
    const unknownStages = stages ? STAGES.filter(s => !stages.includes(s)) : []
    return {
      configured: true,
      ok: missing.length === 0 && unknownStages.length === 0,
      workspace: self?.data?.workspace_name || null,
      missing: [...new Set(missing)],
      stages,
      unknownStages,
    }
  } catch (err) {
    return { configured: true, ok: false, error: err.message }
  }
}
