import { useEffect, useState } from 'react'
import { Copy, Pencil, Check, ChevronDown as ChevronDownIcon } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { Order } from '@/components/orders/orderModel'

/*
 * The small labelled rows and sections the order detail view is built from.
 */

/** Collapsible section with header + chevron toggle */
export function CollapsibleSection({ title, defaultOpen = true, children, badge }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode; badge?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between mb-2 group"
      >
        <h4 className="text-xs font-semibold text-off-black/50 uppercase tracking-tight flex items-center gap-2">
          {title}
          {badge}
        </h4>
        <ChevronDownIcon className={`w-3.5 h-3.5 text-off-black/30 group-hover:text-off-black/50 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && children}
    </div>
  )
}

export function CopyableField({ label, value, aside }: { label: React.ReactNode; value: string; aside?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex justify-between items-center">
      <span className="text-body-sm text-off-black/60">{label}</span>
      <div className="flex items-center gap-2">
        {aside}
        <span className="text-body-sm font-medium text-off-black">{value}</span>
        <button
          onClick={handleCopy}
          className="p-1.5 hover:bg-off-black/10 rounded-sm transition-colors"
          title="Copy to clipboard"
        >
          {copied ? (
            <span className="text-success-green text-xs font-medium">✓</span>
          ) : (
            <Copy className="w-3.5 h-3.5 text-off-black/40 hover:text-off-black/70" />
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * Partner details, readable at a glance and editable in place.
 *
 * These three values are not cosmetic. The partner name is the heading on
 * their approval portal and the email is where the approval link goes, so a
 * typo made when the partner was created is invisible here and obvious to
 * them. Editing used to mean a database change.
 *
 * Partner rows have no columns of their own - the organization lives in
 * raceName, the contact in customerName and customerEmail - which is why the
 * API takes these under partner-specific names and refuses them on any other
 * kind of order.
 */
export function PartnerInfoFields({
  order,
  onSaved,
  onToast,
}: {
  order: Order
  onSaved: () => Promise<void>
  onToast: (t: { message: string; type: 'success' | 'error' }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const initial = () => ({
    partnerName: order.partnerName || order.raceName || '',
    partnerContactName: order.partnerContactName || '',
    partnerEmail: order.customerEmail || '',
  })
  const [values, setValues] = useState(initial)

  const start = () => { setValues(initial()); setEditing(true) }
  const cancel = () => { setValues(initial()); setEditing(false) }

  const save = async () => {
    if (!values.partnerName.trim()) {
      onToast({ message: 'Partner name is required', type: 'error' })
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: order.orderNumber,
          partnerName: values.partnerName.trim(),
          partnerContactName: values.partnerContactName.trim(),
          partnerEmail: values.partnerEmail.trim(),
        }),
      })
      if (!res.ok) {
        // The endpoint explains itself on a bad email or an empty name, so
        // show what it said rather than a generic failure.
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to save partner details')
      }
      onToast({ message: 'Partner details saved', type: 'success' })
      setEditing(false)
      await onSaved()
    } catch (e) {
      onToast({ message: e instanceof Error ? e.message : 'Failed to save partner details', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-44 px-2 py-1 border border-border-gray rounded text-body-sm text-right focus:outline-none focus:ring-2 focus:ring-off-black/20'

  if (!editing) {
    return (
      <>
        <CopyableField label="Partner" value={order.partnerName || order.raceName || 'Partner'} />
        <StaticField label="Year" value={String(order.raceYear || 'N/A')} />
        {order.partnerContactName
          ? <CopyableField label="Contact" value={order.partnerContactName} />
          : <StaticField label="Contact" value="Not set" />}
        {order.customerEmail
          ? <CopyableField label="Email" value={order.customerEmail} />
          : <StaticField label="Email" value="Not set" />}
        <div className="pt-1 flex justify-end">
          <button
            onClick={start}
            className="flex items-center gap-1.5 text-xs font-medium text-off-black/60 hover:text-off-black transition-colors"
          >
            <Pencil className="w-3 h-3" />
            Edit details
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="flex justify-between items-center">
        <span className="text-body-sm text-off-black/60">Partner</span>
        <input
          type="text"
          value={values.partnerName}
          onChange={e => setValues(v => ({ ...v, partnerName: e.target.value }))}
          className={inputClass}
        />
      </div>
      {/* Year stays read-only: it is part of how the partner row was created
          and nothing on this screen is the right place to renumber it. */}
      <StaticField label="Year" value={String(order.raceYear || 'N/A')} />
      <div className="flex justify-between items-center">
        <span className="text-body-sm text-off-black/60">Contact</span>
        <input
          type="text"
          value={values.partnerContactName}
          onChange={e => setValues(v => ({ ...v, partnerContactName: e.target.value }))}
          placeholder="Contact name"
          className={inputClass}
        />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-body-sm text-off-black/60">Email</span>
        <input
          type="email"
          value={values.partnerEmail}
          onChange={e => setValues(v => ({ ...v, partnerEmail: e.target.value }))}
          placeholder="name@example.com"
          className={inputClass}
        />
      </div>
      <div className="pt-1 flex justify-end gap-2">
        <button
          onClick={cancel}
          disabled={saving}
          className="px-3 py-1 text-xs font-medium text-off-black/60 hover:text-off-black transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1 text-xs font-medium bg-dark-fill text-white rounded hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </>
  )
}

// Static field without copy button
export function StaticField({ label, value, flag }: { label: string; value: string; flag?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-body-sm text-off-black/60">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-body-sm font-medium text-off-black">{value}</span>
        {flag && <span className="text-warning-amber" title="Year Missing">🚩</span>}
      </div>
    </div>
  )
}

// Pending field for data not yet available
export function PendingField({ label }: { label: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-body-sm text-off-black/60">{label}</span>
      <span className="text-body-sm text-off-black/30 italic">Pending research</span>
    </div>
  )
}

/**
 * A missing race date, presented as work rather than as waiting.
 *
 * Race dates used to be computed from a recurrence rule, so a blank one really
 * did mean "research has not run yet" and "Pending research" was true. The
 * rules were wrong often enough to matter while always looking plausible - CIM
 * came out a week early in two separate years, Berlin 2025 a week late - so
 * they were deleted, and a year nobody has verified now shows nothing at all.
 *
 * Only 2 of our 19 timing platforms hand back a real date, so for almost every
 * race this blank is never going to fill itself. Saying "Pending research"
 * would send Eli off to wait for something that is not coming. It is one
 * field, he can read it off the results page, and the button puts him in the
 * editor that already exists.
 */
export function MissingDateField({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-body-sm text-off-black/60">Date</span>
      <button
        onClick={onAdd}
        className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 bg-warning-amber/10 text-warning-amber border border-warning-amber/20 rounded hover:bg-warning-amber/20 transition-colors"
        title="No verified date for this race year. Click to enter it; the weather fills in from it."
      >
        <Pencil className="w-3 h-3" />
        Not researched
      </button>
    </div>
  )
}

// Not available field (no scraper for this race)
export function NotAvailableField({ label }: { label: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-body-sm text-off-black/60">{label}</span>
      <span className="text-body-sm text-off-black/30 italic">Manual entry needed</span>
    </div>
  )
}

/**
 * A custom order's email, where the proof and approval links are sent. Editable
 * in place: the buyer may want them to go to the runner, or typed it wrong.
 */
export function ApprovalEmailField({ order, onSaved }: { order: Order; onSaved: (email: string) => void }) {
  return <EmailField order={order} onSaved={onSaved} field="approvalEmail" label="Approval email" title="Proof and approval links are emailed here" help="Proof and approval emails go here from now on. The Shopify order is not changed." />
}

/**
 * A standard print's customer email, corrected by hand when the address on
 * the order bounces or has a typo. Support conversations and Email customer
 * use it from then on; the Shopify order is not changed.
 */
export function CustomerEmailField({ order, onSaved }: { order: Order; onSaved: (email: string) => void }) {
  return <EmailField order={order} onSaved={onSaved} field="customerEmail" label="Email" title="The customer's email. Edit it if the one on the order bounces or has a typo." help="Support conversations and Email customer use this address from now on. The Shopify order is not changed." />
}

function EmailField({ order, onSaved, field, label, title, help }: { order: Order; onSaved: (email: string) => void; field: 'approvalEmail' | 'customerEmail'; label: string; title: string; help: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(order.customerEmail || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setEditing(false); setValue(order.customerEmail || ''); setErr(null) }, [order.id, order.customerEmail])
  const save = async () => {
    const email = value.trim()
    if (email === (order.customerEmail || '')) { setEditing(false); return }
    setSaving(true); setErr(null)
    try {
      const res = await apiFetch('/api/orders/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: order.orderNumber, [field]: email }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(data.error || 'Could not save'); return }
      setEditing(false); onSaved(email)
    } finally { setSaving(false) }
  }
  if (!editing) {
    return (
      <div className="flex justify-between items-center gap-3">
        <span className="text-body-sm text-off-black/60" title={title}>{label}</span>
        <span className="inline-flex items-center gap-2 min-w-0">
          <span className={`text-body-sm font-medium truncate ${order.customerEmail ? 'text-off-black' : 'text-off-black/40'}`}>{order.customerEmail || 'Not set'}</span>
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0"><Pencil className="w-3 h-3" /> Edit</button>
        </span>
      </div>
    )
  }
  // Label above, the field full width and the buttons under it: the sidebar is
  // too narrow for all three on one line.
  const cancel = () => { setEditing(false); setValue(order.customerEmail || '') }
  return (
    <div className="space-y-1.5">
      <span className="block text-body-sm text-off-black/60">{label}</span>
      <input type="email" autoFocus value={value} onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
        placeholder="name@example.com" className="w-full min-w-0 px-2 py-1.5 text-sm border border-border-gray rounded bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-off-black/45">{help}</p>
        <span className="inline-flex items-center gap-3 shrink-0">
          <button type="button" onClick={cancel} className="text-xs text-off-black/50 hover:text-off-black">Cancel</button>
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1 text-xs font-medium text-green-700 disabled:opacity-40"><Check className="w-3.5 h-3.5" /> Save</button>
        </span>
      </div>
    </div>
  )
}

/**
 * A custom order's design details (runner, race, year, bib, time, creative
 * direction), editable by hand: orders sometimes come in empty and the
 * customer sends the details by email afterwards. Runner, race and year are
 * overrides; the order's own values stay underneath.
 */
export function CustomDetailsFields({ order, onSaved, onToast }: {
  order: Order
  onSaved: () => Promise<void>
  onToast: (t: { message: string; type: 'success' | 'error' }) => void
}) {
  const initial = () => ({
    runner: order.effectiveRunnerName || order.runnerName || '',
    race: order.effectiveRaceName || order.raceName || '',
    year: String(order.effectiveRaceYear || order.raceYear || ''),
    bib: order.bibNumberCustomer || '',
    time: order.timeCustomer || '',
    direction: order.creativeDirection || '',
  })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [values, setValues] = useState(initial)
  useEffect(() => { setEditing(false) }, [order.id])
  const set = (k: keyof ReturnType<typeof initial>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(v => ({ ...v, [k]: e.target.value }))

  const save = async () => {
    const was = initial()
    const body: Record<string, string | number | null> = { orderNumber: order.orderNumber }
    if (values.runner.trim() !== was.runner) body.runnerNameOverride = values.runner.trim() || null
    if (values.race.trim() !== was.race) body.raceNameOverride = values.race.trim() || null
    if (values.year.trim() !== was.year) {
      const y = Number(values.year.trim())
      if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear() + 1) { onToast({ message: 'Enter a four-digit year', type: 'error' }); return }
      body.yearOverride = y
    }
    if (values.bib.trim() !== was.bib) body.customBib = values.bib.trim()
    if (values.time.trim() !== was.time) body.customTime = values.time.trim()
    if (values.direction.trim() !== was.direction.trim()) body.creativeDirection = values.direction.trim()
    if (Object.keys(body).length === 1) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await apiFetch('/api/orders/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not save the details') }
      onToast({ message: 'Details saved', type: 'success' })
      setEditing(false)
      await onSaved()
    } catch (e) {
      onToast({ message: e instanceof Error ? e.message : 'Could not save the details', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <>
        <CopyableField label="Runner" value={order.effectiveRunnerName || order.runnerName || 'Unknown'} />
        <CopyableField label="Race" value={order.effectiveRaceName || order.raceName || 'Custom'} />
        <CopyableField label="Year" value={String(order.effectiveRaceYear || order.raceYear || 'N/A')} />
        {order.bibNumberCustomer && <CopyableField label="Bib #" value={order.bibNumberCustomer} />}
        {order.timeCustomer && <CopyableField label="Time" value={order.timeCustomer} />}
        <div className="pt-1 flex justify-end">
          <button onClick={() => { setValues(initial()); setEditing(true) }} className="flex items-center gap-1.5 text-xs font-medium text-off-black/60 hover:text-off-black transition-colors">
            <Pencil className="w-3 h-3" />
            Edit details
          </button>
        </div>
      </>
    )
  }

  const input = 'w-full min-w-0 px-2 py-1.5 border border-border-gray rounded bg-white text-body-sm focus:outline-none focus:ring-2 focus:ring-off-black/20'
  const row = (label: string, el: React.ReactNode) => (
    <label className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
      <span className="text-body-sm text-off-black/60">{label}</span>
      {el}
    </label>
  )
  return (
    <div className="space-y-2">
      {row('Runner', <input autoFocus value={values.runner} onChange={set('runner')} placeholder="Name on the print" className={input} />)}
      {row('Race', <input value={values.race} onChange={set('race')} placeholder="e.g. Wattuppa Trail Race 50K" className={input} />)}
      {row('Year', <input value={values.year} onChange={set('year')} inputMode="numeric" maxLength={4} placeholder="2025" className={input} />)}
      {row('Bib #', <input value={values.bib} onChange={set('bib')} placeholder="Optional" className={input} />)}
      {row('Time', <input value={values.time} onChange={set('time')} placeholder="e.g. 5:02:05" className={input} />)}
      <label className="block">
        <span className="block text-body-sm text-off-black/60 mb-1">Creative direction</span>
        <textarea value={values.direction} onChange={set('direction')} rows={3} placeholder="What the customer asked for" className={`${input} resize-y`} />
      </label>
      <div className="pt-1 flex justify-end gap-2">
        <button onClick={() => { setValues(initial()); setEditing(false) }} disabled={saving} className="px-3 py-1 text-xs font-medium text-off-black/60 hover:text-off-black disabled:opacity-40">Cancel</button>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-dark-fill text-white rounded hover:opacity-90 disabled:opacity-50">
          <Check className="w-3 h-3" />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

/**
 * Change which race a print is for, when the customer picked the wrong one
 * (a half marathon's results on a marathon print, or the wrong city). A
 * select of every race we have a design for; saving sets the race override
 * and the caller runs research again, since the result was for the old race.
 */
export function ChangeRace({ order, onSaved }: { order: Order; onSaved: (raceName: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [races, setRaces] = useState<string[] | null>(null)
  const [pick, setPick] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const current = order.effectiveRaceName || order.raceName || ''
  useEffect(() => {
    if (!open || races) return
    apiFetch('/api/orders?list=races').then(r => r.json())
      .then(d => setRaces([...new Set(((d.races || []) as { raceName: string }[]).map(r => r.raceName))].sort((a, b) => a.localeCompare(b))))
      .catch(() => setRaces([]))
  }, [open, races])
  const save = async () => {
    if (!pick || pick === current) { setOpen(false); return }
    setSaving(true); setErr(null)
    try {
      const res = await apiFetch('/api/orders/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: order.orderNumber, raceNameOverride: pick }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(data.error || 'Could not change the race'); return }
      setOpen(false); await onSaved(pick)
    } finally { setSaving(false) }
  }
  if (!open) {
    return <button type="button" onClick={() => { setPick(current); setOpen(true) }} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors" title="The print is for a different race than the order says"><Pencil className="w-3 h-3" /> Change race</button>
  }
  return (
    <div className="flex items-center gap-2">
      <select value={pick} onChange={e => setPick(e.target.value)} disabled={!races} className="max-w-[220px] text-xs border border-border-gray rounded bg-white px-1.5 py-1">
        {!races && <option>Loading races…</option>}
        {races && !races.includes(current) && current && <option value={current}>{current}</option>}
        {races?.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <button type="button" onClick={save} disabled={saving || !races} className="flex items-center gap-1 text-xs text-green-700 disabled:opacity-40"><Check className="w-3 h-3" /> Save</button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-off-black/50 hover:text-off-black">Cancel</button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  )
}
