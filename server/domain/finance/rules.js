/**
 * The constants the scoreboard math depends on, effective-dated, so a change
 * of rule is a row with a date rather than an edit that rewrites history.
 *
 *   designer_fee   { pct: 7.5, base: 'gp' | 'cm' }
 *                  Before 2026-11-01 the designer fee was 7.5% of gross
 *                  profit (revenue less fees, production and shipping) and
 *                  counted inside COGS. From 2026-11-01 it is 7.5% of the
 *                  contribution margin before the fee (gross profit less ad
 *                  spend) and sits under profit, outside COGS. The sheet's
 *                  own header says so.
 *   breakeven_roas { value: 1.56 }
 *   shopify_fee    { pct: 2.9, perOrderCents: 30 }  used only when the sheet's
 *                  Shopify Fees column is empty for a day that has sales.
 *
 * Rows in FinanceRule override these defaults from their effectiveFrom day.
 */
import prisma from '../../db.js'

const DEFAULTS = [
  { key: 'designer_fee', effectiveFrom: '2000-01-01', value: { pct: 7.5, base: 'gp' } },
  { key: 'designer_fee', effectiveFrom: '2026-11-01', value: { pct: 7.5, base: 'cm' } },
  { key: 'breakeven_roas', effectiveFrom: '2000-01-01', value: { value: 1.56 } },
  { key: 'shopify_fee', effectiveFrom: '2000-01-01', value: { pct: 2.9, perOrderCents: 30 } },
]

let cache = { at: 0, rows: null }

/** Every rule, defaults plus the table, sorted by key then date. Cached a minute per instance. */
export async function loadRules({ force = false } = {}) {
  if (!force && cache.rows && Date.now() - cache.at < 60_000) return cache.rows
  let fromDb = []
  try {
    fromDb = await prisma.financeRule.findMany({ select: { key: true, effectiveFrom: true, value: true } })
  } catch (err) {
    console.warn('[finance] rules table unreadable, using defaults:', err?.message)
  }
  const rows = [...DEFAULTS, ...fromDb].sort((a, b) => a.key.localeCompare(b.key) || a.effectiveFrom.localeCompare(b.effectiveFrom))
  cache = { at: Date.now(), rows }
  return rows
}

/** The rule in force on a day: the latest row of that key with effectiveFrom <= day. */
export function ruleFor(rules, key, day) {
  let hit = null
  for (const r of rules) if (r.key === key && r.effectiveFrom <= day) hit = r
  return hit?.value || null
}

export function invalidateRules() { cache = { at: 0, rows: null } }
