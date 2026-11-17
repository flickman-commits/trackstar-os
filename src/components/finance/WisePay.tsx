import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, Loader2, RefreshCw, RotateCcw, Send, Unlink } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { btnGhost, btnPrimary, chip, chipTone, inputBase, modalCancel, modalPrimary } from '@/lib/ui'
import { financeApi, usd } from '@/lib/financeApi'
import type { MonthLine, WisePayee, WisePreview, WiseRecipient, WiseRun, WiseStatus } from '@/types/finance'
import { card, tableHead } from './bits'

/**
 * Paying the team through Wise (server/domain/finance/wisePay.js): the Send
 * dialog for a pay period or a design month, the Wise state on a person's
 * row with Retry and Release, and the card on Rates that links each person
 * to their Wise recipient and records their tax form.
 */

const money = (minor: number | null | undefined, currency: string | null) => {
  if (minor == null || !currency) return '–'
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(minor / 100) } catch { return `${(minor / 100).toFixed(2)} ${currency}` }
}

type Target = { kind: 'period'; periodStart: string } | { kind: 'month'; month: string }

/** Review who gets paid, with live quotes and the balance, then Send. */
export function WiseSendModal({ target, title, onClose, onSent }: { target: Target; title: string; onClose: () => void; onSent: () => void }) {
  const [data, setData] = useState<WisePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WiseRun | null>(null)
  const load = useCallback(async () => {
    setError(null); setData(null)
    try {
      const d = await financeApi.wisePreview(target)
      setData(d)
      setPicked(new Set(d.people.filter(p => !p.blockers.length).map(p => p.userId)))
    } catch (e) { setError((e as Error).message) }
  }, [target])
  useEffect(() => { load() }, [load])

  const chosen = data?.people.filter(p => picked.has(p.userId) && !p.blockers.length) || []
  const total = chosen.reduce((n, p) => n + p.cents, 0)
  const short = data?.balanceCents != null ? Math.max(0, total - data.balanceCents) : null
  const canSend = !busy && chosen.length > 0 && data?.balanceCents != null && !short
  const send = async () => {
    if (!canSend) return
    setBusy(true)
    try {
      const out = await financeApi.wiseSend({ kind: target.kind, ...(target.kind === 'period' ? { periodStart: target.periodStart } : { month: target.month }), userIds: chosen.map(p => p.userId) })
      setResult(out)
      const failed = out.transfers.filter(t => !['funded', 'sent'].includes(t.status))
      if (failed.length) toast.error(`${failed.length} of ${out.transfers.length} did not go through`)
      else toast.success(`Sent ${usd(out.totalCents, { cents: true })} through Wise`)
      onSent()
    } catch (e) { toast.error((e as Error).message); setConfirming(false) } finally { setBusy(false) }
  }

  const live = data?.env === 'production'
  return (
    <ActionModal icon={Send} title={`Pay through Wise`} sub={title} onClose={onClose} busy={busy} size="lg"
      description={result ? 'Here is how each payment went. Statuses keep updating on Payouts.' : 'Each person gets one transfer from the Wise USD balance. Amounts received are Wise’s live estimate.'}
      hint={data && !live ? <span className="inline-flex items-center gap-1 font-medium text-violet-700">Wise sandbox: no real money moves</span> : confirming ? 'Wise sends it right away. It cannot be taken back from here.' : null}
      footer={result
        ? <button onClick={onClose} className={modalPrimary}>Done</button>
        : confirming
          ? <><button onClick={() => setConfirming(false)} disabled={busy} className={modalCancel}>Back</button><button onClick={send} disabled={!canSend} className={live ? 'inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50' : modalPrimary}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send {usd(total, { cents: true })} now</button></>
          : <><button onClick={onClose} className={modalCancel}>Cancel</button><button onClick={() => setConfirming(true)} disabled={!canSend} className={modalPrimary}>Review {usd(total, { cents: true })}</button></>}>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!data && !error && <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-off-black/30" /></div>}
      {data && !result && (
        <>
          <Balance data={data} total={total} short={short} />
          {!data.people.length && <p className="text-sm text-off-black/55">Nobody is due: they may be paid already.</p>}
          <div className="divide-y divide-border-gray/70 rounded-xl border border-border-gray">
            {data.people.map(p => {
              const blocked = p.blockers.length > 0
              const on = picked.has(p.userId) && !blocked
              return (
                <label key={p.userId} className={`flex items-start gap-3 px-3.5 py-3 ${blocked ? 'bg-subtle-gray/50' : 'cursor-pointer'}`}>
                  <input type="checkbox" checked={on} disabled={blocked || confirming} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(p.userId); else n.delete(p.userId); return n })} className="mt-1" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold">{p.name}</span>
                      <span className="font-semibold tabular-nums">{usd(p.cents, { cents: true })}</span>
                    </div>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-off-black/55">
                      <span>{p.recipientName ? `To ${p.recipientName}` : 'No Wise recipient'}{p.currency ? ` · ${p.currency}` : ''} · {p.items.map(i => i.label).join(', ')}</span>
                      {p.quote && <span className="tabular-nums">≈ {money(p.quote.targetMinor, p.currency)} received{p.quote.feeCents != null ? `, fee ${usd(p.quote.feeCents, { cents: true })}` : ''}{p.quote.rate && p.currency !== 'USD' ? ` at ${p.quote.rate}` : ''}</span>}
                    </div>
                    {blocked && <div className="mt-1.5 flex flex-wrap gap-1.5">{p.blockers.map(b => <span key={b} className={`${chip} ${chipTone.rose} py-0.5 font-medium`}><AlertTriangle className="w-3 h-3" />{b}</span>)}</div>}
                  </div>
                </label>
              )
            })}
          </div>
          {confirming && <p className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-sm text-amber-900">Send <b>{usd(total, { cents: true })}</b> to {chosen.map(p => p.name.split(' ')[0]).join(', ')} from the Wise USD balance{live ? '' : ' (sandbox)'}?</p>}
        </>
      )}
      {result && (
        <div className="divide-y divide-border-gray/70 rounded-xl border border-border-gray">
          {result.transfers.map(t => (
            <div key={t.id} className="flex items-start justify-between gap-3 px-3.5 py-3">
              <div className="min-w-0"><p className="font-semibold">{t.name}</p>{t.failureReason && <p className="text-xs text-rose-700">{t.failureReason}</p>}{t.wiseTransferId && <p className="text-[11px] text-off-black/45">Wise #{t.wiseTransferId}</p>}</div>
              <div className="flex items-center gap-2"><span className="tabular-nums font-semibold">{usd(t.cents, { cents: true })}</span><WiseChip status={t.status} /></div>
            </div>
          ))}
        </div>
      )}
    </ActionModal>
  )
}

function Balance({ data, total, short }: { data: WisePreview; total: number; short: number | null }) {
  if (data.balanceError) return <p className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-sm text-amber-900">{data.balanceError}</p>
  if (data.balanceCents == null) return <p className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-sm text-rose-800">The Wise profile has no USD balance to pay from.</p>
  if (short) return <p className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-sm text-rose-800">Wise USD balance {usd(data.balanceCents, { cents: true })}: <b>{usd(short, { cents: true })} short</b> of {usd(total, { cents: true })}. Add money in Wise, then come back.</p>
  return <p className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-sm text-emerald-900">Wise USD balance {usd(data.balanceCents, { cents: true })}, enough for {usd(total, { cents: true })}.</p>
}

const CHIP: Record<WiseStatus, [string, string]> = {
  prepared: ['Sending', chipTone.amber], created: ['Sending', chipTone.amber], funded: ['Paid · Wise', chipTone.emerald],
  sent: ['Paid out · Wise', chipTone.emerald], failed: ['Wise failed', chipTone.rose], returned: ['Came back', chipTone.rose], cancelled: ['Released', chipTone.quiet],
}
export function WiseChip({ status }: { status: WiseStatus }) {
  const [label, tone] = CHIP[status]
  return <span className={`${chip} ${tone} py-0.5`}>{label}</span>
}

/** A Wise payment that needs a hand: what went wrong, Retry (same ids, never a second payment) and Release (free it to pay another way). */
export function WiseActions({ wise, onChanged }: { wise: NonNullable<MonthLine['wise']>; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (action: 'retry' | 'release') => {
    if (action === 'release' && !window.confirm('Release this payment? It is cancelled at Wise if it was made, and the hours or month can be paid again another way.')) return
    setBusy(action)
    try {
      const out = await financeApi.wiseTransfer(action, wise.id)
      const t = out.transfers.find(x => x.id === wise.id)
      if (action === 'retry' && t && !['funded', 'sent'].includes(t.status)) toast.error(t.failureReason || 'Still not through')
      else toast.success(action === 'retry' ? 'Sent through Wise' : 'Released')
      onChanged()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const stuck = ['prepared', 'created', 'failed'].includes(wise.status)
  const freeable = stuck || wise.status === 'returned'
  return (
    <span className="inline-flex items-center gap-1" title={wise.failureReason || undefined}>
      {stuck && <button onClick={() => act('retry')} disabled={!!busy} className={btnGhost}>{busy === 'retry' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />} Retry</button>}
      {freeable && <button onClick={() => act('release')} disabled={!!busy} className={btnGhost}>{busy === 'release' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />} Release</button>}
    </span>
  )
}

/** "Pay through Wise" for a period or a month: the button and its dialog. */
export function WiseSendButton({ target, title, onSent }: { target: Target; title: string; onSent: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className={`${btnPrimary} py-1`}><Send className="w-3.5 h-3.5" /> Pay through Wise</button>
      {open && <WiseSendModal target={target} title={title} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  )
}

/**
 * Payouts > Rates: each person's Wise recipient (added in Wise, picked here)
 * and their tax form. Sending through Wise is blocked without both.
 */
export function WisePayees() {
  const [payees, setPayees] = useState<WisePayee[] | null>(null)
  const [recips, setRecips] = useState<WiseRecipient[] | null>(null)
  const [recipError, setRecipError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const loadRecips = useCallback(async () => {
    setRecipError(null)
    try { setRecips((await financeApi.wiseRecipients()).recipients) } catch (e) { setRecipError((e as Error).message) }
  }, [])
  useEffect(() => {
    financeApi.wisePayees().then(d => setPayees(d.payees)).catch(e => toast.error((e as Error).message))
    loadRecips()
  }, [loadRecips])
  const save = async (userId: string, fn: () => Promise<{ payees: WisePayee[] }>, done: string) => {
    setSaving(userId)
    try { setPayees((await fn()).payees); toast.success(done) } catch (e) { toast.error((e as Error).message) } finally { setSaving(null) }
  }
  const rows = (payees || []).filter(p => p.role !== 'admin')
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-off-black mb-1">Paying through Wise</h3>
          <p className="text-[11px] text-off-black/50">Add each person as a recipient in Wise first (bank details stay in Wise), then pick them here. A Costa Rica recipient needs a CRC IBAN starting with CR. Pay through Wise is blocked until there is a recipient and a tax form on file.</p>
        </div>
        <button onClick={loadRecips} className={btnGhost} title="Read the recipient list from Wise again"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      {recipError && <p className="mb-2 text-xs text-amber-800">Could not read recipients from Wise: {recipError}</p>}
      {!payees ? <Loader2 className="w-4 h-4 animate-spin text-off-black/30" /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border-gray"><th className={`py-1.5 text-left ${tableHead}`}>Person</th><th className={`py-1.5 text-left ${tableHead}`}>Wise recipient</th><th className={`py-1.5 text-left ${tableHead}`}>Currency</th><th className={`py-1.5 text-left ${tableHead}`}>Tax form</th></tr></thead>
            <tbody>{rows.map(p => {
              const linkedMissing = p.recipientId && recips && !recips.some(r => r.id === p.recipientId)
              return (
                <tr key={p.userId} className="border-b border-border-gray/60 last:border-0">
                  <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{p.name}</td>
                  <td className="py-1.5 pr-3">
                    {recips ? (
                      <select value={p.recipientId || ''} disabled={saving === p.userId}
                        onChange={e => save(p.userId, () => financeApi.wiseLink(p.userId, e.target.value || null), e.target.value ? 'Recipient linked' : 'Recipient unlinked')}
                        className={`${inputBase} py-1 max-w-[280px]`}>
                        <option value="">Not linked</option>
                        {linkedMissing && <option value={p.recipientId!}>{p.recipientName || p.recipientId} (not in Wise list)</option>}
                        {recips.map(r => <option key={r.id} value={r.id} disabled={!!r.problem}>{r.name} · {r.currency} · {r.summary}{r.problem ? ' (not usable)' : ''}</option>)}
                      </select>
                    ) : <span className="text-off-black/60">{p.recipientName || 'Not linked'}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-off-black/60">{p.currency ? `${p.currency}${p.country ? ` · ${p.country}` : ''}` : '–'}</td>
                  <td className="py-1.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <select value={p.taxFormType || ''} disabled={saving === p.userId}
                        onChange={e => save(p.userId, () => financeApi.wiseTaxForm(p.userId, e.target.value || null, Boolean(e.target.value) && p.taxFormOnFile), 'Tax form saved')}
                        className={`${inputBase} py-1 w-28`}>
                        <option value="">None</option><option value="W-9">W-9</option><option value="W-8BEN">W-8BEN</option>
                      </select>
                      <label className={`inline-flex items-center gap-1 ${p.taxFormType ? '' : 'opacity-40'}`}>
                        <input type="checkbox" checked={p.taxFormOnFile} disabled={!p.taxFormType || saving === p.userId}
                          onChange={e => save(p.userId, () => financeApi.wiseTaxForm(p.userId, p.taxFormType, e.target.checked), e.target.checked ? 'Marked on file' : 'Marked not on file')} />
                        On file
                      </label>
                      {p.taxFormOnFile && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </span>
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
