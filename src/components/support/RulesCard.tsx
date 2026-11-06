import { useEffect, useState } from 'react'
import { GraduationCap, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi, type TeachRule } from '@/lib/supportApi'
import { useAuth } from '@/lib/auth'
import { useArmed } from '@/lib/useArmed'

/**
 * Rules for Claude: anyone on Support writes a rule here and every draft
 * after it follows it. They are the playbook's "Lessons from the team", the
 * same lines "Teach Claude" on a draft adds, and they win over anything else
 * in the playbook that disagrees. You remove your own; an admin removes any.
 */
export default function RulesCard({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useAuth()
  const [rules, setRules] = useState<TeachRule[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const { arm, isArmed } = useArmed()
  useEffect(() => { supportApi.rules().then(r => setRules(r.rules)).catch(() => setRules([])) }, [])

  const add = async () => {
    setBusy(true)
    try { setRules((await supportApi.addRule(text)).rules); setText(''); toast.success('Rule added. The next draft follows it.') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const remove = async (r: TeachRule) => {
    if (!arm(r.line)) return
    setBusy(true)
    try { setRules((await supportApi.removeRule(r.line)).rules); toast.success('Rule removed') }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const mine = (r: TeachRule) => isAdmin || (r.author && r.author === user?.firstName)

  return (
    <div className="border-b border-border-gray px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-off-black inline-flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" />Rules for Claude</span>
        {rules && <span className="text-[11px] text-off-black/45">{rules.length} rule{rules.length === 1 ? '' : 's'}</span>}
      </div>
      <p className="text-[11px] text-off-black/50">Tell Claude how to handle a kind of message. Every draft follows these, and they win over the rest of the playbook. Write it for every customer, not one: "When someone asks for a rush, offer expedited shipping before anything else."</p>
      <div className="flex items-start gap-2">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} maxLength={400} placeholder="When a customer…"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() && !busy) { e.preventDefault(); void add() } }}
          className="flex-1 px-2.5 py-2 text-base sm:text-xs bg-white border border-border-gray rounded resize-y focus:outline-none focus:ring-1 focus:ring-[#4600D6]/30" />
        <button onClick={() => void add()} disabled={busy || text.trim().length < 8} className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded bg-[#4600D6] text-white disabled:opacity-50">
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}Add rule
        </button>
      </div>
      {rules === null
        ? <div className="text-[11px] text-off-black/40 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Loading rules</div>
        : rules.length === 0
          ? <div className="text-[11px] text-off-black/40">No rules yet.</div>
          : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {rules.map(r => (
                <li key={r.line} className="group flex items-start gap-2 text-xs text-off-black/80 py-1">
                  <span className="flex-1">{r.text}{(r.author || r.date) && <span className="text-off-black/40"> · {[r.author, r.date].filter(Boolean).join(', ')}</span>}</span>
                  {mine(r) && (
                    <button onClick={() => void remove(r)} disabled={busy} title="Remove this rule"
                      className={`shrink-0 inline-flex items-center gap-1 text-[11px] ${isArmed(r.line) ? 'text-red-600' : 'text-off-black/35 hover:text-off-black'}`}>
                      {isArmed(r.line) ? 'Click again to remove' : <X className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}
