import PageHeader from '@/components/PageHeader'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Braces, FileText, ImagePlus, Loader2, Plus, Search, StickyNote, Trash2, X } from 'lucide-react'
import {
  btnPrimary, btnSecondary, btnGhost, inputBase, fieldLabel, cardLabel, sectionLabel, segment, segmentGroup,
  pageShell, listCard, chip, chipTone,
} from '@/lib/ui'
import { salesApi, type CustomVariable, type LibraryTemplate, type SequencePipeline, type SequenceStep, type TemplateMotion, type TemplateNote, type Workspace } from '@/lib/salesApi'
import { BodyEditor } from '@/components/sales/Composer'
import { useArmed } from '@/lib/useArmed'
import type { Asset } from '@/types/sales'
import { TIPS, wordCount, isThreadReply } from '@/lib/coldEmailTips'
import { useDocumentHead } from '@/lib/useDocumentHead'
import { useAuth } from '@/lib/auth'

/**
 * The Sales workspace: Templates, Sequences and Variables, each a page.
 *
 * Templates hold all the wording. A sequence holds none: it is the order of
 * templates for a motion and the days to wait between them. Variables are the
 * [Bracketed] words a template can use, the tool's own (from Attio) and the
 * ones you set yourself. New templates start with a [First line] the person
 * writes for each email; one can be taken out.
 */
type Section = 'templates' | 'sequences' | 'variables'
const MOTION_OF: Record<SequencePipeline, TemplateMotion> = { RACE: 'Race', CHARITY: 'Charity', PR: 'PR' }
const MOTION_TONE: Record<string, string> = { Race: chipTone.race, Charity: chipTone.charity, PR: chipTone.pr, Any: chipTone.quiet }

function usedBy(ws: Workspace, id: string) {
  const out: string[] = []
  for (const p of Object.keys(ws.sequences) as SequencePipeline[]) (ws.sequences[p] || []).forEach((s, i) => { if (s.templateId === id) out.push(`${MOTION_OF[p]} step ${i + 1}`) })
  return out
}

export default function SalesWorkspace() {
  const location = useLocation()
  const section: Section = location.pathname.endsWith('/sequences') ? 'sequences' : location.pathname.endsWith('/variables') ? 'variables' : 'templates'
  useDocumentHead({ title: `${section[0].toUpperCase()}${section.slice(1)} · Sales · Trackstar` })
  const [ws, setWs] = useState<Workspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { setWs(await salesApi.workspace()); setError(null) } catch (e) { setError((e as Error).message) }
  }, [])
  useEffect(() => { load() }, [load])

  const tabs: [Section | 'outreach', string, string][] = [
    ['outreach', 'Outreach', '/sales'], ['templates', 'Templates', '/sales/templates'], ['sequences', 'Sequences', '/sales/sequences'], ['variables', 'Variables', '/sales/variables'],
  ]
  return (
    <div className={pageShell}>
      <div className="px-3 md:px-5 w-full flex flex-col h-full">
        <PageHeader title="Sales" subtitle={tabs.find(t => t[0] === section)?.[1]} control={
          <select value={tabs.find(t => t[0] === section)?.[2] || '/sales'} onChange={e => { window.location.assign(e.target.value) }} className="text-xs font-medium bg-white border border-border-gray rounded-full pl-3 pr-7 py-1.5 appearance-none">
            {tabs.map(([key, label, to]) => <option key={key} value={to}>{label}</option>)}
          </select>
        } />
        <div className="pt-4 md:pt-5 pb-3 md:pb-4 hidden md:flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
            <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Sales</h1>
          </div>
          <div className={segmentGroup}>
            {tabs.map(([key, label, to]) => <Link key={key} to={to} className={segment(section === key, 'md')}>{label}</Link>)}
          </div>
        </div>
        <section className="flex-1 flex flex-col min-h-0 pb-3">
          <div className={listCard}>
            {error ? <div className="p-6 text-sm text-red-700">{error}</div>
              : !ws ? <div className="flex-1 grid place-items-center text-off-black/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
              : section === 'templates' ? <Templates ws={ws} reload={load} />
              : section === 'sequences' ? <Sequences ws={ws} reload={load} />
              : <Variables ws={ws} reload={load} />}
          </div>
        </section>
      </div>
    </div>
  )
}

// ── Templates ────────────────────────────────────────────────────────────────

const MOTIONS: TemplateMotion[] = ['Race', 'Charity', 'PR', 'Any']

function Templates({ ws, reload }: { ws: Workspace; reload: () => Promise<void> }) {
  const { isAdmin } = useAuth()
  // Deleting takes a second click, in the page (Arc blocks window.confirm).
  const { arm, isArmed } = useArmed()
  const location = useLocation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TemplateMotion | 'All'>('All')
  const wanted = new URLSearchParams(location.search).get('id')
  const [id, setId] = useState<string | null>(wanted || ws.templates[0]?.id || null)
  const [draft, setDraft] = useState<Partial<LibraryTemplate> | null>(null)
  const [saving, setSaving] = useState(false)
  const [varsOpen, setVarsOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const lastField = useRef<'subject' | 'body'>('body')
  const bodyRange = useRef<Range | null>(null)
  const subjectAt = useRef<number | null>(null)

  const saved = ws.templates.find(t => t.id === id) || null
  useEffect(() => { setDraft(saved ? { ...saved } : id === 'new' ? { name: '', motion: filter === 'All' ? 'Any' : filter, useFor: '', subject: '', body: 'Hey [First Name],\n\n[First line]\n\n' } : null) }, [id, ws]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (wanted) setId(wanted) }, [wanted])

  const shown = ws.templates.filter(t => (filter === 'All' || t.motion === filter) && (!query || `${t.name} ${t.useFor || ''} ${t.body} ${(t.notes || []).map(n => `${n.text} ${n.from || ''}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())))
  const dirty = Boolean(draft) && (!saved || (['name', 'motion', 'useFor', 'subject', 'body'] as const).some(k => (draft?.[k] || '') !== (saved[k] || ''))
    || (draft?.assetIds || []).join() !== (saved.assetIds || []).join())
  const names = [...ws.builtIn.map(([n]) => n), ...ws.variables.map(v => v.name)]

  const insert = (name: string) => {
    const token = `[${name}]`
    setVarsOpen(false)
    if (!draft) return
    if (lastField.current === 'subject') {
      const v = draft.subject || ''
      const at = subjectRef.current?.selectionStart ?? subjectAt.current ?? v.length
      setDraft({ ...draft, subject: `${v.slice(0, at)}${token}${v.slice(at)}` })
      requestAnimationFrame(() => { subjectRef.current?.focus(); subjectRef.current?.setSelectionRange(at + token.length, at + token.length) })
      return
    }
    const el = bodyRef.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    if (bodyRange.current && el.contains(bodyRange.current.startContainer)) { sel?.removeAllRanges(); sel?.addRange(bodyRange.current) }
    document.execCommand('insertText', false, token)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const r = await salesApi.saveLibraryTemplate({ ...draft, id: saved?.id })
      const next = saved ? saved.id : r.templates[r.templates.length - 1]?.id
      await reload()
      if (next) { setId(next); navigate(`/sales/templates?id=${next}`, { replace: true }) }
      toast.success('Template saved')
    } catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }
  const remove = async () => {
    if (!saved || !arm(`delete:${saved.id}`)) return
    try { await salesApi.deleteLibraryTemplate(saved.id); await reload(); setId(null); toast.message('Template deleted') }
    catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr]">
      <aside className="border-r border-border-gray flex flex-col min-h-0">
        <div className="p-3 border-b border-border-gray space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-off-black/40" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates" className={`${inputBase} w-full pl-9`} />
          </div>
          <div className={`${segmentGroup} flex-wrap`}>
            {(['All', ...MOTIONS] as const).map(m => <button key={m} onClick={() => setFilter(m)} className={segment(filter === m)}>{m}</button>)}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {shown.map(t => {
            const used = usedBy(ws, t.id)
            return (
              <button key={t.id} onClick={() => setId(t.id)} className={`w-full text-left px-4 py-3 border-b border-border-gray ${t.id === id ? 'bg-off-black/[0.045] shadow-[inset_3px_0_0_0_#242424]' : 'hover:bg-subtle-gray'}`}>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-medium text-off-black truncate flex-1">{t.name}</span>
                  <span className={`${chip} ${MOTION_TONE[t.motion] || chipTone.quiet} text-[10px] px-1.5 py-0.5`}>{t.motion === 'Any' ? 'Any' : t.motion}</span>
                </span>
                {(used.length > 0 || (t.notes?.length ?? 0) > 0) && (
                  <span className="flex items-center gap-2 text-[11px] text-off-black/45 mt-0.5">
                    {used.length > 0 && <span className="truncate">In {used.join(', ')}</span>}
                    {(t.notes?.length ?? 0) > 0 && <span className="inline-flex items-center gap-0.5 shrink-0"><StickyNote className="w-3 h-3" />{t.notes!.length}</span>}
                  </span>
                )}
              </button>
            )
          })}
          {shown.length === 0 && <p className="p-4 text-sm text-off-black/45">No templates match.</p>}
        </div>
        <div className="p-3 border-t border-border-gray">
          <button onClick={() => setId('new')} className={`${btnSecondary} w-full`}><Plus className="w-3.5 h-3.5" /> New template</button>
        </div>
      </aside>

      {draft ? (
        <div className="min-h-0 flex">
        <div className="min-h-0 overflow-y-auto flex-1 min-w-0">
          <div className="max-w-3xl px-8 py-6 space-y-4">
            <div className="grid grid-cols-[1fr_150px] gap-3">
              <div><label className={fieldLabel}>Name</label><input value={draft.name || ''} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Brand activation pitch" className={`${inputBase} w-full`} /></div>
              <div><label className={fieldLabel}>For</label>
                <select value={draft.motion || 'Any'} onChange={e => setDraft({ ...draft, motion: e.target.value as TemplateMotion })} className={`${inputBase} w-full`}>
                  {MOTIONS.map(m => <option key={m} value={m}>{m === 'Any' ? 'Any deal' : m}</option>)}
                </select>
              </div>
            </div>
            <div><label className={fieldLabel}>When to use it</label><input value={draft.useFor || ''} onChange={e => setDraft({ ...draft, useFor: e.target.value })} placeholder="Cold first touch for gift guide editors" className={`${inputBase} w-full`} /></div>
            <div>
              <div className="flex items-center justify-between">
                <label className={fieldLabel}>Subject</label>
                {draft.subject?.trim() && !isThreadReply(draft.subject) && (
                  <span className={`text-[10px] mb-1 ${draft.subject.trim().length > TIPS.maxSubjectChars ? 'text-amber-700' : 'text-off-black/40'}`}>
                    {draft.subject.trim().length} / {TIPS.maxSubjectChars}{draft.subject.trim().length > TIPS.maxSubjectChars ? ` · under ${TIPS.maxSubjectChars} characters opens best` : ''}
                  </span>
                )}
              </div>
              <input
                ref={subjectRef} value={draft.subject || ''} placeholder="Leave empty to reply on the same thread"
                onChange={e => setDraft({ ...draft, subject: e.target.value })}
                onFocus={() => { lastField.current = 'subject' }}
                onBlur={e => { subjectAt.current = e.currentTarget.selectionStart }}
                className={`${inputBase} w-full`}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="flex items-center gap-2">
                  <label className={`${fieldLabel} mb-0`}>Body</label>
                  {(() => { const n = wordCount(draft.body || ''); return <span className={`text-[10px] ${n > TIPS.maxWords ? 'text-amber-700' : 'text-off-black/40'}`}>{n} words{n > TIPS.maxWords ? ` · under ${TIPS.maxWords} got a ${TIPS.replyRate} reply rate` : ''}</span> })()}
                </span>
                <div className="relative">
                  <button onMouseDown={e => e.preventDefault()} onClick={() => setVarsOpen(o => !o)} className={btnGhost}><Braces className="w-3.5 h-3.5" /> Insert variable</button>
                  {varsOpen && (
                    <div className="absolute right-0 top-full mt-1 z-20 w-56 max-h-72 overflow-y-auto rounded-lg border border-border-gray bg-white shadow-lg py-1">
                      {names.map(n => (
                        <button key={n} onMouseDown={e => e.preventDefault()} onClick={() => insert(n)} className="w-full text-left px-3 py-1.5 text-sm hover:bg-subtle-gray">[{n}]</button>
                      ))}
                      <Link to="/sales/variables" className="block px-3 py-1.5 text-xs text-blue-600 border-t border-border-gray mt-1">Edit variables</Link>
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-md border border-border-gray px-2 py-2 focus-within:ring-2 focus-within:ring-off-black/10" onFocusCapture={() => { lastField.current = 'body' }}>
                <BodyEditor
                  bare boxRef={bodyRef} body={draft.body || ''} minHeight={280} signature={ws.signature}
                  onChange={v => setDraft(d => (d ? { ...d, body: v } : d))}
                  onBlur={() => {
                    const sel = window.getSelection()
                    if (sel?.rangeCount && bodyRef.current?.contains(sel.anchorNode)) bodyRange.current = sel.getRangeAt(0).cloneRange()
                  }}
                />
              </div>
              <p className="text-xs text-off-black/45 mt-1.5 leading-snug">
                [First line] is the opener you write for each email: it shows as a blank in the composer and the email will not send until it is written. New templates start with one; delete it if this template does not need it.
                Leave out the sign-off: your signature is added on send, and anything under it goes out as a P.S. ⌘K adds a link.
              </p>
            </div>
            <TemplateImages ids={draft.assetIds || []} onChange={assetIds => setDraft(d => (d ? { ...d, assetIds } : d))} />
            <div className="flex items-center justify-between pt-2">
              {saved && isAdmin ? <button onClick={remove} className={`${btnGhost} text-red-700 hover:text-red-800`}><Trash2 className="w-3.5 h-3.5" /> {isArmed(`delete:${saved.id}`) ? 'Click again to delete for good' : 'Delete'}</button> : <span />}
              <button onClick={save} disabled={saving || !dirty || !draft.name?.trim()} className={`${btnPrimary} px-4 py-2`}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} {saved ? 'Save changes' : 'Add template'}</button>
            </div>
          </div>
        </div>
        <TemplateNotes template={saved} reload={reload} />
        </div>
      ) : <div className="grid place-items-center text-sm text-off-black/45">Pick a template, or add one.</div>}
    </div>
  )
}

/**
 * Images (and other library files) that go with the template: attached
 * whenever it is picked in the composer, at the end of the email.
 */
function TemplateImages({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { salesApi.assets().then(r => setAssets(r.assets || [])).catch(() => setAssets([])) }, [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const chosen = ids.map(id => assets?.find(a => a.id === id) || null)
  const toggle = (id: string) => onChange(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  return (
    <div ref={box} className="relative">
      <div className="flex items-center justify-between mb-1">
        <label className={`${fieldLabel} mb-0`}>Images</label>
        <button onClick={() => setOpen(o => !o)} className={btnGhost}><ImagePlus className="w-3.5 h-3.5" /> Add from library</button>
      </div>
      {ids.length === 0 ? (
        <p className="text-xs text-off-black/45">None. Images added here are attached whenever this template is used.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {chosen.map((a, i) => (
            <div key={ids[i]} className="group relative w-24 rounded-md border border-border-gray bg-white overflow-hidden">
              <div className="aspect-square bg-subtle-gray grid place-items-center">
                {a?.previewUrl ? <img src={a.previewUrl} alt={a.name} className="w-full h-full object-contain" /> : <FileText className="w-5 h-5 text-off-black/30" />}
              </div>
              <div className="px-1.5 py-1 text-[10px] text-off-black/70 truncate">{a?.name || 'Not in the library'}</div>
              <button onClick={() => toggle(ids[i])} title="Remove" className="absolute top-1 right-1 p-0.5 rounded bg-white/90 text-off-black/50 opacity-0 group-hover:opacity-100 hover:text-red-700"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute right-0 top-8 z-20 w-[420px] max-h-80 overflow-y-auto rounded-lg border border-border-gray bg-white shadow-lg p-2">
          {!assets ? <div className="p-4 grid place-items-center text-off-black/40"><Loader2 className="w-4 h-4 animate-spin" /></div>
            : assets.length === 0 ? <p className="p-3 text-xs text-off-black/50">The library is empty. Upload images from the library panel on the Outreach page.</p>
            : (
              <div className="grid grid-cols-4 gap-2">
                {assets.map(a => {
                  const on = ids.includes(a.id)
                  return (
                    <button key={a.id} onClick={() => toggle(a.id)} className={`text-left rounded-md border overflow-hidden ${on ? 'border-off-black ring-1 ring-off-black' : 'border-border-gray hover:border-off-black/40'}`} title={a.name}>
                      <div className="aspect-square bg-subtle-gray grid place-items-center">
                        {a.previewUrl ? <img src={a.previewUrl} alt={a.name} className="w-full h-full object-contain" /> : <FileText className="w-5 h-5 text-off-black/30" />}
                      </div>
                      <div className="px-1.5 py-1 text-[10px] text-off-black/70 truncate">{a.name}</div>
                    </button>
                  )
                })}
              </div>
            )}
        </div>
      )}
    </div>
  )
}

/**
 * Notes beside a template: advice and reminders (a PR friend's notes on a
 * pitch). They never go into an email; the composer shows them as a
 * reminder when the template is picked.
 */
function TemplateNotes({ template, reload }: { template: LibraryTemplate | null; reload: () => Promise<void> }) {
  const [text, setText] = useState('')
  const [from, setFrom] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const { arm, isArmed } = useArmed()
  useEffect(() => { setText(''); setFrom('') }, [template?.id])
  const notes: TemplateNote[] = [...(template?.notes || [])].reverse()

  const add = async () => {
    if (!template || !text.trim()) return
    setBusy('add')
    try { await salesApi.addTemplateNote(template.id, text, from); setText(''); await reload() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const remove = async (n: TemplateNote) => {
    if (!template || !arm(`remove:${n.id}`)) return
    setBusy(n.id)
    try { await salesApi.deleteTemplateNote(template.id, n.id); await reload() }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border-gray bg-subtle-gray/40 flex flex-col min-h-0">
      <div className="px-4 pt-5 pb-3 flex items-center gap-1.5">
        <StickyNote className="w-3.5 h-3.5 text-off-black/45" />
        <span className={sectionLabel}>Notes</span>
        {notes.length > 0 && <span className="text-[11px] text-off-black/40">{notes.length}</span>}
      </div>
      {!template ? (
        <p className="px-4 text-xs text-off-black/45 leading-snug">Add the template first, then keep notes on it here.</p>
      ) : (
        <>
          <div className="px-4 space-y-2">
            <textarea
              value={text} onChange={e => setText(e.target.value)} rows={3}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add() } }}
              placeholder="A reminder or advice for this pitch. Never sent."
              className={`${inputBase} w-full resize-y text-sm`}
            />
            <div className="flex items-center gap-2">
              <input value={from} onChange={e => setFrom(e.target.value)} placeholder="From (optional)" className={`${inputBase} flex-1 min-w-0 text-sm`} />
              <button onClick={add} disabled={!text.trim() || busy === 'add'} className={btnSecondary}>{busy === 'add' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2.5">
            {notes.length === 0 && <p className="text-xs text-off-black/40 leading-snug">No notes yet. Notes show as a reminder when you pick this template in the composer.</p>}
            {notes.map(n => (
              <div key={n.id} className="group relative rounded-md border border-border-gray bg-white px-3 py-2.5">
                <p className="text-[13px] text-off-black leading-snug whitespace-pre-wrap break-words pr-5">{n.text}</p>
                <p className="text-[11px] text-off-black/45 mt-1.5">
                  {n.from ? <span className="font-medium text-off-black/60">{n.from}</span> : null}
                  {n.from ? ' · ' : ''}{new Date(n.addedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <button
                  onClick={() => remove(n)} disabled={busy === n.id} title="Remove note"
                  className={isArmed(`remove:${n.id}`)
                    ? 'absolute top-2 right-2 px-1.5 py-0.5 rounded bg-red-600 text-white text-[11px] font-medium'
                    : 'absolute top-2 right-2 p-0.5 rounded text-off-black/30 opacity-0 group-hover:opacity-100 hover:text-red-700 hover:bg-red-50 transition-opacity'}
                >{isArmed(`remove:${n.id}`) ? 'Click again to remove' : <X className="w-3.5 h-3.5" />}</button>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}

// ── Sequences ────────────────────────────────────────────────────────────────

function Sequences({ ws, reload }: { ws: Workspace; reload: () => Promise<void> }) {
  const [pipeline, setPipeline] = useState<SequencePipeline>('RACE')
  const [steps, setSteps] = useState<SequenceStep[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => { setSteps((ws.sequences[pipeline] || []).map(s => ({ ...s }))) }, [pipeline, ws])

  const motion = MOTION_OF[pipeline]
  const byId = useMemo(() => Object.fromEntries(ws.templates.map(t => [t.id, t])), [ws.templates])
  const options = ws.templates.filter(t => t.motion === motion || t.motion === 'Any')
  const dirty = JSON.stringify(steps) !== JSON.stringify(ws.sequences[pipeline] || [])
  const totalDays = steps.slice(1).reduce((n, s) => n + (Number(s.waitDays) || 0), 0)

  const set = (i: number, patch: Partial<SequenceStep>) => setSteps(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const move = (i: number, by: number) => setSteps(prev => {
    const next = prev.slice(); const [s] = next.splice(i, 1); next.splice(i + by, 0, s)
    return next.map((x, j) => (j === 0 ? { ...x, waitDays: 0, replyInThread: false } : { ...x, waitDays: x.waitDays || 4 }))
  })
  const add = () => setSteps(prev => [...prev, { templateId: options[0]?.id || ws.templates[0]?.id || '', waitDays: prev.length ? 4 : 0, replyInThread: prev.length > 0 }])
  const remove = (i: number) => setSteps(prev => prev.filter((_, j) => j !== i).map((x, j) => (j === 0 ? { ...x, waitDays: 0, replyInThread: false } : x)))

  const save = async () => {
    setSaving(true)
    try { await salesApi.saveSequence(pipeline, steps); await reload(); toast.success(`${motion} sequence saved`) }
    catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between gap-3 mb-1">
          <div className={segmentGroup}>
            {(Object.keys(MOTION_OF) as SequencePipeline[]).map(p => <button key={p} onClick={() => setPipeline(p)} className={segment(pipeline === p, 'md')}>{MOTION_OF[p]}</button>)}
          </div>
          <button onClick={save} disabled={saving || !dirty} className={`${btnPrimary} px-4 py-2`}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save sequence</button>
        </div>
        <p className="text-sm text-off-black/55 mb-5">
          {steps.length} {steps.length === 1 ? 'email' : 'emails'} over {totalDays} days. Each step starts from a template; you still write the first line and send it yourself.
          {pipeline === 'RACE' ? ' Corporate deals use this sequence too.' : ''}
        </p>
        {steps.length > TIPS.maxFollowUps + 1 && (
          <div className="-mt-3 mb-5 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {steps.length - 1} follow-ups. Cold email has done best with {TIPS.maxFollowUps} at most; consider ending this sequence at step {TIPS.maxFollowUps + 1}.
          </div>
        )}

        <ol className="space-y-0">
          {steps.map((s, i) => {
            const t = byId[s.templateId]
            return (
              <li key={i}>
                {i > 0 && (
                  <div className="flex items-center gap-3 pl-[19px] py-1.5">
                    <span className="w-px self-stretch bg-border-gray" />
                    <span className="text-xs text-off-black/55 flex items-center gap-2 py-1">
                      Wait
                      <input type="number" min={1} max={60} value={s.waitDays} onChange={e => set(i, { waitDays: Number(e.target.value) })} className={`${inputBase} w-16 py-1 text-xs`} />
                      days, then
                    </span>
                  </div>
                )}
                <div className="rounded-lg border border-border-gray bg-white p-4 flex gap-4">
                  <span className="w-10 h-10 rounded-full bg-subtle-gray border border-border-gray grid place-items-center text-sm font-semibold text-off-black shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <select value={s.templateId} onChange={e => set(i, { templateId: e.target.value })} className={`${inputBase} flex-1 min-w-0`}>
                        {!byId[s.templateId] && <option value="">Pick a template</option>}
                        {[...options, ...(t && !options.includes(t) ? [t] : [])].map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <button onClick={() => move(i, -1)} disabled={i === 0} className={btnGhost} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className={btnGhost} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(i)} disabled={steps.length === 1} className={`${btnGhost} hover:text-red-700`} title="Remove step"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    {t && (
                      <div className="text-xs text-off-black/55 leading-snug">
                        <span className={cardLabel}>Subject</span>{' '}
                        {i > 0 && s.replyInThread ? <span className="italic">Replies on the same thread</span> : (t.subject || <span className="italic">Replies on the same thread</span>)}
                        <p className="mt-1 line-clamp-2 text-off-black/45">{t.body.replace(/\[First line\]\n*/g, '').replace(/\n+/g, ' ')}</p>
                      </div>
                    )}
                    <div className="flex items-center gap-4 text-xs">
                      {i > 0 && (
                        <label className="inline-flex items-center gap-1.5 text-off-black/60">
                          <input type="checkbox" checked={s.replyInThread} onChange={e => set(i, { replyInThread: e.target.checked })} /> Reply on the same thread
                        </label>
                      )}
                      {t && <Link to={`/sales/templates?id=${t.id}`} className="text-blue-600 hover:text-blue-700">Edit template</Link>}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
        <button onClick={add} disabled={steps.length >= 12} className={`${btnSecondary} mt-4`}><Plus className="w-3.5 h-3.5" /> Add step</button>
      </div>
    </div>
  )
}

// ── Variables ────────────────────────────────────────────────────────────────

/** Built-ins that are not read from the deal: the opener you write, and your own name. */
const PER_EMAIL = new Set(['First line', 'Your name'])

function Variables({ ws, reload }: { ws: Workspace; reload: () => Promise<void> }) {
  const [rows, setRows] = useState<CustomVariable[]>(ws.variables.map(v => ({ ...v })))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setRows(ws.variables.map(v => ({ ...v }))) }, [ws])
  const dirty = JSON.stringify(rows) !== JSON.stringify(ws.variables)
  const save = async () => {
    setSaving(true)
    try { await salesApi.saveVariables(rows.filter(r => r.name.trim() || r.value.trim())); await reload(); toast.success('Variables saved') }
    catch (e) { toast.error((e as Error).message) }
    finally { setSaving(false) }
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-8">
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className={sectionLabel}>Your variables</h2>
            {dirty || saving
              ? <button onClick={save} disabled={saving} className={`${btnPrimary} px-4 py-2`}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Save</button>
              : <span className="text-xs text-off-black/45">All saved</span>}
          </div>
          <p className="text-sm text-off-black/55 mb-3">Text you set once and use in any template as [Name]. Change it here and every template that uses it changes with it. These are the ones you add here; the ones below come from Attio and your profile.</p>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[200px_1fr_auto] gap-2 items-start">
                <div>
                  <input value={r.name} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name, e.g. Loom Link" className={`${inputBase} w-full font-medium`} />
                  {r.name.trim() && (() => {
                    const token = `[${r.name.trim()}]`.toLowerCase()
                    const n = ws.templates.filter(t => `${t.subject || ''} ${t.body}`.toLowerCase().includes(token)).length
                    return <p className="text-[11px] text-off-black/45 mt-1 px-1">Use as <span className="font-mono text-off-black/70">[{r.name.trim()}]</span>{n ? ` · in ${n} template${n === 1 ? '' : 's'}` : ''}</p>
                  })()}
                </div>
                <textarea rows={2} value={r.value} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="What it becomes in the email" className={`${inputBase} w-full resize-y`} />
                <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className={`${btnGhost} hover:text-red-700 mt-0.5`} title="Remove"><X className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setRows([...rows, { name: '', value: '' }])} className={`${btnSecondary} mt-3`}><Plus className="w-3.5 h-3.5" /> Add variable</button>
        </section>

        {([
          ['Filled from the Attio deal', ws.builtIn.filter(([n]) => !PER_EMAIL.has(n))],
          ['Filled by you or your profile', ws.builtIn.filter(([n]) => PER_EMAIL.has(n))],
        ] as const).map(([title, list]) => list.length > 0 && (
          <section key={title}>
            <h2 className={`${sectionLabel} mb-2`}>{title}</h2>
            <div className="rounded-lg border border-border-gray divide-y divide-border-gray">
              {list.map(([name, what]) => (
                <div key={name} className="grid grid-cols-[200px_1fr] gap-3 px-4 py-2.5 text-sm">
                  <span className="font-medium text-off-black">[{name}]</span>
                  <span className="text-off-black/60">{what}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
