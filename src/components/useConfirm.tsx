import { useCallback, useState, type ReactNode } from 'react'
import ActionModal from '@/components/ActionModal'
import { modalCancel, modalDanger, modalPrimary } from '@/lib/ui'

type Ask = {
  title: string
  /** What happens, in a sentence or two. */
  body?: ReactNode
  /** The button that says yes ("Remove photo"). */
  action: string
  /** Red button, for anything that cannot be taken back. */
  danger?: boolean
}

/**
 * window.confirm, in the page: `if (!(await confirm({...}))) return` opens a
 * small modal drawn like the others and resolves true on the yes button.
 * Arc blocks window.confirm, and a blocked confirm answers no without
 * showing anything. Render `modal` once, anywhere in the component.
 */
export function useConfirm() {
  const [req, setReq] = useState<(Ask & { resolve: (yes: boolean) => void }) | null>(null)
  const confirm = useCallback((a: Ask) => new Promise<boolean>(resolve => setReq({ ...a, resolve })), [])
  const finish = (yes: boolean) => { req?.resolve(yes); setReq(null) }
  const modal = req && (
    <ActionModal title={req.title} size="sm" onClose={() => finish(false)}
      footer={<>
        <button className={modalCancel} onClick={() => finish(false)}>Cancel</button>
        <button className={req.danger ? modalDanger : modalPrimary} onClick={() => finish(true)} autoFocus>{req.action}</button>
      </>}>
      {req.body && <div className="text-off-black/70">{req.body}</div>}
    </ActionModal>
  )
  return { confirm, modal }
}
