/**
 * /api/admin/connections - Settings > Connections. Admins only.
 *
 *   GET                                         every service: on/off, configured, connected as, last used
 *   POST { action: 'switch', id, on, confirm }  turn a service on or off (critical ones need confirm)
 *   POST { action: 'test', id }                 one read-only call through that service's client
 *
 * Never returns a secret or a token, only whether each is set. Switching is
 * written to the Activity Log.
 */
import { setCors } from '../../_lib/auth.js'
import { requireAdminOnly, recordAudit } from '../../_lib/users.js'
import { CONNECTIONS, connectionStatus, setConnectionOn } from '../../../server/lib/connections.js'
import { testConnection } from '../../../server/lib/connectionTests.js'
import { sendPublicError } from '../../../server/lib/publicError.js'

const KNOWN = new Set(CONNECTIONS.map(c => c.id))

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  const admin = await requireAdminOnly(req, res)
  if (!admin) return
  res.setHeader('Cache-Control', 'private, no-store')

  try {
    if (req.method === 'GET') return res.status(200).json({ connections: await connectionStatus() })
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const id = String(body.id || '')
    if (!KNOWN.has(id)) return res.status(400).json({ error: 'Unknown connection' })
    const entry = CONNECTIONS.find(c => c.id === id)

    if (body.action === 'switch') {
      const on = body.on === true
      if (!on && entry.critical && body.confirm !== true) {
        return res.status(409).json({ error: `Turning ${entry.label} off stops imports and every order action that uses it. Confirm to go ahead.`, needsConfirm: true })
      }
      await setConnectionOn(id, on)
      await recordAudit({ action: `connection.${on ? 'on' : 'off'}`, summary: `Turned ${entry.label} ${on ? 'on' : 'off'}`, detail: { id }, actor: admin })
      return res.status(200).json({ connections: await connectionStatus() })
    }

    if (body.action === 'test') {
      return res.status(200).json({ id, ...(await testConnection(id)) })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /admin/connections]', error)
    return sendPublicError(res, error)
  }
}
