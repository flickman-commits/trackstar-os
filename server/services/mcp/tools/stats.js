/**
 * Handling time: how long orders sit with the team, from when they can be
 * worked to when a person marks them complete. Same numbers as Settings >
 * Stats (api/admin/stats.js), behind the same settings.stats capability.
 */
import { z } from 'zod'
import { computeFulfillmentTime } from '../../../domain/orders/fulfillmentTime.js'
import { rangeWindow } from '../../../services/shopifyStats.js'

const round = h => (h == null ? null : Math.round(h * 10) / 10)
const shape = s => ({ completed: s.count, medianHours: round(s.medianHours), meanHours: round(s.meanHours), p90Hours: round(s.p90Hours), withinGoal: s.withinGoal, withinGoalPct: s.withinGoalPct, overFiveDays: s.overFiveDays, orderedBeforeRace: s.orderedBeforeRace, leftOut: s.leftOut })

export const statsTools = [
  {
    name: 'handling_time',
    title: 'Handling time',
    description: 'How long orders took from workable to sent to production at Artelo in a range (today, 7d, 30d, 90d), standard and custom apart: the average against the 36-hour goal, the share within the 48-hour deadline, plus open standard orders already past it.',
    scope: 'read',
    cap: 'settings.stats',
    readOnly: true,
    input: { range: z.enum(['today', '7d', '30d', '90d']).default('30d') },
    async handler({ range = '30d' }) {
      const w = rangeWindow(range)
      const t = await computeFulfillmentTime(w)
      return {
        range, since: w.since, until: w.until, goalHours: t.goalHours, goalMeanHours: t.goalMeanHours,
        standard: shape(t.standard), custom: shape(t.custom),
        openStandard: t.openStandard,
      }
    },
  },
]
