import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, UserPlus, ChevronRight, Check, Copy } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { btnPrimary, btnSecondary, btnGhost, inputBase, fieldLabel } from '@/lib/ui'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { Avatar } from '@/components/AssigneePicker'
import PersonPage, { StatusChip } from './PersonPage'
import { ago, loadPeople, loadRoles, postJson, type Person, type RolesPayload } from './api'

/**
 * Settings > Team > People: the directory. One row per person with their
 * level, sets and status; a row opens their page, where everything about
 * them lives. Invite from here.
 */
export default function PeopleDirectory() {
  const { user: me } = useAuth()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [roles, setRoles] = useState<RolesPayload | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [inviteUrl, setInviteUrl] = useState('')
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', roles: ['designer'] as Role[] })
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, r] = await Promise.all([loadPeople(), loadRoles()])
      setPeople(p); setRoles(r)
    } catch (e) { toast.error((e as Error).message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    try {
      const d = await postJson<{ inviteUrl: string }>('/api/admin/users', { action: 'invite', ...form })
      toast.success(`Invited ${form.email}`)
      setInviteUrl(d.inviteUrl); setInviting(false)
      setForm({ firstName: '', lastName: '', email: '', roles: ['designer'] })
      await load()
    } catch (err) { toast.error((err as Error).message) } finally { setSending(false) }
  }

  if (!people || !roles) return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>

  const open = openId ? people.find(p => p.id === openId) : null
  if (open) return <PersonPage person={open} roles={roles} onBack={() => { setOpenId(null); load() }} onChanged={load} />

  const sets = roles.roles.filter(r => r.id !== 'admin')
  const active = people.filter(p => p.status === 'active'), invited = people.filter(p => p.status === 'invited'), off = people.filter(p => p.status === 'deactivated')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-off-black/50">
          {active.length} active{invited.length ? `, ${invited.length} invited` : ''}{off.length ? `, ${off.length} deactivated` : ''}. Open a person to change what they can do.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={load} className={btnGhost} disabled={loading}><RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
          <button onClick={() => setInviting(v => !v)} className={btnPrimary}><UserPlus className="w-3 h-3" /> Invite someone</button>
        </div>
      </div>

      {inviteUrl && <InviteLink url={inviteUrl} onDismiss={() => setInviteUrl('')} />}

      {inviting && (
        <form onSubmit={invite} className="rounded-lg border border-border-gray bg-subtle-gray/40 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={fieldLabel}>First name</label><input className={inputBase} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} placeholder="First" /></div>
            <div><label className={fieldLabel}>Last name</label><input className={inputBase} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} placeholder="Last" /></div>
            <div><label className={fieldLabel}>Email</label><input className={inputBase} type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="name@trackstar.art" /></div>
          </div>
          <div>
            <label className={fieldLabel}>Permission sets</label>
            <div className="flex flex-wrap gap-2">
              {sets.map(r => {
                const on = form.roles.includes(r.id)
                return (
                  <label key={r.id} className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs cursor-pointer ${on ? 'border-off-black/40 bg-white text-off-black' : 'border-border-gray bg-white/60 text-off-black/60'}`}>
                    <input type="checkbox" checked={on} onChange={() => setForm(f => { const next = on ? f.roles.filter(x => x !== r.id) : [...f.roles, r.id]; return { ...f, roles: next.length ? next : f.roles } })} className="accent-off-black" />
                    {r.label}
                  </label>
                )
              })}
            </div>
            <p className="text-[11px] text-off-black/45 mt-1">Admin, exceptions and pay are set on their page once they are in.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className={btnPrimary} disabled={sending}>{sending && <Loader2 className="w-3 h-3 animate-spin" />} Create invite link</button>
            <button type="button" onClick={() => setInviting(false)} className={btnSecondary}>Cancel</button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-border-gray bg-white divide-y divide-border-gray">
        {[...active, ...invited, ...off].map(p => (
          <button key={p.id} onClick={() => setOpenId(p.id)} className={`w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-subtle-gray transition-colors ${p.status === 'deactivated' ? 'opacity-55' : ''}`}>
            <Avatar user={p} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-off-black">{p.name}{p.id === me?.id && <span className="text-off-black/40 font-normal"> (you)</span>}</span>
                <StatusChip status={p.status} />
              </div>
              <div className="text-xs text-off-black/50 truncate">{p.email}</div>
            </div>
            <div className="hidden md:flex items-center gap-1 flex-wrap justify-end max-w-[40%]">
              {p.roles.includes('admin') && <span className="px-1.5 py-px rounded bg-off-black text-white text-[10px] font-semibold">Admin</span>}
              {p.roles.filter(r => r !== 'admin').map(r => <span key={r} className="px-1.5 py-px rounded bg-off-black/[0.06] text-off-black/70 text-[10px] font-medium">{ROLE_LABEL[r]}</span>)}
              {((p.extraCaps?.length || 0) + (p.deniedCaps?.length || 0)) > 0 && <span className="px-1.5 py-px rounded border border-dashed border-off-black/25 text-off-black/55 text-[10px]" title="Has exceptions on top of their sets">custom</span>}
            </div>
            <div className="hidden sm:block w-20 text-right text-[11px] text-off-black/45 shrink-0">{p.status === 'deactivated' ? '' : ago(p.lastSeenAt || p.lastLoginAt)}</div>
            <ChevronRight className="w-4 h-4 text-off-black/30 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}

function InviteLink({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-xs font-medium text-blue-800">Send this link to them. It works once and expires in 7 days.</p>
      <div className="flex items-center gap-2 mt-2">
        <input readOnly value={url} className={`${inputBase} flex-1 font-mono text-[11px]`} />
        <button onClick={copy} className={btnSecondary}>{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}{copied ? 'Copied' : 'Copy'}</button>
        <button onClick={onDismiss} className={btnGhost}>Done</button>
      </div>
    </div>
  )
}
