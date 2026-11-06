/**
 * /api/admin/roles - what each role includes (Settings > Admin > Roles).
 *
 *   GET                       the table, the roles and what can be handed out
 *   PUT  { caps: { sales: [...], fulfillment: [...], designer: [...] } }
 *
 * Admin only. Admin itself always has everything and is not in the table;
 * Data and Admin settings are never on offer. See api/_lib/roles.js.
 */
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { requireAdminRole, recordAudit } from '../../_lib/users.js'
import { ROLES, ROLE_LABEL, CAPABILITIES, DEFAULT_CAPS, loadRoleCaps, saveRoleCaps, rolesOf } from '../../_lib/roles.js'
import prisma from '../../_lib/prisma.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, PUT, OPTIONS' })) return
  const actor = (await requireAdmin(req, res))
  if (!actor) return
  const user = await requireAdminRole(req, res, actor)
  if (!user) return

  try {
    if (req.method === 'GET') {
      // Who has each role, for the cards.
      const people = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, firstName: true, lastName: true, role: true, extraRoles: true }, orderBy: { firstName: 'asc' } })
      const members = Object.fromEntries(ROLES.map(r => [r, people.filter(p => rolesOf(p).includes(r)).map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim() }))]))
      return res.status(200).json({
        roles: ROLES.map(id => ({ id, label: ROLE_LABEL[id], members: members[id] })),
        capabilities: CAPABILITIES,
        caps: await loadRoleCaps({ force: true }),
        defaults: DEFAULT_CAPS,
      })
    }
    if (req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
      const before = await loadRoleCaps({ force: true })
      const caps = await saveRoleCaps(body.caps)
      await recordAudit({
        actor: user,
        action: 'roles.update',
        summary: 'Changed what roles include',
        detail: { before, after: caps },
      })
      return res.status(200).json({ caps })
    }
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[admin/roles]', err)
    return res.status(500).json({ error: 'Could not save roles' })
  }
}
