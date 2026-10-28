import { useRef, useState } from 'react'
import { ImagePlus, Loader2 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { fieldLabel, modalCancel, modalPrimary } from '@/lib/ui'
import ActionModal from './ActionModal'
import PhotoCropper from './PhotoCropper'

/**
 * Admin only: a customer emails a photo after ordering. Attach it to one or
 * every print on the order and, on a Shopify order, either bill for it in the
 * same step (the tool adds one Photo Add-On per print to the Shopify order and
 * Shopify emails the customer a link to pay; the photo reads "not paid" until
 * they do) or add it free. A free photo, and one on an Etsy order, which has
 * no add-on to bill, renders with the photo straight away.
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
  onDone: (result: { charged: boolean; chargeError: string | null; free: boolean; rendering: number[]; reasons: string[] }) => void
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  // The crop stage hands back the square to upload.
  const cropExport = useRef<(() => Promise<File>) | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(prints.filter(p => !p.hasPhoto).map(p => p.id).length ? prints.filter(p => !p.hasPhoto).map(p => p.id) : [currentId]))
  // Shopify orders choose: bill the customer, or add it free. Elsewhere there is nothing to bill.
  const [billing, setBilling] = useState<'bill' | 'free'>(isShopify ? 'bill' : 'free')
  const charge = isShopify && !custom && billing === 'bill'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const choose = (f: File | null) => setFile(f)

  const submit = async () => {
    if (!file || !picked.size) return
    setBusy(true); setErr(null)
    try {
      // What goes up is the 1:1 crop, the same as a customer's upload on the site.
      const cropped = !custom && cropExport.current ? await cropExport.current() : file
      const slot = await post({ action: 'upload-url', filename: cropped.name, orderId: currentId })
      const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': cropped.type || 'application/octet-stream', 'x-upsert': 'false' }, body: cropped })
      if (!put.ok) throw new Error('The photo did not upload')
      if (replace) {
        const out = await post({ action: 'replace', orderId: currentId, path: slot.path })
        setOpen(false); choose(null)
        onDone({ charged: false, chargeError: null, free: false, rendering: out.rendering ? [out.rendering] : [], reasons: out.reasons || [] })
        return
      }
      const out = await post({ action: 'attach', orderIds: [...picked], path: slot.path, charge, free: !custom && billing === 'free' })
      setOpen(false); choose(null)
      onDone({ charged: !!out.charged, chargeError: out.chargeError || null, free: !!out.free, rendering: out.rendering || [], reasons: out.reasons || [] })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the photo')
    } finally { setBusy(false) }
  }

  const title = replace ? 'Replace the customer photo' : custom ? 'Add customer photo' : 'Add a customer photo'
  const count = picked.size
  // A choice drawn as a card: the whole box is the hit target.
  const option = (on: boolean) => `flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${on ? 'border-dark-fill bg-off-black/[0.03]' : 'border-border-gray hover:border-off-black/30'}`
  return (
    <>
      <button onClick={() => setOpen(true)} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2">
        <ImagePlus className="w-3.5 h-3.5" /> {title}
      </button>
      {open && (
        <ActionModal icon={ImagePlus} title={title} onClose={() => setOpen(false)} busy={busy}
          footer={<>
            <button onClick={() => setOpen(false)} disabled={busy} className={modalCancel}>Cancel</button>
            <button onClick={submit} disabled={!file || !count || busy} className={modalPrimary}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}{replace ? 'Replace photo' : `Add photo${charge ? ` and bill $${20 * count}` : ''}`}
            </button>
          </>}>
          <div className="flex items-start gap-4">
            {file ? (
              <div className="shrink-0">
                {custom
                  ? <img src={URL.createObjectURL(file)} alt="" className="max-w-[220px] max-h-56 rounded-xl border border-border-gray object-contain bg-white" />
                  : <PhotoCropper file={file} exportRef={cropExport} className="w-[220px]" />}
                <label className="mt-1.5 inline-block text-sm font-medium text-[#4600D6] hover:underline cursor-pointer">
                  Choose a different photo
                  <input type="file" accept="image/*" className="hidden" onChange={e => choose(e.target.files?.[0] || null)} />
                </label>
              </div>
            ) : (
              <label className="shrink-0 w-32 h-32 rounded-xl border-2 border-dashed border-border-gray hover:border-off-black/30 bg-subtle-gray flex flex-col items-center justify-center gap-1.5 cursor-pointer text-off-black/50" title="Choose a photo">
                <ImagePlus className="w-6 h-6" />
                <span className="text-xs font-medium">Choose photo</span>
                <input type="file" accept="image/*" className="hidden" onChange={e => choose(e.target.files?.[0] || null)} />
              </label>
            )}
            {replace ? (
              <p className="flex-1 text-off-black/60">The new photo replaces the one on this print. Nothing is billed. The design renders again with the new photo.</p>
            ) : custom && prints.length <= 1 ? (
              <p className="flex-1 text-off-black/60">The photo the customer emailed. It shows at the top of this order for the designer, and the order gets the Photo on print tag. Nothing is billed.</p>
            ) : (
              <div className="flex-1 min-w-0">
                <span className={fieldLabel}>Put it on</span>
                <div className="space-y-1.5">
                  {prints.map(p => (
                    <label key={p.id} className="flex items-center gap-2.5 text-[15px] text-off-black cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 accent-dark-fill" checked={picked.has(p.id)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} />
                      <span className="truncate">{p.label}{p.hasPhoto ? ' (replaces its photo)' : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {isShopify && !replace && !custom && (
            <div className="space-y-2">
              <label className={option(billing === 'bill')}>
                <input type="radio" name="photo-billing" className="mt-1 accent-dark-fill" checked={billing === 'bill'} onChange={() => setBilling('bill')} />
                <span>
                  <span className="block font-medium text-off-black">Bill the customer, ${20 * count}</span>
                  <span className="block text-off-black/60">Adds {count} Photo Add-On{count === 1 ? '' : 's'} to the Shopify order. Shopify emails them a link to pay; the print renders with the photo once they pay.</span>
                </span>
              </label>
              <label className={option(billing === 'free')}>
                <input type="radio" name="photo-billing" className="mt-1 accent-dark-fill" checked={billing === 'free'} onChange={() => setBilling('free')} />
                <span>
                  <span className="block font-medium text-off-black">Free, no charge</span>
                  <span className="block text-off-black/60">The print renders with the photo now.</span>
                </span>
              </label>
            </div>
          )}
          {!isShopify && !replace && !custom && <p className="text-off-black/50">Added free (there is no Photo Add-On to bill on this order). The print renders with the photo now.</p>}
          {err && <p className="text-red-700">{err}</p>}
        </ActionModal>
      )}
    </>
  )
}
