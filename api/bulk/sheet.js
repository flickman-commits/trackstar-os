/**
 * /api/bulk/sheet?id=   the Artelo bulk upload workbook for one order.
 *
 * One row per runner in the template's exact column order, with the product
 * columns fixed to what we ship and the file URL in Image URL 1. Rows with a
 * missing address or file are still written so the person can see the gap,
 * but the response also names them; the UI blocks the download until the
 * list is clean unless ?force=1.
 *
 *   ?batch=next   only the runners ready for the next batch (server/domain/bulk/batches.js)
 *   ?batch=<n>    a batch already sent, again
 */
import XLSX from 'xlsx'
import prisma from '../_lib/prisma.js'
import { setCors, requireAdmin } from '../_lib/auth.js'
import { sheetRows, sheetProblems, SHEET_COLUMNS } from '../../server/domain/bulk/bulkOrders.js'
import { sendPublicError } from '../../server/lib/publicError.js'
import { nextBatchRunners, batchRunnerIds, BatchError } from '../../server/domain/bulk/batches.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const id = String(req.query?.id || '')
    if (!id) return res.status(400).json({ error: 'id is required' })
    const bulk = await prisma.bulkOrder.findUnique({ where: { id } })
    if (!bulk) return res.status(404).json({ error: 'Bulk order not found' })
    let runners = (await prisma.order.findMany({ where: { bulkOrderId: id }, orderBy: { lineItemIndex: 'asc' }, include: { runnerResearch: { select: { researchStatus: true }, take: 1, orderBy: { createdAt: 'desc' } } } }))
      .map(r => ({ ...r, runnerName: r.runnerNameOverride || r.runnerName }))
    const batch = String(req.query?.batch || '')
    let batchLabel = ''
    if (batch === 'next') {
      runners = nextBatchRunners(runners)
      if (!runners.length) return res.status(400).json({ error: 'Nobody is ready for a batch yet: each runner needs an address and an approved print.' })
      batchLabel = '_next_batch'
    } else if (/^\d+$/.test(batch)) {
      const ids = new Set(await batchRunnerIds(id, Number(batch)))
      runners = runners.filter(r => ids.has(r.id))
      batchLabel = `_batch_${batch}`
    }

    const problems = sheetProblems(runners)
    if (problems.length && req.query?.force !== '1') {
      return res.status(400).json({ error: `${problems.length} row${problems.length === 1 ? '' : 's'} would fail at Artelo`, problems })
    }

    const rows = sheetRows(bulk, runners)
    const ws = XLSX.utils.json_to_sheet(rows, { header: SHEET_COLUMNS })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Orders')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    const name = `${bulk.number}_${bulk.partnerName.replace(/[^A-Za-z0-9]+/g, '_')}${batchLabel}_Artelo.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
    return res.status(200).send(buf)
  } catch (error) {
    if (error instanceof BatchError) return res.status(error.status).json({ error: error.message })
    console.error('[API /bulk/sheet]', error)
    return sendPublicError(res, error)
  }
}
