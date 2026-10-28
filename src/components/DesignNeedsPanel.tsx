import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, RefreshCw, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnPrimary, btnSecondary, btnGhost, chip, chipTone, inputBase, sectionLabel } from '@/lib/ui'
import { useArmed } from '@/lib/useArmed'

/**
 * Settings > Design Needs: what the designer has to fix in production files
 * so the render script can make the print (server/domain/render/designNeeds.js).
 * The tool adds what the open orders are stuck on and closes those itself once
 * nothing waits on them; a design rejected as a file problem lands here too;
 * anyone can write one. Whoever fixes one checks it off. Checking off a
 * rejected design renders that order again.
 */
type OrderRef = { id: string; number: string }
type Need = {
  id: string; kind: string; title: string; template: string | null; size: string | null; detail: string | null
  orders: OrderRef[] | null; source: 'auto' | 'reject' | 'manual'; status: 'open' | 'done'; note: string | null
  createdByName: string | null; doneAt: string | null; doneByName: string | null; createdAt: string
}

const KIND_TONE: Record<string, keyof typeof chipTone> = {
  production_file: 'purple', no_time_layer: 'blue', photo_window: 'teal', file_problem: 'amber', rejected: 'red', other: 'slate',
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}

export default function DesignNeedsPanel() {
  const [open, setOpen] = useState<Need[] | null>(null)
  const [done, setDone] = useState<Need[]>([])
  const [kinds, setKinds] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const { arm, isArmed } = useArmed()
  const [showDone, setShowDone] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: '', template: '', size: '', detail: '' })

  const apply = (d: { open: Need[]; done: Need[]; kinds: Record<string, string> }) => { setOpen(d.open); setDone(d.done); setKinds(d.kinds) }
  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/render/needs')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load design needs')
      apply(d)
    } catch (e) { toast.error((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await apiFetch('/api/render/needs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.error || 'That did not work')
    return d
  }

  const toggle = async (n: Need) => {
    setBusy(n.id)
    try {
      await post({ action: n.status === 'open' ? 'done' : 'undo', id: n.id })
      if (n.status === 'open') toast.success(n.kind === 'rejected' ? 'Checked off. The order is rendering again.' : 'Checked off')
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  const remove = async (n: Need) => {
    if (!arm(`remove:${n.id}`)) return
    setBusy(n.id)
    try { await post({ action: 'delete', id: n.id }); await load() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  const lookAgain = async () => {
    setBusy('sync')
    try { apply(await post({ action: 'sync' })) } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  const add = async () => {
    setBusy('add')
    try {
      await post({ action: 'add', ...draft })
      setDraft({ title: '', template: '', size: '', detail: '' }); setAdding(false)
      await load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  if (!open) return <div className="flex items-center gap-2 text-xs text-off-black/50"><Loader2 className="w-3 h-3 animate-spin" /> Loading design needs…</div>

  const row = (n: Need) => {
    const orders = n.orders || []
    return (
      <div key={n.id} className="p-3 flex items-start gap-3">
        <input type="checkbox" checked={n.status === 'done'} disabled={busy !== null} onChange={() => toggle(n)}
          className="mt-1 w-4 h-4 accent-green-600 cursor-pointer flex-shrink-0" aria-label={n.status === 'done' ? 'Put back on the list' : 'Check off'} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium ${n.status === 'done' ? 'text-off-black/50 line-through' : 'text-off-black'}`}>{n.title}</span>
            <span className={`${chip} ${chipTone[KIND_TONE[n.kind] || 'slate']}`}>{kinds[n.kind] || n.kind}</span>
            {busy === n.id && <Loader2 className="w-3 h-3 animate-spin text-off-black/40" />}
          </div>
          {n.detail && n.status === 'open' && <p className="text-xs text-off-black/60 mt-1">{n.detail}</p>}
          {n.note && <p className={`text-xs mt-1 ${n.status === 'open' ? 'text-amber-700' : 'text-off-black/50'}`}>{n.note}</p>}
          <p className="text-[11px] text-off-black/45 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {orders.length > 0 && (
              <>
                <span>{orders.length} order{orders.length === 1 ? '' : 's'} waiting:</span>
                {orders.slice(0, 12).map(o => <Link key={o.id} to={`/orders/${o.number}`} className="text-blue-600 hover:underline">#{o.number}</Link>)}
                {orders.length > 12 && <span>and {orders.length - 12} more</span>}
                <span>·</span>
              </>
            )}
            <span>{n.source === 'auto' ? 'Found by the tool' : n.source === 'reject' ? `Rejected by ${n.createdByName || 'someone'}` : `Added by ${n.createdByName || 'someone'}`} {when(n.createdAt)}</span>
            {n.status === 'done' && <span>· Done by {n.doneByName || 'someone'} {when(n.doneAt)}</span>}
          </p>
        </div>
        {n.source !== 'auto' && n.status === 'open' && (
          <button onClick={() => remove(n)} disabled={busy !== null} className={`${btnGhost} flex-shrink-0${isArmed(`remove:${n.id}`) ? ' text-red-600' : ''}`} title="Remove"><Trash2 className="w-3.5 h-3.5" />{isArmed(`remove:${n.id}`) && ' Click again to remove'}</button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-off-black/55 flex-1 min-w-[240px]">
          What the production files need so the script can make the print. The tool adds what orders are stuck on and closes those once nothing waits on them. A design rejected as a file problem lands here too. Check one off when the file is fixed.
        </p>
        <button className={btnSecondary} onClick={lookAgain} disabled={busy !== null}>
          {busy === 'sync' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Look again
        </button>
        <button className={btnPrimary} onClick={() => setAdding(a => !a)} disabled={busy !== null}><Plus className="w-3 h-3" /> Add</button>
      </div>

      {adding && (
        <div className="rounded-lg border border-border-gray bg-subtle-gray p-3 space-y-2">
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="What needs doing, e.g. Export production images for the halves" className={`${inputBase} w-full`} autoFocus />
          <div className="grid grid-cols-[1fr,120px] gap-2">
            <input value={draft.template} onChange={e => setDraft({ ...draft, template: e.target.value })} placeholder="Race or file (optional)" className={inputBase} />
            <input value={draft.size} onChange={e => setDraft({ ...draft, size: e.target.value })} placeholder="Size (optional)" className={inputBase} />
          </div>
          <textarea value={draft.detail} onChange={e => setDraft({ ...draft, detail: e.target.value })} placeholder="Details (optional)" rows={2} className={`${inputBase} w-full`} />
          <div className="flex gap-2 justify-end">
            <button className={btnGhost} onClick={() => setAdding(false)}>Cancel</button>
            <button className={btnPrimary} onClick={add} disabled={busy !== null || !draft.title.trim()}>{busy === 'add' ? <Loader2 className="w-3 h-3 animate-spin" /> : null} Add to the list</button>
          </div>
        </div>
      )}

      <div>
        <h3 className={`${sectionLabel} mb-2`}>To do · {open.length}</h3>
        {open.length
          ? <div className="rounded-lg border border-border-gray bg-white divide-y divide-border-gray">{open.map(row)}</div>
          : <p className="text-sm text-off-black/50 rounded-lg border border-border-gray bg-white p-4">Nothing needs the designer right now.</p>}
      </div>

      {done.length > 0 && (
        <div>
          <button onClick={() => setShowDone(s => !s)} className={`${sectionLabel} inline-flex items-center gap-1 mb-2 hover:text-off-black`}>
            {showDone ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Done · {done.length}
          </button>
          {showDone && <div className="rounded-lg border border-border-gray bg-white divide-y divide-border-gray">{done.map(row)}</div>}
        </div>
      )}
    </div>
  )
}
