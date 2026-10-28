import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnPrimary, fieldLabel, inputBase } from '@/lib/ui'

type Product = { id: string; title: string; status?: string }

/**
 * Settings > Skipped Products: Shopify products that never enter the
 * fulfillment tool, because there is nothing to personalize (the Catch Me If
 * You Can posters). Artelo fulfills them from its own library. Saving also
 * completes any open order already made for one (server/domain/orders/excludedProducts.js).
 */
export default function SkippedProductsPanel() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [saved, setSaved] = useState<Product[]>([])
  const [picked, setPicked] = useState<Product[]>([])
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/orders/excluded-products')
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load products'); return d })
      .then(d => { setProducts(d.products); setSaved(d.excluded); setPicked(d.excluded) })
      .catch(e => toast.error((e as Error).message))
  }, [])

  const pickedIds = useMemo(() => new Set(picked.map(p => p.id)), [picked])
  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!products || term.length < 2) return []
    return products.filter(p => !pickedIds.has(p.id) && p.title.toLowerCase().includes(term)).slice(0, 30)
  }, [products, q, pickedIds])
  const changed = JSON.stringify(picked.map(p => p.id).sort()) !== JSON.stringify(saved.map(p => p.id).sort())

  const save = async () => {
    setSaving(true)
    try {
      const r = await apiFetch('/api/orders/excluded-products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: picked }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not save')
      setSaved(d.excluded)
      setPicked(d.excluded)
      toast.success(d.cleared.length ? `Saved. Completed ${d.cleared.length} open order${d.cleared.length === 1 ? '' : 's'} for these products.` : 'Saved')
      if (d.problems?.length) toast.error(`Could not complete: ${d.problems.join('; ')}`)
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }

  if (!products) return <div className="flex items-center gap-2 text-sm text-off-black/50"><Loader2 className="w-4 h-4 animate-spin" />Loading the store's products…</div>

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-off-black/60">
        Orders for these products skip the fulfillment tool: nothing to personalize, so Artelo prints them as they are. Saving also completes any open order already made for one.
      </p>

      <div>
        <label className={fieldLabel}>Skipped ({picked.length})</label>
        {picked.length === 0 ? (
          <p className="text-sm text-off-black/45">None yet. Search below to add a product.</p>
        ) : (
          <ul className="divide-y divide-border-gray border border-border-gray rounded-md bg-white">
            {picked.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="text-off-black truncate">{p.title || `Product ${p.id}`}</span>
                <button onClick={() => setPicked(prev => prev.filter(x => x.id !== p.id))} className="p-1 rounded text-off-black/45 hover:text-off-black hover:bg-off-black/5" aria-label={`Stop skipping ${p.title}`}>
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label className={fieldLabel}>Add a product</label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder='Search products, e.g. "catch me"' className={`${inputBase} w-full`} />
        {matches.length > 0 && (
          <ul className="mt-2 divide-y divide-border-gray border border-border-gray rounded-md bg-white max-h-72 overflow-y-auto">
            {matches.map(p => (
              <li key={p.id}>
                <button onClick={() => setPicked(prev => [...prev, { id: p.id, title: p.title }])} className="w-full flex items-center justify-between gap-3 px-3 py-2 text-sm text-left hover:bg-subtle-gray">
                  <span className="truncate text-off-black">{p.title}{p.status && p.status !== 'ACTIVE' && <span className="ml-2 text-xs text-off-black/40">{p.status.toLowerCase()}</span>}</span>
                  <Plus className="w-4 h-4 text-off-black/45 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {matches.length > 1 && (
          <button onClick={() => setPicked(prev => [...prev, ...matches.map(p => ({ id: p.id, title: p.title }))])} className="mt-2 text-xs text-[#4600D6] hover:underline">
            Add all {matches.length} matches
          </button>
        )}
      </div>

      <button onClick={save} disabled={!changed || saving} className={`${btnPrimary} inline-flex items-center gap-1.5 disabled:opacity-50`}>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Save
      </button>
    </div>
  )
}
