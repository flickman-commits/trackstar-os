import { useCallback, useEffect, useState } from 'react'

// Two-click confirm, in the page. Arc (and Chrome, after a run of dialogs)
// blocks window.confirm, and a blocked confirm answers "no" silently, so the
// button did nothing. The first click arms the key and the button reads
// "Click again to …"; a second click within `ms` returns true.
//
//   const { arm, isArmed } = useArmed()
//   const remove = () => { if (!arm(`remove:${id}`)) return; ... }
//   <button onClick={remove}>{isArmed(`remove:${id}`) ? 'Click again to remove' : 'Remove'}</button>
export function useArmed(ms = 5000) {
  const [armed, setArmed] = useState<string | null>(null)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(null), ms)
    return () => clearTimeout(t)
  }, [armed, ms])
  const arm = useCallback((key: string) => {
    if (armed === key) { setArmed(null); return true }
    setArmed(key)
    return false
  }, [armed])
  const isArmed = useCallback((key: string) => armed === key, [armed])
  return { arm, isArmed }
}
