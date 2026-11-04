import { Fragment, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { btnPrimary, btnSecondary, btnGhost } from '@/lib/ui'
import type { Capability, Role } from '@/lib/roles'
import { loadRoles, postJson, type RolesPayload } from './api'

/**
 * Settings > Team > Permission Sets: what each set includes, as one card per
 * set with who holds it. Admin is not a set, it is the level that has
 * everything. Changes save for every set at once, as before.
 */
export default function PermissionSets() {
  const [data, setData] = useState<RolesPayload | null>(null)
  const [draft, setDraft] = useState<Record<string, Capability[]> | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadRoles().then(d => { setData(d); setDraft(d.caps) }).catch(e => toast.error((e as Error).message)) }, [])
  if (!data || !draft) return <div className="flex items-center justify-center h-40 text-off-black/40"><Loader2 className="w-4 h-4 animate-spin" /></div>

  const sets = data.roles.filter(r => r.id !== 'admin')
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.caps)
  const toggle = (role: Role, cap: Capability) => {
    const has = (draft[role] || []).includes(cap)
    setDraft({ ...draft, [role]: has ? draft[role].filter(c => c !== cap) : [...(draft[role] || []), cap] })
  }
  const save = async () => {
    setSaving(true)
    try {
      const d = await postJson<{ caps: Record<string, Capability[]> }>('/api/admin/roles', { caps: draft }, 'PUT')
      setData({ ...data, caps: d.caps }); setDraft(d.caps)
      toast.success('Saved. Everyone gets it on their next page load.')
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }
  const groups = [...new Set(data.capabilities.map(c => c.group))]
  const admins = data.roles.find(r => r.id === 'admin')?.members || []

  return (
    <div className="space-y-4">
      <p className="text-xs text-off-black/55 max-w-2xl">
        A set is a bundle of permissions you give a person on their page in People; one person can hold several. Everyone sees Fulfillment.
        Admins ({admins.map(a => a.name).join(', ') || 'none'}) have everything and are not a set.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sets.map(r => (
          <div key={r.id} className="rounded-lg border border-border-gray bg-white">
            <div className="px-4 py-3 border-b border-border-gray flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-off-black">{r.label}</p>
                <p className="text-[11px] text-off-black/50">{r.members.length ? r.members.map(m => m.name).join(', ') : 'Nobody has this yet'}</p>
              </div>
              <span className="text-[11px] text-off-black/40 tabular-nums shrink-0">{(draft[r.id] || []).length} permissions</span>
            </div>
            <div className="px-4 py-2">
              {groups.map(g => (
                <Fragment key={g}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mt-2 mb-0.5">{g}</p>
                  {data.capabilities.filter(c => c.group === g).map(c => (
                    <label key={c.id} className="flex items-center gap-2 py-0.5 text-sm text-off-black cursor-pointer" title={c.blurb}>
                      <input type="checkbox" checked={(draft[r.id] || []).includes(c.id)} onChange={() => toggle(r.id, c.id)} className="accent-off-black" />
                      {c.label}
                    </label>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={() => setDraft(data.defaults)} className={btnGhost}>Reset to defaults</button>
        <button onClick={() => setDraft(data.caps)} disabled={!dirty} className={btnSecondary}>Discard</button>
        <button onClick={save} disabled={!dirty || saving} className={btnPrimary}>{saving && <Loader2 className="w-3 h-3 animate-spin" />} Save sets</button>
      </div>
    </div>
  )
}
