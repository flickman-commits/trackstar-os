import CreatorsTabs from '@/components/CreatorsTabs'
import { toast } from 'sonner'
import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader2, Plus, X, FileText, Users, Search, ChevronLeft, Link as LinkIcon } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { pageShell, sectionLabel, infoCard } from '@/lib/ui'
import { apiFetch } from '@/lib/api'

type BriefStatus = 'active' | 'archived'

interface Brief {
  id: string
  title: string
  description: string | null
  styleOfVideo: string | null
  angle: string | null
  targetLength: string | null
  hooks: string | null
  emotion: string | null
  fomo: string | null
  persona: string | null
  examplesNotes: string | null
  status: BriefStatus
  createdAt: string
  updatedAt: string
  _count?: { assignments: number }
}

const EMPTY_BRIEF: Omit<Brief, 'id' | 'createdAt' | 'updatedAt' | '_count'> = {
  title: '',
  description: '',
  styleOfVideo: '',
  angle: '',
  targetLength: '',
  hooks: '',
  emotion: '',
  fomo: '',
  persona: '',
  examplesNotes: '',
  status: 'active',
}

export default function BriefsAdmin() {
  const [briefs, setBriefs] = useState<Brief[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  // The open brief lives in the address: /briefs/<id>, or /briefs/new.
  const { briefId = null } = useParams<{ briefId: string }>()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/creators/manage?action=list-briefs')
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      const { briefs } = await res.json()
      setBriefs(briefs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load briefs')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const close = useCallback(() => navigate('/briefs'), [navigate])
  useEffect(() => {
    if (!briefId) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [briefId, close])

  const q = query.trim().toLowerCase()
  const matches = (b: Brief) => !q || [b.title, b.description, b.styleOfVideo, b.angle].some(v => String(v || '').toLowerCase().includes(q))
  const activeBriefs = briefs.filter(b => b.status === 'active')
  const archivedBriefs = briefs.filter(b => b.status === 'archived')
  const list = (showArchived ? archivedBriefs : activeBriefs).filter(matches)
  const open = briefId === 'new' ? 'new' : briefs.find(b => b.id === briefId) || null

  return (
    <div className={pageShell}>
      <div className="px-3 md:px-5 w-full flex flex-col h-full">
        {!open && (
          <PageHeader
            title="Briefs"
            subtitle="Content direction for creators"
            pill={`${activeBriefs.length} active`}
            control={<button onClick={() => navigate('/briefs/new')} className="inline-flex items-center gap-1 text-xs font-medium bg-dark-fill text-white rounded-full px-3 py-1.5"><Plus className="w-3.5 h-3.5" /> New</button>}
          />
        )}
        <div className="pt-4 md:pt-5 pb-3 hidden md:flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
            <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Creators</h1>
            {isLoading && <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />}
          </div>
          <div className="flex-1 flex items-center justify-end gap-2 md:gap-3 min-w-0">
            <div className="relative flex-1 max-w-[640px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-off-black/40" />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); if (open) close() }}
                placeholder="Search briefs"
                className="w-full pl-9 pr-3 py-2 bg-white border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30"
              />
            </div>
            <CreatorsTabs active="briefs" />
            <button onClick={() => navigate('/briefs/new')} className="inline-flex items-center gap-1.5 px-3 py-2 bg-dark-fill text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity whitespace-nowrap">
              <Plus className="w-4 h-4" /> New brief
            </button>
          </div>
        </div>

        {error && !isLoading && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 mb-3 text-sm text-red-800 flex-shrink-0">{error}</div>
        )}

        {open ? (
          <div className="flex-1 min-h-0 overflow-y-auto pb-36 md:pb-8">
            <BriefEditor
              key={open === 'new' ? 'new' : open.id}
              brief={open === 'new' ? null : open}
              onClose={close}
              onSaved={async (id) => { await load(); navigate(id ? `/briefs/${id}` : '/briefs', { replace: true }) }}
            />
          </div>
        ) : briefId && isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-off-black/30" /></div>
        ) : (
          <section className="flex-1 min-h-0 pb-3">
            <div className="h-full bg-white border border-border-gray rounded-lg shadow-sm overflow-hidden flex flex-col">
              <div className="flex items-center gap-1 px-3 py-2.5 border-b border-border-gray flex-shrink-0">
                {([['Active', false, activeBriefs.length], ['Archived', true, archivedBriefs.length]] as const).map(([label, arch, n]) => (
                  <button
                    key={label}
                    onClick={() => setShowArchived(arch)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${showArchived === arch ? 'bg-dark-fill text-white' : 'text-off-black/70 hover:bg-subtle-gray'}`}
                  >
                    {label} <span className={`text-xs ${showArchived === arch ? 'text-white/70' : 'text-off-black/40'}`}>{n}</span>
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto">
                {isLoading ? (
                  <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-off-black/30" /></div>
                ) : list.length === 0 ? (
                  <div className="text-center py-20 px-6">
                    <FileText className="w-8 h-8 text-off-black/25 mx-auto mb-2" />
                    <p className="text-sm text-off-black/50">{q ? `No briefs match "${query}".` : showArchived ? 'Nothing archived.' : 'No briefs yet. Click New brief to write the first.'}</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border-gray">
                    {list.map(b => <BriefCard key={b.id} brief={b} onClick={() => navigate(`/briefs/${b.id}`)} muted={b.status === 'archived'} />)}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function BriefCard({ brief, onClick, muted = false }: { brief: Brief; onClick: () => void; muted?: boolean }) {
  return (
    <li onClick={onClick} className={`px-4 py-3.5 hover:bg-subtle-gray cursor-pointer transition-colors flex items-center gap-4 ${muted ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-off-black">{brief.title}</span>
          {brief.styleOfVideo && <Chip label={brief.styleOfVideo} />}
          {brief.targetLength && <Chip label={brief.targetLength} />}
          {brief.angle && <Chip label={brief.angle} />}
        </div>
        {brief.description && <p className="text-xs text-off-black/60 mt-1 line-clamp-2 max-w-[90ch]">{brief.description}</p>}
      </div>
      <span className="inline-flex items-center gap-1 text-xs text-off-black/50 shrink-0" title="Creators assigned">
        <Users className="w-3.5 h-3.5" /> {brief._count?.assignments ?? 0}
      </span>
    </li>
  )
}

function Chip({ label }: { label: string }) {
  return (
    <span className="px-1.5 py-0.5 text-[10px] font-medium text-off-black/60 bg-off-black/5 rounded">
      {label}
    </span>
  )
}

function BriefEditor({ brief, onClose, onSaved }: {
  brief: Brief | null
  onClose: () => void
  /** Called with the brief's id once it is saved. */
  onSaved: (id: string | null) => void | Promise<void>
}) {
  const isNew = brief === null
  const [draft, setDraft] = useState(brief || { ...EMPTY_BRIEF, id: '', createdAt: '', updatedAt: '' } as Brief)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!draft.title.trim()) {
      toast.error('Title is required')
      return
    }
    setIsSaving(true)
    try {
      const body = isNew
        ? {
            action: 'create-brief',
            title: draft.title,
            description: draft.description,
            styleOfVideo: draft.styleOfVideo,
            angle: draft.angle,
            targetLength: draft.targetLength,
            hooks: draft.hooks,
            emotion: draft.emotion,
            fomo: draft.fomo,
            persona: draft.persona,
            examplesNotes: draft.examplesNotes,
            status: draft.status,
          }
        : {
            action: 'update-brief',
            briefId: draft.id,
            updates: {
              title: draft.title,
              description: draft.description,
              styleOfVideo: draft.styleOfVideo,
              angle: draft.angle,
              targetLength: draft.targetLength,
              hooks: draft.hooks,
              emotion: draft.emotion,
              fomo: draft.fomo,
              persona: draft.persona,
              examplesNotes: draft.examplesNotes,
              status: draft.status,
            }
          }

      const res = await apiFetch('/api/creators/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Save failed: ${res.status}`)
      await onSaved(data.brief?.id || draft.id || null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setIsSaving(false)
    }
  }

  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(brief)
  const set = (k: keyof Brief) => (v: string) => setDraft({ ...draft, [k]: v })

  return (
    <div className="bg-white border border-border-gray rounded-md w-full">
      {/* Header, as on an order: back, status, title, and Save. */}
      <div className="sticky top-0 z-30 px-4 md:px-6 py-3 md:py-4 bg-white/95 backdrop-blur border-b border-border-gray rounded-t-md flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button onClick={onClose} title="Back to briefs (Esc)" className="inline-flex items-center gap-1 -ml-1 px-1.5 py-1 text-off-black/60 hover:text-off-black hover:bg-off-black/5 rounded transition-colors">
            <ChevronLeft className="w-5 h-5 md:w-4 md:h-4" />
            <span className="text-sm hidden md:inline">Briefs</span>
          </button>
          {!isNew && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${draft.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-off-black/5 text-off-black/50'}`}>
              {draft.status === 'active' ? 'Active' : 'Archived'}
            </span>
          )}
          <h3 className="text-lg md:text-xl font-semibold text-off-black truncate">{isNew ? 'New brief' : brief?.title}</h3>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving || !draft.title.trim() || !dirty}
          className="inline-flex items-center gap-2 px-4 py-2 bg-dark-fill text-white text-sm font-medium rounded-md hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {isSaving ? 'Saving' : isNew ? 'Create brief' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <div className="p-4 md:p-6 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5">
        {/* Left: what the creator reads. */}
        <div className="space-y-5 min-w-0">
          <FieldText label="Title" value={draft.title} onChange={set('title')} placeholder="e.g. Unboxing reveal, marathon finisher" autoFocus={isNew} />
          <FieldText label="Description" value={draft.description} onChange={set('description')} multiline placeholder="Overall goal or context of this brief" />
          <div>
            <div className={sectionLabel}>Information framework</div>
            <div className={`${infoCard} mt-2 space-y-3`}>
              <FieldText label="Hook: opening line options" value={draft.hooks} onChange={set('hooks')} multiline placeholder={`I trained 6 months for this moment…\nThe one thing no runner talks about…`} />
              <FieldText label="Emotion: what feeling should the video land?" value={draft.emotion} onChange={set('emotion')} multiline placeholder="e.g. pride, nostalgia, validation" />
              <FieldText label="FOMO: why should they act now?" value={draft.fomo} onChange={set('fomo')} multiline placeholder="e.g. only marathon finishers get this" />
            </div>
          </div>
          <div>
            <div className={sectionLabel}>Top-performing references</div>
            <div className={`${infoCard} mt-2`}>
              <ReferencesField value={draft.examplesNotes} onChange={set('examplesNotes')} />
            </div>
          </div>
        </div>

        {/* Right: the details and the status. */}
        <div className="space-y-4">
          <div>
            <div className={sectionLabel}>Status</div>
            <select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as BriefStatus })}
              className="mt-2 w-full px-3 py-2 border border-border-gray rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-off-black/20"
            >
              <option value="active">Active (creators see it)</option>
              <option value="archived">Archived (hidden)</option>
            </select>
          </div>
          <div>
            <div className={sectionLabel}>Production details</div>
            <div className={`${infoCard} mt-2 space-y-3`}>
              <FieldText label="Style of video" value={draft.styleOfVideo} onChange={set('styleOfVideo')} placeholder="e.g. POV reveal, talking head" />
              <FieldText label="Target length" value={draft.targetLength} onChange={set('targetLength')} placeholder="e.g. 15-30s" />
              <FieldText label="Angle" value={draft.angle} onChange={set('angle')} placeholder="e.g. emotional payoff" />
              <FieldText label="Persona" value={draft.persona} onChange={set('persona')} placeholder="Who they're speaking to" />
            </div>
          </div>
          {!isNew && (
            <p className="text-xs text-off-black/50 inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Assigned to {brief?._count?.assignments ?? 0} creator{(brief?._count?.assignments ?? 0) === 1 ? '' : 's'}</p>
          )}
          <div className="text-xs text-off-black/55 leading-relaxed border-t border-border-gray pt-3">
            <span className="font-semibold text-off-black">Guardrails, not scripts.</span> Show what has worked, explain the framework (hook, emotion, FOMO), then let creators find their own voice.
          </div>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-off-black/60 mb-1">{children}</div>
}

function FieldText({ label, value, onChange, multiline, placeholder, autoFocus }: {
  label: string
  value: string | null
  onChange: (v: string) => void
  multiline?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div>
      <Label>{label}</Label>
      {multiline ? (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20 resize-none"
        />
      ) : (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
        />
      )}
    </div>
  )
}

// Top-performing references — list of {url, note} rows. Persisted as a single
// string in `examplesNotes`, one row per line, formatted as `URL` or `URL — note`.
type Reference = { url: string; note: string }

function parseReferences(raw: string | null): Reference[] {
  if (!raw) return []
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const urlMatch = line.match(/https?:\/\/\S+/)
      if (urlMatch) {
        const url = urlMatch[0]
        const rest = line.replace(url, '').replace(/^[\s-–-]+/, '').trim()
        return { url, note: rest }
      }
      return { url: '', note: line }
    })
}

function serializeReferences(refs: Reference[]): string {
  return refs
    .map(r => {
      const url = r.url.trim()
      const note = r.note.trim()
      if (url && note) return `${url} - ${note}`
      return url || note
    })
    .filter(Boolean)
    .join('\n')
}

function ReferencesField({ value, onChange }: {
  value: string | null
  onChange: (v: string) => void
}) {
  const [refs, setRefs] = useState<Reference[]>(() => {
    const parsed = parseReferences(value)
    return parsed.length > 0 ? parsed : [{ url: '', note: '' }]
  })

  const update = (next: Reference[]) => {
    setRefs(next)
    onChange(serializeReferences(next))
  }

  const updateRow = (i: number, patch: Partial<Reference>) => {
    update(refs.map((r, idx) => idx === i ? { ...r, ...patch } : r))
  }

  const addRow = () => update([...refs, { url: '', note: '' }])
  const removeRow = (i: number) => {
    const next = refs.filter((_, idx) => idx !== i)
    update(next.length > 0 ? next : [{ url: '', note: '' }])
  }

  return (
    <div>
      <Label>Top-Performing References</Label>
      <div className="space-y-2">
        {refs.map((r, i) => (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-2">
              <div className="relative">
                <LinkIcon className="w-3.5 h-3.5 text-off-black/30 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={r.url}
                  onChange={(e) => updateRow(i, { url: e.target.value })}
                  placeholder="https://…"
                  className="w-full pl-8 pr-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                />
              </div>
              <input
                type="text"
                value={r.note}
                onChange={(e) => updateRow(i, { note: e.target.value })}
                placeholder="Why it works (optional)"
                className="w-full px-3 py-2 border border-border-gray rounded text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
              />
            </div>
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="p-2 text-off-black/40 hover:text-off-black hover:bg-off-black/5 rounded transition-colors"
              aria-label="Remove reference"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-off-black/60 hover:text-off-black transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add reference
      </button>
    </div>
  )
}
