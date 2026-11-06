/**
 * /api/admin/api-keys - keys for the MCP server and other integrations.
 *
 *   GET                                  every key, live and revoked (never the secret)
 *   POST { name, userId, scopes, expiresInDays }   mint one; the secret comes back once
 *   DELETE { id }                        revoke
 *
 * Admin only. Every mint and revoke is in the Activity Log. See api/_lib/apiKeys.js.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import { listApiKeys, createApiKey, revokeApiKey, SCOPES, SCOPE_LABEL } from '../../_lib/apiKeys.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  const admin = await requireAdminRole(req, res, actor)
  if (!admin) return

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ keys: await listApiKeys(), scopes: SCOPES.map(id => ({ id, label: SCOPE_LABEL[id] })) })
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (req.method === 'POST') {
      try {
        const { key, secret } = await createApiKey({ name: body.name, userId: body.userId || null, scopes: body.scopes, expiresInDays: body.expiresInDays, actor: admin })
        await recordAudit({ action: 'apikey.create', summary: `Minted API key "${key.name}" (${key.scopes.join(', ')})${key.actsAs ? ` acting as ${key.actsAs.email}` : ' as a service key'}`, detail: { id: key.id, scopes: key.scopes, userId: key.userId }, actor: admin })
        return res.status(200).json({ key, secret })
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }
    }
    if (req.method === 'DELETE') {
      try {
        const key = await revokeApiKey(body.id)
        await recordAudit({ action: 'apikey.revoke', summary: `Revoked API key "${key.name}"`, detail: { id: key.id }, actor: admin })
        return res.status(200).json({ key })
      } catch (err) {
        return res.status(400).json({ error: err.message })
      }
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[admin/api-keys]', err)
    return res.status(500).json({ error: 'Could not manage keys' })
  }
}
