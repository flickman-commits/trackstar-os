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
export default function ActionModal({ icon: Icon, title, sub, description, actions, onClose, busy, hint, footer, size = 'md', bare, children }: {
  icon?: typeof X
  title: ReactNode
  /** Grey, after the title: the order number, the customer. */
  sub?: ReactNode
  /** A grey line under the title: what this does. */
  description?: ReactNode
  /** Buttons in the header, left of the close button ("New macro"). */
  actions?: ReactNode
  onClose: () => void
  busy?: boolean
  /** Left side of the footer. */
  hint?: ReactNode
  /** Right side of the footer: the buttons. */
  footer?: ReactNode
  /** sm for a yes/no, md for a form, lg for a form with a lot in it, xl for a list beside an editor. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** The body without padding, for panels that lay out their own (lists, cards). */
  bare?: boolean
  children?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onClose])
  return createPortal(
    <div className={modalOverlay} onMouseDown={() => { if (!busy) onClose() }}>
      <div role="dialog" aria-modal="true" className={`${modalCard} ${size === 'xl' ? 'max-w-[960px]' : size === 'lg' ? 'max-w-[760px]' : size === 'sm' ? 'max-w-[440px]' : 'max-w-[560px]'}`} onMouseDown={e => e.stopPropagation()}>
        <div className={modalHeader}>
          {Icon && <Icon className="w-5 h-5 text-off-black/80 flex-shrink-0" strokeWidth={2} />}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-off-black truncate">
              {title}{sub && <span className="ml-2 font-normal text-off-black/45">{sub}</span>}
            </h2>
            {description && <p className="mt-0.5 text-sm text-off-black/55">{description}</p>}
          </div>
          {actions}
          <button onClick={onClose} disabled={busy} aria-label="Close"
            className="p-1 -mr-1 rounded-md text-off-black/60 hover:text-off-black hover:bg-off-black/5 flex-shrink-0 disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>
        {bare ? <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">{children}</div> : children ? <div className={modalBody}>{children}</div> : null}
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
