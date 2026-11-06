import { useEffect, useRef, useState, type MutableRefObject } from 'react'

/**
 * The same 1:1 crop the customer gets on the site (trackstar-art,
 * personalization wizard): the photo always covers a square window, drag to
 * pan, a slider zooms 1x to 3x, and the export cuts exactly what the window
 * shows, as a JPEG up to 3000px on a side on a white ground. The print's
 * photo window is a clipped square, so anything but a square would be cut
 * again, unseen, by the render.
 *
 * Geometry (shared with the export, or the preview would lie):
 *   scale = (stage px / natural short edge) * zoom
 *   the image's top-left sits at (offX, offY) stage px, clamped so the image
 *   never leaves a gap in the window.
 */
const MAX_ZOOM = 3
const MAX_OUTPUT_EDGE = 3000

type Geometry = { scale: number; offX: number; offY: number; stage: number }

export default function PhotoCropper({ file, exportRef, className = '' }: {
  file: File
  /** Set to a function that returns the cropped square as a JPEG file. */
  exportRef: MutableRefObject<(() => Promise<File>) | null>
  className?: string
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [stage, setStage] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  // The file as an image, and its natural size.
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u); setNatural(null); setZoom(1)
    const img = new Image()
    img.onload = () => { imgRef.current = img; setNatural({ w: img.naturalWidth, h: img.naturalHeight }) }
    img.src = u
    return () => { URL.revokeObjectURL(u); imgRef.current = null }
  }, [file])

  // The stage is as wide as its box; keep its pixel size current.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const base = natural && stage ? stage / Math.min(natural.w, natural.h) : 0
  const scale = base * zoom
  const drawn = natural ? { w: natural.w * scale, h: natural.h * scale } : { w: 0, h: 0 }
  const clamp = (x: number, y: number, d = drawn) => ({ x: Math.min(0, Math.max(stage - d.w, x)), y: Math.min(0, Math.max(stage - d.h, y)) })

  // A new image or a resized stage starts centered.
  useEffect(() => {
    if (!natural || !stage) return
    const s = (stage / Math.min(natural.w, natural.h))
    setOff({ x: (stage - natural.w * s) / 2, y: (stage - natural.h * s) / 2 })
    setZoom(1)
  }, [natural, stage])

  const geometry = (): Geometry => ({ scale, offX: off.x, offY: off.y, stage })

  // Zoom around the window's center, so what is in the middle stays there.
  const changeZoom = (z: number) => {
    if (!natural) return
    const next = base * z
    const cx = (stage / 2 - off.x) / scale, cy = (stage / 2 - off.y) / scale
    const nx = stage / 2 - cx * next, ny = stage / 2 - cy * next
    setZoom(z)
    setOff(clamp(nx, ny, { w: natural.w * next, h: natural.h * next }))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setOff(clamp(drag.current.ox + (e.clientX - drag.current.x), drag.current.oy + (e.clientY - drag.current.y)))
  }
  const onPointerUp = () => { drag.current = null }

  // Export inverts the geometry: the window shows stage/scale natural pixels per side.
  useEffect(() => {
    exportRef.current = async () => {
      const img = imgRef.current
      if (!img || !natural) throw new Error('The photo is still loading')
      const g = geometry()
      let sx = -g.offX / g.scale, sy = -g.offY / g.scale, side = g.stage / g.scale
      sx = Math.max(0, Math.min(sx, natural.w)); sy = Math.max(0, Math.min(sy, natural.h))
      side = Math.min(side, natural.w - sx, natural.h - sy)
      const out = Math.round(Math.min(side, MAX_OUTPUT_EDGE))
      const canvas = document.createElement('canvas')
      canvas.width = out; canvas.height = out
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out, out)  // a transparent PNG would flatten to black on the poster
      ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out)
      const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('That photo could not be prepared')
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      return new File([blob], name, { type: 'image/jpeg' })
    }
    return () => { exportRef.current = null }
  })

  return (
    <div className={className}>
      <div ref={stageRef} className="relative w-full aspect-square overflow-hidden rounded-md bg-off-black/5 border border-[#4600D6]/30 cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {url && natural && (
          <img src={url} alt="" draggable={false} className="absolute top-0 left-0 max-w-none pointer-events-none"
            style={{ width: drawn.w, height: drawn.h, transform: `translate(${off.x}px, ${off.y}px)` }} />
        )}
      </div>
      <label className="mt-2 flex items-center gap-2 text-[11px] text-off-black/60">
        Zoom
        <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={e => changeZoom(Number(e.target.value))} className="flex-1 accent-[#4600D6]" />
      </label>
      {natural && <p className="mt-1 text-[11px] text-off-black/50">Drag to move. The square is what prints{natural.w < 500 || natural.h < 500 ? '; this photo is too small to print clearly, so try the original' : ''}.</p>}
    </div>
  )
}
