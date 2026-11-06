/**
 * /api/support/macros - saved replies.
 *
 *   GET                                   the list, most used first (seeds the playbook's on first read)
 *   POST { action:'save', id?, name, shortcut?, body }
 *   POST { action:'delete', id }
 *   POST { action:'use', id }             counts an insert
 *
 * Anyone on Support adds; editing and deleting are the author's or an admin's.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { listMacros, saveMacro, deleteMacro, noteMacroUse } from '../../../server/domain/support/macros.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    if (req.method === 'GET') return res.status(200).json({ macros: await listMacros() })
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (body.action === 'save') {
      const m = await saveMacro({ id: body.id, name: body.name, shortcut: body.shortcut, body: body.body }, user)
      await recordAudit({ action: 'support.macro', summary: `${body.id ? 'Edited' : 'Added'} macro "${m.name}"`, detail: { id: m.id }, actor: user })
      return res.status(200).json(m)
    }
    if (body.action === 'delete') {
      const out = await deleteMacro(String(body.id || ''), user)
      await recordAudit({ action: 'support.macro', summary: 'Deleted a macro', detail: { id: out.id }, actor: user })
      return res.status(200).json(out)
    }
    if (body.action === 'use') { await noteMacroUse(String(body.id || '')); return res.status(200).json({ ok: true }) }
    return res.status(400).json({ error: `Unknown action: ${body.action}` })
  } catch (error) {
    console.error('[API /support/macros]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Could not save the macro') })
  }
}
