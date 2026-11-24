import { Copy, CornerUpLeft } from 'lucide-react'
import { toast } from 'sonner'
import { modalCancel, modalPrimary } from '@/lib/ui'
import { bodyOnly } from './reply'

/** A reply ready to send: into the open conversation's composer, or copied. */
export default function ReplyCard({ text, onUse }: { text: string; onUse?: (body: string) => void }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast.success('Copied') } catch { toast.error('Could not copy. Select the text instead.') }
  }
  return (
    <div>
      <div className="rounded-2xl bg-off-black/[0.035] px-5 py-4 text-[15px] leading-relaxed text-off-black whitespace-pre-wrap break-words">{text}</div>
      <div className="mt-3 flex items-center gap-1">
        {onUse && <button onClick={() => onUse(bodyOnly(text))} className={modalPrimary}><CornerUpLeft className="w-4 h-4" />Use this reply</button>}
        <button onClick={copy} className={onUse ? modalCancel : modalPrimary}><Copy className="w-4 h-4" />Copy</button>
      </div>
    </div>
  )
}
