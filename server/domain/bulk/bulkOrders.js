/**
 * Bulk partner orders.
 *
 * A partner prepays for a run of co-branded prints for one race. The invoice
 * is Stripe, the runner list comes from the partner (names and addresses
 * only; bibs and times are ours to find), the prints are made by Eli from
 * one production file, and the whole run goes to Artelo as a bulk upload
 * sheet: one row per runner, each pointing at a public URL for its file.
 *
 * Runners are ordinary Order rows of type "bulk" with the bulk order as their
 * parent, so research, weather, the filename convention and the order modal
 * all work on them without knowing anything about this module.
 */
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import prisma from '../../../api/_lib/prisma.js'
import { getCanonicalRaceName, hasScraperForRace, getCoveredYears, getVerifiedRaceDates } from '../../scrapers/index.js'
import { parseCsv } from '../../lib/csv.js'
import { ResearchService } from '../../services/ResearchService.js'

export const TURNAROUND_DAYS = 3

/** The Artelo catalog values we ship. Everything else on the sheet is fixed. */
export const FRAME_OPTIONS = ['Unframed', 'Natural Premium Oak', 'Black Premium Oak']
export const SIZE_OPTIONS = ['8x10', '12x18', '16x24']

export function nextNumber(last) {
  const n = last ? parseInt(String(last).replace(/\D/g, ''), 10) || 0 : 0
  return `BULK-${String(n + 1).padStart(4, '0')}`
}

export function dueDateFor(raceDate) {
  if (!raceDate) return null
  return new Date(new Date(raceDate).getTime() + TURNAROUND_DAYS * 86400000)
}

/** The pinned, verified date for a race year, or null. Never computed. */
export function verifiedRaceDate(raceName, year) {
  const canonical = getCanonicalRaceName(raceName) || raceName
  const pinned = getVerifiedRaceDates()[canonical]?.[year]
  return pinned ? new Date(`${pinned}T12:00:00Z`) : null
}

/**
 * Parse a runner list. Accepts CSV with a header row (any order, loose
 * names) or plain lines of "First Last". Returns rows and the problems that
 * would stop a row shipping, so the person can fix the list before it lands.
 */
export function parseRunnerList(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim()
  if (!raw) return { rows: [], problems: ['The list is empty'] }
  const hasCommas = raw.split('\n')[0].includes(',') || raw.split('\n')[0].includes('\t')
  const rows = []
  const problems = []
  if (hasCommas) {
    const parsed = parseCsv(raw.includes('\t') && !raw.includes(',') ? raw.replace(/\t/g, ',') : raw)
    const header = (parsed.headers || []).map(h => String(h || '').trim().toLowerCase())
    const body = parsed.rows || []
    const col = (...names) => header.findIndex(h => names.some(n => h === n || h.replace(/[^a-z0-9]/g, '') === n.replace(/[^a-z0-9]/g, '')))
    const iFirst = col('first name', 'first', 'firstname')
    const iLast = col('last name', 'last', 'lastname', 'surname')
    const iName = col('name', 'runner', 'runner name', 'full name')
    const iEmail = col('email', 'e-mail')
    const iL1 = col('address', 'address line 1', 'address 1', 'street', 'line1')
    const iL2 = col('address line 2', 'address 2', 'apt', 'line2', 'unit')
    const iCity = col('city', 'city/town', 'town')
    const iState = col('state', 'state/province/region', 'province', 'region')
    const iZip = col('zip', 'zip/postal code', 'postal code', 'postcode', 'zipcode')
    const iCountry = col('country')
    if (iFirst < 0 && iName < 0) return { rows: [], problems: ['Could not find a name column. Use "First Name" and "Last Name", or "Name".'] }
    for (let r = 0; r < body.length; r++) {
      const cells = body[r]
      if (!cells || cells.every(c => !String(c || '').trim())) continue
      const g = i => (i >= 0 ? String(cells[i] || '').trim() : '')
      const name = iFirst >= 0 ? `${g(iFirst)} ${g(iLast)}`.trim() : g(iName)
      if (!name) { problems.push(`Row ${r + 2}: no name`); continue }
      const row = {
        runnerName: name,
        email: g(iEmail) || null,
        address: {
          line1: g(iL1), line2: g(iL2), city: g(iCity), state: g(iState), zip: g(iZip),
          country: g(iCountry) || 'United States',
        },
      }
      if (!row.address.line1 || !row.address.city || !row.address.zip) problems.push(`${name}: address is incomplete`)
      rows.push(row)
    }
  } else {
    for (const line of raw.split('\n')) {
      const name = line.trim()
      if (!name) continue
      rows.push({ runnerName: name, email: null, address: { line1: '', line2: '', city: '', state: '', zip: '', country: 'United States' } })
      problems.push(`${name}: no address yet`)
    }
  }
  return { rows, problems }
}

export function addressComplete(a) {
  return Boolean(a && a.line1 && a.city && a.zip)
}

/**
 * The address an order's prints go to when it ships everything to the
 * organization (billing.js), in the runner-address shape; null when each
 * runner gets their own.
 */
export async function orgShipTo(bulk) {
  const terms = 'shipping' in bulk ? bulk : await prisma.bulkOrder.findUnique({ where: { id: bulk.id }, select: { shipping: true, shipToAddress: true } })
  const a = terms?.shipping === 'organization' ? terms.shipToAddress : null
  return a ? { line1: a.address1 || '', line2: a.address2 || '', city: a.city || '', state: a.province || '', zip: a.zip || '', country: a.country === 'US' || !a.country ? 'United States' : a.country } : null
}

/**
 * Create runner rows under a bulk order. Skips exact duplicate names already
 * present. Each runner carries the run's event, so research searches that
 * event; when the order ships to the organization, that is every runner's
 * address and the list needs names only.
 */
export async function addRunners(bulk, rows) {
  const shipTo = await orgShipTo(bulk)
  const existing = await prisma.order.findMany({ where: { bulkOrderId: bulk.id }, select: { runnerName: true, lineItemIndex: true } })
  const seen = new Set(existing.map(e => e.runnerName.trim().toLowerCase()))
  let idx = existing.reduce((m, e) => Math.max(m, e.lineItemIndex), 0)
  const created = []
  for (const row of rows) {
    const key = row.runnerName.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    idx += 1
    const order = await prisma.order.create({
      data: {
        orderNumber: `${bulk.number}-${idx}`,
        parentOrderNumber: bulk.number,
        lineItemIndex: idx,
        source: 'bulk',
        arteloOrderData: {},
        raceName: bulk.raceName,
        raceYear: bulk.raceYear,
        runnerName: row.runnerName.trim(),
        productSize: bulk.productSize,
        frameType: bulk.frameType,
        trackstarOrderType: 'bulk',
        bulkOrderId: bulk.id,
        shippingAddress: shipTo || row.address,
        customerEventType: bulk.eventType || null,
        customerEmail: row.email,
        customerName: row.runnerName.trim().split(/\s+/)[0],
        dueDate: bulk.dueDate,
      },
    })
    created.push(order)
  }
  return created
}

/** What has to be true before the run can go. Each item is a light, not a gate, except paid. */
export async function readiness(bulk, runners) {
  const canonical = getCanonicalRaceName(bulk.raceName) || bulk.raceName
  const scraper = hasScraperForRace(bulk.raceName)
  const covered = scraper ? getCoveredYears(bulk.raceName) : null
  const yearOk = scraper && (covered === null || covered.includes(bulk.raceYear))
  const health = scraper ? await prisma.scraperHealth.findUnique({ where: { race_year: { race: canonical, year: bulk.raceYear } } }) : null
  const design = bulk.partnerOrderId
    ? await prisma.order.findUnique({ where: { id: bulk.partnerOrderId }, select: { designStatus: true, proofs: { where: { status: 'approved' }, select: { imageUrl: true }, take: 1 } } })
    : null
  const withAddress = runners.filter(r => addressComplete(r.shippingAddress)).length
  return {
    paid: Boolean(bulk.paidAt),
    raceDate: { ok: Boolean(bulk.raceDate), date: bulk.raceDate },
    scraper: {
      ok: scraper && yearOk && health?.status !== 'broken',
      configured: scraper,
      yearConfigured: yearOk,
      health: health ? { status: health.status, checkedAt: health.checkedAt, detail: health.detail } : null,
    },
    design: {
      ok: Boolean(design && ['approved_by_customer', 'final_pdf_uploaded', 'sent_to_production'].includes(design.designStatus)),
      status: design?.designStatus || null,
      approvedImageUrl: design?.proofs?.[0]?.imageUrl || null,
    },
    runners: { total: runners.length, withAddress, ok: runners.length > 0 && withAddress === runners.length },
  }
}

/**
 * Research every runner that has not been researched yet, in order, stopping
 * after `limit` so a 100-person list does not hold one request for minutes.
 * Returns what happened so the caller can show it and call again.
 */
export async function researchPending(bulk, { limit = 10 } = {}) {
  const runners = await prisma.order.findMany({
    where: { bulkOrderId: bulk.id, researchedAt: null },
    orderBy: { lineItemIndex: 'asc' },
    take: limit,
  })
  const service = new ResearchService()
  const results = []
  for (const r of runners) {
    try {
      const out = await service.researchOrder(r.orderNumber)
      results.push({ orderNumber: r.orderNumber, runnerName: r.runnerName, status: out?.runnerResearch?.researchStatus || 'done' })
    } catch (err) {
      results.push({ orderNumber: r.orderNumber, runnerName: r.runnerName, status: 'error', error: err.message })
    }
  }
  const remaining = await prisma.order.count({ where: { bulkOrderId: bulk.id, researchedAt: null } })
  return { done: results, remaining }
}

/**
 * Pick the runner a dropped file belongs to. The tool names files
 * "<orderNumber>_<race>_<Last>.pdf", so the order number wins outright; a
 * file named by hand matches on last name when exactly one runner has it.
 */
export function matchFileToRunner(filename, runners) {
  const base = String(filename || '').replace(/\.[a-z0-9]+$/i, '')
  const byNumber = runners.find(r => base.toUpperCase().startsWith(r.orderNumber.toUpperCase()))
  if (byNumber) return { runner: byNumber, how: 'order number' }
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
  const tokens = base.split(/[_\-\s.]+/).map(norm).filter(Boolean)
  const candidates = runners.filter(r => {
    const parts = r.runnerName.trim().split(/\s+/)
    const last = norm(parts[parts.length - 1])
    return last && tokens.includes(last)
  })
  if (candidates.length === 1) return { runner: candidates[0], how: 'last name' }
  if (candidates.length > 1) {
    // Try first name too.
    const both = candidates.filter(r => tokens.includes(norm(r.runnerName.trim().split(/\s+/)[0])))
    if (both.length === 1) return { runner: both[0], how: 'first and last name' }
    return { runner: null, how: 'ambiguous', candidates }
  }
  return { runner: null, how: 'no match' }
}

/**
 * Where a production file may live: our own storage (where api/bulk/files.js
 * puts uploads) or a Google Drive link. The URL is what Artelo prints and what
 * checkUrl fetches, so an arbitrary one is both a wrong print and a way to
 * make the server fetch any address.
 */
export function isAllowedFileUrl(value) {
  let u
  try { u = new URL(String(value)) } catch { return false }
  if (u.protocol !== 'https:' || (u.port && u.port !== '443')) return false
  const storage = String(process.env.SUPABASE_URL || '').replace(/\/$/, '')
  if (storage && String(value).startsWith(`${storage}/storage/v1/object/public/`)) return true
  return ['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'].includes(u.hostname)
}

/** Does Artelo's fetcher see the file? A plain unauthenticated GET, like theirs. */
export async function checkUrl(url) {
  if (!isAllowedFileUrl(url)) return { ok: false, status: 0, error: 'Not a storage or Google Drive link' }
  try {
    const res = await fetchWithTimeout(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'follow' }, 10_000)
    const ok = res.status === 200 || res.status === 206
    return { ok, status: res.status, contentType: res.headers.get('content-type') }
  } catch (err) {
    return { ok: false, status: 0, error: err.message }
  }
}

/** The Artelo sheet rows, in the template's column order. */
export function sheetRows(bulk, runners) {
  const framed = bulk.frameType !== 'Unframed'
  return runners.map(r => {
    const a = r.shippingAddress || {}
    return {
      'Order ID': r.orderNumber,
      'Customer Name': r.runnerName,
      'Address Line 1': a.line1 || '',
      'Address Line 2': a.line2 || '',
      'City/Town': a.city || '',
      'State/Province/Region': a.state || '',
      'Zip/Postal Code': a.zip || '',
      'Country': a.country || 'United States',
      'Quantity': 1,
      'Product Catalog Type': 'Individual Art Print',
      'Orientation': 'Portrait',
      'Paper Type': 'Fine Art - Archival Matte',
      'Framing': bulk.frameType,
      'Size': bulk.productSize,
      'Include Framing Service': framed ? 1 : 0,
      'Include Hanging Pins': framed ? 1 : 0,
      'Include Mats': 0,
      'Design Fit Style': 'Outside',
      'Design Fit Canvas': 0,
      'Image URL 1': r.productionFileUrl || '',
    }
  })
}

export const SHEET_COLUMNS = [
  'Order ID', 'Customer Name', 'Address Line 1', 'Address Line 2', 'City/Town', 'State/Province/Region', 'Zip/Postal Code', 'Country',
  'Quantity', 'Product Catalog Type', 'Orientation', 'Paper Type', 'Framing', 'Size', 'Include Framing Service', 'Include Hanging Pins',
  'Include Mats', 'Design Fit Style', 'Design Fit Canvas',
  'Image URL 1', 'Image URL 2', 'Image URL 3', 'Image URL 4', 'Image URL 5', 'Image URL 6', 'Image URL 7', 'Image URL 8', 'Image URL 9', 'Image URL 10', 'Image URL 11', 'Image URL 12',
]

/** Rows that would fail Artelo's validation, with the reason. */
export function sheetProblems(runners) {
  const out = []
  for (const r of runners) {
    if (!addressComplete(r.shippingAddress)) out.push({ orderNumber: r.orderNumber, runnerName: r.runnerName, problem: 'Address is incomplete' })
    if (!r.productionFileUrl) out.push({ orderNumber: r.orderNumber, runnerName: r.runnerName, problem: 'No print file attached' })
  }
  return out
}
