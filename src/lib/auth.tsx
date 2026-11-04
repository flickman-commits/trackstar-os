/**
 * Who is signed in, for the whole app.
 *
 * One fetch of /api/auth/login on mount answers three questions at once: are
 * you signed in, who are you, and are you an admin. Components read it from
 * context rather than each asking the server, so a page can hide an admin-only
 * control without a round trip.
 *
 * The UI hiding is a courtesy, not the enforcement. Every gated action is
 * checked again on the server against the database, because a hidden button is
 * only hidden.
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { roleCan, type Capability, type Caps } from '@/lib/roles'
import { listViewAsPeople, setViewAs, type ViewAsPerson } from '@/lib/viewAs'

const API_BASE = import.meta.env.VITE_API_URL || ''

export interface CurrentUser {
  id: string
  email: string
  firstName: string
  lastName: string
  /** admin | sales | fulfillment | designer; older accounts may still say "staff". See src/lib/roles.ts. */
  role: string
  /** What the role includes, as set in Settings > Admin > Roles. */
  caps?: Caps
  /** Set while an admin is viewing TrackstarOS as this person (read-only): the admin. */
  viewedBy?: { id: string; firstName?: string; lastName?: string }
}

/** "Matt Hickman", or just "Matt" when no last name is set. */
export function fullName(user: { firstName?: string; lastName?: string } | null): string {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim()
}

interface AuthValue {
  user: CurrentUser | null
  isAdmin: boolean
  /** Whether the signed-in person's role includes this part of the app. */
  can: (capability: Capability) => boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue>({
  user: null,
  isAdmin: false,
  can: () => false,
  refresh: async () => {},
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

/** Convenience for the common case: should this control be shown at all? */
export function useIsAdmin() {
  return useContext(AuthContext).isAdmin
}

export function AuthProvider({ user, setUser, children }: {
  user: CurrentUser | null
  setUser: (u: CurrentUser | null) => void
  children: ReactNode
}) {
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, { credentials: 'include' })
      const data = res.ok ? await res.json() : null
      setUser(data?.user || null)
    } catch {
      // A network blip should not sign anyone out; leave the current user be.
    }
  }, [setUser])

  // Re-read every ten minutes while the tab is open, and when it comes back
  // into view: a changed role shows without a reload, a deactivated account
  // stops, and Last seen stays true for people who never close the tab.
  const signedIn = Boolean(user)
  useEffect(() => {
    if (!signedIn) return
    const tick = () => { if (document.visibilityState === 'visible') refresh() }
    const id = window.setInterval(tick, 10 * 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [signedIn, refresh])

  const signOut = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/login`, { method: 'DELETE', credentials: 'include' })
    } finally {
      setUser(null)
    }
  }, [setUser])

  return (
    <AuthContext.Provider value={{ user, isAdmin: user?.role === 'admin', can: (c: Capability) => Boolean(user) && roleCan(user?.role, c, user?.caps), refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Wraps a page that is part of the admin view.
 *
 * Team members get a plain explanation rather than a redirect: bouncing
 * someone to the dashboard makes a link look broken, when the honest answer is
 * that this page is not theirs. The APIs behind these pages refuse a non-admin
 * session independently, so this is the signpost and not the lock.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (isAdmin) return <>{children}</>
  return <NotYours what="This page is admin only" />
}

/** The same signpost for a page a role does not include (Sales for a designer, say). */
export function RequireCap({ cap, children }: { cap: Capability; children: ReactNode }) {
  const { can } = useAuth()
  if (can(cap)) return <>{children}</>
  return <NotYours what="This page is not part of your role" />
}

function NotYours({ what }: { what: string }) {
  const { user } = useAuth()
  return (
    <div className={shell}>
      <div className="w-full max-w-sm text-center">
        <div className={card}>
          <p className="text-body-sm font-medium text-off-black">{what}</p>
          <p className="text-xs text-off-black/50 mt-2">
            You are signed in as {fullName(user) || 'a team member'}. Ask an admin if you need access.
          </p>
          <a
            href="/"
            className="inline-block mt-4 px-4 py-2 text-body-sm font-medium text-white bg-dark-fill hover:opacity-90 rounded-md transition-opacity"
          >
            Back to fulfillment
          </a>
        </div>
      </div>
    </div>
  )
}

/**
 * Shown on every page while an admin views TrackstarOS as someone else
 * (Settings > People). Says who, that it is read-only, and switches or stops.
 */
function ViewAsBanner({ user }: { user: CurrentUser }) {
  const [people, setPeople] = useState<ViewAsPerson[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { listViewAsPeople().then(setPeople).catch(() => {}) }, [])
  const go = async (id: string | null) => {
    setBusy(true)
    try { await setViewAs(id) } catch { setBusy(false) }
  }
  return (
    <div className="fixed z-[200] right-3 left-3 md:left-auto bottom-[calc(100px+env(safe-area-inset-bottom))] md:bottom-4 md:right-4 md:max-w-md rounded-lg border border-amber-300 bg-amber-50 shadow-lg px-3 py-2.5 text-xs text-amber-950">
      <div className="flex items-center gap-2">
        <Eye className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 min-w-0">
          Viewing as <strong>{fullName(user) || user.email}</strong>. Read-only: nothing you do here is saved.
        </span>
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      </div>
      <div className="flex items-center gap-2 mt-2">
        <select
          className="flex-1 min-w-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs"
          value={user.id}
          disabled={busy}
          onChange={e => go(e.target.value)}
        >
          {!people.some(p => p.id === user.id) && <option value={user.id}>{fullName(user) || user.email}</option>}
          {people.map(p => <option key={p.id} value={p.id}>{p.name} ({p.roleLabel})</option>)}
        </select>
        <button
          onClick={() => go(null)}
          disabled={busy}
          className="shrink-0 rounded-md bg-dark-fill px-2.5 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Stop viewing
        </button>
      </div>
    </div>
  )
}

const shell = 'min-h-screen bg-off-white flex items-center justify-center px-4'
const card = 'bg-white border border-border-gray rounded-md p-6 shadow-sm'
const field =
  'w-full px-4 py-3 text-body-sm border border-border-gray rounded-md bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-off-black/20 transition-colors'
const submit =
  'w-full mt-4 px-4 py-3 text-body-sm font-medium text-white bg-dark-fill ' +
  'hover:opacity-90 rounded-md transition-opacity disabled:opacity-50'

/**
 * Password field with a reveal toggle.
 *
 * Typing a long password blind is where sign-in attempts go wrong, and the
 * usual response - retyping it repeatedly - does not tell you whether the
 * problem is your fingers or the server. Being able to look removes one of
 * those two explanations.
 *
 * Defaults to hidden, and does not persist the choice: revealing is a
 * deliberate act each time, not a setting that leaves a password on screen for
 * whoever walks past next.
 */
export function PasswordInput({ value, onChange, placeholder, autoComplete, autoFocus, className }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
  autoFocus?: boolean
  className?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className || field} pr-11`}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        // Outside the tab order: someone tabbing from email to password to
        // submit should not land on this on the way past.
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-off-black/35 hover:text-off-black/70 transition-colors"
      >
        {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

/**
 * Sign-in, invite acceptance, and the gate around everything private.
 *
 * Replaces the old shared-password prompt. The shared password is not gone
 * entirely: on a fresh install with no accounts, it still works once and turns
 * whatever email you type into the first admin. That is the only way to
 * bootstrap without database access, and it closes as soon as one account
 * exists.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [checking, setChecking] = useState(true)

  // An invite link is ?invite=<token>. Read once on mount: the token is
  // removed from the address bar as soon as it is used, so it cannot be
  // re-submitted by a refresh or leak through a shared screenshot of the URL.
  const [inviteToken] = useState(() =>
    new URLSearchParams(window.location.search).get('invite') || ''
  )

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/auth/login`, { credentials: 'include' })
      .then(async (res) => {
        if (cancelled || !res.ok) return
        const data = await res.json()
        setUser(data?.user || null)
      })
      .catch(() => { /* treat as signed out */ })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [])

  const onSignedIn = (u: CurrentUser) => {
    setUser(u)
    if (window.location.search.includes('invite=')) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }

  if (checking) return <div className="min-h-screen bg-off-white" />

  if (user) {
    return (
      <AuthProvider user={user} setUser={setUser}>
        {children}
        {user.viewedBy && <ViewAsBanner user={user} />}
      </AuthProvider>
    )
  }

  if (inviteToken) {
    return <AcceptInvite token={inviteToken} onDone={onSignedIn} />
  }

  return <SignInForm onDone={onSignedIn} />
}

function SignInForm({ onDone }: { onDone: (u: CurrentUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        onDone(data.user)
      } else if (res.status >= 500) {
        // Worth spelling out. A server fault used to surface here as a bare
        // "could not sign in", which reads exactly like a rejected password
        // and sends people off retyping something that was already correct.
        setError('The server had a problem. This is not your password, so try again shortly.')
      } else {
        setError(data.error || 'Could not sign in')
      }
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={shell}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-12" />
        </div>
        <form onSubmit={handleSubmit} className={card}>
          <label className="block text-body-sm font-medium text-off-black mb-2">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
            placeholder="you@trackstar.art"
            autoComplete="username"
            autoFocus
          />
          <label className="block text-body-sm font-medium text-off-black mt-4 mb-2">Password</label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="Password"
            autoComplete="current-password"
          />
          {error && <p className="text-red-500 text-body-sm mt-3">{error}</p>}
          <button type="submit" disabled={submitting} className={submit}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
          <p className="text-xs text-off-black/45 mt-4 text-center">
            No account? Ask an admin to send you an invite link.
          </p>
        </form>
      </div>
    </div>
  )
}

function AcceptInvite({ token, onDone }: { token: string; onDone: (u: CurrentUser) => void }) {
  const [invitee, setInvitee] = useState<{ email: string; firstName: string } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/accept-invite?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (res.ok) setInvitee(data)
        else setLoadError(data.error || 'That invite link is invalid or has expired.')
      })
      .catch(() => setLoadError('Could not reach the server'))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Those two passwords do not match')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/auth/accept-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) onDone(data.user)
      else setError(data.error || 'Could not set your password')
    } catch {
      setError('Could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError) {
    return (
      <div className={shell}>
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center mb-8">
            <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-12" />
          </div>
          <div className={card}>
            <p className="text-body-sm text-off-black">{loadError}</p>
            <p className="text-xs text-off-black/45 mt-3">Ask an admin for a fresh link.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={shell}>
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-12" />
        </div>
        <form onSubmit={handleSubmit} className={card}>
          <h1 className="text-body font-semibold text-off-black">
            {invitee ? `Welcome, ${invitee.firstName}` : 'Set your password'}
          </h1>
          <p className="text-xs text-off-black/50 mt-1 mb-4">
            {invitee?.email ? `Choose a password for ${invitee.email}.` : 'Loading...'}
          </p>
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="New password (10 characters or more)"
            autoComplete="new-password"
            autoFocus
          />
          <div className="mt-3">
            <PasswordInput
              value={confirm}
              onChange={setConfirm}
              placeholder="Confirm password"
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-red-500 text-body-sm mt-3">{error}</p>}
          <button type="submit" disabled={submitting || !invitee} className={submit}>
            {submitting ? 'Saving...' : 'Set password and sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
