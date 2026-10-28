import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { btnPrimary, btnGhost, fieldLabel, modalCancel, modalInput, modalPrimary, sectionLabel } from '@/lib/ui'
import ActionModal from '@/components/ActionModal'
import RequestFeatureModal from '@/components/support/RequestFeatureModal'
import { useArmed } from '@/lib/useArmed'

/**
 * Settings > Feature Requests: what the team has asked to have built, sent
 * from the Request feature button in Support or added here
 * (server/domain/featureRequests.js). Everyone reads and adds; an admin
 * checks one off when it ships, with an optional note.
 */
type Request = {
  id: string; title: string; detail: string | null; source: string; status: 'open' | 'done'; note: string | null
  createdByName: string | null; createdAt: string; doneAt: string | null; doneByName: string | null
}

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}

export async function sendFeatureRequest(title: string, detail: string, source: 'support' | 'settings') {
  const res = await apiFetch('/api/feature-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', title, detail, source }) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || 'Could not send the request')
  return d.request as Request
}

export default function FeatureRequestsPanel() {
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState<Request[] | null>(null)
  const [done, setDone] = useState<Request[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [adding, setAdding] = useState(false)
  // Resolving asks for a note in a modal, and delete takes a second click: Arc blocks window.prompt and window.confirm.
  const [resolving, setResolving] = useState<Request | null>(null)
  const [resolveNote, setResolveNote] = useState('')
  const { arm, isArmed } = useArmed()

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/feature-requests')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load feature requests')
      setOpen(d.open); setDone(d.done)
    } catch (e) { toast.error((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await apiFetch('/api/feature-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(d.error || 'That did not work')
    return d
  }

  const toggle = (r: Request) => {
    if (r.status === 'open') { setResolveNote(''); setResolving(r); return }
    void setStatus(r, 'undo', '')
  }
  const setStatus = async (r: Request, action: 'done' | 'undo', note: string) => {
    setBusy(r.id)
    try { await post({ action, id: r.id, note }); setResolving(null); await load() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  const remove = async (r: Request) => {
    if (!arm(`delete:${r.id}`)) return
    setBusy(r.id)
    try { await post({ action: 'delete', id: r.id }); await load() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  if (!open) return <div className="flex items-center gap-2 text-xs text-off-black/50"><Loader2 className="w-3 h-3 animate-spin" /> Loading feature requests…</div>

  const row = (r: Request) => (
    <div key={r.id} className="p-3 flex items-start gap-3">
      {isAdmin && (
        <input type="checkbox" checked={r.status === 'done'} disabled={busy !== null} onChange={() => toggle(r)}
          className="mt-1 w-4 h-4 accent-green-600 cursor-pointer flex-shrink-0" aria-label={r.status === 'done' ? 'Reopen' : 'Mark done'} />
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${r.status === 'done' ? 'text-off-black/50 line-through' : 'text-off-black'}`}>{r.title}</p>
        {r.detail && <p className="text-xs text-off-black/60 mt-1 whitespace-pre-wrap break-words">{r.detail}</p>}
        {r.note && <p className="text-xs text-off-black/55 mt-1">{r.note}</p>}
        <p className="text-[11px] text-off-black/45 mt-1">
          {r.createdByName || 'Someone'} asked {when(r.createdAt)}{r.source === 'support' ? ' from Support' : ''}
          {r.status === 'done' && <> · Done by {r.doneByName || 'someone'} {when(r.doneAt)}</>}
        </p>
      </div>
      {isAdmin && r.status === 'open' && (
        <button onClick={() => remove(r)} disabled={busy !== null} className={`${btnGhost} flex-shrink-0${isArmed(`delete:${r.id}`) ? ' text-red-600' : ''}`} title="Delete"><Trash2 className="w-3.5 h-3.5" />{isArmed(`delete:${r.id}`) && ' Click again to delete'}</button>
      )}
      {busy === r.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-off-black/40" />}
    </div>
  )

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-off-black/55 flex-1 min-w-[240px]">
          What the team has asked to have built. Add one here or with Request feature in Support. {isAdmin ? 'Check one off when it ships.' : 'Matt checks them off as they ship.'}
        </p>
        <button className={btnPrimary} onClick={() => setAdding(true)} disabled={busy !== null}><Plus className="w-3 h-3" /> Request a feature</button>
      </div>

      {adding && <RequestFeatureModal source="settings" onClose={() => setAdding(false)} onSent={load} />}
      {resolving && (
        <ActionModal icon={CheckCircle2} title="Resolve request" onClose={() => setResolving(null)} busy={busy === resolving.id}
          description={resolving.title}
          footer={<>
            <button className={modalCancel} onClick={() => setResolving(null)} disabled={busy === resolving.id}>Cancel</button>
            <button className={modalPrimary} onClick={() => setStatus(resolving, 'done', resolveNote)} disabled={busy === resolving.id}>{busy === resolving.id && <Loader2 className="w-4 h-4 animate-spin" />}Mark done</button>
          </>}>
          <label className="block"><span className={fieldLabel}>A note for the team (optional)</span>
            <textarea value={resolveNote} onChange={e => setResolveNote(e.target.value)} rows={3} autoFocus placeholder='e.g. "Live now", or why it will not be built' className={`${modalInput} resize-none`} />
          </label>
        </ActionModal>
      )}

      <div>
        <h3 className={`${sectionLabel} mb-2`}>Open · {open.length}</h3>
        {open.length
          ? <div className="rounded-lg border border-border-gray bg-white divide-y divide-border-gray">{open.map(row)}</div>
          : <p className="text-sm text-off-black/50 rounded-lg border border-border-gray bg-white p-4">No open requests.</p>}
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
