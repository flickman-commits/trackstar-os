/**
 * GET  /api/finance/daily?month=YYYY-MM          the month's days, totals and weeks
 * GET  /api/finance/daily?day=YYYY-MM-DD         one day's raw inputs (sheet value, override)
 * POST /api/finance/daily { action: 'override', day, field, value }   value in cents or a count; null takes it back
 * POST /api/finance/daily { action: 'sync', all?: true }              read the sheet now (last 60 days, or the year)
 * Admin only.
 */
import prisma from '../../_lib/prisma.js'
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { dailyTable, setOverride, inputsFor } from '../../../server/domain/finance/ledger.js'
import { syncFromSheet, lastSync, SHEET_URL } from '../../../server/domain/finance/sheetSync.js'
import { todayET, addDays, isValidDay, monthOf } from '../../../server/domain/finance/periods.js'
import { answerError, body } from '../../_lib/finance.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'POST') {
      const b = body(req)
      if (b.action === 'sync') {
        const since = b.all ? null : addDays(todayET(), -60)
        const out = await syncFromSheet({ since })
        await recordAudit({ action: 'finance.sync', summary: `Read the Daily Tracker (${out.read} days, ${out.created} new, ${out.updated} changed)`, detail: out, actor })
        return res.status(200).json(out)
      }
      if (b.action === 'override') {
        const value = b.value === null || b.value === undefined ? null : Number(b.value)
        const out = await setOverride({ day: b.day, field: b.field, value })
        await recordAudit({ action: 'finance.override', summary: value === null ? `Took back the override on ${b.field} for ${b.day}` : `Set ${b.field} for ${b.day} to ${value}`, detail: { day: b.day, field: b.field, value }, actor })
        return res.status(200).json(out)
      }
      return res.status(400).json({ error: 'action must be sync or override' })
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
    if (req.query?.day) {
      const day = String(req.query.day)
      if (!isValidDay(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD' })
      const row = await prisma.financeDay.findUnique({ where: { day } })
      return res.status(200).json({ day, inputs: inputsFor(row || { day, overrides: null }), readAt: row?.readAt || null })
    }
    const month = String(req.query?.month || monthOf(todayET()))
    const table = await dailyTable(month)
    return res.status(200).json({ ...table, sync: await lastSync(), sheetUrl: SHEET_URL })
  } catch (error) { return answerError(res, error, '/finance/daily') }
}
