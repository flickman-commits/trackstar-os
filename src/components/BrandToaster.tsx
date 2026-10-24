import { Toaster } from 'sonner'
import { useLocation } from 'react-router-dom'
import { toastCard, toastStyle } from '@/lib/ui'

/**
 * Every toast in the app looks like this: a white card in Inter with a small
 * green, red or purple dot. Shared by sonner's Toaster and the dashboard's
 * own Toast so the two never drift apart.
 */


const DOT = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-[#4600D6]', warning: 'bg-amber-500' } as const
export function ToastDot({ type }: { type: keyof typeof DOT }) {
  return <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[type]}`} aria-hidden />
}

export default function BrandToaster() {
  // Support's reply buttons sit along the bottom middle; its toasts go to the corner instead.
  const { pathname } = useLocation()
  return (
    <Toaster
      position={pathname.startsWith('/support') ? 'bottom-right' : 'bottom-center'}
      icons={{ success: <ToastDot type="success" />, error: <ToastDot type="error" />, info: <ToastDot type="info" />, warning: <ToastDot type="warning" /> }}
      toastOptions={{
        unstyled: true,
        style: toastStyle,
        classNames: { toast: `${toastCard} w-[356px] max-w-[calc(100vw-32px)]`, icon: 'flex items-center w-2', description: 'text-off-black/55 font-normal' },
      }}
    />
  )
}
