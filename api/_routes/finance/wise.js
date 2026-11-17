/**
 * Paying the team through Wise (server/domain/finance/wisePay.js). Admin
 * only, signed in through the browser: requireAdminOnly takes a session
 * cookie, never an API key or the cron secret, so neither the MCP nor a cron
 * can send money from here.
 *
 * GET  ?preview=period&periodStart=YYYY-MM-DD   who Send would pay for an hours period, with live quotes and the balance
 * GET  ?preview=month&month=YYYY-MM             the same for the design team's month
 * GET  ?payees=1                                everyone, with their Wise recipient and tax form
 * GET  ?recipients=1                            the recipients on the Wise profile, to link
 * GET  ?runs=1                                  the latest Wise runs and each transfer's state
 * POST { action: 'send', kind: 'period' | 'month', periodStart | month, userIds: [] }   moves money
 * POST { action: 'retry' | 'release', id }      one transfer
 * POST { action: 'refresh' }                    ask Wise for the latest states now
 * POST { action: 'link_recipient', userId, recipientId | null }
 * POST { action: 'link_contact', userId, identifier, currency }   someone with their own Wise account (Wisetag, email or phone)
 * POST { action: 'set_tax_form', userId, type: 'W-9' | 'W-8BEN' | null, onFile }
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import * as wisePay from '../../../server/domain/finance/wisePay.js'
import { answerError, body } from '../../_lib/finance.js'

const usd = c => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const outcome = run => run.transfers.map(t => `${t.name || t.userId} ${usd(t.cents)} ${t.status}${t.wiseTransferId ? ` (Wise #${t.wiseTransferId})` : ''}${t.failureReason ? `: ${t.failureReason}` : ''}`).join('; ')

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const actor = await requireAdminOnly(req, res)
  if (!actor) return
  try {
    if (req.method === 'GET') {
      const q = req.query || {}
      if (q.preview) return res.status(200).json(await wisePay.preview({ kind: String(q.preview), periodStart: q.periodStart ? String(q.periodStart) : undefined, month: q.month ? String(q.month) : undefined }))
      if (q.payees) return res.status(200).json({ payees: await wisePay.payees() })
      if (q.recipients) return res.status(200).json({ recipients: await wisePay.recipients() })
      if (q.runs) return res.status(200).json({ runs: await wisePay.latestRuns() })
      return res.status(400).json({ error: 'What should this show?' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const b = body(req)
    let out, summary, detail = { ...b }
    switch (b.action) {
      case 'send': {
        out = await wisePay.send({ kind: b.kind, periodStart: b.periodStart, month: b.month, userIds: b.userIds, actor })
        summary = `Sent "${out.label}" through Wise, ${usd(out.totalCents)}: ${outcome(out)}`
        detail = { ...b, runId: out.runId, transfers: out.transfers.map(t => ({ id: t.id, userId: t.userId, cents: t.cents, status: t.status, wiseTransferId: t.wiseTransferId, traceId: t.traceId })) }
        break
      }
      case 'retry': out = await wisePay.retry(String(b.id || '')); summary = `Retried a Wise payment on "${out.label}": ${outcome(out)}`; break
      case 'release': out = await wisePay.release(String(b.id || '')); summary = `Released a Wise payment on "${out.label}" so it can be paid another way`; break
      case 'refresh': out = await wisePay.refreshStatuses(); summary = out.changed.length ? `Wise states: ${out.changed.map(c => `${c.id} ${c.from} -> ${c.to}`).join(', ')}` : null; break
      case 'link_recipient': out = { payees: await wisePay.linkRecipient(b.userId, b.recipientId || null) }; summary = b.recipientId ? `Linked a Wise recipient (${b.recipientId})` : 'Unlinked a Wise recipient'; break
      case 'link_contact': { out = { payees: await wisePay.linkContact(b.userId, { identifier: b.identifier, currency: b.currency }) }; const who = out.payees.find(p => p.userId === b.userId); summary = `Linked a Wise account for ${who?.name || b.userId} (${who?.recipientName || 'name not given'}, ${who?.currency || b.currency})`; detail = { action: b.action, userId: b.userId, currency: b.currency }; break }
      case 'set_tax_form': out = { payees: await wisePay.setTaxForm(b.userId, { type: b.type ?? null, onFile: b.onFile }) }; summary = `Tax form set to ${b.type || 'none'}${b.onFile ? ', on file' : ''}`; break
      default: return res.status(400).json({ error: 'Unknown action' })
    }
    if (summary) await recordAudit({ action: `wise.${b.action}`, summary, detail, actor })
    return res.status(200).json(out)
  } catch (error) { return answerError(res, error, '/finance/wise') }
}
