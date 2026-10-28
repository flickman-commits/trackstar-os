import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, ExternalLink, RefreshCw, Power, Trash2, ChevronDown, ChevronRight, Check, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useArmed } from '@/lib/useArmed'
import { btnPrimary, btnSecondary, btnGhost, inputBase, fieldLabel, sectionCount } from '@/lib/ui'

/**
 * Settings > Admin > Designs: the automated print renderer at a glance.
 * Which races have a production file mapped, whether each file passed its
 * check and is on a machine that is online, which races with orders still
 * have no template, and the render workers and queue.
 */
type Size = { artboard: string; fields: string[]; nameAlign: string | null; nameGrows: string | null; photoWindow: boolean | 'variant'; photoArtboard: string | null }
type Report = { ok: boolean; problems: string[]; warnings: string[]; sizes: Record<string, Size>; extraSizes?: string[]; colorSpace?: string }
type Template = {
  key: string; raceName: string; edition: string | null; file: string; rules: Record<string, string> | null; enabled: boolean; notes: string | null
  driveLink: string; status: 'ready' | 'problems' | 'checking' | 'no_file' | 'offline' | 'disabled'
  lastCheckAt: string | null; lastCheckOk: boolean | null; report: Report | null; lastCheckWorker: string | null
  workers: { id: string; name: string; online: boolean; mtime: string | null }[]
  openOrders: number; orders180d: number; renders: { rendered: number; approved: number; rejected: number; failed: number }
}
type Overview = {
  templates: Template[]
  unmapped: { raceName: string; openOrders: number; orders180d: number }[]
  workers: { id: string; name: string; lastSeenAt: string; online: boolean; templates: number; files: number }[]
  queue: Record<string, number>
  racesFolder: string
}

const STATUS: Record<Template['status'], { label: string; cls: string; help: string }> = {
  ready: { label: 'Ready', cls: 'bg-green-100 text-green-800', help: 'Checked, and a worker that is online has the file.' },
  problems: { label: 'Problems', cls: 'bg-red-100 text-red-800', help: 'The last check found something the renderer cannot work around. Open the row.' },
  checking: { label: 'Checking…', cls: 'bg-amber-100 text-amber-800', help: 'A worker has the file and checks it on its next check-in, within a minute.' },
  no_file: { label: 'No file', cls: 'bg-red-100 text-red-800', help: 'No worker has this file on disk. Check the path, or the Drive sync on the worker Mac.' },
  offline: { label: 'Worker offline', cls: 'bg-off-black/10 text-off-black/60', help: 'Checked and ready, but no machine with the file is online right now.' },
  disabled: { label: 'Off', cls: 'bg-off-black/10 text-off-black/60', help: 'Turned off by hand. Not rendered.' },
}

function ago(iso: string | null) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

async function post(body: Record<string, unknown>) {
  const res = await apiFetch('/api/render/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function RenderTemplatesPanel() {
  const [data, setData] = useState<Overview | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ raceName: string; edition: string; file: string; artboard: string; artboardExclude: string; photoArtboard: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const r = await apiFetch('/api/render/templates'); const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j) }
    catch (e) { toast.error((e as Error).message || 'Could not load') }
  }, [])
  const anyChecking = Boolean(data?.templates.some(t => t.status === 'checking'))
  useEffect(() => { load(); const t = setInterval(load, anyChecking ? 5000 : 30000); return () => clearInterval(t) }, [load, anyChecking])

  const act = async (label: string, body: Record<string, unknown>) => {
    setBusy(label)
    try { await post(body); await load() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }

  if (!data) return <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /></div>
  const ready = data.templates.filter(t => t.status === 'ready').length
  const queued = (data.queue.queued || 0) + (data.queue.rendering || 0)

  return (
    <div className="space-y-6">
      {/* Workers and queue */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Templates ready" value={`${ready} / ${data.templates.length}`} />
        <Stat label="Workers online" value={String(data.workers.filter(w => w.online).length)} />
        <Stat label="In the queue" value={String(queued)} sub={data.queue.failed ? `${data.queue.failed} failed` : undefined} />
        <Stat label="Races without a template" value={String(data.unmapped.filter(r => r.openOrders > 0).length)} sub="with open orders" />
      </div>

      <section>
        <div className="flex items-center gap-2 mb-2"><h4 className="text-xs font-semibold text-off-black/50 uppercase tracking-tight">Render workers</h4></div>
        {data.workers.length === 0 ? <p className="text-sm text-off-black/50">No worker has ever checked in. Start one with <code>npm run worker</code> on a Mac with Illustrator.</p> : (
          <div className="bg-white border border-border-gray rounded-lg divide-y divide-border-gray">
            {data.workers.map(w => (
              <div key={w.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${w.online ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="font-medium text-off-black">{w.name}</span>
                <span className="text-off-black/50">{w.online ? 'online' : `last seen ${ago(w.lastSeenAt)}`}</span>
                <span className="ml-auto text-off-black/50">{w.templates} renderable · {w.files} files on disk</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Templates */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold text-off-black/50 uppercase tracking-tight">Templates</h4>
            <span className={sectionCount}>{data.templates.length}</span>
            <a href={data.racesFolder} target="_blank" rel="noopener noreferrer" className="text-xs text-[#4600D6] hover:underline inline-flex items-center gap-1">Races folder <ExternalLink className="w-3 h-3" /></a>
          </div>
          <button onClick={() => setAdding({ raceName: '', edition: '', file: '', artboard: '', artboardExclude: '', photoArtboard: '' })} className={btnPrimary}><Plus className="w-4 h-4" /> Add template</button>
        </div>

        {adding && (
          <div className="bg-subtle-gray border border-border-gray rounded-lg p-4 mb-3 space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <div><label className={fieldLabel}>Race (as the tool names it)</label><input className={inputBase} value={adding.raceName} onChange={e => setAdding({ ...adding, raceName: e.target.value })} placeholder="Austin Marathon" /></div>
              <div><label className={fieldLabel}>Edition (blank for the standard print)</label><input className={inputBase} value={adding.edition} onChange={e => setAdding({ ...adding, edition: e.target.value })} placeholder="World Majors" /></div>
            </div>
            <div><label className={fieldLabel}>Production file, relative to the Races folder</label><input className={`${inputBase} font-mono text-xs`} value={adding.file} onChange={e => setAdding({ ...adding, file: e.target.value })} placeholder="Austin Marathon/Illustrator Files/Austin Marathon_Production.ai" /></div>
            <div className="grid md:grid-cols-3 gap-3">
              <div><label className={fieldLabel}>Artboard must contain</label><input className={inputBase} value={adding.artboard} onChange={e => setAdding({ ...adding, artboard: e.target.value })} placeholder="Red" /></div>
              <div><label className={fieldLabel}>Artboard must not contain</label><input className={inputBase} value={adding.artboardExclude} onChange={e => setAdding({ ...adding, artboardExclude: e.target.value })} placeholder="copy" /></div>
              <div><label className={fieldLabel}>Photo variant artboard word</label><input className={inputBase} value={adding.photoArtboard} onChange={e => setAdding({ ...adding, photoArtboard: e.target.value })} placeholder="photo" /></div>
            </div>
            <p className="text-xs text-off-black/50">Leave the three artboard rules blank unless the file has more than one artboard per size. A worker checks the file on its next check-in and the row shows the result.</p>
            <div className="flex gap-2">
              <button disabled={busy === 'save' || !adding.raceName.trim() || !adding.file.trim()} onClick={async () => {
                const rules: Record<string, string> = {}
                for (const k of ['artboard', 'artboardExclude', 'photoArtboard'] as const) if (adding[k].trim()) rules[k] = adding[k].trim()
                await act('save', { action: 'save', raceName: adding.raceName.trim(), edition: adding.edition.trim() || null, file: adding.file.trim(), rules })
                setAdding(null)
              }} className={btnPrimary}>{busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}</button>
              <button onClick={() => setAdding(null)} className={btnGhost}>Cancel</button>
            </div>
          </div>
        )}

        <div className="bg-white border border-border-gray rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-subtle-gray text-[11px] font-semibold uppercase tracking-wider text-off-black/50">
              <tr>
                <th className="text-left px-3 py-2 w-6"></th>
                <th className="text-left px-3 py-2">Race</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Open</th>
                <th className="text-right px-3 py-2 hidden md:table-cell">180d</th>
                <th className="text-right px-3 py-2 hidden md:table-cell">Rendered</th>
                <th className="text-left px-3 py-2 hidden lg:table-cell">Checked</th>
                <th className="text-left px-3 py-2">File</th>
              </tr>
            </thead>
            <tbody>
              {data.templates.map(t => {
                const st = STATUS[t.status]
                const isOpen = open === t.key
                return (
                  <TemplateRow key={t.key} t={t} st={st} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : t.key)} busy={busy} act={act} />
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Unmapped */}
      <section>
        <div className="flex items-center gap-2 mb-2"><h4 className="text-xs font-semibold text-off-black/50 uppercase tracking-tight">Races without a template</h4><span className={sectionCount}>{data.unmapped.length}</span></div>
        <p className="text-xs text-off-black/50 mb-2">By orders in the last 180 days. These still go to the designers by hand.</p>
        <div className="bg-white border border-border-gray rounded-lg divide-y divide-border-gray">
          {data.unmapped.slice(0, 25).map(r => (
            <div key={r.raceName} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="text-off-black">{r.raceName}</span>
              <span className="ml-auto text-off-black/50 tabular-nums">{r.openOrders} open · {r.orders180d} in 180d</span>
              <button onClick={() => setAdding({ raceName: r.raceName, edition: '', file: `${r.raceName}/Illustrator Files/${r.raceName}_Production.ai`, artboard: '', artboardExclude: '', photoArtboard: '' })} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Add</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-border-gray rounded-lg p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-off-black/40">{label}</div>
      <div className="text-2xl font-bold text-off-black mt-0.5">{value}</div>
      {sub && <div className="text-xs text-off-black/50">{sub}</div>}
    </div>
  )
}

function TemplateRow({ t, st, isOpen, onToggle, busy, act }: {
  t: Template; st: { label: string; cls: string; help: string }; isOpen: boolean; onToggle: () => void; busy: string | null
  act: (label: string, body: Record<string, unknown>) => Promise<void>
}) {
  const r = t.report
  const { arm, isArmed } = useArmed()
  return (
    <>
      <tr className="border-t border-border-gray hover:bg-subtle-gray/60 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2 text-off-black/40">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
        <td className="px-3 py-2 font-medium text-off-black">{t.raceName}{t.edition && <span className="ml-1.5 text-[11px] font-semibold text-[#4600D6]">{t.edition}</span>}</td>
        <td className="px-3 py-2"><span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${st.cls}`} title={st.help}>{st.label}</span></td>
        <td className="px-3 py-2 text-right tabular-nums text-off-black/70">{t.openOrders}</td>
        <td className="px-3 py-2 text-right tabular-nums text-off-black/50 hidden md:table-cell">{t.orders180d}</td>
        <td className="px-3 py-2 text-right tabular-nums text-off-black/50 hidden md:table-cell" title={`${t.renders.approved} approved, ${t.renders.rejected} rejected, ${t.renders.failed} failed`}>{t.renders.rendered}</td>
        <td className="px-3 py-2 text-off-black/50 hidden lg:table-cell">{ago(t.lastCheckAt)}</td>
        <td className="px-3 py-2">
          <a href={t.driveLink} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-[#4600D6] hover:underline font-mono" title={t.file}>
            {t.file.split('/').pop()} <ExternalLink className="w-3 h-3" />
          </a>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-border-gray bg-subtle-gray/40">
          <td colSpan={8} className="px-6 py-3">
            <div className="grid lg:grid-cols-[1fr,auto] gap-4">
              <div className="space-y-2 text-xs text-off-black/70">
                <div className="font-mono text-[11px] text-off-black/60">{t.file}{t.rules && Object.keys(t.rules).length ? <span className="ml-2 text-off-black/40">rules: {Object.entries(t.rules).map(([k, v]) => `${k}=${v}`).join(', ')}</span> : null}</div>
                <div>On {t.workers.length ? t.workers.map(w => `${w.name}${w.online ? '' : ' (offline)'}`).join(', ') : 'no worker'}{t.lastCheckAt ? ` · checked ${ago(t.lastCheckAt)} by ${t.lastCheckWorker || 'a worker'}` : ''}</div>
                {r?.problems?.length ? <ul className="space-y-0.5">{r.problems.map((p, i) => <li key={i} className="flex gap-1.5 text-red-700"><X className="w-3.5 h-3.5 mt-0.5 shrink-0" />{p}</li>)}</ul> : null}
                {r && !r.problems?.length && (
                  <ul className="space-y-0.5">
                    {Object.entries(r.sizes).map(([size, s]) => (
                      <li key={size} className="flex gap-1.5"><Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-green-600" /><span><span className="font-semibold text-off-black">{size}</span>: {s.fields.join(', ')}; name {s.nameAlign}-aligned, grows {s.nameGrows}{s.photoWindow ? '; photo window' : '; no photo window'}</span></li>
                    ))}
                  </ul>
                )}
                {r?.warnings?.length ? <details><summary className="cursor-pointer text-off-black/50">{r.warnings.length} note{r.warnings.length > 1 ? 's' : ''} (handled at render time)</summary><ul className="mt-1 space-y-0.5 text-off-black/55">{r.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details> : null}
                {!r && <div className="text-off-black/50">{st.help}</div>}
              </div>
              <div className="flex lg:flex-col gap-2 shrink-0">
                <button disabled={!!busy} onClick={() => act('recheck', { action: 'recheck', key: t.key }).then(() => toast.success(`Re-checking ${t.key}. The result shows here in under a minute; a file that has not changed gets the same verdict.`))} className={btnSecondary} title="Forget the last check; the next worker check-in runs it again"><RefreshCw className="w-3.5 h-3.5" /> Re-check</button>
                <button disabled={!!busy} onClick={() => act('toggle', { action: t.enabled ? 'disable' : 'enable', key: t.key })} className={btnSecondary}><Power className="w-3.5 h-3.5" /> {t.enabled ? 'Turn off' : 'Turn on'}</button>
                <button disabled={!!busy} onClick={() => { if (arm(`delete:${t.key}`)) act('delete', { action: 'delete', key: t.key }) }} className={`${btnGhost} text-red-600`} title="Orders for it go back to the designers"><Trash2 className="w-3.5 h-3.5" /> {isArmed(`delete:${t.key}`) ? 'Click again to remove: orders go back to designers' : 'Remove'}</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
