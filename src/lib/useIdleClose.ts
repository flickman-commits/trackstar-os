import { useCallback, useEffect, useRef } from 'react'

/**
 * Close a small popup after `ms` without use. Any pointer move, click, key or
 * scroll inside it restarts the clock. Spread the returned handlers on the
 * popup's outer element.
 */
export function useIdleClose(open: boolean, onClose: () => void, ms = 7000) {
  const timer = useRef<number | undefined>(undefined)
  const close = useRef(onClose)
  close.current = onClose
  const reset = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => close.current(), ms)
  }, [ms])
  useEffect(() => {
    if (!open) return
    reset()
    return () => window.clearTimeout(timer.current)
  }, [open, reset])
  return { onPointerMove: reset, onPointerDown: reset, onKeyDown: reset, onInput: reset, onWheel: reset }
}
