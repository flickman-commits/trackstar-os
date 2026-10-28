import { useCallback, useEffect, useState } from 'react'
import { Loader2, PlugZap, CheckCircle2, AlertTriangle, CircleOff } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useArmed } from '@/lib/useArmed'
import { btnSecondary, btnGhost, chip, chipTone } from '@/lib/ui'

/**
 * Settings > Admin > Connections: every outside service TrackstarOS talks
 * to, in one list (server/lib/connections.js). For each: whether it is set
 * up, who it is connected as, when it was last used, a read-only Test, a
 * Connect or Reconnect where the service has a sign-in flow, and an on/off
 * switch that every part of the tool respects. Secrets never reach this page,
 * only whether they are set. Admin only; switching is in the Activity Log.
 */
type Connection = {
  id: string; label: string; what: string; on: boolean; configured: boolean; missing: string[]
  connected: boolean; needsConnect: boolean; connectUrl: string | null; connectedAs: string | null
  critical: boolean; lastUsedAt: string | null; note: string | null
}
type TestResult = { ok: boolean; detail: string; ms?: number }

function ago(iso: string | null) {
  if (!iso) return 'not yet'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString()
}

function StateChip({ c }: { c: Connection }) {
  if (!c.on) return <span className={`${chip} ${chipTone.rose}`}><CircleOff className="w-3 h-3" />Off</span>
  if (!c.configured) return <span className={`${chip} ${chipTone.amber}`}><AlertTriangle className="w-3 h-3" />Not set up</span>
  if (c.needsConnect) return <span className={`${chip} ${chipTone.amber}`}><AlertTriangle className="w-3 h-3" />Needs connecting</span>
  if (!c.connected) return <span className={`${chip} ${chipTone.amber}`}><AlertTriangle className="w-3 h-3" />Offline</span>
  return <span className={`${chip} ${chipTone.teal}`}><CheckCircle2 className="w-3 h-3" />On</span>
}

/**
 * Under Artelo: whether Approve sends prints to production
 * (server/domain/render/arteloSend.js). Off, Approve only uploads to the
 * library and a person attaches and sends in Artelo, as before.
 */
function ArteloAutoSend() {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  // Turning it off takes a second click, in the page (Arc blocks window.confirm).
  const { arm, isArmed } = useArmed(10000)
  useEffect(() => {
    apiFetch('/api/orders/artelo-send').then(r => r.json()).then(d => setOn(d.on !== false)).catch(() => setOn(null))
  }, [])
  if (on === null) return null
  const flip = async () => {
    const next = !on
    if (!next && !arm('off')) return
    setBusy(true)
    try {
      const res = await apiFetch('/api/orders/artelo-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setting', on: next }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'That did not work')
      setOn(d.on); toast.success(d.on ? 'Approve sends to production' : 'Approve no longer sends to production')
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-off-black/70">
      <button role="switch" aria-checked={on} aria-label="Approve sends to production" disabled={busy} onClick={flip}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-dark-fill' : 'bg-off-black/20'}`}>
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
      </button>
      {isArmed('off')
        ? <span className="text-red-600">Click again to stop sending approved prints to production. Approve will only upload to the Artelo library, and prints waiting to send stay where they are until this is back on.</span>
        : <>Approve sends to production {on ? '(attaches the print and sends the order after a few minutes)' : '(off: attach and send in Artelo by hand)'}</>}
    </div>
  )
}

export default function ConnectionsPanel() {
  const [rows, setRows] = useState<Connection[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, TestResult>>({})
  // Switching off, and anything the server asks to confirm, takes another click on the switch (Arc blocks window.confirm).
  const { arm, isArmed } = useArmed(10000)
  const [serverAsk, setServerAsk] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/connections')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not load connections')
      setRows(d.connections)
    } catch (e) { toast.error((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    const res = await apiFetch('/api/admin/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { res, data: await res.json().catch(() => ({})) }
  }

  const flip = async (c: Connection) => {
    const on = !c.on
    const serverKey = `server:${c.id}`
    const confirmed = isArmed(serverKey) && arm(serverKey)
    if (!confirmed && !on && !arm(`off:${c.id}`)) return
    setBusy(c.id)
    try {
      const { res, data } = await post({ action: 'switch', id: c.id, on, ...(confirmed ? { confirm: true } : {}) })
      if (res.status === 409 && data.needsConfirm) {
        setServerAsk(a => ({ ...a, [c.id]: data.error }))
        arm(serverKey)
        return
      }
      if (!res.ok) throw new Error(data.error || 'That did not work')
      setRows(data.connections)
      toast.success(`${c.label} is ${on ? 'on' : 'off'}`)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  const test = async (c: Connection) => {
    setBusy(`test:${c.id}`)
    try {
      const { res, data } = await post({ action: 'test', id: c.id })
      if (!res.ok) throw new Error(data.error || 'Test failed')
      setTests(t => ({ ...t, [c.id]: { ok: data.ok, detail: data.detail, ms: data.ms } }))
      load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  if (!rows) return <div className="flex items-center gap-2 text-xs text-off-black/50"><Loader2 className="w-3 h-3 animate-spin" /> Loading connections…</div>

  return (
    <div className="space-y-3">
      <p className="text-xs text-off-black/55 max-w-2xl">
        Every outside service TrackstarOS uses. Connect each once here and the whole tool uses it. Turning one off stops every part of the tool that calls it, until it is turned back on. Keys live in Vercel and are never shown here.
      </p>
      <div className="rounded-lg border border-border-gray bg-white divide-y divide-border-gray">
        {rows.map(c => {
          const t = tests[c.id]
          return (
            <div key={c.id} className="p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-off-black">{c.label}</span>
                  <StateChip c={c} />
                </div>
                <p className="text-xs text-off-black/50 mt-0.5">{c.what}</p>
                <p className="text-[11px] text-off-black/45 mt-1 break-words">
                  {c.connectedAs ? <>Connected as <span className="text-off-black/70">{c.connectedAs}</span> · </> : null}
                  {c.id === 'render_worker' ? 'Last checked in' : 'Last used'} {ago(c.lastUsedAt)}
                  {c.note && <> · {c.note}</>}
                  {c.missing.length > 0 && <> · Missing in Vercel: <span className="font-mono">{c.missing.join(', ')}</span></>}
                </p>
                {isArmed(`off:${c.id}`) && (
                  <p className="text-[11px] text-red-600 mt-1">
                    {c.id === 'render_worker'
                      ? 'Pause the render queue? Workers stop picking up jobs; new renders wait until you turn it back on.'
                      : `Turn ${c.label} off? Everything that uses it stops until it is turned back on: ${c.what.toLowerCase()}.`} Click the switch again to confirm.
                  </p>
                )}
                {isArmed(`server:${c.id}`) && <p className="text-[11px] text-red-600 mt-1">{serverAsk[c.id]} Click the switch again to go ahead.</p>}
                {c.id === 'artelo' && c.on && <ArteloAutoSend />}
                {t && (
                  <p className={`text-[11px] mt-1 ${t.ok ? 'text-teal-700' : 'text-red-600'}`}>
                    {t.ok ? 'Test passed' : 'Test failed'}: {t.detail}{t.ms != null ? ` (${t.ms} ms)` : ''}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {c.connectUrl && c.configured && (
                  <a href={c.connectUrl} className={btnGhost}>{c.needsConnect ? 'Connect' : 'Reconnect'}</a>
                )}
                <button className={btnSecondary} disabled={busy !== null || !c.configured || (!c.on && c.id !== 'render_worker')} onClick={() => test(c)}>
                  {busy === `test:${c.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlugZap className="w-3 h-3" />} Test
                </button>
                <button
                  role="switch"
                  aria-checked={c.on}
                  aria-label={`${c.label} ${c.on ? 'on' : 'off'}`}
                  disabled={busy !== null}
                  onClick={() => flip(c)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${c.on ? 'bg-dark-fill' : 'bg-off-black/20'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${c.on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
