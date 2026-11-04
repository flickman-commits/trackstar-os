import { useRef, useState, useEffect } from 'react'
import { ChevronRight, Check, Loader2 } from 'lucide-react'

/**
 * Slide-to-confirm control for touch screens. Approving is final, and a tap
 * on a phone is easy to make by accident, so the partner has to drag the knob
 * the full width of the track. Releasing early snaps it back.
 */
export default function SlideToApprove({ label, onComplete, disabled, busy, accent = '#4600D6' }: {
  label: string
  onComplete: () => void
  disabled?: boolean
  busy?: boolean
  accent?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(false)
  const startX = useRef(0)
  const startOffset = useRef(0)
  // Mirror of x that pointerup can trust even if the events land in one tick.
  const xRef = useRef(0)
  const draggingRef = useRef(false)

  const KNOB = 48
  const PAD = 4
  const maxX = () => Math.max(0, (trackRef.current?.clientWidth ?? 0) - KNOB - PAD * 2)

  // Reset after a completed approval finishes rendering (busy goes false).
  useEffect(() => {
    if (!busy && done) { setDone(false); setX(0); xRef.current = 0 }
  }, [busy, done])

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || busy || done) return
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
    startX.current = e.clientX
    startOffset.current = xRef.current
    draggingRef.current = true
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return
    const next = Math.min(maxX(), Math.max(0, startOffset.current + e.clientX - startX.current))
    xRef.current = next
    setX(next)
  }
  const onPointerUp = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
    const span = maxX()
    // A track that is not really laid out (hidden, or absurdly narrow) can
    // never count as a completed slide.
    if (span > 80 && xRef.current >= span * 0.92) {
      xRef.current = span
      setX(span)
      setDone(true)
      onComplete()
    } else {
      xRef.current = 0
      setX(0)
    }
  }

  const progress = maxX() > 0 ? x / maxX() : 0

  return (
    <div
      ref={trackRef}
      className="relative w-full select-none overflow-hidden"
      style={{
        height: KNOB + PAD * 2,
        borderRadius: 5,
        backgroundColor: done || busy ? accent : '#EDEBE6',
        border: `1px solid ${done || busy ? accent : '#DCD9D2'}`,
        opacity: disabled ? 0.4 : 1,
        touchAction: 'pan-y',
        transition: 'background-color 150ms',
      }}
    >
      {/* Fill behind the knob as it travels */}
      {x > 0 && (
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: x + KNOB + PAD * 2, backgroundColor: accent, borderRadius: 5, opacity: done || busy ? 1 : 0.9 }}
        />
      )}
      <div
        className="absolute inset-0 flex items-center justify-center text-[16px] font-bold pointer-events-none"
        style={{ paddingLeft: KNOB + PAD, color: done || busy ? '#FFFFFF' : '#1A1A1A', opacity: done || busy ? 1 : 1 - progress * 1.4 }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? 'Approved' : label}
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute flex items-center justify-center"
        style={{
          top: PAD,
          left: PAD,
          width: KNOB,
          height: KNOB,
          borderRadius: 4,
          backgroundColor: '#FFFFFF',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
          transform: `translateX(${x}px)`,
          transition: dragging ? 'none' : 'transform 200ms ease-out',
          cursor: disabled ? 'default' : 'grab',
          touchAction: 'none',
        }}
      >
        {done || busy ? <Check className="w-5 h-5" style={{ color: accent }} /> : <ChevronRight className="w-5 h-5" style={{ color: accent }} />}
      </div>
    </div>
  )
}
