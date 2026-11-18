import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi, type AutoReply } from '@/lib/supportApi'

/**
 * The automatic "we got your message" (server/domain/support/autoReply.js):
 * goes to the first email of each new conversation, a few minutes after it
 * comes in, so the customer knows a person will answer. It never counts as
 * an answer: the conversation stays Open and Claude still drafts. Admins
 * switch it on and write it; [First name] becomes the customer's first name.
 */
export default function AutoReplyCard({ isAdmin }: { isAdmin: boolean }) {
  const [saved, setSaved] = useState<AutoReply | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supportApi.settings().then(r => { if (r.autoReply) { setSaved(r.autoReply); setText(r.autoReply.text) } }).catch(() => {})
  }, [])
  const save = async (next: AutoReply, msg: string) => {
    setBusy(true)
    try { const r = await supportApi.saveAutoReply(next); setSaved(r.autoReply); setText(r.autoReply.text); toast.success(msg) }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }
  if (!saved) return null
  return (
    <div className="border-b border-border-gray px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-off-black">Auto-reply</span>
        <label className={`inline-flex items-center gap-1.5 text-xs ${isAdmin ? 'cursor-pointer' : 'opacity-70'}`}>
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          <input type="checkbox" checked={saved.enabled} disabled={!isAdmin || busy}
            onChange={e => save({ enabled: e.target.checked, text: saved.text }, e.target.checked ? 'Auto-reply is on' : 'Auto-reply is off')} className="accent-[#4600D6]" />
          {saved.enabled ? 'On' : 'Off'}
        </label>
      </div>
      <p className="text-[11px] text-off-black/50">Goes to the first email of each new conversation, within a few minutes, at most once a day per customer. Never to vendors, no-reply addresses, out-of-office replies or old mail. It doesn't count as an answer: the conversation stays Open and Claude still drafts. [First name] becomes their first name.</p>
      <textarea value={text} onChange={e => setText(e.target.value)} readOnly={!isAdmin} rows={7}
        className="w-full px-2.5 py-2 text-xs leading-relaxed bg-white border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20" />
      {isAdmin && (
        <div className="flex justify-end">
          <button disabled={busy || text.trim() === saved.text} onClick={() => save({ enabled: saved.enabled, text }, 'Auto-reply saved')}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-dark-fill text-white hover:bg-off-black/85 disabled:opacity-50">Save</button>
        </div>
      )}
    </div>
  )
}
