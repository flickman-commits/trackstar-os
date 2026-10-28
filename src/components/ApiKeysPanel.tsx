import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Copy, Check, KeyRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnPrimary, btnSecondary, btnGhost, inputBase, fieldLabel } from '@/lib/ui'
import { useArmed } from '@/lib/useArmed'

/**
 * Settings > Admin > API Keys: credentials for the MCP server and anything
 * else that integrates. A key is shown once, acts as a person, and does no
 * more than that person's role allows, narrowed by its scopes. Admin only;
 * every mint and revoke is in the Activity Log.
 */
type Scope = 'read' | 'write' | 'admin' | 'repair' | 'worker'
type ApiKey = {
  id: string; name: string; prefix: string; scopes: Scope[]; userId: string | null
  actsAs: { id: string; firstName: string; lastName: string; email: string; role: string; isActive: boolean } | null
  lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; createdAt: string
}
type Person = { id: string; firstName: string; lastName: string }

const MCP_URL = `${window.location.origin}/api/mcp`
// What a key with no person may hold (SERVICE_SCOPES in api/_lib/apiKeys.js).
const SERVICE_SCOPES: Scope[] = ['read', 'repair', 'worker']
// New keys expire unless someone chooses otherwise; "never" is still a choice.
const EXPIRY_CHOICES = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
]

function ago(iso: string | null) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString()
}

function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} className={`${inputBase} flex-1 ${mono ? 'font-mono text-[11.5px]' : ''}`} onFocus={e => e.currentTarget.select()} />
      <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className={btnSecondary}>
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [scopes, setScopes] = useState<{ id: Scope; label: string }[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [fresh, setFresh] = useState<{ key: ApiKey; secret: string } | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const { arm, isArmed } = useArmed()

  const load = useCallback(async () => {
    try {
      const [k, u] = await Promise.all([apiFetch('/api/admin/api-keys').then(r => r.json()), apiFetch('/api/orders/assign').then(r => r.json())])
      if (k.error) throw new Error(k.error)
      setKeys(k.keys || []); setScopes(k.scopes || []); setPeople(u.users || [])
    } catch (e) { toast.error((e as Error).message || 'Could not load keys') }
  }, [])
  useEffect(() => { load() }, [load])

  const revoke = async (k: ApiKey) => {
    if (!arm(`revoke:${k.id}`)) return
    setBusy(k.id)
    try {
      const res = await apiFetch('/api/admin/api-keys', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: k.id }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not revoke')
      toast.success(`Revoked "${k.name}"`); load()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  if (!keys) return <div className="flex justify-center py-10 text-off-black/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
  const shown = keys.filter(k => showRevoked || !k.revokedAt)

  return (
    <div className="space-y-4 max-w-3xl">
      <p className="text-sm text-off-black/60">
        A key lets Claude (on your phone, or a routine) and other tools reach Trackstar through the MCP server. Each key acts as one person and can do no more than their role allows, narrowed by the scopes you tick. Keys are shown once.
      </p>

      {fresh && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
          <p className="text-xs font-medium text-blue-800">"{fresh.key.name}" is ready. Copy it now; it will not be shown again.</p>
          <CopyField value={fresh.secret} />
          <p className="text-[11px] text-blue-800/70">In Claude: Settings → Connectors → Add custom connector. URL <span className="font-mono">{MCP_URL}</span>, Authentication: None, and under advanced settings a header <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>.</p>
          <button onClick={() => setFresh(null)} className={btnGhost}>Done</button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-1.5 text-xs text-off-black/55">
          <input type="checkbox" checked={showRevoked} onChange={e => setShowRevoked(e.target.checked)} /> Show revoked
        </label>
        <button onClick={() => setCreating(true)} className={btnPrimary}><Plus className="w-3.5 h-3.5" /> New key</button>
      </div>

      {creating && (
        <CreateKey
          people={people}
          scopes={scopes}
          onCancel={() => setCreating(false)}
          onCreated={(r) => { setCreating(false); setFresh(r); load() }}
        />
      )}

      <div className="rounded-lg border border-border-gray overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-subtle-gray text-off-black/55">
            <tr>
              <th className="text-left font-medium px-3 py-2">Key</th>
              <th className="text-left font-medium px-3 py-2">Acts as</th>
              <th className="text-left font-medium px-3 py-2">Scopes</th>
              <th className="text-left font-medium px-3 py-2">Last used</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-gray">
            {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-off-black/40">No keys yet.</td></tr>}
            {shown.map(k => (
              <tr key={k.id} className={k.revokedAt ? 'opacity-50' : ''}>
                <td className="px-3 py-2">
                  <div className="font-medium text-off-black flex items-center gap-1.5"><KeyRound className="w-3 h-3 text-off-black/40" /> {k.name}</div>
                  <div className="font-mono text-[10px] text-off-black/40">{k.prefix}…{k.revokedAt ? ' · revoked' : k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}` : ''}</div>
                </td>
                <td className="px-3 py-2 text-off-black/70">{k.actsAs ? `${k.actsAs.firstName} ${k.actsAs.lastName || ''}`.trim() : <span className="text-off-black/45">Service key</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">{k.scopes.map(s => <span key={s} className="px-1.5 py-0.5 rounded bg-off-black/5 text-off-black/60 text-[10px] font-medium">{s}</span>)}</div>
                </td>
                <td className="px-3 py-2 text-off-black/55">{ago(k.lastUsedAt)}</td>
                <td className="px-3 py-2 text-right">
                  {!k.revokedAt && <button onClick={() => revoke(k)} disabled={busy === k.id} className={`${btnGhost}${isArmed(`revoke:${k.id}`) ? ' text-red-600' : ''}`} title="Anything using it stops working now"><X className="w-3 h-3" /> {isArmed(`revoke:${k.id}`) ? 'Click again to revoke: anything using it stops' : 'Revoke'}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border-gray bg-subtle-gray px-4 py-3 text-xs text-off-black/60 space-y-1">
        <div className="font-mono text-[10px] tracking-wider uppercase text-off-black/40">Connecting</div>
        <p>MCP endpoint: <span className="font-mono text-off-black">{MCP_URL}</span></p>
        <p>Send the key as <span className="font-mono text-off-black">Authorization: Bearer &lt;key&gt;</span>. Every call is logged, writes go to the Activity Log as the person the key acts as, and a key can be revoked here at any time.</p>
      </div>
    </div>
  )
}

function CreateKey({ people, scopes, onCancel, onCreated }: {
  people: Person[]
  scopes: { id: Scope; label: string }[]
  onCancel: () => void
  onCreated: (r: { key: ApiKey; secret: string }) => void
}) {
  const [name, setName] = useState('')
  const [userId, setUserId] = useState(people[0]?.id || '')
  const [picked, setPicked] = useState<Scope[]>(['read'])
  const [expiresInDays, setExpiresInDays] = useState('90')
  const [busy, setBusy] = useState(false)
  const service = userId === ''
  const toggle = (s: Scope) => setPicked(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])

  const create = async () => {
    setBusy(true)
    try {
      const res = await apiFetch('/api/admin/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, userId: userId || null, scopes: picked, expiresInDays: expiresInDays === 'never' ? null : Number(expiresInDays) }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not create the key')
      onCreated(d)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="rounded-lg border border-border-gray p-3 space-y-3 bg-white">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Matt's phone" className={`${inputBase} w-full`} autoFocus />
        </div>
        <div>
          <label className={fieldLabel}>Acts as</label>
          <select value={userId} onChange={e => { setUserId(e.target.value); if (!e.target.value) setPicked(p => p.filter(s => SERVICE_SCOPES.includes(s))) }} className={`${inputBase} w-full`}>
            {people.map(p => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}
            <option value="">Service key (no person; read, repair or render worker only)</option>
          </select>
        </div>
      </div>
      <div>
        <label className={fieldLabel}>Scopes</label>
        <div className="space-y-1.5">
          {scopes.map(s => {
            const off = service && !SERVICE_SCOPES.includes(s.id)
            return (
              <label key={s.id} className={`flex items-center gap-2 text-xs ${off ? 'opacity-40' : ''}`}>
                <input type="checkbox" checked={picked.includes(s.id)} disabled={off} onChange={() => toggle(s.id)} className="accent-off-black" />
                <span className="text-off-black">{s.label}</span>
              </label>
            )
          })}
        </div>
      </div>
      <div className="w-48">
        <label className={fieldLabel}>Expires</label>
        <select value={expiresInDays} onChange={e => setExpiresInDays(e.target.value)} className={`${inputBase} w-full`}>
          {EXPIRY_CHOICES.map(c => <option key={c.value} value={c.value}>{c.value === 'never' ? c.label : `In ${c.label}`}</option>)}
        </select>
        {expiresInDays === 'never' && <p className="mt-1 text-[11px] text-off-black/50">A key that never expires keeps working until someone revokes it here.</p>}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={create} disabled={busy || !name.trim() || !picked.length} className={btnPrimary}>{busy && <Loader2 className="w-3 h-3 animate-spin" />} Create key</button>
        <button onClick={onCancel} className={btnSecondary}>Cancel</button>
      </div>
    </div>
  )
}
