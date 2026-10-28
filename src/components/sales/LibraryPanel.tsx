import { useEffect, useRef, useState, type DragEvent } from 'react'
import { FileText, Image as ImageIcon, Loader2, Plus, Trash2, Upload, Check, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { sectionLabel, textLink } from '@/lib/ui'
import { useArmed } from '@/lib/useArmed'
import { salesApi } from '@/lib/salesApi'
import { ASSET_DRAG_TYPE } from './Composer'
import type { Asset } from '@/types/sales'

/**
 * The content library, on the right.
 *
 * Every deck, mockup and image the team sends, as cards. Drag a card onto
 * the email to attach it, or click the plus. Drop files here (or click
 * Upload) to add to the library; they go straight to storage. Names carry
 * meaning: a mockup named for its race is what gets auto-picked for a
 * charity that runs that race, so name files for what they are.
 */
function fmtSize(n: number | null) {
  if (!n) return ''
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

export default function LibraryPanel({ assets, configured, attachedIds, onAttach, onChanged, onRenamed, compact }: {
  assets: Asset[]
  configured: boolean
  attachedIds: Set<string>
  onAttach: (a: Asset) => void
  onChanged: () => void
  /** A rename changes the file's id; the page moves any attachment across. */
  onRenamed?: (oldId: string, newId: string) => void
  compact?: boolean
}) {
  const [over, setOver] = useState(false)
  const [uploading, setUploading] = useState<Record<string, number>>({})
  const { arm, isArmed } = useArmed()
  const [filter, setFilter] = useState<'all' | 'image' | 'deck'>('all')
  const fileInput = useRef<HTMLInputElement>(null)
  const resigned = useRef(false)
  const [viewing, setViewing] = useState<Asset | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (!list.length) return
    for (const f of list) {
      setUploading(u => ({ ...u, [f.name]: 0 }))
      try {
        await salesApi.uploadAsset(f, frac => setUploading(u => ({ ...u, [f.name]: frac })))
        toast.success(`Added ${f.name}`)
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`)
      } finally {
        setUploading(u => { const n = { ...u }; delete n[f.name]; return n })
      }
    }
    onChanged()
  }
  const remove = async (a: Asset) => {
    if (!arm(`remove:${a.id}`)) return
    try { await salesApi.deleteAsset(a.id); toast.message(`Removed ${a.name}`); onChanged() }
    catch (e) { toast.error((e as Error).message) }
  }
  // Which card is being renamed, readable synchronously: the blur that
  // follows Enter (and the one when the input unmounts) must see it is done.
  const editingRef = useRef<string | null>(null)
  const stopRename = () => { editingRef.current = null; setEditing(null) }
  const startRename = (a: Asset) => { editingRef.current = a.id; setEditing(a.id); setDraftName(a.name) }
  // Enter submits and then the input's blur fires as it unmounts; without
  // this the second call renames the old name, which is already gone.
  const renameBusy = useRef(false)
  const rename = async (a: Asset) => {
    if (renameBusy.current || editingRef.current !== a.id) return
    const name = draftName.trim()
    if (!name || name === a.name) { stopRename(); return }
    renameBusy.current = true
    setRenaming(true)
    try {
      const out = await salesApi.renameAsset(a.id, name)
      onRenamed?.(a.id, out.id)
      toast.success(`Renamed to ${out.filename}`)
      stopRename()
      onChanged()
    } catch (e) { toast.error((e as Error).message) }
    finally { setRenaming(false); renameBusy.current = false }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setOver(false)
    if (e.dataTransfer.files?.length) upload(e.dataTransfer.files)
  }

  const shown = assets.filter(a => filter === 'all' || a.kind === filter)

  if (!configured) {
    return (
      <section className="text-xs text-off-black/55">
        <h3 className={`${sectionLabel} mb-2`}>Library</h3>
        Storage is not configured on the server (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY), so there is nowhere to keep decks and mockups yet.
      </section>
    )
  }

  return (
    <>
    {viewing && <Viewer asset={viewing} attached={attachedIds.has(viewing.id)} onAttach={() => { onAttach(viewing); setViewing(null) }} onClose={() => setViewing(null)} />}
    <section
      className={`flex flex-col rounded-md transition-colors ${over ? 'ring-2 ring-dark-fill/20 bg-subtle-gray' : ''}`}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className={sectionLabel}>Library</h3>
        <div className="flex items-center gap-3">
          <select value={filter} onChange={e => setFilter(e.target.value as 'all' | 'image' | 'deck')} className="text-xs bg-transparent text-off-black/55 focus:outline-none cursor-pointer">
            <option value="all">All</option><option value="image">Images</option><option value="deck">Decks</option>
          </select>
          <button onClick={() => fileInput.current?.click()} className={textLink} title="Upload files"><Upload className="w-3 h-3" /> Upload</button>
          <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pptx,.ppt,.key" className="hidden" onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      <p className="text-xs text-off-black/45 mb-2">Click a mockup to see it full size. Drag it onto the email, or use +.</p>
      <div className={`grid items-start gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {Object.entries(uploading).map(([name, frac]) => (
          <div key={name} className="rounded-md border border-dashed border-border-gray p-2 text-[11px] text-off-black/55">
            <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />{name}
            <div className="h-1 mt-1.5 rounded bg-subtle-gray overflow-hidden"><div className="h-full bg-dark-fill" style={{ width: `${Math.round(frac * 100)}%` }} /></div>
          </div>
        ))}
        {shown.map(a => {
          const attached = attachedIds.has(a.id)
          return (
            <div
              key={a.id}
              draggable
              onDragStart={e => { e.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(a)); e.dataTransfer.effectAllowed = 'copy' }}
              className={`group relative rounded-md border bg-white ${attached ? 'border-dark-fill' : 'border-border-gray hover:border-off-black/40'}`}
              title={`${a.name}${a.size ? ` · ${fmtSize(a.size)}` : ''}. Click to see it full size; drag onto the email to attach.`}
            >
              <div
                onClick={() => { if (a.kind === 'image' && a.previewUrl) setViewing(a); else if (a.previewUrl) window.open(a.previewUrl, '_blank', 'noopener') }}
                className={`rounded-t-md bg-subtle-gray overflow-hidden cursor-zoom-in ${a.kind === 'image' && a.previewUrl ? '' : 'aspect-square grid place-items-center'}`}
              >
                {a.kind === 'image' && a.previewUrl ? (
                  // The whole mockup at its own shape: it fills the card's width and sets the height,
                  // so nothing is cropped and there is no empty band. An expired link asks for fresh ones, once.
                  <img src={a.previewUrl} alt="" className="block w-full h-auto" draggable={false} onError={() => { if (!resigned.current) { resigned.current = true; onChanged() } }} />
                ) : a.kind === 'image' ? <ImageIcon className="w-6 h-6 text-off-black/30" /> : (
                  <div className="text-center"><FileText className="w-7 h-7 text-off-black/40 mx-auto" /><div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40 mt-1">{a.filename.split('.').pop()}{a.size ? ` · ${fmtSize(a.size)}` : ''}</div></div>
                )}
              </div>
              {editing === a.id ? (
                <form className="px-1.5 py-1.5" onSubmit={e => { e.preventDefault(); rename(a) }}>
                  <input
                    autoFocus value={draftName} disabled={renaming}
                    onChange={e => setDraftName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') stopRename() }}
                    onBlur={() => rename(a)}
                    onClick={e => e.stopPropagation()}
                    className="w-full px-1.5 py-1 text-xs font-medium text-off-black border border-border-gray rounded focus:outline-none focus:ring-2 focus:ring-off-black/15"
                  />
                </form>
              ) : (
                <div className="px-2 py-1.5 text-xs font-medium text-off-black leading-tight line-clamp-2 cursor-text" title={`${a.name}. Double-click the name to rename.`} onDoubleClick={e => { e.stopPropagation(); startRename(a) }}>{a.name}</div>
              )}
              <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); onAttach(a) }} className="w-6 h-6 rounded bg-white/95 border border-border-gray grid place-items-center hover:bg-subtle-gray" title={attached ? 'Attached' : 'Attach to this email'}>
                  {attached ? <Check className="w-3.5 h-3.5 text-success-green" /> : <Plus className="w-3.5 h-3.5" />}
                </button>
                <button onClick={e => { e.stopPropagation(); startRename(a) }} className="w-6 h-6 rounded bg-white/95 border border-border-gray grid place-items-center hover:bg-subtle-gray" title="Rename"><Pencil className="w-3 h-3" /></button>
                <button onClick={e => { e.stopPropagation(); remove(a) }} className={isArmed(`remove:${a.id}`) ? 'h-6 px-2 rounded bg-red-600 text-white text-[11px] font-medium whitespace-nowrap' : 'w-6 h-6 rounded bg-white/95 border border-border-gray grid place-items-center hover:bg-red-50 hover:text-red-700'} title="Remove from the library (emails already sent keep their copy)">{isArmed(`remove:${a.id}`) ? 'Click again to remove' : <Trash2 className="w-3.5 h-3.5" />}</button>
              </div>
              {attached && <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-dark-fill text-white grid place-items-center"><Check className="w-2.5 h-2.5" strokeWidth={3} /></div>}
            </div>
          )
        })}
        {shown.length === 0 && Object.keys(uploading).length === 0 && (
          <div className={`${compact ? 'col-span-3' : 'col-span-2'} rounded-md border border-dashed border-border-gray px-3 py-5 text-center text-[11.5px] text-off-black/50`}>
            Drop decks, mockups and images here.<br />Name files for what they are: <span className="font-medium text-off-black/70">Chicago_SIR_Mockup.png</span>.
          </div>
        )}
      </div>
    </section>
    </>
  )
}

/** One mockup, full screen. Esc or a click outside closes it. */
function Viewer({ asset, attached, onAttach, onClose }: { asset: Asset; attached: boolean; onAttach: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-off-black/80 flex flex-col items-center justify-center p-6 gap-3" onClick={onClose} role="dialog" aria-label={asset.name}>
      <img src={asset.previewUrl || ''} alt={asset.name} className="max-w-full max-h-[calc(100vh-120px)] object-contain rounded shadow-2xl" onClick={e => e.stopPropagation()} />
      <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-medium text-white">{asset.name}</span>
        <button onClick={onAttach} disabled={attached} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-off-black text-xs font-medium hover:bg-white/90 disabled:opacity-60">
          {attached ? <><Check className="w-3.5 h-3.5" /> Attached</> : <><Plus className="w-3.5 h-3.5" /> Attach to email</>}
        </button>
        <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 text-white text-xs font-medium hover:bg-white/20"><X className="w-3.5 h-3.5" /> Close</button>
      </div>
    </div>
  )
}

