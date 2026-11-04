import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Check, Copy, Eye, KeyRound, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { setViewAs } from '@/lib/viewAs'
import { useArmed } from '@/lib/useArmed'
import { btnPrimary, btnSecondary, btnDanger, btnGhost, inputBase } from '@/lib/ui'
import { ROLE_LABEL, type Role } from '@/lib/roles'
import { Avatar } from '@/components/AssigneePicker'
import AccessEditor from './AccessEditor'
import { ago, dollars, toCents, getJson, postJson, loadPeople, type Person, type RolesPayload } from './api'

/**
 * One person, everything about them, in sections: Access (level, sets,
 * exceptions), Work (where orders and conversations land on them), Pay,
 * Keys, Security. The other screens that hold a piece of this (Order
 * Assignment, Support routing, Finance rates, API keys) stay as the view by
 * queue; this is the view by person.
 */
type Shift = { id: string; type: string; userId: string; weight: number; from: string; until: string; handedBackAt?: string }
type Assign = { defaults: Record<string, string>; shifts?: Shift[]; raceRules?: { race: string; userId: string }[]; today?: string }
type Routing = Record<string, { mode: string; people: { userId: string; weight: number }[] }>
type ApiKey = { id: string; name: string; prefix: string; scopes: string[]; userId: string | null; lastUsedAt: string | null; revokedAt: string | null }

const TYPE_LABEL: Record<string, string> = { standard: 'Standard orders', custom: 'Custom orders', race_partner: 'Partner orders', bulk: 'Bulk orders' }
const SHARE: Record<string, string> = { '0.5': 'half share', '1': 'even share', '2': 'double share' }
const DESIGN_ROLES: Role[] = ['head_designer', 'designer']

export function StatusChip({ status }: { status: Person['status'] }) {
  const tone = status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : status === 'invited' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-off-black/5 text-off-black/50 border-border-gray'
  const label = status === 'active' ? 'Active' : status === 'invited' ? 'Invited' : 'Deactivated'
  return <span className={`inline-flex items-center px-1.5 py-px rounded-full border text-[10px] font-semibold ${tone}`}>{label}</span>
}

function Section({ title, blurb, children }: { title: string; blurb?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border-gray bg-white">
      <div className="px-4 py-3 border-b border-border-gray">
        <h3 className="text-sm font-semibold text-off-black">{title}</h3>
        {blurb && <p className="text-[11px] text-off-black/50">{blurb}</p>}
      </div>
      <div className="p-4">{children}</div>
    </section>
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

export default function PersonPage({ person: initial, roles, onBack, onChanged }: { person: Person; roles: RolesPayload; onBack: () => void; onChanged: () => void }) {
  const { user: me } = useAuth()
  const [person, setPerson] = useState(initial)
  const [assign, setAssign] = useState<Assign | null>(null)
  const [routing, setRouting] = useState<Routing | null>(null)
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState('')
  const { arm, isArmed } = useArmed()

  useEffect(() => { setPerson(initial) }, [initial])
  useEffect(() => {
    getJson<Assign>('/api/orders/assign').then(setAssign).catch(() => setAssign({ defaults: {} }))
    getJson<{ routing: Routing }>('/api/support/settings').then(d => setRouting(d.routing || {})).catch(() => setRouting({}))
    getJson<{ keys: ApiKey[] }>('/api/admin/api-keys').then(d => setKeys(d.keys || [])).catch(() => setKeys([]))
  }, [person.id])

  /** Re-read this person after a change elsewhere (rates live on other endpoints). */
  const refresh = useCallback(async () => {
    const all = await loadPeople().catch(() => null)
    const p = all?.find(x => x.id === person.id)
    if (p) setPerson(p)
    onChanged()
  }, [person.id, onChanged])

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key)
    try { await fn(); if (ok) toast.success(ok); await refresh() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const users = (body: Record<string, unknown>) => postJson<{ user?: Person; inviteUrl?: string }>('/api/admin/users', { id: person.id, ...body })

  const isMe = person.id === me?.id
  const isDesigner = person.roles.some(r => DESIGN_ROLES.includes(r))
  const today = assign?.today || new Date().toISOString().slice(0, 10)
  const regularFor = Object.entries(assign?.defaults || {}).filter(([, id]) => id === person.id).map(([t]) => TYPE_LABEL[t] || t)
  const shifts = (assign?.shifts || []).filter(s => s.userId === person.id && !s.handedBackAt && s.until >= today)
  const races = (assign?.raceRules || []).filter(r => r.userId === person.id).map(r => r.race)
  const channels = Object.entries(routing || {}).filter(([, r]) => r.people.some(p => p.userId === person.id)).map(([c, r]) => {
    const w = r.people.find(p => p.userId === person.id)?.weight ?? 1
    return `${c === 'instagram' ? 'Instagram' : 'Email'}: ${r.mode === 'person' ? 'everything' : SHARE[String(w)] || `${w}x share`}`
  })
  const myKeys = (keys || []).filter(k => k.userId === person.id && !k.revokedAt)

  return (
    <div className="space-y-4 max-w-4xl">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-off-black/60 hover:text-off-black"><ArrowLeft className="w-3.5 h-3.5" /> All people</button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar user={person} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-off-black leading-tight">{person.name}{isMe && <span className="text-off-black/40 font-normal"> (you)</span>}</h2>
              <StatusChip status={person.status} />
            </div>
            <p className="text-xs text-off-black/55">{person.email} · {person.roles.includes('admin') ? 'Admin' : 'Member'}{person.roles.filter(r => r !== 'admin').length ? ` · ${person.roles.filter(r => r !== 'admin').map(r => ROLE_LABEL[r]).join(', ')}` : ''} · Last seen {ago(person.lastSeenAt || person.lastLoginAt)}</p>
          </div>
        </div>
        {!isMe && person.isActive && (
          <button onClick={() => act('view', () => setViewAs(person.id))} disabled={Boolean(busy)} className={btnSecondary} title="See TrackstarOS as they see it, read-only"><Eye className="w-3.5 h-3.5" /> View as {person.firstName}</button>
        )}
      </div>

      {inviteUrl && <InviteLink url={inviteUrl} onDismiss={() => setInviteUrl('')} />}

      <Section title="Access" blurb="Their level, the permission sets they hold, and anything added or taken away just for them.">
        <AccessEditor key={person.id + person.roles.join() + (person.extraCaps || []).join() + (person.deniedCaps || []).join()} person={person} roles={roles} onSaved={p => { setPerson(p); onChanged() }} />
      </Section>

      <Section title="Work" blurb="Where new orders and conversations land on them. Change it from the queue's side.">
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-[11px] text-off-black/50">New orders</dt>
            <dd className="text-off-black">
              {!assign ? <Loader2 className="w-3 h-3 animate-spin text-off-black/40" /> : regularFor.length || shifts.length || races.length ? (
                <ul className="space-y-0.5">
                  {regularFor.map(t => <li key={t}>Regular for {t.toLowerCase()}</li>)}
                  {shifts.map(s => <li key={s.id}>Helping on {(TYPE_LABEL[s.type] || s.type).toLowerCase()} until {s.until} ({SHARE[String(s.weight)] || `${s.weight}x`})</li>)}
                  {races.length > 0 && <li>Races: {races.join(', ')}</li>}
                </ul>
              ) : <span className="text-off-black/45">None by default</span>}
              <Link to="/settings/assignments" className="block text-[11px] text-blue-600 hover:underline mt-1">Order Assignment</Link>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-off-black/50">New conversations</dt>
            <dd className="text-off-black">
              {!routing ? <Loader2 className="w-3 h-3 animate-spin text-off-black/40" /> : channels.length ? <ul className="space-y-0.5">{channels.map(c => <li key={c}>{c}</li>)}</ul> : <span className="text-off-black/45">None by default</span>}
              <Link to="/support" className="block text-[11px] text-blue-600 hover:underline mt-1">Support › Settings › Routing</Link>
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Pay" blurb="Hourly for approved timesheets; per design for a designer. Payouts read these.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RateField label="Hourly rate" hint="per approved hour" value={person.hourlyRateCents} placeholder="not hourly" busy={busy === 'hourly'}
            onSave={cents => act('hourly', () => postJson('/api/finance/payouts', { action: 'set_hourly_rate', userId: person.id, cents }), 'Hourly rate saved')} />
          {isDesigner && <>
            <RateField label="New custom design" hint="per first design of a race" value={person.customRateCents} placeholder="level default" busy={busy === 'custom'}
              onSave={cents => act('custom', () => postJson('/api/admin/custom-counter', { action: 'rates', userId: person.id, newCents: cents, repeatCents: person.customRepeatRateCents }), 'Design rate saved')} />
            <RateField label="Repeat design" hint="per design of a race done before" value={person.customRepeatRateCents} placeholder="level default" busy={busy === 'repeat'}
              onSave={cents => act('repeat', () => postJson('/api/admin/custom-counter', { action: 'rates', userId: person.id, newCents: person.customRateCents, repeatCents: cents }), 'Repeat rate saved')} />
          </>}
        </div>
        {!isDesigner && <p className="text-[11px] text-off-black/45 mt-2">Per-design rates appear when they hold a designer set.</p>}
      </Section>

      <Section title="API keys" blurb="Keys that act as them. Each can do no more than they can.">
        {!keys ? <Loader2 className="w-3 h-3 animate-spin text-off-black/40" /> : myKeys.length === 0 ? <p className="text-sm text-off-black/45">No keys.</p> : (
          <ul className="divide-y divide-border-gray">
            {myKeys.map(k => (
              <li key={k.id} className="py-2 flex items-center gap-3 text-sm">
                <KeyRound className="w-3.5 h-3.5 text-off-black/40 shrink-0" />
                <span className="min-w-0 flex-1"><span className="font-medium text-off-black">{k.name}</span> <span className="font-mono text-[10px] text-off-black/40">{k.prefix}…</span><span className="block text-[11px] text-off-black/50">{k.scopes.join(', ')} · used {ago(k.lastUsedAt).toLowerCase()}</span></span>
                <button onClick={() => { if (!arm(`key:${k.id}`)) return; act(`key:${k.id}`, () => postJson('/api/admin/api-keys', { id: k.id }, 'DELETE'), `Revoked "${k.name}"`) }} disabled={Boolean(busy)} className={`${btnGhost} ${isArmed(`key:${k.id}`) ? 'text-red-600' : ''}`}>{isArmed(`key:${k.id}`) ? 'Click again to revoke' : 'Revoke'}</button>
              </li>
            ))}
          </ul>
        )}
        <Link to="/settings/apikeys" className="block text-[11px] text-blue-600 hover:underline mt-2">New key</Link>
      </Section>

      <Section title="Security">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
          <div><dt className="text-[11px] text-off-black/50">Status</dt><dd><StatusChip status={person.status} /></dd></div>
          <div><dt className="text-[11px] text-off-black/50">Last signed in</dt><dd className="text-off-black">{ago(person.lastLoginAt)}</dd></div>
          <div><dt className="text-[11px] text-off-black/50">Last seen</dt><dd className="text-off-black">{ago(person.lastSeenAt)}</dd></div>
          <div><dt className="text-[11px] text-off-black/50">Added</dt><dd className="text-off-black">{new Date(person.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</dd></div>
        </dl>
        {person.status === 'invited' && <p className="text-xs text-amber-800 mb-3">Invite {person.inviteExpiresAt && new Date(person.inviteExpiresAt) < new Date() ? 'expired. Send a fresh link below.' : 'not accepted yet.'}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {person.isActive && <button onClick={() => act('reset', async () => { const d = await users({ action: 'reset' }); if (d.inviteUrl) setInviteUrl(d.inviteUrl) }, person.hasPassword ? 'Reset link ready' : 'Fresh invite ready')} disabled={Boolean(busy)} className={btnSecondary}>{person.hasPassword ? 'Reset password' : 'New invite link'}</button>}
          {person.isActive && !isMe && <button onClick={() => act('signout', () => users({ action: 'sign-out' }), `Signed ${person.firstName} out everywhere`)} disabled={Boolean(busy)} className={btnSecondary}>Sign out everywhere</button>}
          {!isMe && <button onClick={() => act('active', () => users({ action: 'active', isActive: !person.isActive }), `${person.isActive ? 'Deactivated' : 'Reactivated'} ${person.firstName}`)} disabled={Boolean(busy)} className={btnSecondary}>{person.isActive ? 'Deactivate' : 'Reactivate'}</button>}
          {!isMe && <button onClick={() => { if (!arm('delete')) return; act('delete', async () => { await postJson('/api/admin/users', { id: person.id }, 'DELETE'); onBack() }, `Deleted ${person.email}`) }} disabled={Boolean(busy)} className={btnDanger} title="Comments and edit history stay, attributed to their name">{isArmed('delete') ? 'Click again to delete' : 'Delete'}</button>}
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-off-black/40" />}
        </div>
      </Section>
    </div>
  )
}

function RateField({ label, hint, value, placeholder, busy, onSave }: { label: string; hint: string; value: number | null; placeholder: string; busy: boolean; onSave: (cents: number | null) => void }) {
  const [text, setText] = useState(dollars(value))
  useEffect(() => { setText(dollars(value)) }, [value])
  const changed = text !== dollars(value)
  return (
    <div>
      <p className="text-[11px] text-off-black/50">{label}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className="text-off-black/40">$</span>
        <input value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} inputMode="decimal" className={`${inputBase} w-24 py-1`} />
        {changed && <button onClick={() => { const c = toCents(text); if (text.trim() && c == null) { toast.error('Dollars, like 25 or 25.50'); return } onSave(c) }} disabled={busy} className={`${btnPrimary} py-1`}>{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}</button>}
      </div>
      <p className="text-[10px] text-off-black/40 mt-0.5">{hint}</p>
    </div>
  )
}
