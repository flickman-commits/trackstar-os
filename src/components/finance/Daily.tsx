import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, ExternalLink, PencilLine, RefreshCw, X } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { btnGhost, btnSecondary, inputBase, modalPrimary, segment, segmentGroup } from '@/lib/ui'
import { financeApi, usd, pctText, xText, intText, dayLabel, monthLabel, shiftMonth, todayET } from '@/lib/financeApi'
import type { DailyPayload, DayInput, DayRow, Totals } from '@/types/finance'
import { card, ErrorCard, Spinner, tableHead, num } from './bits'

type View = 'scoreboard' | 'levers'
type Col = { key: string; label: string; fmt: (d: Totals & Record<string, unknown>) => string; strong?: boolean; group?: string }

const money = (k: string) => (d: Record<string, unknown>) => usd(d[k] as number)
const pct = (k: string, digits = 1) => (d: Record<string, unknown>) => pctText(d[k] as number | null, digits)
const x = (k: string) => (d: Record<string, unknown>) => xText(d[k] as number | null)
const int = (k: string) => (d: Record<string, unknown>) => intText(d[k] as number | null)

const SCOREBOARD: Col[] = [
  { key: 'shopifyRevenue', label: 'Shopify', fmt: money('shopifyRevenue'), group: 'Revenue' }, { key: 'etsyRevenue', label: 'Etsy', fmt: money('etsyRevenue'), group: 'Revenue' }, { key: 'revenue', label: 'Revenue', fmt: money('revenue'), strong: true, group: 'Revenue' },
  { key: 'shopifyFees', label: 'Shopify fees', fmt: money('shopifyFees'), group: 'Costs' }, { key: 'etsyFees', label: 'Etsy fees', fmt: money('etsyFees'), group: 'Costs' }, { key: 'production', label: 'Production', fmt: money('production'), group: 'Costs' }, { key: 'shipping', label: 'Shipping', fmt: money('shipping'), group: 'Costs' }, { key: 'cogs', label: 'COGS', fmt: money('cogs'), strong: true, group: 'Costs' },
  { key: 'meta', label: 'Meta', fmt: money('meta'), group: 'Ad spend' }, { key: 'trybe', label: 'Trybe', fmt: money('trybe'), group: 'Ad spend' }, { key: 'google', label: 'Google', fmt: money('google'), group: 'Ad spend' }, { key: 'adSpend', label: 'Ads', fmt: money('adSpend'), strong: true, group: 'Ad spend' },
  { key: 'grossProfit', label: 'Gross profit', fmt: money('grossProfit'), strong: true, group: 'Profit' }, { key: 'grossMarginPct', label: 'GM %', fmt: pct('grossMarginPct'), group: 'Profit' }, { key: 'designerFee', label: 'Designer', fmt: money('designerFee'), group: 'Profit' }, { key: 'cm', label: 'CM', fmt: money('cm'), strong: true, group: 'Profit' }, { key: 'cmPct', label: 'CM %', fmt: pct('cmPct'), group: 'Profit' },
  { key: 'roas', label: 'ROAS', fmt: x('roas'), group: 'Ratios' }, { key: 'aov', label: 'AOV', fmt: money('aov'), group: 'Ratios' }, { key: 'cpa', label: 'CPA', fmt: money('cpa'), group: 'Ratios' }, { key: 'orders', label: 'Orders', fmt: int('orders'), group: 'Ratios' }, { key: 'breakevenCpa', label: 'BE CPA', fmt: money('breakevenCpa'), group: 'Ratios' }, { key: 'organicOrders', label: 'Organic', fmt: int('organicOrders'), group: 'Ratios' }, { key: 'organicPct', label: 'Organic %', fmt: pct('organicPct'), group: 'Ratios' },
]
const LEVERS: Col[] = [
  { key: 'shopifyRevenue', label: 'Shopify', fmt: money('shopifyRevenue'), group: 'Channels' }, { key: 'shopifyOrders', label: 'Orders', fmt: int('shopifyOrders'), group: 'Channels' }, { key: 'shopifyAov', label: 'AOV', fmt: money('shopifyAov'), group: 'Channels' }, { key: 'etsyRevenue', label: 'Etsy', fmt: money('etsyRevenue'), group: 'Channels' }, { key: 'etsyOrders', label: 'Orders', fmt: int('etsyOrders'), group: 'Channels' }, { key: 'shopifyPct', label: 'Shopify %', fmt: pct('shopifyPct'), group: 'Channels' },
  { key: 'meta', label: 'Spend', fmt: money('meta'), group: 'Meta' }, { key: 'metaPurchases', label: 'Purch.', fmt: int('metaPurchases'), group: 'Meta' }, { key: 'metaPurchaseValue', label: 'Value', fmt: money('metaPurchaseValue'), group: 'Meta' }, { key: 'metaRoas', label: 'ROAS', fmt: x('metaRoas'), group: 'Meta' }, { key: 'metaCpa', label: 'CPA', fmt: money('metaCpa'), group: 'Meta' }, { key: 'metaCpc', label: 'CPC', fmt: money('metaCpc'), group: 'Meta' }, { key: 'metaCtr', label: 'CTR', fmt: pct('metaCtr'), group: 'Meta' },
  { key: 'google', label: 'Spend', fmt: money('google'), group: 'Google' }, { key: 'googleConversions', label: 'Conv', fmt: int('googleConversions'), group: 'Google' }, { key: 'googleRoas', label: 'ROAS', fmt: x('googleRoas'), group: 'Google' }, { key: 'googleCpa', label: 'CPA', fmt: money('googleCpa'), group: 'Google' }, { key: 'googleCpc', label: 'CPC', fmt: money('googleCpc'), group: 'Google' },
  { key: 'sessions', label: 'Sessions', fmt: int('sessions'), group: 'Funnel' }, { key: 'addToCart', label: 'ATC', fmt: int('addToCart'), group: 'Funnel' }, { key: 'atcPct', label: 'ATC %', fmt: pct('atcPct'), group: 'Funnel' }, { key: 'reachedCheckout', label: 'Checkout', fmt: int('reachedCheckout'), group: 'Funnel' }, { key: 'atcToCheckoutPct', label: 'ATC→Chk', fmt: pct('atcToCheckoutPct'), group: 'Funnel' }, { key: 'completedCheckout', label: 'Complete', fmt: int('completedCheckout'), group: 'Funnel' }, { key: 'checkoutToPurchasePct', label: 'Chk→Purch', fmt: pct('checkoutToPurchasePct'), group: 'Funnel' }, { key: 'cvr', label: 'CVR', fmt: pct('cvr'), group: 'Funnel' },
  { key: 'units', label: 'Units', fmt: int('units'), group: 'Cost' }, { key: 'costPerUnit', label: 'Cost/unit', fmt: money('costPerUnit'), group: 'Cost' }, { key: 'cogsPct', label: 'COGS %', fmt: pct('cogsPct'), group: 'Cost' }, { key: 'adSpendPct', label: 'Ads %', fmt: pct('adSpendPct'), group: 'Cost' },
]

const FIELD_LABEL: Record<string, string> = {
  shopifyGrossCents: 'Gross sales', shopifyDiscountsCents: 'Discounts', shopifyReturnsCents: 'Returns', shopifyShippingCents: 'Shipping charged', shopifyTaxCents: 'Taxes', shopifyNetCents: 'Net sales', shopifyOrders: 'Orders', shopifySessions: 'Sessions', shopifyAddToCart: 'Add to cart', shopifyReachedCheckout: 'Reached checkout', shopifyCompletedCheckout: 'Completed checkout', shopifyFeesCents: 'Shopify fees',
  etsyGrossCents: 'Gross sales', etsyDiscountsCents: 'Discounts', etsyReturnsCents: 'Returns', etsyShippingCents: 'Shipping charged', etsyTaxCents: 'Taxes', etsyNetCents: 'Net sales', etsyOrders: 'Orders', etsyVisits: 'Visits', etsyFeesCents: 'Etsy fees',
  productionCents: 'Production costs', shippingCostCents: 'Shipping costs', unitsProduced: 'Units produced',
  metaSpendCents: 'Ad spend', metaImpressions: 'Impressions', metaClicks: 'Clicks', metaPurchases: 'Purchases', metaPurchaseValueCents: 'Purchase value', metaAddToCarts: 'Add to carts',
  googleSpendCents: 'Ad spend', googleImpressions: 'Impressions', googleClicks: 'Clicks', googleConversions: 'Conversions', googleConversionValueCents: 'Conversion value',
  trybeSalesCents: 'Attributed sales', trybeConversions: 'Conversions', trybeEarningsCents: 'Creator earnings', trybeCostCents: 'Total cost',
}
const TAB_OF = (f: string) => f.startsWith('shopify') ? 'Shopify' : f.startsWith('etsy') ? 'Etsy' : f.startsWith('meta') ? 'Meta Ads' : f.startsWith('google') ? 'Google Ads' : f.startsWith('trybe') ? 'Trybe' : 'Print shop (Artelo)'
const isMoney = (f: string) => f.endsWith('Cents')

/** The Daily Tracker's scoreboard and levers for a month, from the ledger; a day opens to its raw inputs. */
export default function Daily() {
  const [params, setParams] = useSearchParams()
  const month = params.get('month') || todayET().slice(0, 7)
  const [view, setView] = useState<View>('scoreboard')
  const [data, setData] = useState<DailyPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setData(await financeApi.daily(month)); setError(null) } catch (e) { setError((e as Error).message) }
  }, [month])
  useEffect(() => { setData(null); load() }, [load])
  const setMonth = (m: string) => setParams(p => { const n = new URLSearchParams(p); n.set('month', m); return n })
  const sync = async (all = false) => {
    setSyncing(true)
    try { const r = await financeApi.sync(all); toast.success(`Read the sheet: ${r.read} days, ${r.created + r.updated} changed`); await load() } catch (e) { toast.error((e as Error).message) } finally { setSyncing(false) }
  }
  const cols = view === 'scoreboard' ? SCOREBOARD : LEVERS
  const groups: [string, number][] = []
  for (const c of cols) { const g = groups[groups.length - 1]; if (g && g[0] === c.group) g[1]++; else groups.push([c.group || '', 1]) }
  const atNow = month >= todayET().slice(0, 7)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className={btnSecondary} aria-label="Previous month"><ChevronLeft className="w-4 h-4" /></button>
          <span className="min-w-[150px] text-center font-semibold text-off-black">{monthLabel(month)}</span>
          <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={atNow} className={btnSecondary} aria-label="Next month"><ChevronRight className="w-4 h-4" /></button>
          <div className={`${segmentGroup} ml-2`}>
            <button onClick={() => setView('scoreboard')} className={segment(view === 'scoreboard', 'sm')}>Scoreboard</button>
            <button onClick={() => setView('levers')} className={segment(view === 'levers', 'sm')}>Levers</button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data?.sync?.at && <span className="text-[11px] text-off-black/40">Sheet read {new Date(data.sync.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
          <button onClick={() => sync(false)} disabled={syncing} className={btnGhost} title="Read the last 60 days of the sheet now"><RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> Refresh</button>
          <button onClick={() => sync(true)} disabled={syncing} className={btnGhost} title="Read the whole year">Whole year</button>
          {data && <a href={data.sheetUrl} target="_blank" rel="noopener noreferrer" className={btnGhost}><ExternalLink className="w-3.5 h-3.5" /> Sheet</a>}
        </div>
      </div>

      {error ? <ErrorCard text={error} /> : !data ? <Spinner /> : data.days.length === 0 ? <div className={`${card} p-6 text-sm text-off-black/50`}>Nothing in the ledger for {monthLabel(month)}.</div> : (
        <>
          <div className={`${card} overflow-x-auto`}>
            <table className="min-w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="bg-subtle-gray border-b border-border-gray">
                  <th className="sticky left-0 bg-subtle-gray z-10 px-3 py-1.5 text-left" />
                  {groups.map(([g, n], i) => <th key={i} colSpan={n} className={`px-2 py-1.5 text-left ${tableHead} border-l border-border-gray`}>{g}</th>)}
                </tr>
                <tr className="bg-subtle-gray border-b border-border-gray">
                  <th className={`sticky left-0 bg-subtle-gray z-10 px-3 py-1.5 text-left ${tableHead}`}>Date</th>
                  {cols.map(c => <th key={c.key} className={`px-2 py-1.5 ${tableHead} ${num}`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.days.map(d => <Row key={d.day} d={d} cols={cols} onOpen={() => setOpenDay(d.day)} />)}
                {data.total && (
                  <tr className="border-t-2 border-off-black/20 bg-subtle-gray font-semibold">
                    <td className="sticky left-0 bg-subtle-gray z-10 px-3 py-2 text-left">{monthLabel(month)} <span className="font-normal text-off-black/45">· {data.total.dayCount} days</span></td>
                    {cols.map(c => <td key={c.key} className={`px-2 py-2 ${num}`}>{c.fmt(data.total as Totals & Record<string, unknown>)}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className={`${card} overflow-x-auto`}>
            <div className="px-3 py-2 border-b border-border-gray"><h3 className="text-sm font-semibold text-off-black">Weeks <span className="font-normal text-off-black/45 text-xs">Monday to Sunday</span></h3></div>
            <table className="min-w-full text-xs whitespace-nowrap">
              <thead><tr className="bg-subtle-gray border-b border-border-gray">
                <th className={`px-3 py-1.5 text-left ${tableHead}`}>Week of</th>
                {['Revenue', 'COGS', 'Gross profit', 'Ad spend', 'Designer', 'CM', 'CM %', 'ROAS', 'Orders', 'AOV', 'CPA'].map(h => <th key={h} className={`px-2 py-1.5 ${tableHead} ${num}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.weeks.map(w => (
                  <tr key={w.weekStart} className="border-b border-border-gray/60">
                    <td className="px-3 py-1.5">{dayLabel(w.weekStart)} to {dayLabel(w.weekEnd)} <span className="text-off-black/40">· {w.dayCount}d</span></td>
                    {[usd(w.revenue), usd(w.cogs), usd(w.grossProfit), usd(w.adSpend), usd(w.designerFee), usd(w.cm), pctText(w.cmPct), xText(w.roas), intText(w.orders), usd(w.aov), usd(w.cpa)].map((v, i) => <td key={i} className={`px-2 py-1.5 ${num}`}>{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-off-black/40">A day's row holds what its feeds reported; a grey row has not landed. Click a day to see the raw inputs and type over a value a feed got wrong.</p>
        </>
      )}
      {openDay && <DayModal day={openDay} onClose={() => setOpenDay(null)} onChanged={load} />}
    </div>
  )
}

function Row({ d, cols, onOpen }: { d: DayRow; cols: Col[]; onOpen: () => void }) {
  const missing = Object.entries(d.has).filter(([, ok]) => !ok).map(([k]) => ({ shopify: 'Shopify', etsy: 'Etsy', printShop: 'Artelo', meta: 'Meta', google: 'Google' }[k]))
  return (
    <tr onClick={onOpen} className={`border-b border-border-gray/60 cursor-pointer hover:bg-subtle-gray ${d.landed ? '' : 'text-off-black/35'}`} title={missing.length ? `Not landed: ${missing.join(', ')}` : undefined}>
      <td className="sticky left-0 bg-white z-10 px-3 py-1.5 text-left">
        <span className="font-medium">{dayLabel(d.day, 'weekday')}</span>
        {d.overridden.length > 0 && <PencilLine className="inline w-3 h-3 ml-1 text-off-black/40" aria-label="Has an override" />}
        {d.landed && missing.length > 0 && <span className="ml-1 text-[10px] text-amber-700">{missing.join(', ')} missing</span>}
      </td>
      {cols.map(c => <td key={c.key} className={`px-2 py-1.5 ${num} ${c.strong ? 'font-semibold' : ''}`}>{d.landed ? c.fmt(d as unknown as Totals & Record<string, unknown>) : '–'}</td>)}
    </tr>
  )
}

/** A day's raw inputs: the sheet's value, and Matt's override beside it. */
function DayModal({ day, onClose, onChanged }: { day: string; onClose: () => void; onChanged: () => void }) {
  const [inputs, setInputs] = useState<DayInput[] | null>(null)
  const [readAt, setReadAt] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  useEffect(() => { financeApi.dayInputs(day).then(r => { setInputs(r.inputs); setReadAt(r.readAt) }).catch(e => toast.error((e as Error).message)) }, [day])
  const text = (f: string, v: number | null) => v == null ? '' : isMoney(f) ? (v / 100).toFixed(2) : String(v)
  const save = async (f: string, raw: string | null) => {
    const value = raw === null || raw.trim() === '' ? null : isMoney(f) ? Math.round(Number(raw) * 100) : Math.round(Number(raw))
    if (raw !== null && raw.trim() !== '' && !Number.isFinite(value)) { toast.error('That is not a number'); return }
    setSaving(f)
    try { const r = await financeApi.override(day, f, value); setInputs(r.inputs); setDraft(p => { const n = { ...p }; delete n[f]; return n }); onChanged() } catch (e) { toast.error((e as Error).message) } finally { setSaving(null) }
  }
  const tabs = inputs ? [...new Set(inputs.map(i => TAB_OF(i.field)))] : []
  return (
    <ActionModal title={dayLabel(day, 'weekday')} sub={readAt ? `read ${new Date(readAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : undefined} description="What each feed reported for this day. Type over a value a feed got wrong; blank takes the override back." onClose={onClose} size="lg">
      {!inputs ? <p className="text-sm text-off-black/50">Loading…</p> : tabs.map(tab => (
        <div key={tab}>
          <p className={`${tableHead} mb-1`}>{tab}</p>
          <table className="w-full text-xs">
            <tbody>
              {inputs.filter(i => TAB_OF(i.field) === tab).map(i => {
                const d = draft[i.field] ?? text(i.field, i.override)
                const changed = draft[i.field] !== undefined && draft[i.field] !== text(i.field, i.override)
                return (
                  <tr key={i.field} className="border-b border-border-gray/60">
                    <td className="py-1 pr-2 text-off-black/80 w-40">{FIELD_LABEL[i.field] || i.field}</td>
                    <td className={`py-1 px-2 ${num} text-off-black/60 w-28`}>{i.sheet == null ? <span className="text-off-black/35">not landed</span> : isMoney(i.field) ? usd(i.sheet, { cents: true }) : intText(i.sheet)}</td>
                    <td className="py-1 pl-2">
                      <div className="flex items-center gap-1.5">
                        {isMoney(i.field) && <span className="text-off-black/40">$</span>}
                        <input value={d} onChange={e => setDraft(p => ({ ...p, [i.field]: e.target.value }))} placeholder="override" inputMode="decimal" className={`${inputBase} w-28 py-1 text-right`} />
                        {changed && <button onClick={() => save(i.field, d)} disabled={saving === i.field} className={`${modalPrimary} py-1 px-2.5 text-xs`}>Save</button>}
                        {i.override != null && !changed && <button onClick={() => save(i.field, null)} disabled={saving === i.field} className={btnGhost} title="Take the override back"><X className="w-3.5 h-3.5" /></button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </ActionModal>
  )
}
