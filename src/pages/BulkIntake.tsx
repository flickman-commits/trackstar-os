import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Trash2, Loader2, CheckCircle2, Upload, Download, Copy, Link2, ChevronDown, ChevronUp, Pencil, Lock } from 'lucide-react'
import ProofFullscreen from '@/components/ProofFullscreen'
import { useArmed } from '@/lib/useArmed'
import { loadPublic, LoadError } from '@/lib/publicLoad'

const API_BASE = import.meta.env.VITE_API_URL || ''

/**
 * The partner's side of a bulk order: a form for the runner list.
 *
 * A partner has a spreadsheet of names and addresses and a deadline. This
 * takes both shapes: paste the sheet in, or type rows by hand. Nothing here
 * is personalized or approved; it exists so we never have to ask "can you
 * send that list again" and so Eli never retypes an address.
 */

type Row = { firstName: string; lastName: string; email: string; line1: string; line2: string; city: string; state: string; zip: string; country: string }
const blank = (): Row => ({ firstName: '', lastName: '', email: '', line1: '', line2: '', city: '', state: '', zip: '', country: 'United States' })

const T = { page: '#F6F5F2', card: '#FFFFFF', line: '#E7E4DD', accent: '#4600D6', bar: '#242424', font: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif" }

function parsePaste(text: string): Row[] {
  let lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  // A Markdown table: strip the outer pipes and the |---| divider, then treat as pipe-separated.
  const isMd = lines[0].startsWith('|')
  if (isMd) lines = lines.filter(l => !/^\|?\s*:?-{2,}/.test(l)).map(l => l.replace(/^\|/, '').replace(/\|$/, ''))
  const sep = isMd ? '|' : lines[0].includes('\t') ? '\t' : ','
  const split = (l: string) => sep !== ',' ? l.split(sep) : l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')).filter((_, i, arr) => i < arr.length - 1 || _ !== '')
  const head = split(lines[0]).map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  const idx = (...names: string[]) => head.findIndex(h => names.includes(h))
  const iF = idx('firstname', 'first'), iL = idx('lastname', 'last', 'surname'), iN = idx('name', 'fullname', 'runner', 'runnername')
  const hasHeader = iF >= 0 || iN >= 0
  const iE = idx('email'), i1 = idx('address', 'addressline1', 'address1', 'street'), i2 = idx('addressline2', 'address2', 'apt', 'unit')
  const iC = idx('city', 'town'), iS = idx('state', 'province', 'region'), iZ = idx('zip', 'zipcode', 'postalcode', 'postcode'), iK = idx('country')
  const rows: Row[] = []
  for (const l of lines.slice(hasHeader ? 1 : 0)) {
    const c = split(l).map(x => x.trim())
    const g = (i: number) => (i >= 0 ? c[i] || '' : '')
    let first = '', last = ''
    if (hasHeader) {
      if (iF >= 0) { first = g(iF); last = g(iL) } else { const p = g(iN).split(/\s+/); first = p[0] || ''; last = p.slice(1).join(' ') }
    } else {
      // No header: assume First, Last, Address, City, State, Zip. A plain list
      // of full names (one column, "Jane Doe") is split on the first space.
      if (c.length === 1) { const p = (c[0] || '').split(/\s+/); first = p[0] || ''; last = p.slice(1).join(' ') }
      else { first = c[0] || ''; last = c[1] || '' }''
    }
    if (!first && !last) continue
    rows.push({
      firstName: first, lastName: last, email: hasHeader ? g(iE) : '',
      line1: hasHeader ? g(i1) : c[2] || '', line2: hasHeader ? g(i2) : '',
      city: hasHeader ? g(iC) : c[3] || '', state: hasHeader ? g(iS) : c[4] || '', zip: hasHeader ? g(iZ) : c[5] || '',
      country: (hasHeader ? g(iK) : c[6]) || 'United States',
    })
  }
  return rows
}

type Received = { id: string; name: string; city: string | null; at: string; locked?: boolean }

const field = 'w-full px-2.5 py-2 rounded-md text-base sm:text-sm'
const fieldStyle = { border: `1px solid ${T.line}`, backgroundColor: '#fff', color: '#1A1A1A' }

/**
 * The partner's list as it stands, with Edit and Remove on every runner whose
 * print is not in production yet. Always on the page: a partner who needed to
 * take two runners off could not find the remove button, which sat in a
 * collapsed list under the request-link tab.
 */
function YourList({ token, received, namesOnly, onRemoved, onEdited }: {
  token: string
  received: Received[]
  namesOnly: boolean
  onRemoved: (id: string, entered: number) => void
  onEdited: (id: string, next: Received) => void
}) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Row>(blank())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { arm, isArmed } = useArmed()

  const post = (body: object) => fetch(`${API_BASE}/api/public/bulk-intake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...body }) })
  const locked = 'Their print is already in production, so it can\'t be changed here. Email us and we\'ll sort it out.'

  const remove = async (r: Received) => {
    if (!arm(`remove:${r.id}`)) return
    setMsg(null)
    try {
      const res = await post({ action: 'remove', id: r.id })
      if (!res.ok) { setMsg(res.status === 409 ? `${r.name}: ${locked}` : `Could not remove ${r.name} just now. Please try again.`); return }
      const data = await res.json()
      onRemoved(r.id, data.entered)
    } catch { setMsg(`Could not remove ${r.name} just now. Please try again.`) }
  }

  const startEdit = (r: Received) => {
    const [first, ...rest] = r.name.split(/\s+/)
    setDraft({ ...blank(), firstName: first || '', lastName: rest.join(' ') })
    setEditing(r.id); setMsg(null)
  }

  const save = async (r: Received) => {
    setBusy(true); setMsg(null)
    try {
      const res = await post({ action: 'edit', id: r.id, firstName: draft.firstName, lastName: draft.lastName, address: { line1: draft.line1, line2: draft.line2, city: draft.city, state: draft.state, zip: draft.zip, country: draft.country } })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))).error
        setMsg(e === 'in_production' ? `${r.name}: ${locked}` : e === 'name' ? 'Add a first and last name.' : e === 'address' ? 'That address is missing the street, city or ZIP code.' : e === 'zip' ? 'That ZIP code does not look right.' : e === 'duplicate' ? 'Someone with that name is already on your list.' : 'Could not save that just now. Please try again.')
        return
      }
      const data = await res.json()
      onEdited(r.id, { ...r, id: data.id, name: data.name, city: data.city })
      setEditing(null)
    } catch { setMsg('Could not save that just now. Please try again.') } finally { setBusy(false) }
  }

  const set = (k: keyof Row) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft(d => ({ ...d, [k]: e.target.value }))

  return (
    <div className="rounded-2xl p-5 mb-4" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span>
          <span className="block text-base font-bold" style={{ color: '#1A1A1A' }}>Your list ({received.length})</span>
          <span className="block text-xs mt-0.5" style={{ color: '#666' }}>Fix a name or address, or take someone off, any time before their print goes into production.</span>
        </span>
        {open ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: '#999' }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: '#999' }} />}
      </button>
      {msg && <p className="text-sm mt-3 rounded-lg p-2.5" style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.25)', color: '#991B1B' }}>{msg}</p>}
      {open && (received.length === 0 ? (
        <p className="text-sm mt-3" style={{ color: '#999' }}>Nobody yet. Runners appear here as they are added.</p>
      ) : (
        <ul className="mt-3 max-h-[28rem] overflow-y-auto text-sm" style={{ color: '#1A1A1A' }}>
          {received.map((r, i) => (
            <li key={r.id} className="py-2" style={{ borderTop: i ? `1px solid ${T.line}` : undefined }}>
              {editing === r.id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input className={field} style={fieldStyle} placeholder="First name" value={draft.firstName} onChange={set('firstName')} />
                    <input className={field} style={fieldStyle} placeholder="Last name" value={draft.lastName} onChange={set('lastName')} />
                  </div>
                  {!namesOnly && (
                    <>
                      <p className="text-xs" style={{ color: '#666' }}>New address? Type it in full. Leave these blank to keep the one we have{r.city ? ` (${r.city})` : ''}.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input className={field} style={fieldStyle} placeholder="Street address" value={draft.line1} onChange={set('line1')} />
                        <input className={field} style={fieldStyle} placeholder="Apt, suite (optional)" value={draft.line2} onChange={set('line2')} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input className={field} style={fieldStyle} placeholder="City" value={draft.city} onChange={set('city')} />
                        <input className={field} style={fieldStyle} placeholder="State" value={draft.state} onChange={set('state')} />
                        <input className={field} style={fieldStyle} placeholder="ZIP" value={draft.zip} onChange={set('zip')} />
                      </div>
                    </>
                  )}
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm font-semibold rounded-md" style={{ color: '#666' }}>Cancel</button>
                    <button onClick={() => save(r)} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md disabled:opacity-50" style={{ backgroundColor: T.accent, color: '#fff' }}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-medium">{r.name}</span>
                    {r.city && <span className="text-xs ml-2" style={{ color: '#999' }}>{r.city}</span>}
                  </span>
                  {r.locked ? (
                    <span className="inline-flex items-center gap-1 text-xs shrink-0" style={{ color: '#999' }} title={locked}><Lock className="w-3.5 h-3.5" />In production</span>
                  ) : (
                    <span className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => startEdit(r)} className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-md" style={{ color: '#1A1A1A' }} title="Fix the name or address"><Pencil className="w-3.5 h-3.5" />Edit</button>
                      <button type="button" onClick={() => remove(r)} className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-semibold rounded-md" style={{ color: isArmed(`remove:${r.id}`) ? '#DC2626' : '#666' }} title="Take them off the list"><Trash2 className="w-3.5 h-3.5" />{isArmed(`remove:${r.id}`) ? 'Click again to remove' : 'Remove'}</button>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}

export default function BulkIntake() {
  const { token } = useParams<{ token: string }>()
  const [info, setInfo] = useState<{ partnerName: string; raceName: string; raceYear: number; quantity: number; entered: number; note: string | null; product: string; runnerLink: string | null; previewImageUrl: string | null; event?: string | null; namesOnly?: boolean; received: Received[] | null } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'gone' | 'sent' | 'unavailable'>('loading')
  const [rows, setRows] = useState<Row[]>([blank()])
  const [mode, setMode] = useState<'paste' | 'link'>('paste')
  const [copied, setCopied] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; duplicates: number; rejected: { name?: string; reason: string }[] } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    loadPublic<NonNullable<typeof info>>(`${API_BASE}/api/public/bulk-intake?token=${encodeURIComponent(token || '')}`)
      .then(d => { setInfo(d); setState('ready') })
      .catch((e: LoadError) => setState(e.gone ? 'gone' : 'unavailable'))
  }, [token])

  const usable = rows.filter(r => r.firstName.trim() && r.lastName.trim())
  // When every print ships to the organization, names are all we need.
  const incomplete = info?.namesOnly ? 0 : usable.filter(r => !r.line1.trim() || !r.city.trim() || !r.zip.trim()).length

  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`${API_BASE}/api/public/bulk-intake`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, runners: usable.map(r => ({ firstName: r.firstName, lastName: r.lastName, email: r.email, address: { line1: r.line1, line2: r.line2, city: r.city, state: r.state, zip: r.zip, country: r.country } })) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error()
      setResult(data)
      setInfo(i => (i ? { ...i, entered: data.entered } : i))
      setState('sent')
    } catch { setErr('Something went wrong sending the list. Please try again, or email us the spreadsheet.') } finally { setBusy(false) }
  }

  // A plain function, not a component: a component defined inside render is
  // a new type every keystroke, which remounts everything below and drops focus.
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ backgroundColor: T.page, fontFamily: T.font }}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 pl-1.5 pr-4 py-1.5 mb-6" style={{ backgroundColor: T.bar, borderRadius: 24 }}>
          <span className="flex items-center justify-center shrink-0 overflow-hidden" style={{ backgroundColor: '#F3F3F3', borderRadius: 999, padding: '2px 10px' }}>
            <img src="/trackstar-logo.png" alt="Trackstar" className="h-8 w-auto" />
          </span>
          {info && <span style={{ color: '#FFFFFF', fontSize: '15px', fontWeight: 600 }}>{info.partnerName}</span>}
        </div>
        {children}
        <p className="mt-10 text-center" style={{ fontSize: '11px', color: '#999999', letterSpacing: '0.05em' }}>Trackstar - Celebrating athletic achievement.</p>
      </div>
    </div>
  )

  if (state === 'loading') return shell(<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#999' }} /></div>)
  if (state === 'unavailable') return shell(<div className="rounded-2xl p-8 text-center" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}><h1 className="text-lg font-bold mb-2">We couldn't load this just now</h1><p className="text-sm" style={{ color: '#666' }}>Check your connection and try again. Your link is fine.</p><button onClick={() => window.location.reload()} className="mt-4 inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold" style={{ backgroundColor: '#1A1A1A', color: '#fff' }}>Try again</button></div>)
  if (state === 'gone' || !info) return shell(<div className="rounded-2xl p-8 text-center" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}><h1 className="text-lg font-bold mb-2">This link is no longer active</h1><p className="text-sm" style={{ color: '#666' }}>Ask your Trackstar contact for a fresh one.</p></div>)

  if (state === 'sent' && result) return shell(
    <>
      <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
        <CheckCircle2 className="w-8 h-8 mx-auto mb-3" style={{ color: T.accent }} />
        <h1 className="text-xl font-bold mb-2">Got it. {result.added} runner{result.added === 1 ? '' : 's'} added.</h1>
        <p className="text-sm" style={{ color: '#666' }}>
          {info.entered} on the list so far{info.quantity ? ` of ${info.quantity}` : ''}.
          {result.duplicates ? ` ${result.duplicates} were already on it.` : ''}
        </p>
        {result.rejected.length > 0 && (
          <div className="mt-4 text-left rounded-xl p-3 text-sm" style={{ backgroundColor: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', color: '#92400E' }}>
            <p className="font-semibold mb-1">{result.rejected.length} could not be added:</p>
            <ul className="space-y-0.5">{result.rejected.map((x, i) => <li key={i}>{x.name || `Row ${i + 1}`}: {x.reason === 'address' ? 'address is incomplete' : 'name is missing'}</li>)}</ul>
          </div>
        )}
        <button onClick={() => { setRows([blank()]); setResult(null); setState('ready'); setMode('paste') }} className="mt-6 px-4 py-2.5 text-sm font-semibold rounded-md" style={{ backgroundColor: T.accent, color: '#fff' }}>Add more</button>
      </div>
    </>
  )

  const pct = info.quantity ? Math.min(100, Math.round((info.entered / info.quantity) * 100)) : 0
  const tag = (t: string) => <span className="inline-flex items-center px-2.5 py-1 rounded-md" style={{ backgroundColor: T.accent, color: '#fff', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{t}</span>

  return shell(
    <>
      {previewOpen && info.previewImageUrl && (
        <ProofFullscreen proofs={[{ id: 'preview', imageUrl: info.previewImageUrl }]} index={0} onIndexChange={() => {}} onClose={() => setPreviewOpen(false)} counterLabel="Your co-branded print" />
      )}
      <div className="rounded-2xl p-6 mb-4" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
        <div className="flex gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 mb-3">{tag(info.raceName)}{tag(String(info.raceYear))}{info.event && info.event !== 'Marathon' ? tag(info.event) : null}</div>
            <h1 className="text-xl font-bold" style={{ color: '#1A1A1A' }}>Upload your list of runners</h1>
            <p className="text-sm mt-1" style={{ color: '#666' }}>{info.namesOnly ? `For each runner we need their first and last name. Every print ships to ${info.partnerName}, so no addresses are needed.` : 'For each runner we need their first and last name and shipping address to be able to create and send their Trackstar print.'}</p>
          </div>
          {info.previewImageUrl && (
            <button type="button" onClick={() => setPreviewOpen(true)} className="shrink-0 w-28 h-28 rounded-xl overflow-hidden" style={{ backgroundColor: '#E9EBEE', border: `1px solid ${T.line}` }} title="See your co-branded print full screen">
              <img src={info.previewImageUrl} alt="Your co-branded print" className="w-full h-full object-cover" draggable={false} onContextMenu={e => e.preventDefault()} />
            </button>
          )}
        </div>
        {/* Progress toward the invoiced count */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: '#666' }}>
            <span className="font-semibold" style={{ color: '#1A1A1A' }}>{info.entered}{info.quantity ? ` of ${info.quantity}` : ''} runner{info.entered === 1 && !info.quantity ? '' : 's'} received</span>
            {info.quantity ? <span>{pct}%</span> : null}
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.page }}>
            <div className="h-full rounded-full" style={{ width: `${info.quantity ? pct : info.entered ? 100 : 0}%`, backgroundColor: T.accent, transition: 'width 300ms' }} />
          </div>
        </div>
        {info.note && <p className="text-sm mt-4 rounded-xl p-3" style={{ backgroundColor: 'rgba(70,0,214,0.05)', border: '1px solid rgba(70,0,214,0.15)', color: '#1A1A1A' }}>{info.note}</p>}
      </div>

      <YourList
        token={token || ''}
        received={info.received || []}
        namesOnly={Boolean(info.namesOnly)}
        onRemoved={(id, entered) => setInfo(v => v ? { ...v, entered, received: (v.received || []).filter(x => x.id !== id) } : v)}
        onEdited={(id, next) => setInfo(v => v ? { ...v, received: (v.received || []).map(x => x.id === id ? next : x) } : v)}
      />

      {/* Two ways in: they have the list, or they ask their runners for it. */}
      <div className="inline-flex p-1 rounded-full mb-3" style={{ backgroundColor: '#fff', border: `1px solid ${T.line}` }}>
        {(['paste', 'link'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} className="px-4 py-1.5 text-xs font-semibold rounded-full" style={mode === m ? { backgroundColor: T.bar, color: '#fff' } : { color: '#666' }}>
            {m === 'paste' ? 'Upload Runner List' : 'Send Request Link'}
          </button>
        ))}
      </div>

      {mode === 'link' ? (
        <div className="rounded-2xl p-5 mb-4" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
          <div className="flex items-start gap-3">
            <Link2 className="w-5 h-5 mt-0.5 shrink-0" style={{ color: T.accent }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>Don't have everyone's address? Send your runners this link.</p>
              <p className="text-xs mt-0.5" style={{ color: '#666' }}>Each person enters their own name and shipping address and lands on your list here. No spreadsheet needed.</p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <code className="text-[12px] px-2 py-1.5 rounded-md truncate max-w-full" style={{ backgroundColor: T.page, color: '#666' }}>{window.location.origin}{info.runnerLink}</code>
                <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${info.runnerLink}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md" style={{ backgroundColor: T.bar, color: '#fff' }}>
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-2xl p-5 mb-4" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
            <ol className="space-y-4">
              <li className="flex items-center gap-4">
                <span className="text-xs font-bold w-14 shrink-0" style={{ color: '#999', letterSpacing: '0.06em' }}>STEP 1</span>
                <a href="/trackstar-runner-list.xlsx" download className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold uppercase tracking-wide rounded-md" style={{ backgroundColor: '#fff', color: '#1A1A1A', border: `1px solid ${T.line}` }}>
                  <Download className="w-4 h-4" /> Download template
                </a>
              </li>
              <li className="flex items-center gap-4">
                <span className="text-xs font-bold w-14 shrink-0" style={{ color: '#999', letterSpacing: '0.06em' }}>STEP 2</span>
                <span className="text-sm" style={{ color: '#1A1A1A' }}>{info.namesOnly ? 'Fill it out with each runner\'s first and last name' : 'Fill it out with each runner\'s name and shipping address'}</span>
              </li>
              <li className="flex items-center gap-4">
                <span className="text-xs font-bold w-14 shrink-0" style={{ color: '#999', letterSpacing: '0.06em' }}>STEP 3</span>
                <label className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold uppercase tracking-wide rounded-md cursor-pointer" style={{ backgroundColor: T.accent, color: '#fff' }}>
                  <Upload className="w-4 h-4" /> Upload your list
                  <input type="file" accept=".xlsx,.xls,.csv,.txt,.md,.markdown,text/csv,text/markdown,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={async e => {
                    const f = e.target.files?.[0]; e.target.value = ''
                    if (!f) return
                    let text = ''
                    if (/\.xlsx?$/i.test(f.name)) {
                      const XLSX = await import('xlsx')
                      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
                      text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])
                    } else {
                      text = await f.text()
                    }
                    const parsed = parsePaste(text)
                    if (!parsed.length) { setErr('Could not read any rows from that file.'); return }
                    setRows(parsed); setErr(null)
                  }} />
                </label>
                <span className="text-xs" style={{ color: '#999' }}>Excel, CSV or Markdown</span>
              </li>
            </ol>
          </div>

          {/* What was read, before it goes. */}
          {usable.length > 0 && (
            <div className="rounded-2xl mb-4 overflow-hidden" style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}>
              <div className="px-4 py-2.5 text-xs font-semibold flex items-center justify-between" style={{ borderBottom: `1px solid ${T.line}`, color: '#1A1A1A' }}>
                <span>Upload List: {usable.length} runner{usable.length === 1 ? '' : 's'} read</span>
                <button onClick={() => { setRows([blank()]); setErr(null) }} className="text-xs font-medium" style={{ color: '#999' }}>Clear</button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((r, i) => {
                      const ok = r.firstName.trim() && r.lastName.trim() && (info.namesOnly || (r.line1.trim() && r.city.trim() && r.zip.trim()))
                      if (!r.firstName.trim() && !r.lastName.trim()) return null
                      return (
                        <tr key={i} style={{ borderTop: i ? `1px solid ${T.line}` : undefined }}>
                          <td className="px-4 py-2 font-medium" style={{ color: '#1A1A1A' }}>{r.firstName} {r.lastName}</td>
                          <td className="px-3 py-2 text-xs" style={{ color: ok ? '#666' : '#B45309' }}>{info.namesOnly ? `Ships to ${info.partnerName}` : ok ? `${r.line1}${r.line2 ? `, ${r.line2}` : ''}, ${r.city} ${r.state} ${r.zip}` : 'Address incomplete, will be held back'}</td>
                          <td className="px-2 py-2 text-right"><button onClick={() => setRows(rs => rs.length === 1 ? [blank()] : rs.filter((_, j) => j !== i))} title="Remove" style={{ color: '#999' }}><Trash2 className="w-4 h-4" /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {err && <p className="text-sm mb-3" style={{ color: '#DC2626' }}>{err}</p>}
          {incomplete > 0 && <p className="text-xs mb-3" style={{ color: '#92400E' }}>{incomplete} runner{incomplete === 1 ? ' has' : 's have'} an incomplete address and will be held back.</p>}
          <button onClick={submit} disabled={busy || usable.length === 0} className="w-full py-3 text-sm font-bold uppercase tracking-wide rounded-md disabled:opacity-40" style={{ backgroundColor: T.accent, color: '#fff' }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : `Send ${usable.length} runner${usable.length === 1 ? '' : 's'} to Trackstar`}
          </button>
        </>
      )}
    </>
  )
}
