import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Loader2 } from 'lucide-react'
import { Suspense, lazy, type ReactNode } from 'react'

const PdfViewer = lazy(() => import('@/components/PdfViewer'))

const MIN_SCALE = 1
const MAX_SCALE = 5
/** What a click, a double-tap or one press of + jumps to from a fitted view. */
const STEP_SCALE = 2.5

export type FullscreenProof = {
  id: string
  imageUrl: string
  groupLabel?: string | null
}

function isPdf(url: string) {
  return url.toLowerCase().includes('.pdf')
}

/**
 * The proof, as big as the screen will allow.
 *
 * Partners approve a print from a card roughly a third of the window, which is
 * a poor way to judge something that gets framed. This is the same set of
 * designs at full size: still navigable, still zoomable, and it closes back to
 * the option you were looking at.
 *
 * Zoom is a transform on the fitted image, about the point under the cursor
 * or between the fingers: translate(x, y) scale(s), with the image's centre
 * as the origin. It used to make the image physically wider inside a scroll
 * box centred with flexbox, and once it outgrew the box the centring pushed
 * its left edge out of reach, so every zoom slid sideways; each wheel tick
 * also jumped a fixed 12%. Now the point you aim at stays put, the buttons and
 * a click glide (a short transition), a trackpad pinch follows the fingers
 * continuously, and the pan is clamped so the print never drifts off screen.
 * Drag (or a plain wheel / two-finger scroll) pans once zoomed.
 */
export default function ProofFullscreen({
  proofs,
  index,
  onIndexChange,
  onClose,
  counterLabel,
  footer,
}: {
  proofs: FullscreenProof[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
  /** e.g. "Marathon: Option 2 of 3". Falls back to a plain count. */
  counterLabel?: string
  /** An action for the design on screen, pinned under it (Design Survey's vote). */
  footer?: ReactNode
}) {
  // One view: scale and the pan, in screen pixels from the centred position.
  const [view, setView] = useState<{ s: number; x: number; y: number }>({ s: 1, x: 0, y: 0 })
  // Glide for discrete steps (buttons, a click, keys); follow exactly while a gesture is live.
  const [animate, setAnimate] = useState(false)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const gesture = useRef<{ kind: 'pinch'; dist: number; s: number; mid: { x: number; y: number }; x: number; y: number } | { kind: 'pan'; x0: number; y0: number; x: number; y: number; moved: boolean } | null>(null)
  const scale = view.s
  const zoomed = scale > 1.001

  const proof = proofs[index]
  const many = proofs.length > 1

  // The stage's size: the fitted image and the pan limits both come from it.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const PAD = 16
  const fitted = natural && box
    ? (() => {
        const r = Math.min((box.w - PAD * 2) / natural.w, (box.h - PAD * 2) / natural.h, 1)
        return { w: Math.max(1, natural.w * r), h: Math.max(1, natural.h * r) }
      })()
    : null

  /** Keep the image covering what it can: no pan past its own edges, and centred on an axis where it fits. */
  const clamp = useCallback((v: { s: number; x: number; y: number }) => {
    if (!fitted || !box) return { s: v.s, x: 0, y: 0 }
    const mx = Math.max(0, (fitted.w * v.s - box.w) / 2 + PAD)
    const my = Math.max(0, (fitted.h * v.s - box.h) / 2 + PAD)
    return { s: v.s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) }
  }, [fitted, box])

  /**
   * Zoom to `next`, keeping the screen point (clientX, clientY) fixed; the
   * centre of the stage when none is given, which zooms perfectly straight.
   */
  const zoomTo = useCallback((next: number, clientX?: number, clientY?: number, glide = true) => {
    const el = stageRef.current
    const cur = viewRef.current
    const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
    if (!el || Math.abs(target - cur.s) < 1e-4) return
    const r = el.getBoundingClientRect()
    // The point, relative to the stage centre (the transform origin's home).
    const px = clientX == null ? 0 : clientX - (r.left + r.width / 2)
    const py = clientY == null ? 0 : clientY - (r.top + r.height / 2)
    const k = target / cur.s
    const nextView = target <= MIN_SCALE ? { s: 1, x: 0, y: 0 } : clamp({ s: target, x: px - (px - cur.x) * k, y: py - (py - cur.y) * k })
    setAnimate(glide)
    setView(nextView)
  }, [clamp])

  // The old name, used by the controls below.
  const zoomAt = zoomTo

  const go = useCallback(
    (delta: number) => {
      if (!many) return
      const next = (index + delta + proofs.length) % proofs.length
      setAnimate(false)
      setView({ s: 1, x: 0, y: 0 })
      onIndexChange(next)
    },
    [index, many, onIndexChange, proofs.length]
  )

  // Arrow keys move between options, Escape leaves. Bound while open only, so
  // the page underneath keeps its own key handling the rest of the time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      const s0 = viewRef.current.s
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(s0 < 1.01 ? STEP_SCALE : s0 * 1.4) }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(s0 / 1.4) }
      if (e.key === '0') { e.preventDefault(); zoomTo(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, onClose, zoomTo])

  // Hold the page still underneath, and put it back exactly as it was.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // A new option opens fitted and centred.
  useEffect(() => {
    setAnimate(false)
    setView({ s: 1, x: 0, y: 0 })
    setNatural(null)
  }, [index])

  // A resize (a phone turned, the window dragged) keeps the pan inside the new limits.
  useEffect(() => { setView(v => clamp(v)) }, [clamp])

  // Native listeners, deliberately: React attaches wheel and touchmove as
  // passive, so preventDefault there is ignored and the browser zooms the
  // whole page instead.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const cur = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        // A trackpad pinch arrives as ctrl+wheel with small deltas; a mouse
        // wheel with ctrl as big ones. An exponential of the delta makes both
        // smooth and proportional, instead of a fixed jump per event.
        const delta = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY))
        zoomTo(cur.s * Math.exp(-delta * 0.01), e.clientX, e.clientY, false)
        return
      }
      // A plain wheel or two-finger scroll pans once zoomed.
      if (cur.s > 1.001) { setAnimate(false); setView(v => clamp({ s: v.s, x: v.x - e.deltaX, y: v.y - e.deltaY })) }
    }

    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })

    const onTouchStartNative = (e: TouchEvent) => {
      const cur = viewRef.current
      if (e.touches.length === 2) {
        gesture.current = { kind: 'pinch', dist: dist(e.touches), s: cur.s, mid: mid(e.touches), x: cur.x, y: cur.y }
      } else if (e.touches.length === 1 && cur.s > 1.001) {
        gesture.current = { kind: 'pan', x0: e.touches[0].clientX, y0: e.touches[0].clientY, x: cur.x, y: cur.y, moved: false }
      }
    }
    const onTouchMoveNative = (e: TouchEvent) => {
      const g = gesture.current
      if (!g) return
      e.preventDefault()
      setAnimate(false)
      if (g.kind === 'pinch' && e.touches.length === 2) {
        const r = el.getBoundingClientRect()
        const m = mid(e.touches)
        const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.s * (dist(e.touches) / g.dist)))
        // Zoom about where the fingers started, then follow the midpoint as they move together.
        const px = g.mid.x - (r.left + r.width / 2), py = g.mid.y - (r.top + r.height / 2)
        const k = target / g.s
        setView(clamp({ s: target, x: px - (px - g.x) * k + (m.x - g.mid.x), y: py - (py - g.y) * k + (m.y - g.mid.y) }))
      } else if (g.kind === 'pan' && e.touches.length === 1) {
        const dx = e.touches[0].clientX - g.x0, dy = e.touches[0].clientY - g.y0
        if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true
        setView(v => clamp({ s: v.s, x: g.x + dx, y: g.y + dy }))
      }
    }
    const onTouchEndNative = (e: TouchEvent) => {
      if (e.touches.length === 0) gesture.current = null
      // Let go of a pinch below fit and it settles back to fit.
      if (viewRef.current.s < 1.02) { setAnimate(true); setView({ s: 1, x: 0, y: 0 }) }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStartNative, { passive: false })
    el.addEventListener('touchmove', onTouchMoveNative, { passive: false })
    el.addEventListener('touchend', onTouchEndNative)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStartNative)
      el.removeEventListener('touchmove', onTouchMoveNative)
      el.removeEventListener('touchend', onTouchEndNative)
    }
  }, [clamp, zoomTo])

  // Mouse: drag to pan once zoomed; a click without a drag zooms in at that
  // point, or back to fit.
  const mouse = useRef<{ x0: number; y0: number; x: number; y: number; moved: boolean } | null>(null)
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const cur = viewRef.current
    mouse.current = { x0: e.clientX, y0: e.clientY, x: cur.x, y: cur.y, moved: false }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const m = mouse.current
    if (!m || viewRef.current.s <= 1.001) return
    const dx = e.clientX - m.x0, dy = e.clientY - m.y0
    if (!m.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    m.moved = true
    setAnimate(false)
    setView(v => clamp({ s: v.s, x: m.x + dx, y: m.y + dy }))
  }
  const onMouseUp = (e: React.MouseEvent) => {
    const m = mouse.current
    mouse.current = null
    if (!m || m.moved) return
    if ((e.target as HTMLElement).tagName !== 'IMG') return
    zoomTo(zoomed ? 1 : STEP_SCALE, zoomed ? undefined : e.clientX, zoomed ? undefined : e.clientY)
  }

  // Swipe changes option, but only while fitted: once zoomed, a drag pans.
  const onTouchStart = (e: React.TouchEvent) => {
    if (zoomed || !many || e.touches.length > 1) { touchStart.current = null; return }
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start || gesture.current?.kind === 'pinch') return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1)
  }

  // A double-tap on a phone zooms in at that point, or back to fit.
  const lastTap = useRef(0)
  const onTapEnd = (e: React.TouchEvent) => {
    onTouchEnd(e)
    if (e.changedTouches.length !== 1 || gesture.current) return
    const now = Date.now()
    if (now - lastTap.current < 300) {
      const t = e.changedTouches[0]
      zoomTo(zoomed ? 1 : STEP_SCALE, zoomed ? undefined : t.clientX, zoomed ? undefined : t.clientY)
      lastTap.current = 0
    } else lastTap.current = now
  }

  if (!proof) return null

  const label = counterLabel || (many ? `${index + 1} of ${proofs.length}` : 'Your design')
  const pdf = isPdf(proof.imageUrl)

  return (
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ backgroundColor: '#0B0B0B' }}>
      {/* Top bar. Kept out of the image area so it never covers the artwork. */}
      <div
        className="flex items-center justify-between gap-3 px-3 py-2.5 shrink-0"
        style={{ backgroundColor: '#141414', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <span className="text-[13px] font-medium truncate" style={{ color: '#FFFFFF' }}>{label}</span>
        <div className="flex items-center gap-1">
          {!pdf && (
            <>
              {/* Separate in and out, rather than one toggle that only knew two
                  states. The percentage doubles as the reset. */}
              <button
                onClick={() => zoomAt(scale / 1.4)}
                disabled={scale <= MIN_SCALE}
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-30"
                style={{ color: '#FFFFFF' }}
                title="Zoom out (minus key)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={() => zoomAt(1)}
                className="px-2 py-1.5 rounded-lg text-[12px] font-medium tabular-nums transition-colors hover:bg-white/10"
                style={{ color: zoomed ? '#FFFFFF' : 'rgba(255,255,255,0.55)' }}
                title="Reset to fit (0)"
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                onClick={() => zoomAt(scale === 1 ? STEP_SCALE : scale * 1.4)}
                disabled={scale >= MAX_SCALE}
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors hover:bg-white/10 disabled:opacity-30"
                style={{ color: '#FFFFFF' }}
                title="Zoom in (plus key)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors hover:bg-white/10"
            style={{ color: '#FFFFFF' }}
            title="Close full screen (Esc)"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={stageRef}
          className={`absolute inset-0 overflow-hidden select-none ${pdf ? 'overflow-auto' : ''} ${zoomed ? 'cursor-grab active:cursor-grabbing' : ''}`}
          style={{ touchAction: pdf ? 'auto' : 'none' }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTapEnd}
          onMouseDown={pdf ? undefined : onMouseDown}
          onMouseMove={pdf ? undefined : onMouseMove}
          onMouseUp={pdf ? undefined : onMouseUp}
          onMouseLeave={() => { mouse.current = null }}
        >
          <div className="w-full h-full flex items-center justify-center p-2 sm:p-4">
            {pdf ? (
              <Suspense fallback={<Loader2 className="w-7 h-7 animate-spin" style={{ color: '#888' }} />}>
                <PdfViewer url={proof.imageUrl} maxHeight={Math.round(window.innerHeight * 0.85)} />
              </Suspense>
            ) : (
              <img
                src={proof.imageUrl}
                alt={label}
                onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className={`select-none ${zoomed ? '' : 'cursor-zoom-in'} ${fitted ? '' : 'max-w-full max-h-full object-contain'}`}
                // Always the fitted size; zoom and pan are a transform about
                // its centre, so the layout never moves under it.
                style={fitted ? {
                  width: fitted.w,
                  height: fitted.h,
                  maxWidth: 'none',
                  transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`,
                  transformOrigin: '50% 50%',
                  transition: animate ? 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)' : 'none',
                  willChange: 'transform',
                } : undefined}
                draggable={false}
                onContextMenu={e => e.preventDefault()}
              />
            )}
          </div>
        </div>

        {many && (
          <>
            <button
              onClick={() => go(-1)}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full transition-colors"
              style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
              title="Previous option (left arrow)"
            >
              <ChevronLeft className="w-6 h-6" style={{ color: '#1A1A1A' }} />
            </button>
            <button
              onClick={() => go(1)}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full transition-colors"
              style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}
              title="Next option (right arrow)"
            >
              <ChevronRight className="w-6 h-6" style={{ color: '#1A1A1A' }} />
            </button>
          </>
        )}
      </div>

      {/* The shortcuts were already bound and completely invisible, which is the
          same as not having them. Desktop only: there are no keys to press on a
          phone, and pinch needs no instructions. */}
      <div className="hidden md:block text-center pb-1 pt-2 shrink-0" style={{ backgroundColor: '#141414' }}>
        <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {pdf
            ? 'Arrow keys to change option · Esc to close'
            : 'Pinch or click to zoom · drag to move around · + and − to step · 0 to fit · arrow keys to change option · Esc to close'}
        </span>
      </div>

      {many && (
        <div className="flex items-center justify-center gap-1.5 pb-3 pt-1 shrink-0" style={{ backgroundColor: '#141414' }}>
          {proofs.map((p, i) => (
            <button
              key={p.id}
              onClick={() => { setAnimate(false); setView({ s: 1, x: 0, y: 0 }); onIndexChange(i) }}
              className="rounded-full transition-all"
              style={{
                width: i === index ? '24px' : '8px',
                height: '8px',
                backgroundColor: i === index ? '#FFFFFF' : 'rgba(255,255,255,0.3)',
              }}
              title={`Option ${i + 1}`}
            />
          ))}
        </div>
      )}

      {footer && (
        <div className="px-4 pt-1 shrink-0" style={{ backgroundColor: '#141414', paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
          {footer}
        </div>
      )}
    </div>
  )
}
