import { useEffect, useState } from 'react'
import { Loader2, Star } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { btnSecondary } from '@/lib/ui'

type Pick = { consent: boolean | null; status: 'suggested' | 'live' | 'skipped'; starred: boolean; starredBy: string | null }

/**
 * On an approved custom: star it to suggest it for the custom product page's
 * "Our Favorite Designs". Starred designs lead Settings > Site Gallery, where
 * Matt adds them to the site (server/domain/gallery/siteGallery.js).
 */
export default function FeatureStar({ orderId }: { orderId: string }) {
  const [pick, setPick] = useState<Pick | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    setPick(null)
    apiFetch(`/api/gallery?orderId=${encodeURIComponent(orderId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live && d) setPick(d) })
      .catch(() => null)
    return () => { live = false }
  }, [orderId])

  if (!pick) return null

  if (pick.status === 'live') {
    return <p className="text-xs text-off-black/55 flex items-center gap-1.5"><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" /> On the site, in Our Favorite Designs</p>
  }
  if (pick.consent === false) {
    return <p className="text-xs text-off-black/45">The customer asked us not to feature this design on the site.</p>
  }

  const toggle = async () => {
    setSaving(true)
    try {
      const r = await apiFetch('/api/gallery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'star', orderId, starred: !pick.starred }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not save')
      setPick(d)
      if (d.starred) toast.success('Starred for the site. Matt picks from these in Settings > Site Gallery.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={toggle} disabled={saving} className={btnSecondary} title="Suggest this design for the custom product page">
        {saving
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Star className={`w-3.5 h-3.5 ${pick.starred ? 'fill-amber-400 text-amber-500' : ''}`} />}
        {pick.starred ? 'Starred for the site' : 'Feature this on the site'}
      </button>
      {pick.starred && pick.starredBy && <span className="text-xs text-off-black/45">by {pick.starredBy}</span>}
    </div>
  )
}
