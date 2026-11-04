/**
 * /api/admin/view-as - see TrackstarOS as someone else (admin only).
 *
 *   GET                  the people an admin can view as
 *   POST   { userId }    start viewing as them (sets the ts_view_as cookie)
 *   DELETE               stop viewing
 *
 * While it is on, the session is answered as that person and is read-only
 * (api/_lib/auth.js requireAdmin). This handler checks the admin's own
 * session itself, not through requireAdmin, because requireAdmin would
 * answer as the person being viewed and refuse the POST that switches.
 */
import prisma from '../_lib/prisma.js'
import { setCors, parseCookies, liveSession, SESSION_COOKIE, createViewAsToken, buildViewAsCookie } from '../_lib/auth.js'
import { fullName, roleLabel, recordAudit } from '../_lib/users.js'
import { sendPublicError } from '../../server/lib/publicError.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' })) return

  // Stopping needs no check: it only clears a cookie.
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', buildViewAsCookie(req, { clear: true }))
    return res.status(200).json({ ok: true })
  }

  try {
    const real = await liveSession(parseCookies(req)[SESSION_COOKIE])
    if (!real) return res.status(401).json({ error: 'Unauthorized' })
    if (real.role !== 'admin') return res.status(403).json({ error: 'Viewing as someone else is for admins.' })

    if (req.method === 'GET') {
      const users = await prisma.user.findMany({
        where: { isActive: true, id: { not: real.id } },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      })
      return res.status(200).json({ users: users.map(u => ({ id: u.id, email: u.email, name: fullName(u) || u.email, role: u.role, roleLabel: roleLabel(u.role) })) })
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const userId = String(req.body?.userId || '')
    if (!userId) return res.status(400).json({ error: 'Pick someone to view as.' })
    if (userId === real.id) return res.status(400).json({ error: 'That is you.' })
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true } })
    if (!target || !target.isActive) return res.status(404).json({ error: 'No active person by that id.' })

    res.setHeader('Set-Cookie', buildViewAsCookie(req, { token: createViewAsToken(real.id, target.id) }))
    await recordAudit({ action: 'user.view_as', summary: `Viewed TrackstarOS as ${fullName(target) || target.email}`, detail: { targetId: target.id }, actor: real })
    return res.status(200).json({ ok: true, viewing: { id: target.id, name: fullName(target) || target.email } })
  } catch (error) {
    return sendPublicError(res, error)
  }
}
