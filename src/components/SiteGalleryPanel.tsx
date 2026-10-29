import { useCallback, useEffect, useState } from 'react'
import { Loader2, Star, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnPrimary, btnSecondary, btnGhost, segment, segmentGroup, chip, chipTone } from '@/lib/ui'

type Status = 'suggested' | 'live' | 'skipped'
type Seg = 'marathon' | 'ultra' | 'other'
type Item = {
  orderId: string; orderNumber: string; display: string; race: string; runner: string | null; designer: string | null
  imageUrl: string; thumbnailUrl: string; approvedAt: string; consent: boolean | null; segment: Seg
  starredBy: string | null; starredAt: string | null; decidedBy: string | null; decidedAt: string | null
}
type Counts = { live: number; skipped: number; starred: number }

const SEG_LABEL: Record<Seg, string> = { marathon: 'Marathons', ultra: 'Ultras', other: 'Other' }
const PAGE_URL = 'https://trackstar.art/products/custom'

/**
 * Settings > Site Gallery: approved customs to add to "Our Favorite Designs"
 * on the custom product page. Starred ones (a designer's pick) come first.
 * Add puts it on the site in the tab chosen here; the images already in the
 * theme stay, after the added ones. See server/domain/gallery/siteGallery.js.
 */
export default function SiteGalleryPanel() {
  const [status, setStatus] = useState<Status>('suggested')
  const [items, setItems] = useState<Item[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    apiFetch(`/api/gallery?status=${status}`)
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not load the gallery'); return d })
      .then(d => { setItems(d.items); setCounts(d.counts) })
      .catch(e => setError((e as Error).message))
  }, [status])
  useEffect(() => { setItems(null); load() }, [load])

  const act = async (item: Item, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(item.orderId + action)
    try {
      const r = await apiFetch('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, orderId: item.orderId, ...extra }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Something went wrong')
      if (action === 'segment') {
        setItems(prev => prev?.map(i => (i.orderId === item.orderId ? { ...i, segment: extra.segment as Seg } : i)) ?? prev)
        return
      }
      if (action === 'add') toast.success(`${item.race} is on the site, under ${SEG_LABEL[d.segment as Seg]}`)
      if (action === 'remove') toast.success(`${item.race} is off the site`)
      setItems(prev => prev?.filter(i => i.orderId !== item.orderId) ?? prev)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
      setArmed(null)
    }
  }

  const tabs: { id: Status; label: string; n?: number }[] = [
    { id: 'suggested', label: 'Suggestions', n: counts?.starred || undefined },
    { id: 'live', label: 'On the site', n: counts?.live },
    { id: 'skipped', label: 'Skipped', n: counts?.skipped },
  ]

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className={segmentGroup}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setStatus(t.id)} className={segment(status === t.id)}>
              {t.label}{t.n ? <span className="ml-1 opacity-60">{t.id === 'suggested' ? `${t.n} starred` : t.n}</span> : null}
            </button>
          ))}
        </div>
        <a href={PAGE_URL} target="_blank" rel="noreferrer" className="text-xs text-off-black/55 hover:text-off-black inline-flex items-center gap-1">
          See the custom page <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {status === 'suggested' && (
        <p className="text-xs text-off-black/50 mb-3">
          Every custom a customer approved, except the ones where they said no to being featured. Starred ones come first.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error} <button onClick={load} className="underline">Try again</button></p>}
      {!items && !error && <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>}
      {items && items.length === 0 && (
        <p className="text-sm text-off-black/50 py-6">
          {status === 'suggested' ? 'Nothing waiting. New approved customs show up here.' : status === 'live' ? 'Nothing added yet.' : 'Nothing skipped.'}
        </p>
      )}

      {items && items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {items.map(item => (
            <div key={item.orderId} className="bg-white border border-border-gray rounded-lg overflow-hidden flex flex-col">
              <a href={item.imageUrl} target="_blank" rel="noreferrer" className="block bg-subtle-gray aspect-square">
                <img src={item.thumbnailUrl} alt={item.race} loading="lazy" className="w-full h-full object-contain" />
              </a>
              <div className="p-2.5 flex-1 flex flex-col gap-1.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-off-black leading-tight truncate" title={item.race}>{item.race || 'Custom race'}</p>
                  <p className="text-xs text-off-black/50 truncate">
                    <a href={`/orders/${item.orderNumber}`} target="_blank" rel="noreferrer" className="hover:underline">{item.display}</a>
                    {item.runner ? ` · ${item.runner}` : ''}
                  </p>
                  {item.designer && <p className="text-[11px] text-off-black/40 truncate">Designed by {item.designer}</p>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.starredBy && (
                    <span className={`${chip} ${chipTone.amber}`}><Star className="w-3 h-3 fill-amber-400 text-amber-500" /> {item.starredBy}</span>
                  )}
                  {item.consent === true && <span className={`${chip} ${chipTone.emerald}`}>Customer said yes</span>}
                </div>
                <select
                  value={item.segment}
                  onChange={e => act(item, 'segment', { segment: e.target.value })}
                  className="text-xs border border-border-gray rounded px-1.5 py-1 bg-white"
                  aria-label="Which tab it shows under"
                >
                  {(Object.keys(SEG_LABEL) as Seg[]).map(s => <option key={s} value={s}>{SEG_LABEL[s]}</option>)}
                </select>
                <div className="mt-auto flex gap-1.5 pt-1">
                  {status === 'suggested' && (
                    <>
                      <button onClick={() => act(item, 'add', { segment: item.segment })} disabled={!!busy} className={`${btnPrimary} flex-1 justify-center`}>
                        {busy === item.orderId + 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add to site'}
                      </button>
                      <button onClick={() => act(item, 'skip')} disabled={!!busy} className={btnGhost}>Skip</button>
                    </>
                  )}
                  {status === 'live' && (
                    <button
                      onClick={() => {
                        if (armed !== item.orderId) { setArmed(item.orderId); setTimeout(() => setArmed(a => (a === item.orderId ? null : a)), 5000); return }
                        act(item, 'remove')
                      }}
                      disabled={!!busy}
                      className={`${btnSecondary} flex-1 justify-center`}
                    >
                      {busy === item.orderId + 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : armed === item.orderId ? 'Click again to remove' : 'Remove from site'}
                    </button>
                  )}
                  {status === 'skipped' && (
                    <button onClick={() => act(item, 'unskip')} disabled={!!busy} className={`${btnSecondary} flex-1 justify-center`}>Put back</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
