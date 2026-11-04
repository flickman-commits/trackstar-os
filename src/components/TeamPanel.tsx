/**
 * Settings workspaces for people and accountability.
 *
 *   <ActivityPanel /> the audit log of consequential actions (admin only)
 *   <AccountPanel />  your own account                    (everyone)
 *
 * People and Permission Sets moved to src/components/people/ (the
 * directory, one page per person, and the sets); re-exported here so the
 * Settings page keeps its imports.
 *
 * People and Activity are part of the admin view: team members do not see them
 * in the settings nav at all, and the endpoints behind them refuse a non-admin
 * session, so the roster and the log are not reachable by typing a URL either.
 *
 * AccountPanel exists so that hiding the admin view does not also take away a
 * team member's ability to change their own password. It is the one piece of
 * the old People panel everyone still needs.
 */
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, LogOut } from 'lucide-react'
import { useAuth, fullName, PasswordInput } from '@/lib/auth'
import { btnPrimary, btnSecondary, btnGhost, inputBase, fieldLabel } from '@/lib/ui'
import { ROLE_LABEL, normalizeRole, describeCaps, rolesOf } from '@/lib/roles'

export { default as PeoplePanel } from '@/components/people/PeopleDirectory'
export { default as RolesPanel } from '@/components/people/PermissionSets'

const API_BASE = import.meta.env.VITE_API_URL || ''

/** What each role is called on screen. Roles and what they include: src/lib/roles.ts. */
function roleLabel(role?: string) {
  return ROLE_LABEL[normalizeRole(role)]
}

function api(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/** A generated invite link, shown once with a copy button. */
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
            {rolesOf(user).map(r => roleLabel(r)).join(' + ').toLowerCase()}
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
