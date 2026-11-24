import { Fragment, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { modalChip } from '@/lib/ui'

/**
 * Stats > Team by day (admin only): what each person got done, per day, for
 * the period picked above (sliced from the 90 days it loads once). Everyone's
 * totals first, then the days, newest first; pick a person to see only their
 * days, the empty ones included.
 * Counts: server/domain/stats/teamOutput.js.
 */
type Counts = { prints: number; firsts: number; customs: number; tickets: number; replies: number; minutes: number }
type Row = Counts & { perHour: number | null }
type Team = { days: string[]; people: { id: string; name: string; byDay: Record<string, Counts> }[] }

// Under this, a rate says more about the timesheet than the work.
const MIN_MINUTES = 15
/** Added up, with prints and tickets per hour over the days that have hours logged. */
function sum(rows: Counts[]): Row {
  const t = { prints: 0, firsts: 0, customs: 0, tickets: 0, replies: 0, minutes: 0 }
  let minutes = 0, work = 0
  for (const r of rows) {
    for (const k of Object.keys(t) as (keyof Counts)[]) t[k] += r[k]
    if (r.minutes >= MIN_MINUTES) { minutes += r.minutes; work += r.prints + r.tickets }
  }
  return { ...t, perHour: minutes ? Math.round((work / (minutes / 60)) * 10) / 10 : null }
}
const inRange = (days: string[], range: string) => range === 'today' ? days.slice(0, 1) : range === 'yesterday' ? days.slice(1, 2) : days.slice(0, parseInt(range, 10) || 30)

const COLS: { key: keyof Row; label: string; title: string }[] = [
  { key: 'prints', label: 'Prints', title: 'Standard prints they sent to production. Once a day each.' },
  { key: 'firsts', label: 'First designs', title: 'Custom orders whose first designs they emailed the customer.' },
  { key: 'customs', label: 'Customs done', title: 'Custom and race partner orders they sent to production.' },
  { key: 'tickets', label: 'Tickets closed', title: 'Support conversations they clicked Close on, email and Instagram. Once a day each.' },
  { key: 'replies', label: 'Replies', title: 'Emails and DMs they sent a customer who had written to us.' },
  { key: 'minutes', label: 'Hours', title: 'What they logged on their timesheet.' },
  { key: 'perHour', label: 'Per hour', title: 'Prints and tickets closed per logged hour, on days with at least 15 minutes logged. Customs are left out.' },
]

const dayLabel = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`

function Cells({ r, bold }: { r?: Row; bold?: boolean }) {
  return <>{COLS.map(c => {
    const v = r?.[c.key]
    const empty = v === null || v === undefined || v === 0
    return (
      <td key={c.key} className={`py-1.5 pl-4 text-right tabular-nums whitespace-nowrap ${empty ? 'text-off-black/25' : c.key === 'minutes' || c.key === 'perHour' ? 'text-off-black/60' : bold ? 'font-bold' : 'font-medium'}`}>
        {empty ? '–' : c.key === 'minutes' ? hours(v as number) : (v as number).toLocaleString()}
      </td>
    )
  })}</>
}

export default function TeamByDay({ range, tagClass, reload }: { range: string; tagClass: string; reload: number }) {
  const [team, setTeam] = useState<Team | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [who, setWho] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setErr(null)
    apiFetch('/api/admin/team-output')
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not load'); return j as Team })
      .then(t => { if (live) setTeam(t) })
      .catch(e => { if (live) setErr((e as Error).message) })
    return () => { live = false }
  }, [reload])
  const days = inRange(team?.days || [], range)
  const people = (team?.people || [])
    .map(p => ({ ...p, byDay: Object.fromEntries(days.filter(d => p.byDay[d]).map(d => [d, sum([p.byDay[d]])])) as Record<string, Row> }))
    .filter(p => Object.keys(p.byDay).length)
    .map(p => ({ ...p, total: sum(Object.values(p.byDay)) }))
  const person = people.find(p => p.id === who) || null
  const oneDay = days.length === 1
  const th = 'sticky top-0 z-10 bg-white py-1.5 text-[13px] font-normal text-off-black/50'
  return (
    <div className="flex flex-col p-5 bg-white rounded-lg min-w-0">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] font-medium leading-tight text-off-black">Team by day</span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${tagClass}`}>Team</span>
      </div>
      {err ? <p className="mt-4 text-sm text-red-600">{err}</p> : !team ? <div className="mt-4 h-40 rounded bg-off-black/[0.04] animate-pulse" /> : people.length === 0 ? <p className="mt-4 text-sm text-off-black/45">Nothing in this period yet.</p> : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button onClick={() => setWho(null)} className={modalChip(!person)}>Everyone</button>
            {people.map(p => <button key={p.id} onClick={() => setWho(p.id)} className={modalChip(person?.id === p.id)}>{p.name}</button>)}
          </div>
          <div className="mt-3 max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={`${th} text-left`}>{person ? 'Day' : 'Person'}</th>
                  {COLS.map(c => <th key={c.key} title={c.title} className={`${th} pl-4 text-right whitespace-nowrap cursor-help`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {person ? (
                  <>
                    {!oneDay && <tr className="border-b border-border-gray"><td className="py-1.5 font-bold">Total</td><Cells r={person.total} bold /></tr>}
                    {days.map(d => <tr key={d}><td className="py-1.5 whitespace-nowrap text-off-black/75">{dayLabel(d)}</td><Cells r={person.byDay[d]} /></tr>)}
                  </>
                ) : (
                  <>
                    {!oneDay && <tr><td colSpan={COLS.length + 1} className="pt-1 pb-0.5 text-[13px] font-bold">Total</td></tr>}
                    {people.map(p => <tr key={p.id}><td className="py-1.5 whitespace-nowrap text-off-black/75">{p.name}</td><Cells r={p.total} bold /></tr>)}
                    {!oneDay && days.map(d => {
                      const on = people.filter(p => p.byDay[d])
                      return (
                        <Fragment key={d}>
                          <tr className="border-t border-border-gray"><td colSpan={COLS.length + 1} className="pt-3 pb-0.5 text-[13px] font-bold">{dayLabel(d)}{!on.length && <span className="font-normal text-off-black/40"> · nothing</span>}</td></tr>
                          {on.map(p => <tr key={p.id}><td className="py-1.5 whitespace-nowrap text-off-black/75">{p.name}</td><Cells r={p.byDay[d]} /></tr>)}
                        </Fragment>
                      )
                    })}
                  </>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-off-black/45">Per hour is prints and tickets over logged hours, so it is only as good as the timesheet. Hover a column for what it counts.</p>
        </>
      )}
    </div>
  )
}
