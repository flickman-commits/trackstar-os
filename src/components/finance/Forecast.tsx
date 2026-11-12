import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { btnGhost, btnPrimary, btnSecondary, inputBase, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, usdShort, intText, dayLabel, SERIES } from '@/lib/financeApi'
import type { Bank, FixedCost, ForecastDriver, ForecastPayload, ForecastScenario, ForecastWeek } from '@/types/finance'
import { card, ErrorCard, Spinner, Stat, tableHead, num } from './bits'

/**
 * The next 13 weeks: orders, revenue and contribution margin from the race
 * calendar and our order history, the months against their targets, the
 * races driving it, the drivers (each one editable per scenario), and the
 * cash that leaves the bank week by week (server/domain/finance/forecast.js).
 */
const SCENARIO_LABEL: Record<ForecastScenario, string> = { base: 'Base', upside: 'Upside', downside: 'Downside' }
const dollars = (c: number | null | undefined) => (c == null ? '' : String(Math.round(c) / 100))
const toCents = (s: string) => (s.trim() === '' ? null : Math.round(Number(s.replace(/[$,]/g, '')) * 100))

export default function Forecast() {
  const [scenario, setScenario] = useState<ForecastScenario>('base')
  const [data, setData] = useState<ForecastPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await financeApi.forecast(scenario)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [scenario])
  useEffect(() => { setData(null); load() }, [load])

  /** Save something and take the forecast the server sends back. */
  const save = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true)
    try { setData(await financeApi.forecastAction({ scenario, ...body })); if (ok) toast.success(ok) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={segmentGroup}>{(['base', 'upside', 'downside'] as ForecastScenario[]).map(s => <button key={s} onClick={() => setScenario(s)} className={segment(scenario === s, 'sm')}>{SCENARIO_LABEL[s]}</button>)}</div>
          {data && <span className="text-xs text-off-black/50">{dayLabel(data.horizon.start)} to {dayLabel(data.horizon.end)}, as of {dayLabel(data.asOf)}</span>}
        </div>
        {data && <span className="text-[11px] text-off-black/45">{data.curve.fromData ? `How orders arrive around race day: learned from ${intText(data.curve.orders)} orders` : 'How orders arrive around race day: a standard shape until there is more history'}</span>}
      </div>

      {error ? <ErrorCard text={error} /> : !data ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Revenue, 13 weeks" value={usd(data.totals.revenue)} sub={`${usd(data.totals.forecastRevenue)} of it still to come`} />
            <Stat label="Contribution margin" value={usd(data.totals.cm)} sub={data.totals.revenue ? `${Math.round(data.totals.cm / data.totals.revenue * 100)}% of revenue` : ''} />
            <Stat label="Orders" value={intText(data.totals.orders)} sub={`${data.races.filter(r => r.remaining > 0).length} races still bringing orders`} />
            <Stat label="Lowest cash" value={data.cash.hasBalance ? usd(data.cash.lowest.cents) : '–'} sub={data.cash.hasBalance ? `week of ${dayLabel(data.cash.lowest.weekStart)}${data.cash.weeksBelowBuffer ? `, ${data.cash.weeksBelowBuffer} week${data.cash.weeksBelowBuffer === 1 ? '' : 's'} under the buffer` : ''}` : 'Type your bank balances below'} warn={data.cash.hasBalance && data.cash.weeksBelowBuffer > 0} />
          </div>

          <div className={`${card} p-4`}>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold text-off-black">Revenue by week</h3>
              <span className="text-[11px] text-off-black/45">Solid is what has landed, lighter is the forecast; the line is contribution margin.</span>
            </div>
            <WeeksChart weeks={data.weeks} />
          </div>

          <Months data={data} busy={busy} save={save} />
          <Races data={data} busy={busy} save={save} />
          <Drivers drivers={data.drivers} scenario={scenario} growthHint={data.growthHint} busy={busy} save={save} />
          <Cash data={data} busy={busy} save={save} />
        </>
      )}
    </div>
  )
}

function WeeksChart({ weeks }: { weeks: ForecastWeek[] }) {
  const rows = weeks.map(w => ({ ...w, label: `${dayLabel(w.weekStart)}${(w.holiday ?? 1) > 1.05 ? ' 🎄' : ''}`, actualRev: w.actual.revenue, forecastRev: w.forecast.revenue }))
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#eeeeee" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#52514e' }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={v => usdShort(v)} tick={{ fontSize: 10, fill: '#52514e' }} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={({ payload }) => {
            const w = payload?.[0]?.payload as (ForecastWeek & { label: string }) | undefined
            if (!w) return null
            return (
              <div className="bg-white border border-border-gray rounded-md px-2.5 py-1.5 text-xs shadow space-y-0.5 max-w-[260px]">
                <div className="font-semibold">Week of {w.label}</div>
                {w.actual.revenue > 0 && <div className="flex justify-between gap-4"><span>Landed</span><span className="tabular-nums">{usd(w.actual.revenue)}</span></div>}
                {w.forecast.revenue > 0 && <div className="flex justify-between gap-4"><span>Forecast</span><span className="tabular-nums">{usd(w.forecast.revenue)}</span></div>}
                <div className="flex justify-between gap-4 font-semibold"><span>Contribution margin</span><span className="tabular-nums">{usd(w.cm)}</span></div>
                <div className="flex justify-between gap-4 text-off-black/60"><span>Orders</span><span className="tabular-nums">{intText(w.orders)}{w.forecast.raceOrders ? ` (${intText(w.forecast.raceOrders)} from races)` : ''}</span></div>
                {w.holiday != null && Math.abs(w.holiday - 1) > 0.05 && <div className="text-off-black/60">{w.holiday > 1 ? `Christmas: ${w.holiday}x a normal week` : `After the Christmas cutoff: ${w.holiday}x a normal week`}</div>}
                {w.races.length > 0 && <div className="pt-1 mt-1 border-t border-border-gray text-off-black/70">Race days: {w.races.join(', ')}</div>}
              </div>
            )
          }} />
          <Bar dataKey="actualRev" stackId="r" fill={SERIES.revenue} isAnimationActive={false} />
          <Bar dataKey="forecastRev" stackId="r" fill={SERIES.revenue} fillOpacity={0.4} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line type="monotone" dataKey="cm" stroke={SERIES.cm} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-off-black/60">
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: SERIES.revenue }} />Revenue landed</span>
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block opacity-40" style={{ background: SERIES.revenue }} />Revenue forecast</span>
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-0.5 inline-block" style={{ background: SERIES.cm }} />Contribution margin</span>
      </div>
    </div>
  )
}

type Save = (body: Record<string, unknown>, ok?: string) => Promise<void>

/** Each month the horizon touches: so far, projected, and the target (typed here). */
function Months({ data, busy, save }: { data: ForecastPayload; busy: boolean; save: Save }) {
  const [draft, setDraft] = useState<Record<string, { revenue: string; cm: string; ads: string }>>({})
  return (
    <div className={`${card} overflow-x-auto`}>
      <div className="px-4 py-2.5 border-b border-border-gray flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-off-black">Months against target</h3>
        <span className="text-[11px] text-off-black/45">Projected is what has landed so far plus the forecast for the rest of the month.</span>
      </div>
      <table className="w-full text-xs">
        <thead><tr className="bg-subtle-gray border-b border-border-gray">
          <th className={`px-4 py-2 text-left ${tableHead}`}>Month</th>
          {['Revenue', 'Contribution margin', 'Ad spend'].map(h => <th key={h} className={`px-3 py-2 ${tableHead} ${num}`} colSpan={2}>{h}</th>)}
          <th />
        </tr>
        <tr className="border-b border-border-gray text-[10px] text-off-black/45">
          <th />{[0, 1, 2].flatMap(i => [<th key={`p${i}`} className={`px-3 py-1 ${num} font-normal`}>Projected</th>, <th key={`t${i}`} className={`px-3 py-1 ${num} font-normal`}>Target</th>])}<th />
        </tr></thead>
        <tbody>{data.months.map(m => {
          const t = m.target
          const d = draft[m.month] ?? { revenue: dollars(t?.revenueCents), cm: dollars(t?.cmCents), ads: dollars(t?.adSpendCents) }
          const changed = Boolean(draft[m.month])
          const vs = (projected: number, target: number | null | undefined, cost = false) => target ? <span className={`block text-[10px] ${(cost ? projected <= target : projected >= target) ? 'text-green-700' : 'text-red-600'}`}>{Math.round(projected / target * 100)}% of target</span> : null
          const field = (k: 'revenue' | 'cm' | 'ads') => <input value={d[k]} onChange={e => setDraft(p => ({ ...p, [m.month]: { ...d, [k]: e.target.value } }))} placeholder="no target" inputMode="decimal" className={`${inputBase} w-24 py-1 text-right`} aria-label={`${m.label} ${k} target`} />
          return (
            <tr key={m.month} className="border-b border-border-gray/60 last:border-0 align-top">
              <td className="px-4 py-2 font-medium whitespace-nowrap">{m.label}<span className="block text-[10px] font-normal text-off-black/45">so far {usd(m.toDate.revenue)}</span></td>
              <td className={`px-3 py-2 ${num}`}>{usd(m.projected.revenue)}{vs(m.projected.revenue, t?.revenueCents)}</td><td className={`px-3 py-2 ${num}`}>{field('revenue')}</td>
              <td className={`px-3 py-2 ${num}`}>{usd(m.projected.cm)}{vs(m.projected.cm, t?.cmCents)}</td><td className={`px-3 py-2 ${num}`}>{field('cm')}</td>
              <td className={`px-3 py-2 ${num}`}>{usd(m.projected.adSpend)}{vs(m.projected.adSpend, t?.adSpendCents, true)}</td><td className={`px-3 py-2 ${num}`}>{field('ads')}</td>
              <td className="px-3 py-2">{changed && <button disabled={busy} onClick={async () => { await save({ action: 'set_target', month: m.month, revenueCents: toCents(d.revenue), cmCents: toCents(d.cm), adSpendCents: toCents(d.ads) }, `Targets saved for ${m.label}`); setDraft(p => { const n = { ...p }; delete n[m.month]; return n }) }} className={btnPrimary}>Save</button>}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

const BASIS: Record<string, string> = { pace: "from this year's pace", rate: 'from the last 7 days', last_year: 'from last year' }

/** The races in the window: last year's orders, expected this year (typed over if you know better), what has come in. */
function Races({ data, busy, save }: { data: ForecastPayload; busy: boolean; save: Save }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const rows = data.races
  return (
    <div className={`${card} overflow-x-auto`}>
      <div className="px-4 py-2.5 border-b border-border-gray flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-off-black">Races driving it</h3>
        <span className="text-[11px] text-off-black/45">Expected is last year's orders times {data.drivers.find(x => x.key === 'growth')?.value ?? 1}x, or this year's pace when there is no last year, unless typed. Orders arrive from 30 days before race day to 60 after; Christmas lifts them on top.</span>
      </div>
      {rows.length === 0 ? <p className="px-4 py-3 text-xs text-off-black/45">No races with a confirmed date in this window. Dates come from the Race Database.</p> : (
        <table className="w-full text-xs">
          <thead><tr className="bg-subtle-gray border-b border-border-gray">
            {['Race', 'Race day', 'Last year', 'Expected', 'In so far', 'Still to come', ''].map((h, i) => <th key={i} className={`px-3 py-2 ${tableHead} ${i >= 2 && i <= 5 ? num : 'text-left'}`}>{h}</th>)}
          </tr></thead>
          <tbody>{rows.map(r => {
            const d = draft[r.key] ?? (r.override != null ? String(r.override) : '')
            const changed = draft[r.key] !== undefined && draft[r.key] !== (r.override != null ? String(r.override) : '')
            return (
              <tr key={`${r.key}|${r.year}`} className="border-b border-border-gray/60 last:border-0">
                <td className="px-3 py-1.5 font-medium">{r.name}{r.noHistory ? <span className="ml-1.5 text-[10px] font-normal text-amber-700">no orders yet to go on</span> : r.basis && BASIS[r.basis] && <span className="ml-1.5 text-[10px] font-normal text-off-black/45">{BASIS[r.basis]}</span>}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{dayLabel(r.date)}</td>
                <td className={`px-3 py-1.5 ${num}`}>{intText(r.lastYear)}</td>
                <td className={`px-3 py-1.5 ${num}`}>
                  <span className="inline-flex items-center gap-1 justify-end">
                    <input value={d} onChange={e => setDraft(p => ({ ...p, [r.key]: e.target.value }))} placeholder={String(r.expected)} inputMode="numeric" className={`${inputBase} w-20 py-0.5 text-right ${r.override != null ? 'font-semibold' : ''}`} aria-label={`Expected orders for ${r.name}`} />
                  </span>
                </td>
                <td className={`px-3 py-1.5 ${num}`}>{intText(r.received)}</td>
                <td className={`px-3 py-1.5 ${num}`}>{intText(r.remaining)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-right">
                  {changed && <button disabled={busy} onClick={async () => { await save({ action: 'set_race', raceKey: r.key, orders: d.trim() === '' ? null : Number(d) }, `${r.name} saved`); setDraft(p => { const n = { ...p }; delete n[r.key]; return n }) }} className={btnPrimary}>Save</button>}
                  {!changed && r.override != null && <button disabled={busy} onClick={() => save({ action: 'set_race', raceKey: r.key, orders: null }, 'Back to the calculation')} className={btnGhost} title="Back to last year times growth"><RotateCcw className="w-3.5 h-3.5" /></button>}
                </td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
    </div>
  )
}

const driverText = (x: ForecastDriver, v: number) => (x.unit === 'cents' ? usd(v) : x.unit === '%' ? `${v}%` : x.unit === 'x' ? `${v}x` : `${v}`)

/** What the forecast assumes, scenario by scenario: calculated, or typed over. */
function Drivers({ drivers, scenario, growthHint, busy, save }: { drivers: ForecastDriver[]; scenario: ForecastScenario; growthHint: { growth: number; races: number }; busy: boolean; save: Save }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => { setDraft({}) }, [scenario])
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-off-black">What it assumes <span className="font-normal text-off-black/45">({SCENARIO_LABEL[scenario].toLowerCase()})</span></h3>
        <span className="text-[11px] text-off-black/45">{growthHint.races >= 3 ? `Races that finished this year did ${growthHint.growth}x last year (${growthHint.races} races).` : 'Not enough finished races to compare with last year yet.'} Upside and downside start at 1.2x and 0.8x of that.</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {drivers.map(x => {
          const shown = x.unit === 'cents' ? dollars(x.value) : String(x.value)
          const d = draft[x.key] ?? shown
          const changed = draft[x.key] !== undefined && draft[x.key] !== shown
          return (
            <div key={x.key} className="flex items-center gap-2 text-xs">
              <div className="flex-1 min-w-0"><p className="font-medium text-off-black">{x.label}</p><p className="text-[11px] text-off-black/45 truncate" title={x.help}>{x.help}{x.overridden ? `, calculated ${driverText(x, x.computed)}` : ''}</p></div>
              {x.unit === 'cents' && <span className="text-off-black/40">$</span>}
              <input value={d} onChange={e => setDraft(p => ({ ...p, [x.key]: e.target.value }))} inputMode="decimal" className={`${inputBase} w-24 py-1 text-right ${x.overridden ? 'font-semibold' : ''}`} aria-label={x.label} />
              {x.unit === '%' && <span className="text-off-black/40">%</span>}
              {x.unit === 'x' && <span className="text-off-black/40">x</span>}
              {changed && <button disabled={busy} onClick={async () => { const v = x.unit === 'cents' ? toCents(d) : d.trim() === '' ? null : Number(d); await save({ action: 'set_driver', key: x.key, value: v }, `${x.label} saved`); setDraft(p => { const n = { ...p }; delete n[x.key]; return n }) }} className={btnPrimary}>Save</button>}
              {!changed && x.overridden && <button disabled={busy} onClick={() => save({ action: 'set_driver', key: x.key, value: null }, 'Back to the calculated value')} className={btnGhost} title="Back to the calculated value"><RotateCcw className="w-3.5 h-3.5" /></button>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The 13-week cash flow, and what it needs from you: bank balances, a buffer, fixed costs, owner draws. */
function Cash({ data, busy, save }: { data: ForecastPayload; busy: boolean; save: Save }) {
  const c = data.cash
  const [banks, setBanks] = useState<Bank[]>(c.banks)
  const [costs, setCosts] = useState<FixedCost[]>(c.fixedCosts)
  const [buffer, setBuffer] = useState(dollars(c.bufferCents))
  const [draws, setDraws] = useState(dollars(c.ownerDrawMonthlyCents))
  useEffect(() => { setBanks(c.banks); setCosts(c.fixedCosts); setBuffer(dollars(c.bufferCents)); setDraws(dollars(c.ownerDrawMonthlyCents)) }, [c.banks, c.fixedCosts, c.bufferCents, c.ownerDrawMonthlyCents])
  const dirty = JSON.stringify(banks) !== JSON.stringify(c.banks) || JSON.stringify(costs) !== JSON.stringify(c.fixedCosts) || buffer !== dollars(c.bufferCents) || draws !== dollars(c.ownerDrawMonthlyCents)
  const saveCash = () => save({ action: 'set_cash', banks: banks.map(b => ({ ...b, cents: Math.round(b.cents) })), fixedCosts: costs, bufferCents: toCents(buffer) ?? 0, ownerDrawMonthlyCents: toCents(draws) ?? 0 }, 'Cash settings saved')
  const rows = c.weeks.map(w => ({ ...w, label: dayLabel(w.weekStart) }))
  const OUT_LABEL: Record<keyof typeof c.weeks[number]['out'], string> = { costs: 'Fees, production, shipping', ads: 'Ads', hours: 'Hours', customsAndFee: 'Customs and designer fee', partners: 'Race partners', fixed: 'Fixed costs', draws: 'Owner draws' }

  return (
    <div className={`${card} overflow-hidden`}>
      <div className="px-4 py-2.5 border-b border-border-gray flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-off-black">Cash, 13 weeks</h3>
        <span className="text-[11px] text-off-black/45">Banks are typed here until they are connected. Customs and the designer fee go out the first week after a month ends.</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 border-b border-border-gray">
        <div className="space-y-1.5">
          <p className={tableHead}>Bank balances</p>
          {banks.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={b.name} onChange={e => setBanks(bs => bs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${inputBase} flex-1 py-1`} aria-label="Bank" />
              <span className="text-off-black/40 text-xs">$</span>
              <input value={dollars(b.cents)} onChange={e => setBanks(bs => bs.map((x, j) => (j === i ? { ...x, cents: toCents(e.target.value) ?? 0, asOf: data.asOf } : x)))} inputMode="decimal" className={`${inputBase} w-28 py-1 text-right`} aria-label={`${b.name} balance`} />
              <button onClick={() => setBanks(bs => bs.filter((_, j) => j !== i))} className="text-off-black/35 hover:text-red-600" aria-label="Remove bank"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button onClick={() => setBanks(bs => [...bs, { name: `Bank ${bs.length + 1}`, cents: 0, asOf: data.asOf }])} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Add a bank</button>
          {banks.length > 0 && <p className="text-[11px] text-off-black/50">Opening {usd(banks.reduce((n, b) => n + b.cents, 0))}{c.banks[0]?.asOf ? `, as of ${dayLabel(c.banks[0].asOf)}` : ''}</p>}
        </div>
        <div className="space-y-1.5">
          <p className={tableHead}>Fixed costs</p>
          {costs.map((x, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input value={x.name} onChange={e => setCosts(cs => cs.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} className={`${inputBase} flex-1 py-1`} aria-label="Cost" />
              <span className="text-off-black/40 text-xs">$</span>
              <input value={dollars(x.cents)} onChange={e => setCosts(cs => cs.map((y, j) => (j === i ? { ...y, cents: toCents(e.target.value) ?? 0 } : y)))} inputMode="decimal" className={`${inputBase} w-20 py-1 text-right`} aria-label={`${x.name} amount`} />
              <select value={x.cadence} onChange={e => setCosts(cs => cs.map((y, j) => (j === i ? { ...y, cadence: e.target.value as FixedCost['cadence'] } : y)))} className={`${inputBase} py-1`} aria-label="How often">
                <option value="monthly">a month</option><option value="weekly">a week</option>
              </select>
              <button onClick={() => setCosts(cs => cs.filter((_, j) => j !== i))} className="text-off-black/35 hover:text-red-600" aria-label="Remove cost"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <button onClick={() => setCosts(cs => [...cs, { name: 'Software', cents: 0, cadence: 'monthly' }])} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Add a cost</button>
        </div>
        <div className="space-y-2 text-xs">
          <label className="flex items-center gap-2"><span className="flex-1">Keep at least</span><span className="text-off-black/40">$</span><input value={buffer} onChange={e => setBuffer(e.target.value)} inputMode="decimal" className={`${inputBase} w-28 py-1 text-right`} /></label>
          <label className="flex items-center gap-2"><span className="flex-1">Owner draws a month</span><span className="text-off-black/40">$</span><input value={draws} onChange={e => setDraws(e.target.value)} inputMode="decimal" className={`${inputBase} w-28 py-1 text-right`} /></label>
          {c.partners.length > 0 && <p className="text-[11px] text-off-black/50">Race partner payouts in the window: {c.partners.map(p => `${p.name} ${usd(p.cents)}${p.estimated ? ' (estimated)' : ''}`).join('; ')}</p>}
          {dirty && <button onClick={saveCash} disabled={busy} className={btnPrimary}>Save cash settings</button>}
          {dirty && <button onClick={() => { setBanks(c.banks); setCosts(c.fixedCosts); setBuffer(dollars(c.bufferCents)); setDraws(dollars(c.ownerDrawMonthlyCents)) }} className={`${btnSecondary} ml-2`}>Discard</button>}
        </div>
      </div>
      {!c.hasBalance ? <p className="px-4 py-3 text-xs text-off-black/50">Add a bank balance to see where cash lands each week.</p> : (
        <>
          <div className="h-48 px-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#eeeeee" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#52514e' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={v => usdShort(v)} tick={{ fontSize: 10, fill: '#52514e' }} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(v: number) => usd(v)} labelFormatter={l => `Week of ${l}`} />
                {c.bufferCents > 0 && <ReferenceLine y={c.bufferCents} stroke="#dc2626" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="end" name="Cash at week end" stroke={SERIES.cogs} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead><tr className="bg-subtle-gray border-y border-border-gray">
                <th className={`px-3 py-2 text-left ${tableHead}`}>Week of</th><th className={`px-3 py-2 ${tableHead} ${num}`}>Start</th><th className={`px-3 py-2 ${tableHead} ${num}`}>In</th>
                {Object.values(OUT_LABEL).map(l => <th key={l} className={`px-3 py-2 ${tableHead} ${num}`}>{l}</th>)}
                <th className={`px-3 py-2 ${tableHead} ${num}`}>End</th>
              </tr></thead>
              <tbody>{c.weeks.map(w => (
                <tr key={w.weekStart} className={`border-b border-border-gray/60 ${w.end < c.bufferCents ? 'bg-red-50' : ''}`}>
                  <td className="px-3 py-1.5">{dayLabel(w.weekStart)}</td>
                  <td className={`px-3 py-1.5 ${num}`}>{usd(w.start)}</td>
                  <td className={`px-3 py-1.5 ${num} text-green-700`}>{usd(w.in)}</td>
                  {(Object.keys(OUT_LABEL) as (keyof typeof OUT_LABEL)[]).map(k => <td key={k} className={`px-3 py-1.5 ${num} text-off-black/70`}>{w.out[k] ? `(${usd(w.out[k])})` : '–'}</td>)}
                  <td className={`px-3 py-1.5 ${num} font-semibold ${w.end < c.bufferCents ? 'text-red-600' : ''}`}>{usd(w.end)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
