/**
 * Settings workspaces for people and accountability.
 *
 *   <PeoplePanel />   who can sign in, what they may do   (admin only)
 *   <RolesPanel />    what each role includes, as checkboxes (admin only)
 *   <ActivityPanel /> the audit log of consequential actions (admin only)
 *   <AccountPanel />  your own account                    (everyone)
 *
 * People and Activity are part of the admin view: team members do not see them
 * in the settings nav at all, and the endpoints behind them refuse a non-admin
 * session, so the roster and the log are not reachable by typing a URL either.
 *
 * AccountPanel exists so that hiding the admin view does not also take away a
 * team member's ability to change their own password. It is the one piece of
 * the old People panel everyone still needs.
 */
import { useState, useEffect, useCallback, Fragment } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, UserPlus, Copy, Check, LogOut, ChevronDown } from 'lucide-react'
import { useAuth, fullName, PasswordInput } from '@/lib/auth'
import { btnPrimary, btnSecondary, btnDanger, btnGhost, inputBase, fieldLabel } from '@/lib/ui'
import { useArmed } from '@/lib/useArmed'
import { ROLES, ROLE_LABEL, normalizeRole, describeCaps, type Role, type Caps, type Capability } from '@/lib/roles'

const API_BASE = import.meta.env.VITE_API_URL || ''

/** What each role is called on screen. Roles and what they include: src/lib/roles.ts. */
function roleLabel(role?: string) {
  return ROLE_LABEL[normalizeRole(role)]
}

/**
 * The role picker. The browser's own arrow sits wherever the platform puts
 * it and collided with "Sales & Marketing", so the arrow is drawn here, with
 * room kept for it.
 */
function RoleSelect({ value, onChange, disabled, title, className = '' }: {
  value: string
  onChange: (role: string) => void
  disabled?: boolean
  title?: string
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <select
        className="w-full appearance-none bg-white border border-border-gray rounded-md pl-2.5 pr-8 py-1.5 text-xs text-off-black focus:outline-none focus:ring-2 focus:ring-off-black/10 disabled:opacity-50"
        value={value}
        title={title}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      >
        {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      <ChevronDown className="w-3.5 h-3.5 text-off-black/45 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  )
}

type RoleTable = Record<Exclude<Role, 'admin'>, Capability[]>

/** What a role includes, from the live table (admin is everything). */
function capsOf(table: RoleTable | null, role?: string): Caps | undefined {
  const r = normalizeRole(role)
  if (r === 'admin') return '*'
  return table?.[r]
}

interface TeamMember {
  id: string
  email: string
  firstName: string
  lastName: string
  /** Composed server-side so the table and the toasts agree on one spelling. */
  name: string
  role: string
  isActive: boolean
  hasPassword: boolean
  lastLoginAt: string | null
  /** When they last used the app; lastLoginAt is only when they last typed a password. */
  lastSeenAt: string | null
  createdAt: string
  inviteExpiresAt: string | null
}

function api(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/** "3 days ago", "never". Rough on purpose: exact timestamps are noise here. */
function ago(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/** A generated invite link, shown once with a copy button. */
function InviteLink({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-xs font-medium text-blue-800">
        Send this link to them. It works once and expires in 7 days.
      </p>
      <div className="flex items-center gap-2 mt-2">
        <input readOnly value={url} className={`${inputBase} flex-1 font-mono text-[11px]`} />
        <button onClick={copy} className={btnSecondary}>
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={onDismiss} className={btnGhost}>Done</button>
      </div>
    </div>
  )
}

export function PeoplePanel() {
  const { user } = useAuth()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { arm, isArmed } = useArmed()
  const [inviteUrl, setInviteUrl] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', role: 'designer' as string })

  const [roleTable, setRoleTable] = useState<RoleTable | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, roles] = await Promise.all([api('/api/admin/users'), api('/api/admin/roles').catch(() => null)])
      const data = await res.json()
      if (roles?.ok) setRoleTable((await roles.json()).caps)
      if (res.ok) setMembers(data.users || [])
      else toast.error(data.error || 'Could not load the team')
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const post = async (body: Record<string, unknown>, okMessage: string) => {
    setBusyId(String(body.id || 'new'))
    try {
      const res = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'That did not work'); return null }
      toast.success(okMessage)
      await load()
      return data
    } catch {
      toast.error('Could not reach the server')
      return null
    } finally {
      setBusyId(null)
    }
  }

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    const data = await post({ action: 'invite', ...form }, `Invited ${form.email}`)
    if (data?.inviteUrl) {
      setInviteUrl(data.inviteUrl)
      setShowInvite(false)
      setForm({ firstName: '', lastName: '', email: '', role: 'designer' })
    }
  }

  const remove = async (m: TeamMember) => {
    if (!arm(`delete:${m.id}`)) return
    setBusyId(m.id)
    try {
      const res = await api('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ id: m.id }) })
      const data = await res.json()
      if (!res.ok) toast.error(data.error || 'That did not work')
      else { toast.success(`Deleted ${m.email}`); await load() }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-off-black/50">
          {members.filter(m => m.isActive).length} active
          {members.some(m => !m.isActive) && `, ${members.filter(m => !m.isActive).length} deactivated`}
          . Admins can run destructive actions and manage this list.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={load} className={btnGhost} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {(
            <button onClick={() => setShowInvite(v => !v)} className={btnPrimary}>
              <UserPlus className="w-3 h-3" /> Invite someone
            </button>
          )}
        </div>
      </div>

      {inviteUrl && <InviteLink url={inviteUrl} onDismiss={() => setInviteUrl('')} />}

      {showInvite && (
        <form onSubmit={invite} className="rounded-lg border border-border-gray bg-subtle-gray/40 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div>
              <label className={fieldLabel}>First name</label>
              <input
                className={inputBase}
                value={form.firstName}
                onChange={e => setForm({ ...form, firstName: e.target.value })}
                placeholder="First"
              />
            </div>
            <div>
              <label className={fieldLabel}>Last name</label>
              <input
                className={inputBase}
                value={form.lastName}
                onChange={e => setForm({ ...form, lastName: e.target.value })}
                placeholder="Last"
              />
            </div>
            <div>
              <label className={fieldLabel}>Email</label>
              <input
                className={inputBase}
                type="email"
                required
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="fast@trackstar.art"
              />
            </div>
            <div>
              <label className={fieldLabel}>Role</label>
              <RoleSelect value={form.role} onChange={role => setForm({ ...form, role })} />
              <p className="text-[11px] text-off-black/45 mt-1">{describeCaps(capsOf(roleTable, form.role))}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className={btnPrimary} disabled={busyId === 'new'}>
              {busyId === 'new' && <Loader2 className="w-3 h-3 animate-spin" />} Create invite link
            </button>
            <button type="button" onClick={() => setShowInvite(false)} className={btnSecondary}>Cancel</button>
          </div>
          <p className="text-[11px] text-off-black/45">
            They choose their own password from the link, and can correct their
            name from My Account. You never type a password for them.
          </p>
        </form>
      )}

      {loading && !members.length ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-off-black/40" />
        </div>
      ) : (
        <div className="rounded-lg border border-border-gray overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-subtle-gray text-off-black/50">
              <tr>
                <th className="text-left font-medium px-3 py-2">Person</th>
                <th className="text-left font-medium px-3 py-2">Role</th>
                <th className="text-left font-medium px-3 py-2">Last seen</th>
                <th className="text-right font-medium px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} className={`border-t border-border-gray ${m.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-off-black">
                      {m.name}
                      {m.id === user?.id && <span className="text-off-black/40 font-normal"> (you)</span>}
                    </div>
                    <div className="text-off-black/45">{m.email}</div>
                    {!m.hasPassword && (
                      <div className="text-warning-amber mt-0.5">
                        Invite {m.inviteExpiresAt && new Date(m.inviteExpiresAt) < new Date()
                          ? 'expired' : 'not accepted yet'}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {m.isActive ? (
                      <RoleSelect
                        className="w-44"
                        value={normalizeRole(m.role)}
                        title={describeCaps(capsOf(roleTable, m.role))}
                        disabled={busyId === m.id}
                        onChange={role => post(
                          { action: 'role', id: m.id, role },
                          `${m.name} is now ${roleLabel(role).toLowerCase()}`
                        )}
                      />
                    ) : (
                      <span className="text-off-black/70">{roleLabel(m.role)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-off-black/55">
                    {m.isActive ? ago(m.lastSeenAt || m.lastLoginAt) : 'Deactivated'}
                  </td>
                  {(
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {busyId === m.id && <Loader2 className="w-3 h-3 animate-spin text-off-black/40" />}
                        {m.isActive && (
                          <button
                            className={btnGhost}
                            disabled={busyId === m.id}
                            onClick={async () => {
                              const data = await post({ action: 'reset', id: m.id }, `Reset ${m.name}'s password`)
                              if (data?.inviteUrl) setInviteUrl(data.inviteUrl)
                            }}
                          >
                            Reset password
                          </button>
                        )}
                        {m.isActive && (
                          <button
                            className={btnGhost}
                            disabled={busyId === m.id}
                            onClick={() => post({ action: 'sign-out', id: m.id }, `Signed ${m.name} out everywhere`)}
                          >
                            Sign out everywhere
                          </button>
                        )}
                        <button
                          className={btnSecondary}
                          disabled={busyId === m.id}
                          onClick={() => post(
                            { action: 'active', id: m.id, isActive: !m.isActive },
                            `${m.isActive ? 'Deactivated' : 'Reactivated'} ${m.name}`
                          )}
                        >
                          {m.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button className={btnDanger} disabled={busyId === m.id} onClick={() => remove(m)} title="Comments and edit history stay, attributed to their name">
                          {isArmed(`delete:${m.id}`) ? 'Click again to delete' : 'Delete'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}

export function AccountPanel() {
  const { user, signOut, refresh } = useAuth()

  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Seed the inputs from the session, and re-seed when it refreshes after a
  // save so the fields reflect what was actually stored.
  useEffect(() => {
    setFirst(user?.firstName || '')
    setLast(user?.lastName || '')
  }, [user?.firstName, user?.lastName])

  const [changingPassword, setChangingPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const nameChanged =
    first.trim() !== (user?.firstName || '') || last.trim() !== (user?.lastName || '')

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!first.trim()) { toast.error('First name is required'); return }
    setSavingName(true)
    try {
      const res = await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'set-name', firstName: first, lastName: last }),
      })
      const data = await res.json()
      if (!res.ok) toast.error(data.error || 'That did not work')
      else {
        toast.success('Name updated')
        // Pull the session fresh so the greeting on the dashboard changes too,
        // rather than staying stale until the next reload.
        await refresh()
      }
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setSavingName(false)
    }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { toast.error('Those two passwords do not match'); return }
    setSavingPassword(true)
    try {
      const res = await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ action: 'set-password', currentPassword, password }),
      })
      const data = await res.json()
      if (!res.ok) toast.error(data.error || 'That did not work')
      else {
        toast.success('Password changed. Your other devices are signed out.')
        setChangingPassword(false); setCurrentPassword(''); setPassword(''); setConfirm('')
      }
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      <div>
        <p className="text-sm font-medium text-off-black">
          {fullName(user)}
          <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded bg-off-black/5 text-off-black/50 align-middle">
            {roleLabel(user?.role).toLowerCase()}
          </span>
        </p>
        <p className="text-xs text-off-black/50">{user?.email}</p>
        <p className="text-xs text-off-black/45 mt-2">
          {describeCaps(user?.caps)}. Ask Matt if you need more.
        </p>
      </div>

      <form onSubmit={saveName} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabel}>First name</label>
            <input
              className={inputBase}
              value={first}
              onChange={e => setFirst(e.target.value)}
              autoComplete="given-name"
            />
          </div>
          <div>
            <label className={fieldLabel}>Last name</label>
            <input
              className={inputBase}
              value={last}
              onChange={e => setLast(e.target.value)}
              autoComplete="family-name"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="submit" className={btnPrimary} disabled={savingName || !nameChanged}>
            {savingName && <Loader2 className="w-3 h-3 animate-spin" />} Save name
          </button>
          <span className="text-[11px] text-off-black/40">
            Your first name is what the dashboard greets you by.
          </span>
        </div>
      </form>

      {changingPassword ? (
        <form onSubmit={savePassword} className="rounded-lg border border-border-gray bg-subtle-gray/40 p-4 space-y-3">
          <div>
            <label className={fieldLabel}>Current password</label>
            <PasswordInput
              className={inputBase}
              autoComplete="current-password"
              value={currentPassword}
              onChange={setCurrentPassword}
            />
          </div>
          <div>
            <label className={fieldLabel}>New password</label>
            <PasswordInput
              className={inputBase}
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              placeholder="10 characters or more"
            />
          </div>
          <div>
            <label className={fieldLabel}>Confirm</label>
            <PasswordInput
              className={inputBase}
              autoComplete="new-password"
              value={confirm}
              onChange={setConfirm}
            />
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className={btnPrimary} disabled={savingPassword}>
              {savingPassword && <Loader2 className="w-3 h-3 animate-spin" />} Save password
            </button>
            <button type="button" className={btnSecondary} onClick={() => setChangingPassword(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2 pt-1 border-t border-border-gray/60">
          <button onClick={() => setChangingPassword(true)} className={`${btnSecondary} mt-4`}>
            Change my password
          </button>
          <button onClick={signOut} className={`${btnSecondary} mt-4`}>
            <LogOut className="w-3 h-3" /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

interface AuditEntry {
  id: string
  action: string
  summary: string
  createdAt: string
  actor: string
}

export function ActivityPanel() {
  const [events, setEvents] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api('/api/admin/audit?limit=200')
      const data = await res.json()
      if (res.ok) setEvents(data.events || [])
      else toast.error(data.error || 'Could not load the log')
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-off-black/50">
          Every destructive action, newest first. Append only, so nothing here can be edited or removed.
        </p>
        <button onClick={load} className={btnGhost} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading && !events.length ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-off-black/40" />
        </div>
      ) : !events.length ? (
        <div className="rounded-lg border border-border-gray bg-subtle-gray/40 p-6 text-center">
          <p className="text-xs text-off-black/50">Nothing logged yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border-gray divide-y divide-border-gray">
          {events.map(e => (
            <div key={e.id} className="flex items-start justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs text-off-black">{e.summary}</p>
                <p className="text-[11px] text-off-black/45 mt-0.5">
                  {e.actor} · <span className="font-mono">{e.action}</span>
                </p>
              </div>
              <span className="text-[11px] text-off-black/40 whitespace-nowrap tabular-nums">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface RolesData {
  roles: { id: Role; label: string }[]
  capabilities: { id: Capability; group: string; label: string }[]
  caps: RoleTable
  defaults: RoleTable
}

/**
 * What each role includes, as checkboxes. Admin always has everything and is
 * shown checked and fixed; Data and Admin settings are not on offer and stay
 * admin only. Saved changes apply to everyone on their next page load (or
 * within ten minutes); the server checks the same table on every request.
 */
export function RolesPanel() {
  const [data, setData] = useState<RolesData | null>(null)
  const [draft, setDraft] = useState<RoleTable | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api('/api/admin/roles')
      .then(async res => {
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'Could not load roles')
        setData(d); setDraft(d.caps)
      })
      .catch(e => toast.error((e as Error).message))
  }, [])

  if (!data || !draft) return <div className="flex items-center justify-center h-40 text-off-black/40"><Loader2 className="w-4 h-4 animate-spin" /></div>

  const editable = data.roles.filter(r => r.id !== 'admin') as { id: Exclude<Role, 'admin'>; label: string }[]
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.caps)
  const toggle = (role: Exclude<Role, 'admin'>, cap: Capability) => {
    const has = draft[role].includes(cap)
    setDraft({ ...draft, [role]: has ? draft[role].filter(c => c !== cap) : [...draft[role], cap] })
  }
  const save = async () => {
    setSaving(true)
    try {
      const res = await api('/api/admin/roles', { method: 'PUT', body: JSON.stringify({ caps: draft }) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save')
      setData({ ...data, caps: d.caps }); setDraft(d.caps)
      toast.success('Roles saved. Everyone gets them on their next page load.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const groups = [...new Set(data.capabilities.map(c => c.group))]

  return (
    <div className="space-y-4">
      <p className="text-xs text-off-black/55">
        Everyone sees Fulfillment. Tick what else each role gets. Admin always has everything, and Data and Admin settings stay admin only.
      </p>
      <div className="rounded-lg border border-border-gray overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-subtle-gray text-off-black/55">
            <tr>
              <th className="text-left font-medium px-3 py-2"></th>
              {editable.map(r => <th key={r.id} className="font-medium px-3 py-2 w-36 text-center">{r.label}</th>)}
              <th className="font-medium px-3 py-2 w-24 text-center text-off-black/35">Admin</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g}>
                <tr className="border-t border-border-gray">
                  <td colSpan={editable.length + 2} className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-off-black/40">{g}</td>
                </tr>
                {data.capabilities.filter(c => c.group === g).map(c => (
                  <tr key={c.id} className="hover:bg-subtle-gray/60">
                    <td className="px-3 py-2 text-off-black">{c.label}</td>
                    {editable.map(r => (
                      <td key={r.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${r.label}: ${c.label}`}
                          className="w-4 h-4 accent-off-black cursor-pointer"
                          checked={draft[r.id].includes(c.id)}
                          onChange={() => toggle(r.id, c.id)}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked disabled className="w-4 h-4 opacity-40" aria-label={`Admin: ${c.label}`} /></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => setDraft(data.defaults)} className={btnGhost}>Reset to defaults</button>
        <button onClick={() => setDraft(data.caps)} disabled={!dirty} className={btnSecondary}>Discard</button>
        <button onClick={save} disabled={!dirty || saving} className={btnPrimary}>{saving && <Loader2 className="w-3 h-3 animate-spin" />} Save roles</button>
      </div>
    </div>
  )
}
