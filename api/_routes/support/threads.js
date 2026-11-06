/**
 * GET /api/support/threads?view=inbox|mentions|unassigned|all|waiting|escalated|snoozed|closed|teammate:<id>&sort=waiting|newest|oldest|priority&q=
 *
 * One view of the inbox, the counts every view shows, the team for the
 * assignee picker and the views column, tag suggestions, and who is asking.
 * Read from the mirror, never from Gmail.
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability } from '../../_lib/users.js'
import { listThreads, team, TAG_SUGGESTIONS } from '../../../server/domain/support/threads.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, OPTIONS' })) return
  const user = await requireCapability(req, res, 'support')
  if (!user) return
  try {
    const view = String(req.query?.view || 'all')
    const sort = String(req.query?.sort || 'waiting')
    const q = String(req.query?.q || '')
    const [list, people] = await Promise.all([listThreads({ view, sort, q, userId: user.id }), team()])
    return res.status(200).json({
      ...list,
      team: people,
      tagSuggestions: TAG_SUGGESTIONS,
      me: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role },
    })
  } catch (error) {
    console.error('[API /support/threads]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'Could not load the inbox') })
  }
}
