import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, ExternalLink, FileText, PencilLine, RefreshCw, Send, Undo2 } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { btnPrimary, btnSecondary, btnGhost, modalInput, modalPrimary, modalCancel } from '@/lib/ui'
import { financeApi, usd, dayLabel } from '@/lib/financeApi'
import type { RacePayout, RacePayoutsPayload } from '@/types/finance'
import { card, ErrorCard, Spinner, Stat, StatusChip, tableHead, num } from './bits'

/**
 * Partnered races and what each is owed: the deal's terms and race date from
 * Attio, the race's sales from Shopify over its purchase window (15 days
 * before race day to 30 after), the payout due 30 days after the race. The
 * report and the email are the runbook's, word for word.
 *
 * While a race is still selling, its payout is what we owe so far: the tab
 * re-pulls those races when it opens on numbers older than half an hour (the
 * finance-sync cron keeps them warm too), so the totals up top are live.
 */
const STALE_MS = 30 * 60_000
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).toLowerCase().replace(' ', '')
const pulledLabel = (iso: string) => {
  const d = new Date(iso), today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === today ? `as of ${timeLabel(iso)}` : `pulled ${dayLabel(iso.slice(0, 10))}`
}
/** Still selling and its numbers are old (or never pulled): worth a refresh. */
const needsRefresh = (r: RacePayout) => r.status === 'pending' && !!r.window && !r.final && r.window.start <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  && (!r.sales || Date.now() - new Date(r.sales.computedAt).getTime() > STALE_MS)
export default function RacePayouts() {
  const [data, setData] = useState<RacePayoutsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<RacePayout | null>(null)
  const [paying, setPaying] = useState<RacePayout | null>(null)
  const [editing, setEditing] = useState<RacePayout | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refreshedOnce = useRef(false)
  const load = useCallback(async () => { try { setData(await financeApi.racePayouts()); setError(null) } catch (e) { setError((e as Error).message) } }, [])
  const refreshLive = useCallback(async (quiet: boolean) => {
    setRefreshing(true)
    try {
      const out = await financeApi.racePayoutsRefresh()
      if (!quiet) out.failed.forEach(f => toast.error(`${f.name}: ${f.error}`))
      await load()
    } catch (e) { if (!quiet) toast.error((e as Error).message) } finally { setRefreshing(false) }
  }, [load])
  useEffect(() => { load() }, [load])
  // Opened on stale numbers for a race still selling: show what we have, then bring it up to date.
  useEffect(() => {
    if (!data || refreshedOnce.current) return
    refreshedOnce.current = true
    if (data.races.some(needsRefresh)) refreshLive(true)
  }, [data, refreshLive])

  const act = async (body: Record<string, unknown>, key: string, done: (r: RacePayout) => string) => {
    setBusy(key)
    try { const { race } = await financeApi.racePayoutAction(body); toast.success(done(race)); setPaying(null); setEditing(null); if (open?.dealId === race.dealId) setOpen(race); await load() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const pullDue = async () => {
    setBusy('due')
    try { const out = await financeApi.racePayoutsDue(); toast.success(`Pulled sales for ${out.computed} race${out.computed === 1 ? '' : 's'}`); out.failed.forEach(f => toast.error(`${f.name}: ${f.error}`)); await load() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  if (error) return <ErrorCard text={error} />
  if (!data) return <Spinner />
  const due = data.races.filter(r => r.status === 'pending' && r.dueDate && r.daysToDue != null && r.daysToDue <= 0)
  const termsText = (r: RacePayout) => r.terms.structure === 'per_order' ? `${usd(r.terms.perOrderCents)}/order` : r.terms.pct === 0 ? 'No share' : `${r.terms.pct}%${r.terms.assumed ? ' (assumed)' : ''}`
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-off-black/50">Terms and the race date come from the Attio deal (rev_share_pct, or payout_per_order for a flat fee; {data.rules.defaultPct}% when empty). Sales are that race's prints in Shopify from {data.rules.daysBefore} days before race day to {data.rules.daysAfter} after, net of discounts and refunds. Due {data.rules.dueDays} days after the race.</p>
        <div className="flex items-center gap-2">
          <button onClick={() => refreshLive(false)} disabled={refreshing} className={btnGhost} title="Pull sales again for every race still selling"><RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? ' Updating' : ''}</button>
          {due.length > 0 && <button onClick={pullDue} disabled={busy !== null} className={btnPrimary}><RefreshCw className={`w-3.5 h-3.5 ${busy === 'due' ? 'animate-spin' : ''}`} /> Pull sales for {due.length} due</button>}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Owed to races now" value={usd(data.owed.totalCents, { cents: true })} sub={`${data.owed.races} race${data.owed.races === 1 ? '' : 's'} not yet paid`} />
        <Stat label="Still selling" value={usd(data.owed.accruingCents, { cents: true })} sub="so far; grows until each window closes" />
        <Stat label="Window closed, unpaid" value={usd(data.owed.closedCents, { cents: true })} sub="final numbers, payout due or sent" />
      </div>
      {data.races.length === 0 ? <div className={`${card} p-6 text-sm text-off-black/50`}>No won race deals in Attio.</div> : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full text-xs whitespace-nowrap">
            <thead><tr className="bg-subtle-gray border-b border-border-gray">
              {['Race', 'Race day', 'Due', 'Terms', 'Units', 'Net sales', 'Owed', 'Status', ''].map((h, i) => <th key={i} className={`px-3 py-2 ${tableHead} ${i >= 4 && i <= 6 ? num : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data.races.map(r => {
                const overdue = r.status === 'pending' && r.daysToDue != null && r.daysToDue <= 0
                return (
                  <tr key={r.dealId} className="border-b border-border-gray/60 hover:bg-subtle-gray">
                    <td className="px-3 py-2"><span className="font-medium">{r.name}</span>{r.poc?.name && <span className="block text-off-black/50">{r.poc.name}{r.poc.email ? ` · ${r.poc.email}` : ''}</span>}</td>
                    <td className="px-3 py-2">{r.raceDate ? dayLabel(r.raceDate) : <span className="text-amber-700">no date in Attio</span>}</td>
                    <td className={`px-3 py-2 ${overdue ? 'text-red-600 font-semibold' : ''}`}>{r.dueDate ? <>{dayLabel(r.dueDate)}{r.status === 'pending' && r.daysToDue != null && <span className="block font-normal text-off-black/50">{r.daysToDue > 0 ? `in ${r.daysToDue}d` : r.daysToDue === 0 ? 'today' : `${-r.daysToDue}d ago`}{!r.windowClosed && r.daysToDue <= 0 ? ' · window open' : ''}</span>}</> : '–'}</td>
                    <td className="px-3 py-2"><button onClick={() => setEditing(r)} className="inline-flex items-center gap-1 hover:underline" title="Change the terms (written to the Attio deal)">{termsText(r)}<PencilLine className="w-3 h-3 text-off-black/40" /></button></td>
                    <td className={`px-3 py-2 ${num}`}>{r.sales ? r.sales.unitsSold.toLocaleString('en-US') : '–'}</td>
                    <td className={`px-3 py-2 ${num}`}>{r.sales ? usd(r.sales.netSalesCents, { cents: true }) : '–'}</td>
                    <td className={`px-3 py-2 ${num} font-semibold`}>{r.payoutCents != null ? usd(r.payoutCents, { cents: true }) : '–'}{r.payoutCents != null && r.status === 'pending' && !r.final && <span className="block font-normal text-[10px] text-off-black/45">so far</span>}</td>
                    <td className="px-3 py-2"><StatusChip status={r.status === 'sent' ? 'submitted' : r.status === 'paid' ? 'paid' : 'draft'} />{r.sales && <span className="block text-[10px] text-off-black/40">{r.final ? `final, ${pulledLabel(r.sales.computedAt)}` : pulledLabel(r.sales.computedAt)}</span>}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        {r.status !== 'paid' && <button onClick={() => act({ action: 'compute', dealId: r.dealId }, r.dealId, x => `${x.name}: ${x.sales?.unitsSold} units, ${usd(x.sales?.netSalesCents ?? 0)} net`)} disabled={busy !== null || !r.raceDate} className={btnSecondary} title="Pull this race's sales from Shopify"><RefreshCw className={`w-3.5 h-3.5 ${busy === r.dealId ? 'animate-spin' : ''}`} /> {r.sales ? 'Pull again' : 'Pull sales'}</button>}
                        {r.report && <button onClick={() => setOpen(r)} className={btnSecondary}><FileText className="w-3.5 h-3.5" /> Report</button>}
                        {r.status === 'pending' && r.sales && <button onClick={() => act({ action: 'sent', dealId: r.dealId }, r.dealId, x => `Report marked sent for ${x.name}`)} disabled={busy !== null} className={btnGhost} title="The report went to the race"><Send className="w-3.5 h-3.5" /> Sent</button>}
                        {r.status !== 'paid' && r.sales && <button onClick={() => setPaying(r)} disabled={busy !== null} className={btnPrimary}><Check className="w-3.5 h-3.5" /> Paid</button>}
                        {r.status !== 'pending' && <button onClick={() => act({ action: 'reopen', dealId: r.dealId }, r.dealId, x => `${x.name} reopened`)} disabled={busy !== null} className={btnGhost} title="Back to pending"><Undo2 className="w-3.5 h-3.5" /></button>}
                        {r.webUrl && <a href={r.webUrl} target="_blank" rel="noopener noreferrer" className={btnGhost} title="The deal in Attio"><ExternalLink className="w-3.5 h-3.5" /></a>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && open.report && <ReportModal r={open} onClose={() => setOpen(null)} />}
      {editing && <TermsModal r={editing} busy={busy === editing.dealId} onClose={() => setEditing(null)} onSave={b => act({ action: 'set_terms', dealId: editing.dealId, ...b }, editing.dealId, x => `${x.name}: terms saved to Attio`)} />}
      {paying && <PaidModal r={paying} busy={busy === paying.dealId} onClose={() => setPaying(null)} onPay={ref => act({ action: 'paid', dealId: paying.dealId, paidRef: ref }, paying.dealId, x => `${x.name} marked paid${x.attio ? `: ${x.attio}` : ''}`)} />}
    </div>
  )
}

function ReportModal({ r, onClose }: { r: RacePayout; onClose: () => void }) {
  const rep = r.report!
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`) } catch { toast.error('Could not copy') } }
  return (
    <ActionModal icon={FileText} title={r.name} sub="sales report" description={`${rep.window}. ${r.sales?.orders} orders, ${r.sales?.products.length} product${r.sales?.products.length === 1 ? '' : 's'}: ${r.sales?.products.join('; ')}`} onClose={onClose} size="lg"
      footer={<><button onClick={onClose} className={modalCancel}>Close</button><button onClick={() => copy(rep.email, 'Email')} className={modalPrimary}><Copy className="w-3.5 h-3.5" /> Copy email</button></>}>
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1"><p className={tableHead}>Report</p><button onClick={() => copy(rep.report, 'Report')} className={btnGhost}><Copy className="w-3.5 h-3.5" /> Copy</button></div>
          <pre className="bg-subtle-gray border border-border-gray rounded-md p-3 text-xs whitespace-pre-wrap font-sans">{rep.report}</pre>
        </div>
        <div>
          <p className={tableHead}>Email{rep.to ? ` · to ${rep.to}` : ' · no contact on the deal'} · {rep.subject}</p>
          <pre className="bg-subtle-gray border border-border-gray rounded-md p-3 text-xs whitespace-pre-wrap font-sans mt-1">{rep.email}</pre>
        </div>
        {r.sales && <p className="text-[11px] text-off-black/50">Gross {usd(r.sales.grossCents, { cents: true })} less discounts {usd(r.sales.discountCents, { cents: true })} and refunds {usd(r.sales.refundCents, { cents: true })}. {r.terms.assumed ? 'The rev share is assumed at the default; set rev_share_pct on the deal if it differs.' : ''}</p>}
      </div>
    </ActionModal>
  )
}

function PaidModal({ r, busy, onClose, onPay }: { r: RacePayout; busy: boolean; onClose: () => void; onPay: (ref: string) => void }) {
  const [ref, setRef] = useState('')
  return (
    <ActionModal icon={Check} title="Mark paid" sub={r.name} description={`${usd(r.payoutCents ?? 0, { cents: true })} to the race. Units and net sales are written to the Attio deal.`} onClose={onClose} busy={busy} size="sm"
      footer={<><button onClick={onClose} className={modalCancel} disabled={busy}>Cancel</button><button onClick={() => onPay(ref)} disabled={busy} className={modalPrimary}>Mark paid</button></>}>
      <input value={ref} onChange={e => setRef(e.target.value)} placeholder="How: check number, invoice, transfer" className={modalInput} autoFocus />
    </ActionModal>
  )
}

/** The share or the flat fee, typed here and written to the Attio deal. */
function TermsModal({ r, busy, onClose, onSave }: { r: RacePayout; busy: boolean; onClose: () => void; onSave: (b: { structure: 'percent' | 'per_order'; pct?: number; perOrder?: number }) => void }) {
  const [structure, setStructure] = useState<'percent' | 'per_order'>(r.terms.structure)
  const [pct, setPct] = useState(r.terms.pct != null ? String(r.terms.pct) : '15')
  const [perOrder, setPerOrder] = useState(r.terms.perOrderCents != null ? String(r.terms.perOrderCents / 100) : '10')
  const ok = structure === 'percent' ? pct.trim() !== '' && Number(pct) >= 0 && Number(pct) <= 100 : Number(perOrder) > 0
  return (
    <ActionModal icon={PencilLine} title="Payout terms" sub={r.name} description="Saved to the deal in Attio (rev_share_pct, or payout_per_order for a flat fee). Use 0% for a race that forgoes its share. Sales already pulled are re-priced." onClose={onClose} busy={busy} size="sm"
      footer={<><button onClick={onClose} className={modalCancel} disabled={busy}>Cancel</button><button onClick={() => onSave(structure === 'percent' ? { structure, pct: Number(pct) } : { structure, perOrder: Number(perOrder) })} disabled={busy || !ok} className={modalPrimary}>Save to Attio</button></>}>
      <div className="flex gap-2">
        <button onClick={() => setStructure('percent')} className={`${btnSecondary} flex-1 ${structure === 'percent' ? '!bg-dark-fill !text-white' : ''}`}>Share of net sales</button>
        <button onClick={() => setStructure('per_order')} className={`${btnSecondary} flex-1 ${structure === 'per_order' ? '!bg-dark-fill !text-white' : ''}`}>Flat fee per order</button>
      </div>
      {structure === 'percent'
        ? <div className="flex items-center gap-2"><input value={pct} onChange={e => setPct(e.target.value)} inputMode="decimal" className={modalInput} autoFocus /><span className="text-off-black/50">%</span></div>
        : <div className="flex items-center gap-2"><span className="text-off-black/50">$</span><input value={perOrder} onChange={e => setPerOrder(e.target.value)} inputMode="decimal" className={modalInput} autoFocus /><span className="text-off-black/50 whitespace-nowrap">per order</span></div>}
    </ActionModal>
  )
}
