/**
 * The watchdog: an hourly check that the other scheduled jobs are still
 * running and still finishing, posted to #admin-alerts. Without it, a job that
 * stopped was only noticed by someone opening Settings > Scheduled Jobs, or by
 * orders that never came in.
 *
 * Three things count as a problem:
 *   - a job that is late (cronJobs.listCronJobs: a run was due and none started)
 *   - the order import has not finished in 30 minutes (orders_last_import)
 *   - a frequent job keeps starting but has not finished in a while
 *     (cron_ok:<path>, stamped by recordCronSuccess at the end of a run). A run
 *     the platform kills at its time limit starts but never finishes, so its
 *     start stamp alone looks healthy.
 *
 * Each problem is posted once when it appears and once when it clears; the
 * open set is kept in SystemConfig (watchdog_open), so an hourly check does
 * not repeat itself every hour.
 */
import prisma from '../db.js'
import { listCronJobs } from './cronJobs.js'
import { slackTo, slackText } from './slack.js'

const MIN = 60_000
const OPEN_KEY = 'watchdog_open'
const IMPORT_STALE_MS = 30 * MIN

/** Jobs that stamp a finish, and how long without one is a problem. */
export const MUST_FINISH = {
  '/api/cron/artelo-send': 20 * MIN,
  '/api/sales/send-due': 60 * MIN,
  '/api/support/sync': 30 * MIN,
}

/**
 * Pure: the problems, as { key, text }.
 *   jobs          listCronJobs().jobs
 *   lastImportAt  orders_last_import (ISO), or null
 *   finished      Map of path -> last finish (ISO)
 */
export function watchProblems({ jobs, lastImportAt, finished, now = new Date() }) {
  const out = []
  for (const j of jobs || []) {
    if (j.late) out.push({ key: `late:${j.path}`, text: `${j.name} has not run since ${j.lastRunAt ? new Date(j.lastRunAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'it was set up'}; it was due ${j.when.toLowerCase()}.` })
  }
  if (lastImportAt && now - new Date(lastImportAt) > IMPORT_STALE_MS) {
    out.push({ key: 'import', text: `No order import has finished since ${new Date(lastImportAt).toISOString().slice(0, 16).replace('T', ' ')} UTC, so new orders are not coming in.` })
  }
  for (const [path, limit] of Object.entries(MUST_FINISH)) {
    const job = (jobs || []).find(j => j.path === path)
    const last = finished?.get(path)
    // Only once it has finished at least once (a job new since this check began has no stamp yet),
    // and only while it is still starting (a job that stopped starting is "late" above).
    if (!job || !last || job.late) continue
    if (now - new Date(last) > limit) out.push({ key: `stuck:${path}`, text: `${job.name} keeps starting but has not finished since ${new Date(last).toISOString().slice(0, 16).replace('T', ' ')} UTC (killed at its time limit, or failing before the end).` })
  }
  return out
}

/** Run the check: post what is new and what has cleared. */
export async function runWatchdog(now = new Date()) {
  const [{ jobs }, importRow, okRows, openRow] = await Promise.all([
    listCronJobs(now),
    prisma.systemConfig.findUnique({ where: { key: 'orders_last_import' } }),
    prisma.systemConfig.findMany({ where: { key: { startsWith: 'cron_ok:' } } }),
    prisma.systemConfig.findUnique({ where: { key: OPEN_KEY } }),
  ])
  const finished = new Map(okRows.map(r => [r.key.slice('cron_ok:'.length), r.value]))
  const problems = watchProblems({ jobs, lastImportAt: importRow?.value || null, finished, now })
  let open = []
  try { open = JSON.parse(openRow?.value || '[]') } catch { open = [] }
  const fresh = problems.filter(p => !open.includes(p.key))
  const cleared = open.filter(k => !problems.some(p => p.key === k))
  if (fresh.length) await slackTo('admin', [':rotating_light: *Scheduled jobs need a look*', ...fresh.map(p => `• ${slackText(p.text, 300)}`), 'Settings > System > Scheduled Jobs, and the Vercel logs.'].join('\n')).catch(() => {})
  if (cleared.length) await slackTo('admin', `:white_check_mark: Scheduled jobs: ${cleared.length} problem${cleared.length === 1 ? '' : 's'} from earlier ${cleared.length === 1 ? 'has' : 'have'} cleared.`).catch(() => {})
  const value = JSON.stringify(problems.map(p => p.key))
  await prisma.systemConfig.upsert({ where: { key: OPEN_KEY }, update: { value }, create: { key: OPEN_KEY, value } })
  return { problems: problems.length, posted: fresh.length, cleared: cleared.length }
}
