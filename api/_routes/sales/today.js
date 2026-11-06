/**
 * /api/sales/today - the morning, read live from Attio.
 *
 *   GET ?scope=mine|all&motion=Race|Charity   new outreach, follow-ups due, what went out, counts
 *   GET ?action=deal&id=                       one deal with its people, enrichment and send history
 *   GET ?action=progress                       sends per day and the stage spread, last 30 days
 *   GET ?action=search&q=                      deals at any stage, for writing outside the queue
 *   GET ?refresh=1                             skip the short Attio cache
 *   POST { action:'skip', id, reason? }        hide until tomorrow
 *   POST { action:'unskip', id }
 *   POST { action:'stage', id, stage }         a person moves the deal in Attio
 *   POST { action:'note', id, text }           a note on the deal in Attio
 *   POST { action:'remove', id, reason? }      a person takes it out for good: Lost (PR: Not interested), with a note
 *   POST { action:'restore', id, previous }    undo a remove: back to the stage it had
 *
 * mine (default) is the deals whose Attio owner is you, plus unowned ones;
 * all is everyone's, for covering when the other person is out.
 */
import prisma from '../../_lib/prisma.js'
import { setCors } from '../../_lib/auth.js'
import { requireSalesRep } from '../../_lib/users.js'
import { getSettings, startOfToday } from '../../../server/domain/sales/settings.js'
import { morningQueue, dealForWork, progress, searchDeals } from '../../../server/domain/sales/queue.js'
import { setStage, noteOnDeal, isAttioConfigured, removeFromOutreach, restoreToOutreach } from '../../../server/domain/sales/attio.js'
import { publicMessage, publicStatus } from '../../../server/domain/sales/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireSalesRep(req, res)
  if (!actor) return

  try {
    if (!isAttioConfigured()) {
      return res.status(503).json({ error: 'Attio is not connected. Set ATTIO_API_KEY in Vercel and reload.', code: 'attio_not_configured' })
    }
    if (req.method === 'GET') {
      const action = String(req.query?.action || '')
      const scopeMode = String(req.query?.scope || 'mine')
      if (action === 'progress') return res.status(200).json(await progress(actor, { scopeMode }))
      if (action === 'search') return res.status(200).json({ deals: await searchDeals(String(req.query?.q || '')) })
      if (action === 'deal') {
        if (!req.query?.id) return res.status(400).json({ error: 'id is required' })
        return res.status(200).json({ deal: await dealForWork(String(req.query.id), { fresh: req.query?.refresh === '1' }) })
      }
      const motion = ['Race', 'Charity', 'Corporate', 'PR'].includes(String(req.query?.motion)) ? String(req.query.motion) : null
      return res.status(200).json(await morningQueue(actor, { scopeMode, motion, fresh: req.query?.refresh === '1' }))
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      const id = String(body.id || '')
      if (!id) return res.status(400).json({ error: 'id is required' })
      if (body.action === 'skip') {
        const settings = await getSettings()
        const until = new Date(startOfToday(settings.timezone).getTime() + 86400000)
        const reason = String(body.reason || '').trim() || null
        await prisma.salesSkip.upsert({
          where: { attioDealId: id },
          update: { until, reason, byEmail: actor.email || null },
          create: { attioDealId: id, until, reason, byEmail: actor.email || null },
        })
        if (reason) await noteOnDeal(id, `Skipped today: ${reason}`, actor.email).catch(err => console.warn(`[sales] skip note failed: ${err.message}`))
        return res.status(200).json({ success: true, until })
      }
      if (body.action === 'remove') {
        const reason = String(body.reason || '').trim().slice(0, 500) || null
        const out = await removeFromOutreach(id, { reason, byEmail: actor.email })
        await prisma.salesSkip.deleteMany({ where: { attioDealId: id } })
        return res.status(200).json({ success: true, previous: out.previous })
      }
      if (body.action === 'restore') {
        await restoreToOutreach(id, String(body.previous || '') || null)
        return res.status(200).json({ success: true })
      }
      if (body.action === 'unskip') {
        await prisma.salesSkip.deleteMany({ where: { attioDealId: id } })
        return res.status(200).json({ success: true })
      }
      if (body.action === 'stage') {
        const deal = await setStage(id, String(body.stage || ''))
        return res.status(200).json({ deal: await dealForWork(id) , stage: deal?.stage })
      }
      if (body.action === 'note') {
        const text = String(body.text || '').trim()
        if (!text) return res.status(400).json({ error: 'Nothing to note' })
        await noteOnDeal(id, text, actor.email)
        return res.status(200).json({ success: true })
      }
      return res.status(400).json({ error: `Unknown action: ${body.action}` })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('[API /sales/today]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Could not load the queue') })
  }
}
