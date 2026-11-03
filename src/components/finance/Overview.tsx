import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Cell, ReferenceDot, BarChart } from 'recharts'
import { btnGhost, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, usdShort, pctText, xText, intText, dayLabel, SERIES } from '@/lib/financeApi'
import type { OverviewPayload, TrendDay, WaterfallLine } from '@/types/finance'
import { card, Delta, ErrorCard, Spark, Spinner, Tile, tableHead, num } from './bits'

const SHORT: Record<string, string> = { today: 'Today', yesterday: 'Yesterday', '7d': '7d', '30d': '30d', mtd: 'MTD', last_month: 'Last month', qtd: 'QTD', ytd: 'YTD' }
const PERIOD_KEY = 'finance.period'

/**
 * The dashboard: the period's numbers with the compare window, where the
 * money went, the 90-day trend with race days, the levers, and Needs you.
 */
export default function Overview() {
  const [period, setPeriod] = useState<string>(() => { try { return localStorage.getItem(PERIOD_KEY) || 'today' } catch { return 'today' } })
  const [data, setData] = useState<OverviewPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    try { setData(await financeApi.overview(p)); setError(null) } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(period); try { localStorage.setItem(PERIOD_KEY, period) } catch { /* private window */ } }, [period, load])

  const sync = async () => {
    setSyncing(true)
    try { const r = await financeApi.sync(); toast.success(`Read the sheet: ${r.created + r.updated} day${r.created + r.updated === 1 ? '' : 's'} changed`); await load(period) }
    catch (e) { toast.error((e as Error).message) } finally { setSyncing(false) }
  }

  const spark = useMemo(() => {
    if (!data) return null
    const last30 = data.trend.slice(-30)
    const of = (k: keyof TrendDay) => last30.map(d => (d.landed ? (d[k] as number) : null))
    return { revenue: of('revenue'), cm: of('cm'), adSpend: of('adSpend'), orders: of('orders') }
  }, [data])

  const t = data?.totals, c = data?.compare
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className={`${segmentGroup} flex-wrap`}>
            {(data?.periods || Object.keys(SHORT).map(key => ({ key, label: SHORT[key] }))).map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} className={segment(period === p.key, 'sm')}>{SHORT[p.key] ?? p.label}</button>
            ))}
          </div>
          {data && (
            <span className="text-xs text-off-black/50">
              {data.period.first === data.period.last ? dayLabel(data.period.first, 'weekday') : `${dayLabel(data.period.first)} to ${dayLabel(data.period.last)}`}
              {data.partial && data.through && <> · through {dayLabel(data.through)}</>}
              {data.partial && !data.through && <> · nothing landed yet</>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data?.sync?.at && <span className="text-[11px] text-off-black/40">Sheet read {new Date(data.sync.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
          <button onClick={sync} disabled={syncing} className={btnGhost} title="Read the Daily Tracker now"><RefreshCw className={`w-3.5 h-3.5 ${syncing || loading ? 'animate-spin' : ''}`} /> Refresh</button>
        </div>
      </div>

      {error ? <ErrorCard text={error} /> : !data || !t || !c ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Revenue" value={usd(t.revenue)} sub={`Shopify ${usd(t.shopifyRevenue)} · Etsy ${usd(t.etsyRevenue)}`} delta={<Delta now={t.revenue} before={c.revenue} fmt={usd} />} spark={spark && <Spark values={spark.revenue} color={SERIES.revenue} />} title="Shopify net sales plus Etsy net sales, as the raw tabs report them." />
            <Tile label="Contribution margin" value={usd(t.cm)} sub={`${pctText(t.cmPct)} of revenue · gross ${pctText(t.grossMarginPct)}`} delta={<Delta now={t.cm} before={c.cm} fmt={usd} />} spark={spark && <Spark values={spark.cm} color={SERIES.cm} />} title={data.feeBase === 'cm' ? 'Revenue less fees, production, shipping and ad spend, less the designer fee (7.5% of that).' : 'Revenue less fees, production, shipping and the designer fee (7.5% of gross profit), less ad spend.'} />
            <Tile label="Ad spend" value={usd(t.adSpend)} sub={`${xText(t.roas)} blended ROAS · break-even ${data.breakevenRoas}x · CPA ${usd(t.cpa)}`} delta={<Delta now={t.adSpend} before={c.adSpend} costly fmt={usd} />} spark={spark && <Spark values={spark.adSpend} color={SERIES.adSpend} />} title="Meta plus Google. ROAS is revenue over ad spend; CPA is ad spend per order." />
            <Tile label="Orders" value={intText(t.orders)} sub={`AOV ${usd(t.aov)} · ${intText(t.organicOrders)} organic (${pctText(t.organicPct)})`} delta={<Delta now={t.orders} before={c.orders} fmt={v => intText(v)} />} spark={spark && <Spark values={spark.orders} color={SERIES.cogs} />} title="Shopify plus Etsy orders. Organic is whatever Meta and Google do not claim." />
          </div>
          <p className="text-[11px] text-off-black/45 -mt-2">Deltas are against {data.period.compareLabel} ({dayLabel(data.period.compareFirst)}{data.period.compareFirst !== data.period.compareLast ? ` to ${dayLabel(data.period.compareLast)}` : ''}).</p>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className={`${card} p-4 xl:col-span-2`}>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-sm font-semibold text-off-black">Where the money went</h3>
                <span className="text-[11px] text-off-black/45">{data.period.label}</span>
              </div>
              <Waterfall lines={data.waterfall} />
            </div>
            <div className="space-y-3">
              <div className={`${card} p-4`}>
                <h3 className="text-sm font-semibold text-off-black mb-2">Needs you</h3>
                {data.needs.length === 0 ? <p className="text-sm text-off-black/50">Nothing waiting. Hours are approved, payouts are on runs, the feeds landed.</p> : (
                  <ul className="space-y-1.5">
                    {data.needs.map((n, i) => (
                      <li key={i} className="text-sm text-off-black/80 flex items-start gap-2">
                        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${n.kind === 'roas' || n.kind === 'cm' ? 'bg-red-500' : n.kind === 'feed' ? 'bg-amber-500' : 'bg-off-black/50'}`} />
                        <span>{n.to ? <Link to={n.to} className="hover:underline">{n.text}</Link> : n.text}{n.cents != null && <span className="text-off-black/50"> · {usd(n.cents)}</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Pacing data={data} />
            </div>
          </div>

          <div className={`${card} p-4`}>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-sm font-semibold text-off-black">The last 90 days</h3>
              <span className="text-[11px] text-off-black/45">Revenue as the line; costs, ad spend, the designer fee and what is left as the bars. Race days marked.</span>
            </div>
            <Trend days={data.trend} />
          </div>

          <div className={`${card} p-4`}>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-sm font-semibold text-off-black">The levers</h3>
              <Link to="/finance/daily" className="text-[11px] text-blue-600 hover:underline">Day by day</Link>
            </div>
            <Levers data={data} />
          </div>
          {data.sync?.missingTabs?.length ? <ErrorCard text={`The sheet is missing tabs the app reads: ${data.sync.missingTabs.join(', ')}`} /> : null}
          <p className="text-[11px] text-off-black/40">Numbers come from the Daily Tracker's raw tabs, read each morning. <a href="https://docs.google.com/spreadsheets/d/1yKe9O8XAHXRxBPlOFKN4pMNlH-eYTsdsLNJsw6Tctwg" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 hover:underline">Open the sheet <ExternalLink className="w-3 h-3" /></a></p>
        </>
      )}
    </div>
  )
}

/** Revenue stepping down to contribution margin: a bridge chart with the lines beside it as rows. */
function Waterfall({ lines }: { lines: WaterfallLine[] }) {
  let running = 0
  const bars = lines.map(l => {
    if (l.kind === 'total' || l.kind === 'subtotal') { running = l.cents; return { ...l, range: [Math.min(0, l.cents), Math.max(0, l.cents)], fill: l.key === 'revenue' ? SERIES.revenue : l.key === 'cm' ? SERIES.cm : SERIES.muted } }
    const from = running; running += l.cents
    return { ...l, range: [Math.min(from, running), Math.max(from, running)], fill: l.key === 'meta' || l.key === 'google' ? SERIES.adSpend : l.key === 'designerFee' ? SERIES.designerFee : SERIES.cogs }
  })
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={6}>
            <CartesianGrid vertical={false} stroke="#eeeeee" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#52514e' }} interval={0} tickLine={false} axisLine={false} angle={-20} dy={6} height={38} />
            <YAxis tickFormatter={v => usdShort(v)} tick={{ fontSize: 10, fill: '#52514e' }} tickLine={false} axisLine={false} width={44} />
            <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={({ payload }) => payload?.[0] ? <div className="bg-white border border-border-gray rounded-md px-2.5 py-1.5 text-xs shadow"><div className="font-semibold">{(payload[0].payload as WaterfallLine).label}</div><div className="tabular-nums">{usd((payload[0].payload as WaterfallLine).cents)}{(payload[0].payload as WaterfallLine).pctOfRevenue != null && <span className="text-off-black/50"> · {pctText((payload[0].payload as WaterfallLine).pctOfRevenue)} of revenue</span>}</div></div> : null} />
            <Bar dataKey="range" radius={[4, 4, 4, 4]} isAnimationActive={false}>
              {bars.map(b => <Cell key={b.key} fill={b.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="lg:col-span-2">
        <table className="w-full text-xs">
          <tbody>
            {lines.map(l => (
              <tr key={l.key} className={l.kind ? 'font-semibold text-off-black' : 'text-off-black/75'}>
                <td className="py-1 pr-2 whitespace-nowrap">{l.label}</td>
                <td className="py-1 w-full">
                  {!l.kind && l.pctOfRevenue != null && <div className="h-1.5 rounded bg-off-black/[0.06] overflow-hidden"><div className="h-full rounded" style={{ width: `${Math.min(100, l.pctOfRevenue)}%`, background: l.key === 'meta' || l.key === 'google' ? SERIES.adSpend : l.key === 'designerFee' ? SERIES.designerFee : SERIES.cogs }} /></div>}
                </td>
                <td className={`py-1 pl-2 ${num} whitespace-nowrap`}>{usd(l.cents)}</td>
                <td className={`py-1 pl-2 ${num} text-off-black/45 w-12`}>{l.pctOfRevenue != null ? pctText(l.pctOfRevenue, 0) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Trend({ days }: { days: TrendDay[] }) {
  const rows = days.map(d => ({ ...d, cmPos: Math.max(0, d.cm), label: dayLabel(d.day) }))
  const raceDots = rows.filter(d => d.races.length && d.landed)
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="#eeeeee" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#52514e' }} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis tickFormatter={v => usdShort(v)} tick={{ fontSize: 10, fill: '#52514e' }} tickLine={false} axisLine={false} width={44} />
          <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }} content={({ payload }) => {
            const d = payload?.[0]?.payload as (TrendDay & { label: string }) | undefined
            if (!d) return null
            return (
              <div className="bg-white border border-border-gray rounded-md px-2.5 py-1.5 text-xs shadow space-y-0.5">
                <div className="font-semibold">{dayLabel(d.day, 'weekday')}{!d.landed && <span className="font-normal text-off-black/50"> · not landed</span>}</div>
                {d.landed && <>
                  <div className="flex justify-between gap-4"><span>Revenue</span><span className="tabular-nums">{usd(d.revenue)}</span></div>
                  <div className="flex justify-between gap-4"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm inline-block" style={{ background: SERIES.cogs }} />COGS</span><span className="tabular-nums">{usd(d.cogs)}</span></div>
                  <div className="flex justify-between gap-4"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm inline-block" style={{ background: SERIES.adSpend }} />Ad spend</span><span className="tabular-nums">{usd(d.adSpend)}</span></div>
                  <div className="flex justify-between gap-4"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm inline-block" style={{ background: SERIES.designerFee }} />Designer fee</span><span className="tabular-nums">{usd(d.designerFee)}</span></div>
                  <div className="flex justify-between gap-4 font-semibold"><span className="flex items-center gap-1"><i className="w-2 h-2 rounded-sm inline-block" style={{ background: SERIES.cm }} />Contribution margin</span><span className="tabular-nums">{usd(d.cm)}</span></div>
                  <div className="flex justify-between gap-4 text-off-black/60"><span>Orders · ROAS</span><span className="tabular-nums">{intText(d.orders)} · {xText(d.roas)}</span></div>
                </>}
                {d.races.length > 0 && <div className="pt-1 mt-1 border-t border-border-gray text-off-black/70">Race day: {d.races.join(', ')}</div>}
              </div>
            )
          }} />
          <Bar dataKey="cogs" stackId="a" fill={SERIES.cogs} isAnimationActive={false} />
          <Bar dataKey="adSpend" stackId="a" fill={SERIES.adSpend} isAnimationActive={false} />
          <Bar dataKey="designerFee" stackId="a" fill={SERIES.designerFee} isAnimationActive={false} />
          <Bar dataKey="cmPos" stackId="a" fill={SERIES.cm} isAnimationActive={false} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="revenue" stroke={SERIES.revenue} strokeWidth={2} dot={false} isAnimationActive={false} />
          {raceDots.map(d => <ReferenceDot key={d.day} x={d.label} y={d.revenue} r={4} fill="#fff" stroke={SERIES.revenue} strokeWidth={2} />)}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-3 mt-1 text-[11px] text-off-black/60">
        {[['Revenue', SERIES.revenue], ['COGS', SERIES.cogs], ['Ad spend', SERIES.adSpend], ['Designer fee', SERIES.designerFee], ['Contribution margin', SERIES.cm]].map(([l, c]) => <span key={l} className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: c }} />{l}</span>)}
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-full inline-block border-2 border-off-black bg-white" />Race day</span>
      </div>
    </div>
  )
}

function Levers({ data }: { data: OverviewPayload }) {
  const l = data.levers, t = data.totals
  const items: [string, string, string][] = [
    ['Meta ROAS', xText(l.metaRoas), `CPA ${usd(l.metaCpa)} · CPC ${usd(l.metaCpc)} · CTR ${pctText(l.metaCtr)}`],
    ['Google ROAS', xText(l.googleRoas), `CPA ${usd(l.googleCpa)} · CPC ${usd(l.googleCpc)} · CTR ${pctText(l.googleCtr)}`],
    ['Shopify CVR', pctText(l.cvr), `${intText(l.sessions)} sessions · ATC ${pctText(l.atcPct)} · checkout ${pctText(l.checkoutToPurchasePct, 0)} to purchase`],
    ['Cost per unit', usd(l.costPerUnit), `${intText(t.units)} units · production and shipping`],
    ['COGS share', pctText(l.cogsPct), `of revenue · ad spend ${pctText(l.adSpendPct)}`],
    ['Break-even CPA', usd(t.breakevenCpa), `gross profit per order · blended CPA ${usd(t.cpa)}`],
    ['Channel split', pctText(l.shopifyPct, 0), `Shopify · Etsy ${pctText(l.etsyPct, 0)} · AOV ${usd(l.shopifyAov)} / ${usd(l.etsyAov)}`],
    ['Paid orders', intText((l.metaPurchases ?? 0) + (l.googleConversions ?? 0)), `Meta ${intText(l.metaPurchases)} · Google ${intText(l.googleConversions)} · organic ${intText(t.organicOrders)}`],
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map(([label, value, sub]) => (
        <div key={label} className="rounded-md bg-subtle-gray border border-border-gray p-3">
          <p className={tableHead}>{label}</p>
          <p className="text-lg font-semibold text-off-black tabular-nums mt-0.5">{value}</p>
          <p className="text-[11px] text-off-black/50 mt-0.5">{sub}</p>
        </div>
      ))}
    </div>
  )
}

function Pacing({ data }: { data: OverviewPayload }) {
  const p = data.pacing
  const rows: [string, number, number][] = [
    [`Same days last month`, p.lastMonthSameDays.revenue, p.lastMonthSameDays.cm],
    [`All of last month`, p.lastMonth.revenue, p.lastMonth.cm],
    [`Same month last year`, p.lastYear.revenue, p.lastYear.cm],
  ]
  const max = Math.max(p.mtd.revenue, ...rows.map(r => r[1]), 1)
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold text-off-black">Month to date</h3>
        <span className="text-[11px] text-off-black/45">day {p.dayNo} of {p.daysInMonth}</span>
      </div>
      <div className="space-y-2 text-xs">
        <div>
          <div className="flex justify-between"><span className="font-semibold text-off-black">This month so far</span><span className="tabular-nums font-semibold">{usd(p.mtd.revenue)} <span className="text-off-black/45 font-normal">· CM {usd(p.mtd.cm)}</span></span></div>
          <div className="h-1.5 rounded bg-off-black/[0.06] mt-1 overflow-hidden"><div className="h-full rounded" style={{ width: `${(p.mtd.revenue / max) * 100}%`, background: SERIES.revenue }} /></div>
        </div>
        {rows.map(([label, rev, cm]) => (
          <div key={label}>
            <div className="flex justify-between text-off-black/70"><span>{label}</span><span className="tabular-nums">{usd(rev)} <span className="text-off-black/45">· CM {usd(cm)}</span></span></div>
            <div className="h-1.5 rounded bg-off-black/[0.06] mt-1 overflow-hidden"><div className="h-full rounded bg-off-black/30" style={{ width: `${(rev / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}
