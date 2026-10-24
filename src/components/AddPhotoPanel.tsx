import { useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { btnPrimary, btnGhost } from '@/lib/ui'
import PhotoCropper from './PhotoCropper'

/**
 * Admin only: a customer emails a photo after ordering. Attach it to one or
 * every print on the order and, on a Shopify order, bill for it in the same
 * step: the tool adds one Photo Add-On per print to the Shopify order and
 * Shopify emails the customer a link to pay. The photo reads "not paid" until
 * they do, and those prints cannot be completed before then.
 */

type Print = { id: string; label: string; hasPhoto: boolean }

async function post(body: Record<string, unknown>) {
  const res = await apiFetch('/api/orders/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function AddPhotoPanel({
  prints, currentId, isShopify, onDone, replace = false, custom = false,
}: {
  prints: Print[]
  currentId: string
  isShopify: boolean
  /** A custom order: the designer uses the photo as it is (no square crop), and a photo emailed after ordering is free. */
  custom?: boolean
  /** Swap this print's existing photo for another one the customer sent. Never bills. */
  replace?: boolean
  onDone: (result: { charged: boolean; chargeError: string | null }) => void
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  // The crop stage hands back the square to upload.
  const cropExport = useRef<(() => Promise<File>) | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(prints.filter(p => !p.hasPhoto).map(p => p.id).length ? prints.filter(p => !p.hasPhoto).map(p => p.id) : [currentId]))
  const [charge, setCharge] = useState(isShopify && !custom)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const choose = (f: File | null) => setFile(f)

  const submit = async () => {
    if (!file || !picked.size) return
    setBusy(true); setErr(null)
    try {
      // What goes up is the 1:1 crop, the same as a customer's upload on the site.
      const cropped = !custom && cropExport.current ? await cropExport.current() : file
      const slot = await post({ action: 'upload-url', filename: cropped.name })
      const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': cropped.type || 'application/octet-stream', 'x-upsert': 'false' }, body: cropped })
      if (!put.ok) throw new Error('The photo did not upload')
      if (replace) {
        await post({ action: 'replace', orderId: currentId, path: slot.path })
        setOpen(false); choose(null)
        onDone({ charged: false, chargeError: null })
        return
      }
      const out = await post({ action: 'attach', orderIds: [...picked], path: slot.path, charge })
      setOpen(false); choose(null)
      onDone({ charged: !!out.charged, chargeError: out.chargeError || null })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the photo')
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2">
        <ImagePlus className="w-3.5 h-3.5" /> {replace ? 'Replace the customer photo' : custom ? 'Add customer photo' : 'Add a customer photo'}
      </button>
    )
  }

  const count = picked.size
  return (
    <div className="rounded-md border border-[#4600D6]/30 bg-[#4600D6]/[0.04] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#4600D6]">{replace ? 'Replace the customer photo' : 'Add a customer photo'}</span>
        <button onClick={() => setOpen(false)} className="text-off-black/40 hover:text-off-black" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>

      {file && (
        <div>
          {custom
            ? <img src={URL.createObjectURL(file)} alt="" className="max-w-[280px] max-h-64 rounded border border-border-gray object-contain bg-white" />
            : <PhotoCropper file={file} exportRef={cropExport} className="max-w-[280px]" />}
          <label className="mt-1 inline-block text-[11px] font-medium text-[#4600D6] hover:underline cursor-pointer">
            Choose a different photo
            <input type="file" accept="image/*" className="hidden" onChange={e => choose(e.target.files?.[0] || null)} />
          </label>
        </div>
      )}
      <div className="flex items-start gap-3">
        {!file && (
          <label className="shrink-0 w-24 h-24 rounded-md border border-dashed border-[#4600D6]/40 bg-white flex items-center justify-center cursor-pointer overflow-hidden" title="Choose a photo">
            <ImagePlus className="w-5 h-5 text-[#4600D6]/60" />
            <input type="file" accept="image/*" className="hidden" onChange={e => choose(e.target.files?.[0] || null)} />
          </label>
        )}
        {replace ? (
          <p className="flex-1 text-xs text-off-black/60">The new photo replaces the one on this print. Nothing is billed. It has to be placed on the artwork again, and a design made with the old photo needs a re-render.</p>
        ) : custom && prints.length <= 1 ? (
          <p className="flex-1 text-xs text-off-black/60">The photo the customer emailed. It shows at the top of this order for the designer, and the order gets the Photo on print tag. Nothing is billed.</p>
        ) : (
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-xs font-semibold text-off-black/60">Put it on</div>
          {prints.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-off-black">
              <input type="checkbox" checked={picked.has(p.id)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} />
              <span className="truncate">{p.label}{p.hasPhoto ? ' (replaces its photo)' : ''}</span>
            </label>
          ))}
        </div>
        )}
      </div>

      {isShopify && !replace && !custom && (
        <label className="flex items-start gap-2 text-sm text-off-black">
          <input type="checkbox" className="mt-0.5" checked={charge} onChange={e => setCharge(e.target.checked)} />
          <span>
            Bill the customer: add {count} Photo Add-On{count === 1 ? '' : 's'} (${20 * count}) to the Shopify order. Shopify emails them a link to pay the difference.
          </span>
        </label>
      )}
      {!replace && !custom && <p className="text-[11px] text-off-black/50">The photo shows as not paid until the order reads paid in Shopify, and those prints cannot be completed before then.</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={!file || !count || busy} className={btnPrimary}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : replace ? 'Replace photo' : `Add photo${charge && isShopify && !custom ? ' and bill' : ''}`}
        </button>
        <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
      </div>
    </div>
  )
}
