import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, CircleDashed } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { btnSecondary, chip, chipTone, sectionLabel } from '@/lib/ui'

/**
 * Settings > System > Scheduled Jobs: every cron the tool runs
 * (server/lib/cronJobs.js, read from vercel.json). A day strip in Eastern
 * time shows when the timed jobs fire, with the always-on ones as bands;
 * the list under it says what each does, when it next runs and when it last
 * did. A job that missed its last run is flagged Late. Admin only.
 */
type Job = {
  path: string; name: string; what: string; schedule: string; when: string
  group: 'frequent' | 'hourly' | 'daily' | 'weekly' | 'monthly'
  dayTimes: number[] | null; days: number[] | null
  next: string[]; lastRunAt: string | null; late: boolean
}
type Payload = { timezone: string; now: string; jobs: Job[] }

const GROUP_LABEL: Record<Job['group'], string> = { frequent: 'Every few minutes', hourly: 'Hourly', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }
const GROUP_ORDER: Job['group'][] = ['frequent', 'hourly', 'daily', 'weekly', 'monthly']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TZ = 'America/New_York'

function ago(iso: string | null) {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const at = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const clock = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}` }
const nowMinute = () => { const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number); return h * 60 + m }

function Status({ j }: { j: Job }) {
  if (j.late) return <span className={`${chip} ${chipTone.amber}`} title="It was due and has not run since"><AlertTriangle className="w-3 h-3" />Late</span>
  if (!j.lastRunAt) return <span className={`${chip} ${chipTone.quiet}`} title="Runs are recorded from Nov 3, 2026"><CircleDashed className="w-3 h-3" />No run yet</span>
  return <span className={`${chip} ${chipTone.teal}`}><CheckCircle2 className="w-3 h-3" />Ran {ago(j.lastRunAt)}</span>
}

/** One row per job across a 24-hour day: dots at its times, a band for the frequent ones. */
function DayStrip({ jobs }: { jobs: Job[] }) {
  const now = nowMinute()
  const rows = [...jobs].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (a.dayTimes?.[0] ?? 0) - (b.dayTimes?.[0] ?? 0))
  const pct = (min: number) => `${(min / 1440) * 100}%`
  return (
    <div className="rounded-lg border border-border-gray bg-white p-3 md:p-4 overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="flex">
          <div className="w-44 shrink-0" />
          <div className="relative flex-1 h-5 text-[10px] text-off-black/40">
            {[0, 3, 6, 9, 12, 15, 18, 21].map(h => <span key={h} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: pct(h * 60) }}>{clock(h * 60)}</span>)}
          </div>
        </div>
        {rows.map(j => (
          <div key={j.path} className="flex items-center h-6">
            <div className="w-44 shrink-0 pr-3 text-xs text-off-black/75 truncate" title={j.when}>{j.name}</div>
            <div className="relative flex-1 h-full">
              <div className="absolute inset-x-0 top-1/2 h-px bg-border-gray" />
              {[3, 6, 9, 12, 15, 18, 21].map(h => <div key={h} className="absolute top-0 bottom-0 w-px bg-off-black/[0.04]" style={{ left: pct(h * 60) }} />)}
              {(j.group === 'frequent' || j.group === 'hourly') && (
                <div className={`absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full ${j.group === 'frequent' ? 'bg-blue-500/25' : 'bg-blue-500/10 border border-dashed border-blue-400/50'}`} title={j.when} />
              )}
              {j.group === 'monthly' && !j.dayTimes && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-2 rounded-full border border-dashed border-purple-400/60" title={j.when} />
              )}
              {(j.dayTimes || []).map(t => (
                <div key={t} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-1" style={{ left: pct(t) }} title={`${j.name}: ${j.when}`}>
                  <span className={`block w-2.5 h-2.5 rounded-full ring-2 ring-white ${j.group === 'weekly' ? 'bg-amber-500' : j.group === 'monthly' ? 'bg-purple-500' : 'bg-dark-fill'}`} />
                  <span className="text-[10px] text-off-black/50 whitespace-nowrap">{clock(t)}{j.days ? ` ${j.days.map(d => DAY_SHORT[d]).join('/')}` : ''}</span>
                </div>
              ))}
              <div className="absolute top-0 bottom-0 w-px bg-red-500/60" style={{ left: pct(now) }} />
            </div>
          </div>
        ))}
        <div className="flex mt-2">
          <div className="w-44 shrink-0" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-off-black/50">
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-dark-fill" />Daily</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />Weekly</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 h-2 rounded-full bg-blue-500/25" />Every few minutes</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 h-2 rounded-full bg-blue-500/10 border border-dashed border-blue-400/50" />Hourly</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 h-2 rounded-full border border-dashed border-purple-400/60" />End of month</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-px h-3 bg-red-500/60" />Now</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CronJobsPanel() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await apiFetch('/api/admin/cron-jobs')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not load the scheduled jobs')
      setData(d); setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the scheduled jobs')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <div className="text-xs text-red-600">{error}</div>
  if (!data) return <div className="flex items-center gap-2 text-xs text-off-black/50"><Loader2 className="w-3 h-3 animate-spin" /> Loading scheduled jobs…</div>
  const late = data.jobs.filter(j => j.late)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <p className="text-xs text-off-black/55 max-w-2xl flex-1">
          Everything the tool runs on a schedule, in Eastern time. Vercel runs these on UTC, so each time moves an hour when the clocks change. The schedules live in vercel.json; a change there shows here on the next deploy.
          {' '}Claude routines (the nightly sweep, CRM upkeep) and the render worker on the Mac run elsewhere and are not listed.
        </p>
        <button onClick={load} disabled={loading} className={`${btnSecondary} shrink-0`}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}Refresh
        </button>
      </div>
      {late.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 inline-flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{late.length === 1 ? `${late[0].name} missed its last run.` : `${late.length} jobs missed their last run: ${late.map(j => j.name).join(', ')}.`} Check the Vercel logs for that function.
        </div>
      )}

      <DayStrip jobs={data.jobs} />

      {GROUP_ORDER.map(g => {
        const jobs = data.jobs.filter(j => j.group === g)
        if (!jobs.length) return null
        return (
          <div key={g} className="space-y-1.5">
            <div className={sectionLabel}>{GROUP_LABEL[g]}</div>
            <div className="rounded-lg border border-border-gray bg-white divide-y divide-border-gray">
              {jobs.map(j => (
                <div key={j.path} className="px-3 py-2.5 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-off-black">{j.name}</div>
                    <div className="text-xs text-off-black/55">{j.what}</div>
                  </div>
                  <div className="md:w-64 shrink-0 text-xs">
                    <div className="text-off-black/80">{j.when}</div>
                    <div className="text-off-black/45">Next {j.next[0] ? at(j.next[0]) : 'not scheduled'} · <code className="text-[10px]" title="Cron schedule, UTC">{j.schedule}</code></div>
                  </div>
                  <div className="md:w-32 shrink-0"><Status j={j} /></div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
