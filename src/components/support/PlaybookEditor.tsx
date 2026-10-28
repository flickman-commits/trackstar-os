import { useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi } from '@/lib/supportApi'
import { useArmed } from '@/lib/useArmed'

/**
 * What Claude drafts from: the playbook, in plain text. Admins edit it
 * here; a change applies to the next draft, no deploy. Reset goes back to
 * the version condensed from the Notion page.
 */
export default function PlaybookEditor({ isAdmin }: { isAdmin: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const { arm, isArmed } = useArmed()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    supportApi.settings().then(r => { if (r.playbook) { setText(r.playbook.text); setSaved(r.playbook.text); setEdited(r.playbook.edited) } }).catch(() => {})
  }, [])
  const run = async (fn: () => Promise<{ playbook: { text: string; edited: boolean } }>, msg: string) => {
    setBusy(true)
    try { const r = await fn(); setText(r.playbook.text); setSaved(r.playbook.text); setEdited(r.playbook.edited); toast.success(msg) }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  if (text === null) return null
  return (
    <div className="border-b border-border-gray px-4 py-3 space-y-2">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between text-left">
        <span className="text-[12px] font-semibold text-off-black">Drafting playbook</span>
        <span className="text-[11px] text-off-black/45">{edited ? 'Edited' : 'From Notion, Oct 17'} · {open ? 'Hide' : 'Show'}</span>
      </button>
      <p className="text-[11px] text-off-black/50">What Claude follows when it drafts a reply: voice, facts, policy, when to flag Matt. The macros are its phrasing examples.</p>
      {open && (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} readOnly={!isAdmin} rows={16}
            className="w-full px-2.5 py-2 text-xs font-mono leading-relaxed bg-white border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
          {isAdmin && (
            <div className="flex items-center gap-2">
              {edited && <button disabled={busy} onClick={() => { if (arm('reset')) run(() => supportApi.resetPlaybook(), 'Playbook reset') }} className={`inline-flex items-center gap-1 text-xs ${isArmed('reset') ? 'text-red-600' : 'text-off-black/50 hover:text-off-black'}`}><RotateCcw className="w-3 h-3" />{isArmed('reset') ? 'Click again to go back to the Notion version' : 'Reset'}</button>}
              <span className="flex-1" />
              <button disabled={busy || text === saved} onClick={() => run(() => supportApi.savePlaybook(text), 'Playbook saved; the next draft uses it')} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-dark-fill text-white hover:bg-off-black/85 disabled:opacity-50">{busy && <Loader2 className="w-3 h-3 animate-spin" />}Save</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
