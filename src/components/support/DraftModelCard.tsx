import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { supportApi } from '@/lib/supportApi'

type Option = { id: string; label: string; note: string }

/**
 * Which Claude model drafts replies (server/domain/support/draftModel.js).
 * A bigger model writes better replies and costs more; the note on each says
 * roughly what it runs a month at our volume. Admins change it.
 */
export default function DraftModelCard({ isAdmin }: { isAdmin: boolean }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [options, setOptions] = useState<Option[]>([])
  const [pinned, setPinned] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    supportApi.settings().then(r => { setCurrent(r.draftModel || null); setOptions(r.draftModels || []); setPinned(Boolean(r.draftModelPinned)) }).catch(() => {})
  }, [])
  const pick = async (id: string) => {
    if (id === current || busy) return
    setBusy(id)
    try { const r = await supportApi.saveDraftModel(id); setCurrent(r.draftModel); toast.success('New drafts use this model') }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(null) }
  }
  if (!current || !options.length) return null
  return (
    <div className="border-b border-border-gray px-4 py-3 space-y-2">
      <div className="text-[12px] font-semibold text-off-black">Drafting model</div>
      <p className="text-[11px] text-off-black/50">The Claude model that writes Claude's draft on each conversation. Costs are rough monthly totals at our volume.</p>
      {pinned && <p className="text-[11px] text-amber-700">SUPPORT_LLM_MODEL is set on the server, so drafts use {current} whatever is picked here.</p>}
      <div className="space-y-1.5">
        {options.map(o => (
          <label key={o.id} className={`flex items-start gap-2 rounded-md border px-2.5 py-2 ${o.id === current ? 'border-[#4600D6]/40 bg-[#4600D6]/[0.04]' : 'border-border-gray bg-white'} ${isAdmin && !pinned ? 'cursor-pointer' : 'opacity-70'}`}>
            <input type="radio" name="draft-model" checked={o.id === current} disabled={!isAdmin || pinned || busy !== null} onChange={() => pick(o.id)} className="mt-0.5 accent-[#4600D6]" />
            <span className="min-w-0">
              <span className="text-xs font-medium text-off-black inline-flex items-center gap-1.5">{o.label}{busy === o.id && <Loader2 className="w-3 h-3 animate-spin" />}</span>
              <span className="block text-[11px] text-off-black/50">{o.note}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
