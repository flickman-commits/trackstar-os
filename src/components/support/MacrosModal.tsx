import { useState } from 'react'
import { Loader2, MessageSquareText, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { fieldLabel, modalCancel, modalInput, modalPrimary } from '@/lib/ui'
import ActionModal from '@/components/ActionModal'
import { useArmed } from '@/lib/useArmed'
import { supportApi } from '@/lib/supportApi'
import { useAuth } from '@/lib/auth'
import type { Macro } from '@/types/support'

/**
 * Macros, managed: the saved replies the composer offers. Seeded from the
 * playbook; edited here. {{first_name}} and {{rep}} fill in on insert;
 * [brackets] are for the rep to fill. The greeting and sign-off are not
 * part of a macro, the composer adds them.
 *
 * Anyone on Support adds one; only its author or an admin changes or
 * deletes it (the server holds the same line). Names stay under 120
 * characters and bodies under 2,000.
 */
const TITLE_MAX = 120
const BODY_MAX = 2000

export default function MacrosModal({ macros, onChanged, onClose }: { macros: Macro[]; onChanged: () => void; onClose: () => void }) {
  const [editing, setEditing] = useState<Partial<Macro> | null>(null)
  const [saving, setSaving] = useState(false)
  const { user, isAdmin } = useAuth()
  const { arm, isArmed } = useArmed()
  // A new macro is yours; an existing one is its author's or an admin's.
  const canChange = !!editing && (!editing.id || isAdmin || (!!editing.createdBy && editing.createdBy.id === user?.id))

  const save = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await supportApi.saveMacro({ id: editing.id, name: editing.name || '', shortcut: editing.shortcut || undefined, body: editing.body || '' })
      toast.success(editing.id ? 'Macro saved' : 'Macro added')
      setEditing(null); onChanged()
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }
  const remove = async (m: Macro) => {
    if (!arm(`delete:${m.id}`)) return
    try { await supportApi.deleteMacro(m.id); toast.success('Macro deleted'); onChanged() }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <ActionModal icon={MessageSquareText} title="Macros" onClose={onClose} busy={saving} size="xl" bare
      description={<>Saved replies. Type / and the shortcut in a reply to drop one in. {'{{first_name}}'} and {'{{rep}}'} fill in; [brackets] are yours.</>}
      actions={<button onClick={() => setEditing({ name: '', body: '' })} className={modalPrimary}><Plus className="w-4 h-4" /> New macro</button>}>
        <div className="flex-1 min-h-0 flex">
          <div className={`${editing ? 'hidden md:block md:w-[300px]' : 'w-full'} shrink-0 overflow-y-auto border-r border-border-gray px-3 py-2`}>
            {macros.map(m => (
              <button key={m.id} onClick={() => setEditing(m)} className={`w-full text-left px-4 py-3 rounded-xl transition-colors hover:bg-off-black/[0.045] ${editing?.id === m.id ? 'bg-off-black/[0.045]' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-off-black truncate">{m.name}</span>
                  <span className="text-xs text-off-black/40 tabular-nums shrink-0">{m.uses ? `${m.uses}× ` : ''}{m.shortcut ? <span className="font-mono text-off-black/55">/{m.shortcut}</span> : null}</span>
                </div>
                {!editing && <div className="mt-0.5 text-sm text-off-black/60 truncate">{m.body.replace(/\s+/g, ' ')}</div>}
              </button>
            ))}
            {macros.length === 0 && <div className="px-4 py-8 text-sm text-off-black/50 text-center">No macros yet.</div>}
          </div>
          {editing && (
            <div className="flex-1 min-w-0 px-6 py-5 flex flex-col gap-4 overflow-y-auto text-sm">
              {!canChange && <div className="text-off-black/55">Only {editing.createdBy?.firstName || 'an admin'}{editing.createdBy ? ' or an admin' : ''} can change this one. You can still use it in a reply.</div>}
              <label className="block"><span className={fieldLabel}>Name</span>
                <input value={editing.name || ''} disabled={!canChange} maxLength={TITLE_MAX} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Order shipped" className={modalInput} autoFocus />
              </label>
              <label className="block"><span className={fieldLabel}>Shortcut</span>
                <div className="flex items-center gap-2">
                  <span className="text-off-black/50 font-mono">/</span>
                  <input value={editing.shortcut || ''} disabled={!canChange} onChange={e => setEditing({ ...editing, shortcut: e.target.value })} placeholder={editing.name ? editing.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-') : 'shortcut'} className={`${modalInput} font-mono`} />
                </div>
                <span className="mt-1 block text-xs text-off-black/45">Letters, digits, dashes. Blank uses the name.</span>
              </label>
              <label className="block"><span className={fieldLabel}>Reply</span>
                <textarea value={editing.body || ''} disabled={!canChange} maxLength={BODY_MAX} onChange={e => setEditing({ ...editing, body: e.target.value })} rows={12} placeholder="The reply, without the greeting or the sign-off." className={`${modalInput} resize-y leading-relaxed`} />
              </label>
              <div className="flex items-center gap-2">
                {editing.id && canChange && <button onClick={() => remove(editing as Macro)} className={`${modalCancel} !text-red-600`}><Trash2 className="w-4 h-4" /> {isArmed(`delete:${editing.id}`) ? 'Click again to delete' : 'Delete'}</button>}
                <span className="flex-1 text-right text-xs text-off-black/40 tabular-nums">{(editing.body || '').length.toLocaleString('en-US')} / {BODY_MAX.toLocaleString('en-US')}</span>
                <button onClick={() => setEditing(null)} className={modalCancel}>Cancel</button>
                <button onClick={save} disabled={saving || !canChange || !(editing.name || '').trim() || !(editing.body || '').trim()} className={modalPrimary}>{saving && <Loader2 className="w-4 h-4 animate-spin" />}Save</button>
              </div>
            </div>
          )}
        </div>
    </ActionModal>
  )
}
