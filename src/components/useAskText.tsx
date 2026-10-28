import { useCallback, useState } from 'react'
import ActionModal from '@/components/ActionModal'
import { fieldLabel, modalCancel, modalInput, modalPrimary } from '@/lib/ui'

type Ask = {
  title: string
  /** Grey, under the title: why we are asking. */
  description?: string
  label: string
  placeholder?: string
  /** The button that answers. */
  action?: string
  /** Several lines (a reason) rather than one (a link). */
  multiline?: boolean
  /** Whether the answer can be sent; by default, anything not blank. */
  valid?: (value: string) => boolean
}

/**
 * window.prompt, in the page: `await ask({...})` opens the shared modal and
 * resolves to the trimmed answer, or null if it was closed. Arc blocks
 * window.prompt, and a blocked prompt answers null without showing anything.
 * Render `modal` once, anywhere in the component.
 */
export function useAskText() {
  const [req, setReq] = useState<(Ask & { resolve: (v: string | null) => void }) | null>(null)
  const [value, setValue] = useState('')
  const ask = useCallback((a: Ask) => new Promise<string | null>(resolve => { setValue(''); setReq({ ...a, resolve }) }), [])
  const finish = (v: string | null) => { req?.resolve(v); setReq(null) }
  const ok = !!req && (req.valid ? req.valid(value.trim()) : !!value.trim())
  const send = () => { if (ok) finish(value.trim()) }
  const modal = req && (
    <ActionModal title={req.title} description={req.description} onClose={() => finish(null)}
      footer={<>
        <button className={modalCancel} onClick={() => finish(null)}>Cancel</button>
        <button className={modalPrimary} onClick={send} disabled={!ok}>{req.action || 'OK'}</button>
      </>}>
      <label className="block"><span className={fieldLabel}>{req.label}</span>
        {req.multiline
          ? <textarea value={value} onChange={e => setValue(e.target.value)} rows={3} autoFocus placeholder={req.placeholder} className={`${modalInput} resize-none`}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
          : <input value={value} onChange={e => setValue(e.target.value)} autoFocus placeholder={req.placeholder} className={modalInput}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }} />}
      </label>
    </ActionModal>
  )
  return { ask, modal }
}
