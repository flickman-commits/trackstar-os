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
  /** A second way through ("Close anyway"); `choose` resolves 'alt' for it. */
  alt?: string
}

/**
 * window.confirm, in the page: `if (!(await confirm({...}))) return` opens a
 * small modal drawn like the others and resolves true on the yes button.
 * Arc blocks window.confirm, and a blocked confirm answers no without
 * showing anything. Render `modal` once, anywhere in the component.
 */
export function useConfirm() {
  const [req, setReq] = useState<(Ask & { resolve: (answer: 'yes' | 'alt' | 'no') => void }) | null>(null)
  /** Three ways out: the yes button, the alt button, or backing out. */
  const choose = useCallback((a: Ask) => new Promise<'yes' | 'alt' | 'no'>(resolve => setReq({ ...a, resolve })), [])
  const confirm = useCallback(async (a: Ask) => (await choose(a)) === 'yes', [choose])
  const finish = (answer: boolean | 'alt') => { req?.resolve(answer === 'alt' ? 'alt' : answer ? 'yes' : 'no'); setReq(null) }
  const modal = req && (
    <ActionModal title={req.title} size="sm" onClose={() => finish(false)}
      footer={<>
        <button className={modalCancel} onClick={() => finish(false)}>Cancel</button>
        {req.alt && <button className={modalCancel} onClick={() => finish('alt')}>{req.alt}</button>}
        <button className={req.danger ? modalDanger : modalPrimary} onClick={() => finish(true)} autoFocus>{req.action}</button>
      </>}>
      {req.body && <div className="text-off-black/70">{req.body}</div>}
    </ActionModal>
  )
  return { confirm, choose, modal }
}
