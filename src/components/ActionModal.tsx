import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { modalBody, modalCard, modalFooter, modalHeader, modalOverlay } from '@/lib/ui'

/**
 * One modal for every action that needs typing or several steps, drawn like
 * the global search: icon and title in the header, the form in the body, the
 * buttons in the footer with a grey hint on the left. Esc and a click outside
 * close it, except while it is saving.
 */
export default function ActionModal({ icon: Icon, title, sub, onClose, busy, hint, footer, wide, children }: {
  icon?: typeof X
  title: ReactNode
  /** Grey, after the title: the order number, the customer. */
  sub?: ReactNode
  onClose: () => void
  busy?: boolean
  /** Left side of the footer. */
  hint?: ReactNode
  /** Right side of the footer: the buttons. */
  footer?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])
  return createPortal(
    <div className={modalOverlay} onMouseDown={() => { if (!busy) onClose() }}>
      <div role="dialog" aria-modal="true" className={`${modalCard} ${wide ? 'max-w-[760px]' : 'max-w-[560px]'}`} onMouseDown={e => e.stopPropagation()}>
        <div className={modalHeader}>
          {Icon && <Icon className="w-5 h-5 text-off-black/80 flex-shrink-0" strokeWidth={2} />}
          <h2 className="flex-1 min-w-0 text-lg font-semibold text-off-black truncate">
            {title}{sub && <span className="ml-2 font-normal text-off-black/45">{sub}</span>}
          </h2>
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="p-1 -mr-1 rounded-md text-off-black/60 hover:text-off-black hover:bg-off-black/5 flex-shrink-0 disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className={modalBody}>{children}</div>
        {(hint || footer) && (
          <div className={modalFooter}>
            <div className="flex-1 min-w-0 text-sm text-off-black/45">{hint}</div>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
