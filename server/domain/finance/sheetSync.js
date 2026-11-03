/**
 * The Daily Tracker's raw tabs -> FinanceDay, one row per day.
 *
 * The five raw tabs (Shopify Data, Etsy Data, Print Shop, Meta Ads, Google
 * Ads) are filled by their own feeds, one row per day of the year, the date
 * in column A as MM/DD/YYYY, the headers on row 3. The app reads them as the
 * sheet formats them ("$16,840.00", "1,287", "-" for nothing) and stores
 * integer cents and counts. A cell that is empty or "-" is null: the feed has
 * not landed. Matt's overrides (FinanceDay.overrides) are never touched.
 *
 * Only rows that differ are written, so a run over the whole year is one
 * Sheets read and a handful of updates.
 */
import prisma from '../../db.js'
import { readRanges, listTabTitles } from '../../services/googleSheets.js'
import { todayET, isValidDay } from './periods.js'

export const SHEET_ID = '1yKe9O8XAHXRxBPlOFKN4pMNlH-eYTsdsLNJsw6Tctwg'
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`

/** Each tab: its header names -> FinanceDay field, and whether it is money. */
export const TABS = [
  { id: 'shopify', title: 'Shopify Data', key: 'shopifyNetCents', columns: {
    'Gross Sales': ['shopifyGrossCents', 'money'], 'Discounts': ['shopifyDiscountsCents', 'money'], 'Returns': ['shopifyReturnsCents', 'money'],
    'Shipping Charges': ['shopifyShippingCents', 'money'], 'Taxes': ['shopifyTaxCents', 'money'], 'Net Sales': ['shopifyNetCents', 'money'],
    'Orders': ['shopifyOrders', 'count'], 'Sessions': ['shopifySessions', 'count'], 'Add to Cart': ['shopifyAddToCart', 'count'],
    'Reached Checkout': ['shopifyReachedCheckout', 'count'], 'Completed Checkout': ['shopifyCompletedCheckout', 'count'], 'Shopify Fees': ['shopifyFeesCents', 'money'],
  } },
  { id: 'etsy', title: 'Etsy Data', key: 'etsyNetCents', columns: {
    'Gross Sales': ['etsyGrossCents', 'money'], 'Discounts': ['etsyDiscountsCents', 'money'], 'Returns': ['etsyReturnsCents', 'money'],
    'Shipping Charges': ['etsyShippingCents', 'money'], 'Taxes': ['etsyTaxCents', 'money'], 'Net Sales': ['etsyNetCents', 'money'],
    'Orders': ['etsyOrders', 'count'], 'Visits': ['etsyVisits', 'count'], 'Etsy Fees': ['etsyFeesCents', 'money'],
  } },
  { id: 'printShop', title: 'Print Shop', key: 'productionCents', columns: {
    'Production Costs': ['productionCents', 'money'], 'Shipping Costs': ['shippingCostCents', 'money'], 'Units Produced': ['unitsProduced', 'count'],
  } },
  { id: 'meta', title: 'Meta Ads', key: 'metaSpendCents', columns: {
    'Ad Spend': ['metaSpendCents', 'money'], 'Impressions': ['metaImpressions', 'count'], 'Clicks': ['metaClicks', 'count'],
    'Purchases': ['metaPurchases', 'count'], 'Purchase Value': ['metaPurchaseValueCents', 'money'], 'Add to Carts': ['metaAddToCarts', 'count'],
  } },
  { id: 'google', title: 'Google Ads', key: 'googleSpendCents', columns: {
    'Ad Spend': ['googleSpendCents', 'money'], 'Impressions': ['googleImpressions', 'count'], 'Clicks': ['googleClicks', 'count'],
    'Conversions': ['googleConversions', 'count'], 'Conversion Value': ['googleConversionValueCents', 'money'],
  } },
]
export const FIELDS = TABS.flatMap(t => Object.values(t.columns).map(c => c[0]))

/** "$16,840.00" -> 1684000; "1,287" -> 1287; "" or "-" -> null. */
export function parseCell(text, kind) {
  const s = String(text ?? '').trim()
  if (!s || s === '-' || s === '—') return null
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  const num = parseFloat(s.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(num)) return null
  const v = neg ? -num : num
  return kind === 'money' ? Math.round(v * 100) : Math.round(v)
}

/** "11/03/2026" -> "2026-11-03"; anything else null. */
export function parseDate(text) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim())
  if (m) {
    const day = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    return isValidDay(day) ? day : null
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(String(text || '').trim())
  return iso && isValidDay(iso[1]) ? iso[1] : null
}

/** One tab's grid (header row first) -> { day: { field: value } }. */
export function parseTab(tab, grid) {
  const header = (grid[0] || []).map(h => String(h || '').trim())
  const cols = []
  header.forEach((h, i) => { if (tab.columns[h]) cols.push([i, ...tab.columns[h]]) })
  const out = new Map()
  for (const row of grid.slice(1)) {
    const day = parseDate(row[0])
    if (!day) continue
    const vals = {}
    for (const [i, field, kind] of cols) vals[field] = parseCell(row[i], kind)
    out.set(day, vals)
  }
  return out
}

const STATUS_KEY = 'finance_sheet_sync'

/**
 * Read the raw tabs and write what changed. `since` limits the days written
 * (the Refresh button uses the last 60 days; the cron takes the year).
 */
export async function syncFromSheet({ since = null, now = new Date() } = {}) {
  const today = todayET(now)
  const titles = await listTabTitles(SHEET_ID)
  const missingTabs = TABS.filter(t => !titles.includes(t.title)).map(t => t.title)
  const present = TABS.filter(t => titles.includes(t.title))
  const grids = await readRanges(present.map(t => `'${t.title}'!A3:Z400`), { spreadsheetId: SHEET_ID })
  const byDay = new Map()
  const latest = {}
  present.forEach((tab, i) => {
    const parsed = parseTab(tab, grids[i])
    for (const [day, vals] of parsed) {
      if (day > today) continue
      if (since && day < since) continue
      const row = byDay.get(day) || { day }
      Object.assign(row, vals)
      byDay.set(day, row)
      if (vals[tab.key] != null && (!latest[tab.id] || day > latest[tab.id])) latest[tab.id] = day
    }
  })
  // A day with nothing in any tab is not a row yet.
  const days = [...byDay.values()].filter(r => FIELDS.some(f => r[f] != null)).sort((a, b) => a.day.localeCompare(b.day))
  const existing = new Map((await prisma.financeDay.findMany({ where: { day: { in: days.map(d => d.day) } } })).map(r => [r.day, r]))
  let created = 0, updated = 0
  for (const r of days) {
    const data = Object.fromEntries(FIELDS.map(f => [f, r[f] ?? null]))
    const was = existing.get(r.day)
    if (!was) { await prisma.financeDay.create({ data: { day: r.day, ...data } }); created++; continue }
    if (FIELDS.some(f => (was[f] ?? null) !== (data[f] ?? null))) {
      await prisma.financeDay.update({ where: { day: r.day }, data: { ...data, readAt: now } })
      updated++
    }
  }
  const result = { at: now.toISOString(), read: days.length, created, updated, latest, missingTabs, since: since || days[0]?.day || null }
  await prisma.systemConfig.upsert({ where: { key: STATUS_KEY }, update: { value: JSON.stringify(result) }, create: { key: STATUS_KEY, value: JSON.stringify(result) } })
  return result
}

/** The last sync's result, or null. */
export async function lastSync() {
  const row = await prisma.systemConfig.findUnique({ where: { key: STATUS_KEY } })
  try { return row ? JSON.parse(row.value) : null } catch { return null }
}
