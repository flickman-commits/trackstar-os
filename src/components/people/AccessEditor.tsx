import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ShieldCheck } from 'lucide-react'
import { btnPrimary, btnSecondary, segment, segmentGroup } from '@/lib/ui'
import { ROLE_LABEL, type Capability, type Role } from '@/lib/roles'
import { postJson, type Person, type RolesPayload } from './api'

/**
 * What one person can do: their level (Admin or Member), the permission
 * sets they hold, and their own exceptions on top.
 *
 * The permission list shows the result. Each row says where it comes from:
 * a set, or added for this person; a row from a set can be switched off for
 * them alone, and one no set gives can be switched on. Saved together, in
 * one call, so a half-saved state cannot exist.
 */
export default function AccessEditor({ person, roles, onSaved }: { person: Person; roles: RolesPayload; onSaved: (p: Person) => void }) {
  const [picked, setPicked] = useState<Role[]>(person.roles)
  const [extra, setExtra] = useState<Capability[]>((person.extraCaps || []) as Capability[])
  const [denied, setDenied] = useState<Capability[]>((person.deniedCaps || []) as Capability[])
  const [saving, setSaving] = useState(false)

  const isAdmin = picked.includes('admin')
  const sets = roles.roles.filter(r => r.id !== 'admin')

  /** Which sets give each capability, with what is picked now. */
  const from = useMemo(() => {
    const m = new Map<Capability, Role[]>()
    for (const r of picked) for (const c of roles.caps[r] || []) m.set(c, [...(m.get(c) || []), r])
    return m
  }, [picked, roles.caps])

  const effective = (c: Capability) => (from.has(c) || extra.includes(c)) && !denied.includes(c)
  const flip = (c: Capability) => {
    if (from.has(c)) setDenied(d => d.includes(c) ? d.filter(x => x !== c) : [...d, c])
    else setExtra(e => e.includes(c) ? e.filter(x => x !== c) : [...e, c])
  }
  const toggleSet = (r: Role) => setPicked(p => {
    const next = p.includes(r) ? p.filter(x => x !== r) : [...p, r]
    return next.length ? next : p
  })
  const setLevel = (admin: boolean) => setPicked(p => {
    if (admin) return p.includes('admin') ? p : ['admin', ...p]
    const rest = p.filter(x => x !== 'admin')
    return rest.length ? rest : ['designer']
  })

  const dirty = JSON.stringify([...picked].sort()) !== JSON.stringify([...person.roles].sort())
    || JSON.stringify([...extra].sort()) !== JSON.stringify([...(person.extraCaps || [])].sort())
    || JSON.stringify([...denied].sort()) !== JSON.stringify([...(person.deniedCaps || [])].sort())

  const save = async () => {
    setSaving(true)
    try {
      const d = await postJson<{ user: Person }>('/api/admin/users', { action: 'access', id: person.id, roles: picked, extraCaps: extra, deniedCaps: denied })
      toast.success(`Saved ${person.firstName}'s access`)
      onSaved(d.user)
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  const groups = [...new Set(roles.capabilities.map(c => c.group))]

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-off-black/70 mb-1.5">Level</p>
        <div className={segmentGroup}>
          <button onClick={() => setLevel(false)} className={segment(!isAdmin, 'sm')}>Member</button>
          <button onClick={() => setLevel(true)} className={segment(isAdmin, 'sm')}>Admin</button>
        </div>
        <p className="text-[11px] text-off-black/45 mt-1.5">
          {isAdmin ? 'An admin can do everything, including Settings, Finance, Data and this page.' : 'A member sees Fulfillment and whatever their permission sets include.'}
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-off-black/70 mb-1.5">Permission sets</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {sets.map(r => {
            const on = picked.includes(r.id)
            return (
              <label key={r.id} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${on ? 'border-off-black/40 bg-white' : 'border-border-gray bg-subtle-gray/40 hover:bg-white'}`}>
                <input type="checkbox" checked={on} onChange={() => toggleSet(r.id)} className="mt-0.5 accent-off-black" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-off-black">{r.label}</span>
                  <span className="block text-[11px] text-off-black/50 leading-snug">{(roles.caps[r.id] || []).map(c => roles.capabilities.find(x => x.id === c)?.label || c).join(', ') || 'Nothing extra'}</span>
                </span>
              </label>
            )
          })}
        </div>
        {isAdmin && <p className="text-[11px] text-off-black/45 mt-1.5">Sets still matter for an admin: they say what their job is (a designer is paid per design, support routing needs the Support set).</p>}
      </div>

      {!isAdmin && (
        <div>
          <p className="text-xs font-medium text-off-black/70 mb-1.5">What {person.firstName} can do</p>
          <div className="rounded-lg border border-border-gray bg-white divide-y divide-border-gray">
            {groups.map(g => (
              <div key={g} className="px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mb-1">{g}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  {roles.capabilities.filter(c => c.group === g).map(c => {
                    const on = effective(c.id)
                    const srcSets = from.get(c.id) || []
                    const note = denied.includes(c.id) ? 'switched off for them' : srcSets.length ? `from ${srcSets.map(r => ROLE_LABEL[r]).join(', ')}` : extra.includes(c.id) ? 'added for them' : ''
                    return (
                      <label key={c.id} className="flex items-start gap-2 py-1 cursor-pointer" title={c.blurb}>
                        <input type="checkbox" checked={on} onChange={() => flip(c.id)} className="mt-0.5 accent-off-black" />
                        <span className="min-w-0">
                          <span className={`block text-sm ${on ? 'text-off-black' : 'text-off-black/60'}`}>{c.label}</span>
                          {note && <span className={`block text-[11px] ${denied.includes(c.id) ? 'text-rose-700' : extra.includes(c.id) ? 'text-emerald-700' : 'text-off-black/40'}`}>{note}</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {dirty && <button onClick={() => { setPicked(person.roles); setExtra((person.extraCaps || []) as Capability[]); setDenied((person.deniedCaps || []) as Capability[]) }} className={btnSecondary}>Discard</button>}
        <button onClick={save} disabled={!dirty || saving} className={btnPrimary}>{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} Save access</button>
      </div>
    </div>
  )
}
