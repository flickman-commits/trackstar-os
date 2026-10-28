import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { fieldLabel, modalCancel, modalInput, modalPrimary } from '@/lib/ui'
import ActionModal from '@/components/ActionModal'
import { sendFeatureRequest } from '@/components/FeatureRequestsPanel'

/** Request feature, from Support: one line and an optional why, into Settings > Feature Requests. */
export default function RequestFeatureModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setBusy(true)
    try {
      await sendFeatureRequest(title, detail, 'support')
      toast.success('Sent. It is on the Feature Requests list in Settings.')
      onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <ActionModal icon={Lightbulb} title="Request a feature" onClose={onClose} busy={busy}
      description={<>Something that would make the work faster or easier. It goes on the list in <Link to="/settings/features" className="underline" onClick={onClose}>Settings &gt; Feature Requests</Link>.</>}
      footer={<>
        <button className={modalCancel} onClick={onClose} disabled={busy}>Cancel</button>
        <button className={modalPrimary} onClick={send} disabled={busy || !title.trim()}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Send request</button>
      </>}>
      <label className="block"><span className={fieldLabel}>What would you like built?</span>
        <input value={title} onChange={e => setTitle(e.target.value)} className={modalInput} autoFocus
          onKeyDown={e => { if (e.key === 'Enter' && title.trim() && !busy) send() }} />
      </label>
      <label className="block"><span className={fieldLabel}>Why it would help, or an example (optional)</span>
        <textarea value={detail} onChange={e => setDetail(e.target.value)} rows={4} className={`${modalInput} resize-none`} />
      </label>
    </ActionModal>
  )
}
