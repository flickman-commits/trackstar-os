import { useEffect } from 'react'
import { ToastDot } from '@/components/BrandToaster'
import { toastCard, toastStyle } from '@/lib/ui'

export type ToastMessage = { message: string; type: 'success' | 'error' | 'info' }

/**
 * The orders page's own toast, also used by Settings. Same card as sonner's
 * (see BrandToaster), held in local state so a handler can just set it.
 */
export default function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) {
  // An error stays long enough to read (8 seconds, not 3) and can be clicked
  // away; it sits above an open dialog (z-[90], dialogs are z-[80]) instead of under it.
  useEffect(() => {
    const timer = setTimeout(onClose, type === 'error' ? 8000 : 3000)
    return () => clearTimeout(timer)
  }, [onClose, type])

  return (
    <div className={`fixed bottom-4 right-4 z-[90] ${toastCard}`} style={toastStyle} role={type === 'error' ? 'alert' : 'status'} onClick={type === 'error' ? onClose : undefined}>
      <ToastDot type={type} />
      {message}
    </div>
  )
}
