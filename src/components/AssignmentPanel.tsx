import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check, Plus, X, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnPrimary, btnSecondary, btnGhost, inputBase, fieldLabel, segment, segmentGroup } from '@/lib/ui'

/**
 * Who new orders go to. Admin only: this decides where every future order
 * lands.
 *
 * Each type has a regular person. For a busy stretch, add help: a teammate,
 * the days, and their share. While a shift is on, each new order goes to
 * whoever is furthest below their share of the open queue; when it ends the
 * helper's unfinished orders go back to the regular. "Spread the order list" hands
 * a helper their share of what is already waiting. Server side:
 * server/domain/orders/assignment.js.
 */
type User = { id: string; firstName: string; lastName: string }
type OrderType = 'standard' | 'custom' | 'race_partner' | 'bulk'
type Shift = { id: string; type: OrderType; userId: string; weight: number; from: string; until: string; handedBackAt?: string }

// Help shifts are for the two queues; partners and bulk runs are projects
// with one owner each, so they only have a regular.
const TYPES: { key: OrderType; label: string; blurb: string; help: boolean }[] = [
  { key: 'standard', label: 'Standard orders', blurb: 'Personalized prints from the storefront and Etsy', help: true },
  { key: 'custom', label: 'Custom orders', blurb: 'Any-race and triathlon custom designs', help: true },
  { key: 'race_partner', label: 'Partner orders', blurb: 'Race partner design projects', help: false },
  { key: 'bulk', label: 'Bulk orders', blurb: 'Prepaid co-branded runs for a race', help: false },
]
const SHARES: { weight: number; label: string }[] = [
  { weight: 0.5, label: 'Half' },
  { weight: 1, label: 'Even' },
  { weight: 2, label: 'Double' },
]
const shareWord = (w: number) => SHARES.find(s => s.weight === w)?.label.toLowerCase() || `${w}x`

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function fmt(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function AssignmentPanel() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [shifts, setShifts] = useState<Shift[]>([])
  const [open, setOpen] = useState<Partial<Record<OrderType, Record<string, number>>>>({})
  const [today, setToday] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState<OrderType | null>(null)
  const [raceRules, setRaceRules] = useState<{ race: string; userId: string }[]>([])
  const [raceOptions, setRaceOptions] = useState<{ race: string; open: number }[]>([])

  const load = useCallback(async () => {
    try {
      const d = await apiFetch('/api/orders/assign').then(r => r.json())
      setUsers(d.users || [])
      setDraft(d.defaults || {})
      setSaved(d.defaults || {})
      setShifts(d.shifts || [])
      setOpen(d.open || {})
      setToday(d.today || new Date().toISOString().slice(0, 10))
      setRaceRules(d.raceRules || [])
      setRaceOptions(d.raceOptions || [])
    } catch {
      toast.error('Could not load the team.')
    }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    try {
      const res = await apiFetch('/api/orders/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not save')
      // The dashboard behind Settings reloads its order list and Current Team.
      window.dispatchEvent(new Event('trackstar:orders-changed'))
      return d
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
      return null
    } finally {
      setBusy(null)
    }
  }

  const dirty = TYPES.some(t => (draft[t.key] || '') !== (saved[t.key] || ''))
  const saveRegulars = async () => {
    const d = await post('regulars', { action: 'defaults', ...draft })
    if (d) { setSaved(d.defaults); setDraft(d.defaults); toast.success('Saved. New orders go to these people from now on.') }
  }

  if (!users) return <div className="flex justify-center py-10 text-off-black/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
  const name = (id: string) => users.find(u => u.id === id)?.firstName || 'Someone'

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-off-black/60">
        Every new order goes to one person when it comes in. For a busy stretch, add help: they share new orders with the regular for the days you pick, and anything they have not finished goes back to the regular when it ends.
      </p>

      {TYPES.map(t => {
        const regular = saved[t.key] || ''
        const mine = shifts.filter(s => s.type === t.key && !s.handedBackAt && s.until >= today)
          .sort((a, b) => a.from.localeCompare(b.from))
        const onNow = mine.filter(s => s.from <= today)
        const roster = [
          ...(regular ? [{ userId: regular, weight: 1 }] : []),
          ...onNow.filter(s => s.userId !== regular).map(s => ({ userId: s.userId, weight: s.weight })),
        ]
        const weightSum = roster.reduce((a, r) => a + r.weight, 0)
        return (
          <div key={t.key} className="border border-border-gray rounded-lg">
            <div className="flex items-center justify-between gap-4 p-3">
              <div>
                <div className="text-sm font-semibold text-off-black">{t.label}</div>
                <div className="text-xs text-off-black/50">{t.blurb}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-off-black/45">Regular</span>
                <select value={draft[t.key] || ''} onChange={e => setDraft(d => ({ ...d, [t.key]: e.target.value }))} className={`${inputBase} w-44`}>
                  <option value="">Nobody</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                </select>
              </div>
            </div>

            {t.help && <div className="border-t border-border-gray px-3 py-2.5 space-y-2 bg-subtle-gray/50">
              {roster.length > 1 && (
                <div className="text-xs text-off-black/60">
                  Today new orders split{' '}
                  {roster.map((r, i) => (
                    <span key={r.userId}>
                      {i > 0 && ' · '}
                      <span className="font-medium text-off-black">{name(r.userId)} {Math.round((r.weight / weightSum) * 100)}%</span>
                      <span className="text-off-black/40"> ({open[t.key]?.[r.userId] || 0} open)</span>
                    </span>
                  ))}
                </div>
              )}

              {mine.map(s => {
                const on = s.from <= today
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 bg-white border border-border-gray rounded-md px-3 py-2">
                    <div className="text-xs">
                      <span className="font-medium text-off-black">{name(s.userId)}</span>
                      <span className="text-off-black/55"> · {shareWord(s.weight)} share · {fmt(s.from)} to {fmt(s.until)}</span>
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${on ? 'bg-green-50 text-green-700' : 'bg-off-black/5 text-off-black/50'}`}>
                        {on ? 'On now' : `Starts ${fmt(s.from)}`}
                      </span>
                      {on && <span className="text-off-black/40"> · {open[t.key]?.[s.userId] || 0} open</span>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {on && (
                        <button
                          className={btnSecondary}
                          disabled={busy === `spread-${s.id}`}
                          title="Move unstarted orders from the order list to them, up to their share"
                          onClick={async () => {
                            const d = await post(`spread-${s.id}`, { action: 'spread', id: s.id })
                            if (d) { toast.success(d.moved ? `Spread oldest first: ${d.moved} order${d.moved === 1 ? '' : 's'} changed hands` : 'Already spread oldest first'); load() }
                          }}
                        >
                          {busy === `spread-${s.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shuffle className="w-3 h-3" />} Spread the order list
                        </button>
                      )}
                      <button
                        className={btnGhost}
                        disabled={busy === `end-${s.id}`}
                        title={on ? 'End now: their unfinished orders go back to the regular' : 'Cancel this shift'}
                        onClick={async () => {
                          const d = await post(`end-${s.id}`, { action: 'end-shift', id: s.id })
                          if (d) { toast.success(on ? `Ended. ${d.handedBack} unfinished order${d.handedBack === 1 ? '' : 's'} back to ${name(regular)}` : 'Shift canceled'); load() }
                        }}
                      >
                        <X className="w-3 h-3" /> {on ? 'End' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                )
              })}

              {adding === t.key ? (
                <AddHelp
                  users={users.filter(u => u.id !== regular)}
                  today={today}
                  busy={busy === `add-${t.key}`}
                  onCancel={() => setAdding(null)}
                  onAdd={async (v) => {
                    const d = await post(`add-${t.key}`, { action: 'add-shift', type: t.key, ...v })
                    if (d) {
                      setAdding(null)
                      await load()
                      toast.success(d.shift.from <= today
                        ? `${name(v.userId)} is on. Use Spread the order list to give them some of what is waiting.`
                        : `${name(v.userId)} starts ${fmt(d.shift.from)}`)
                    }
                  }}
                />
              ) : (
                <button className={btnGhost} onClick={() => setAdding(t.key)} disabled={!regular}>
                  <Plus className="w-3 h-3" /> Add help
                </button>
              )}
            </div>}

            <MoveOpen
              users={users}
              busy={busy}
              onMove={async (fromUserId, toUserId) => {
                const d = await post(`move-${t.key}`, { action: 'move-open', type: t.key, fromUserId, toUserId })
                if (d) { toast.success(d.moved ? `Moved ${d.moved} open order${d.moved === 1 ? '' : 's'} to ${name(toUserId)}` : 'They had no open orders'); load() }
              }}
            />

            {t.key === 'standard' && (
              <RaceRouting
                users={users}
                rules={raceRules}
                options={raceOptions}
                busy={busy}
                onSave={async (rules) => {
                  const d = await post('race-rules', { action: 'race-rules', rules })
                  if (d) { setRaceRules(d.raceRules); toast.success('Saved. New orders for these races go straight to their person.') }
                  return !!d
                }}
                onApply={async (race) => {
                  const d = await post(`apply-${race}`, { action: 'apply-race-rule', race })
                  if (d) { toast.success(d.moved ? `Moved ${d.moved} open ${race} order${d.moved === 1 ? '' : 's'}` : `Every open ${race} order is already theirs`); load() }
                }}
              />
            )}
          </div>
        )
      })}

      <div className="flex items-center gap-3">
        <button onClick={saveRegulars} disabled={!dirty || busy === 'regulars'} className={btnPrimary}>
          {busy === 'regulars' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save regulars
        </button>
        <span className="text-xs text-off-black/45">Help is saved as you add it. Someone new? Invite them from People first.</span>
      </div>
    </div>
  )
}

function AddHelp({ users, today, busy, onAdd, onCancel }: {
  users: User[]
  today: string
  busy: boolean
  onAdd: (v: { userId: string; weight: number; from: string; until: string }) => void
  onCancel: () => void
}) {
  const [userId, setUserId] = useState(users[0]?.id || '')
  const [weight, setWeight] = useState(1)
  const [from, setFrom] = useState(today)
  const [until, setUntil] = useState(addDays(today, 6))
  const days = Math.round((new Date(until).getTime() - new Date(from).getTime()) / 86400000) + 1

  return (
    <div className="bg-white border border-border-gray rounded-md p-3 space-y-3">
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className={fieldLabel}>Who</label>
          <select value={userId} onChange={e => setUserId(e.target.value)} className={`${inputBase} w-full`}>
            {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        </div>
        <div>
          <label className={fieldLabel}>Their share</label>
          <div className={segmentGroup}>
            {SHARES.map(s => <button key={s.weight} type="button" onClick={() => setWeight(s.weight)} className={segment(weight === s.weight)}>{s.label}</button>)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={fieldLabel}>First day</label>
          <input type="date" value={from} min={today} onChange={e => { setFrom(e.target.value); if (until < e.target.value) setUntil(e.target.value) }} className={inputBase} />
        </div>
        <div>
          <label className={fieldLabel}>Last day</label>
          <input type="date" value={until} min={from} onChange={e => setUntil(e.target.value)} className={inputBase} />
        </div>
        <div className="flex gap-1 pb-0.5">
          {[3, 7, 14].map(n => (
            <button key={n} type="button" onClick={() => setUntil(addDays(from, n - 1))} className={segment(days === n)}>
              {n === 7 ? '1 week' : n === 14 ? '2 weeks' : `${n} days`}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-off-black/45">
        {weight === 1 ? 'They and the regular each get about half of new orders' : weight === 2 ? 'They get about two of every three new orders' : 'They get about one of every three new orders'}, balanced against what each has open, for {days} day{days === 1 ? '' : 's'}.
      </p>
      <div className="flex items-center gap-2">
        <button className={btnPrimary} disabled={!userId || busy} onClick={() => onAdd({ userId, weight, from, until })}>
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add help
        </button>
        <button className={btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
      {!users.length && <p className="text-xs text-amber-700">Nobody else is on the team yet. Invite them from People first.</p>}
    </div>
  )
}

/**
 * Standard orders only: every order for a race goes to one person, ahead of
 * the regular and any help. "Move open orders" hands them what is already
 * waiting for that race.
 */
/** Hand all of one person's open orders to someone else, in one go. */
function MoveOpen({ users, busy, onMove }: { users: User[]; busy: string | null; onMove: (fromUserId: string, toUserId: string) => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const label = (u: User) => `${u.firstName} ${u.lastName}`.trim()
  return (
    <div className="border-t border-border-gray px-3 py-2.5 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-semibold text-off-black mr-1">Move open orders</span>
      <select value={from} onChange={e => setFrom(e.target.value)} className={`${inputBase} w-auto`}>
        <option value="">From…</option>
        {users.map(u => <option key={u.id} value={u.id}>{label(u)}</option>)}
      </select>
      <span className="text-off-black/40">to</span>
      <select value={to} onChange={e => setTo(e.target.value)} className={`${inputBase} w-auto`}>
        <option value="">To…</option>
        {users.filter(u => u.id !== from).map(u => <option key={u.id} value={u.id}>{label(u)}</option>)}
      </select>
      <button className={btnSecondary} disabled={!from || !to || from === to || !!busy} onClick={() => { onMove(from, to); setFrom(''); setTo('') }}>
        <Shuffle className="w-3 h-3" /> Move
      </button>
    </div>
  )
}

function RaceRouting({ users, rules, options, busy, onSave, onApply }: {
  users: User[]
  rules: { race: string; userId: string }[]
  options: { race: string; open: number }[]
  busy: string | null
  onSave: (rules: { race: string; userId: string }[]) => Promise<boolean>
  onApply: (race: string) => void
}) {
  const [race, setRace] = useState('')
  const [userId, setUserId] = useState(users[0]?.id || '')
  const name = (id: string) => { const u = users.find(x => x.id === id); return u ? `${u.firstName} ${u.lastName}` : 'Someone (inactive)' }
  const openFor = (r: string) => options.find(o => o.race.toLowerCase() === r.toLowerCase())?.open || 0
  const taken = new Set(rules.map(r => r.race.toLowerCase()))

  return (
    <div className="border-t border-border-gray px-3 py-2.5 space-y-2">
      <div className="text-xs font-semibold text-off-black">Route races to a person</div>
      <p className="text-[11px] text-off-black/50">Every order for the race goes to them, ahead of the regular and any help. Everything else is split as above.</p>
      {rules.map(r => (
        <div key={r.race} className="flex items-center justify-between gap-3 bg-white border border-border-gray rounded-md px-3 py-2">
          <div className="text-xs">
            <span className="font-medium text-off-black">{r.race}</span>
            <span className="text-off-black/55"> → {name(r.userId)}</span>
            <span className="text-off-black/40"> · {openFor(r.race)} open</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button className={btnSecondary} disabled={busy === `apply-${r.race}`} onClick={() => onApply(r.race)} title="Give them every open order for this race">
              {busy === `apply-${r.race}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shuffle className="w-3 h-3" />} Move open orders
            </button>
            <button className={btnGhost} onClick={() => onSave(rules.filter(x => x.race !== r.race))}><X className="w-3 h-3" /> Remove</button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input list="race-route-options" value={race} onChange={e => setRace(e.target.value)} placeholder="Race, e.g. Chicago Marathon" className={`${inputBase} flex-1 min-w-[12rem]`} />
        <datalist id="race-route-options">
          {options.filter(o => !taken.has(o.race.toLowerCase())).map(o => <option key={o.race} value={o.race}>{o.open} open</option>)}
        </datalist>
        <select value={userId} onChange={e => setUserId(e.target.value)} className={`${inputBase} w-40`}>
          {users.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
        </select>
        <button
          className={btnSecondary}
          disabled={!race.trim() || !userId || busy === 'race-rules'}
          onClick={async () => { if (await onSave([...rules, { race: race.trim(), userId }])) setRace('') }}
        >
          <Plus className="w-3 h-3" /> Route
        </button>
      </div>
    </div>
  )
}
