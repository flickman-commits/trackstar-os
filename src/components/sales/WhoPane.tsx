import { useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { btnGhost, btnPrimary, cardLabel, chip, chipTone, infoCard, inputBase, sectionLabel, segment, textLink } from '@/lib/ui'
import { type Deal, type Person } from '@/types/sales'

/** A CRM field used as a link: only an http(s) address, never javascript: or anything else typed into Attio. */
function webLink(v: string | null | undefined): string | undefined {
  const s = String(v || '').trim()
  return /^https?:\/\//i.test(s) ? s : undefined
}

/**
 * The person and the deal, straight from Attio.
 *
 * What Attio's enrichment says about the person and the company, the deal's
 * own fields (stage, priority, race date, runners, the team's notes), the
 * emails sent from here, and a link into the record. The stage can be moved
 * from here because a rep is a person and may; the tool itself only ever
 * moves Not Contacted to Reached Out on a send.
 */
const STAGE_TONE: Record<string, string> = {
  'Needs Enrichment': chipTone.slate,
  'Not Contacted': chipTone.amber,
  'Reached Out': chipTone.rose,
  'In Conversation': chipTone.race,
  'Call Booked': chipTone.purple,
  'Deck Sent': chipTone.lime,
  'Awaiting Payment': chipTone.teal,
  Won: chipTone.emerald,
  'Revisit Next Year': chipTone.blue,
  Lost: chipTone.red,
  // The PR Pipeline's own statuses.
  'To contact': chipTone.slate,
  Contacted: chipTone.rose,
  'Moving forward': chipTone.purple,
  Published: chipTone.emerald,
  'Not interested': chipTone.red,
  'On hold': chipTone.blue,
  Canceled: chipTone.red,
}


/** "Sat, Apr 3, 2027 · in 6 months", or "· 3 weeks ago" once it has run. */
function raceDateLabel(s: string) {
  const d = new Date(`${s.slice(0, 10)}T00:00:00`)
  const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 864e5)
  const abs = Math.abs(days)
  const span = abs === 0 ? 'today' : abs < 14 ? `${abs} day${abs === 1 ? '' : 's'}` : abs < 60 ? `${Math.round(abs / 7)} weeks` : `${Math.round(abs / 30.4)} months`
  return `${day} · ${days === 0 ? 'today' : days > 0 ? `in ${span}` : `${span} ago`}`
}

/**
 * Text from Attio with its addresses made clickable. A bare link shows as its
 * site ("athletechnews.com") so a long URL does not take over the notes.
 */
function Linked({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)<>,"]+)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (!/^https?:\/\//.test(part)) return <span key={i}>{part}</span>
        const url = part.replace(/[.;:]+$/, '')
        const tail = part.slice(url.length)
        let site = url
        try { site = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep as typed */ }
        return <span key={i}><a href={url} target="_blank" rel="noopener noreferrer" title={url} className="text-blue-600 hover:text-blue-700 underline decoration-blue-600/30 underline-offset-2">{site}</a>{tail}</span>
      })}
    </>
  )
}

export default function WhoPane({ deal, person, onSelectPerson, onNote, busy }: {
  deal: Deal | null
  person: Person | null
  onSelectPerson: (id: string) => void
  onNote: (text: string) => Promise<void>
  busy: boolean
}) {
  const [note, setNote] = useState('')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [noteOpen, setNoteOpen] = useState(false)
  // Notes saved from here this session, so the one you just wrote stays in view.
  const [added, setAdded] = useState<Record<string, string[]>>({})
  useEffect(() => { setNote(''); setNoteOpen(false); setAboutOpen(false) }, [deal?.id])

  if (!deal) return null
  // A one-off to a bare address: nothing in Attio to show or move.
  const free = deal.id.startsWith('adhoc:')

  const sends = deal.sends || []
  // The latest thread sent from here, or every email with them in Gmail.
  const thread = sends.slice().reverse().find(s => s.gmailThreadId)?.gmailThreadId
  const gmailUrl = thread
    ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(thread)}`
    : person?.email ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(person.email)}` : null
  const myNotes = added[deal.id] || []

  return (
    <div className="space-y-5 text-sm">
      <section>
        <div className="text-lg font-bold text-off-black leading-tight">{person ? person.fullName || `${person.firstName} ${person.lastName}`.trim() : 'Nobody on the deal'}</div>
        <div className="text-sm text-off-black/60 mt-0.5">{person?.title || ''}{person?.title ? ' · ' : ''}{deal.company?.name || deal.name}</div>
        {/* Where the deal stands, read-only. Stage moves happen in Attio. */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {(deal.prStatus || deal.stage) && <span className={`${chip} ${STAGE_TONE[String(deal.prStatus || deal.stage)] || chipTone.quiet}`}>{deal.prStatus || deal.stage}</span>}
          {deal.priority && <span className={`${chip} ${deal.priority === 'High' ? chipTone.amber : chipTone.neutral}`}>{deal.priority}</span>}
          <span className={`${chip} ${chipTone.quiet}`}>{deal.touchCount} {deal.touchCount === 1 ? 'touch' : 'touches'}</span>
        </div>
        {/* Races: the date, from Attio's Race date field. Blank there means blank here. */}
        {deal.motion === 'Race' && !free && (
          <div className="mt-2.5 text-sm">
            <span className={cardLabel}>Race date</span>
            <div className={deal.raceDate ? 'text-off-black font-medium' : 'text-off-black/45'}>
              {deal.raceDate ? raceDateLabel(deal.raceDate) : 'Not set in Attio'}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          {webLink(person?.linkedin) && <a href={webLink(person?.linkedin)} target="_blank" rel="noopener noreferrer" className={textLink}>LinkedIn <ExternalLink className="w-3 h-3" /></a>}
          {(person?.webUrl || deal.webUrl) && (
            <a href={person?.webUrl || deal.webUrl || '#'} target="_blank" rel="noopener noreferrer" className={textLink}>Open in Attio <ExternalLink className="w-3 h-3" /></a>
          )}
          {gmailUrl && <a href={gmailUrl} target="_blank" rel="noopener noreferrer" className={textLink}>View thread in Gmail <ExternalLink className="w-3 h-3" /></a>}
          {!free && !noteOpen && <button onClick={() => setNoteOpen(true)} className={textLink}>+ Add note</button>}
          {webLink(deal.publishedLink) && <a href={webLink(deal.publishedLink)} target="_blank" rel="noopener noreferrer" className={textLink}>Published piece <ExternalLink className="w-3 h-3" /></a>}
          {person?.location && <span className="text-xs text-off-black/50">{person.location}</span>}
        </div>
        {deal.people.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {deal.people.map(p => (
              <button key={p.id} onClick={() => onSelectPerson(p.id)} className={`${segment(p.id === person?.id)} border ${p.id === person?.id ? 'border-dark-fill' : 'border-border-gray bg-white'} ${!p.email ? 'opacity-50' : ''}`} title={p.email || 'No email'}>
                {p.firstName || p.fullName}
              </button>
            ))}
          </div>
        )}
      </section>

      {!free && (noteOpen || myNotes.length > 0) && (
        <section>
          <h3 className={`${sectionLabel} mb-2`}>Notes</h3>
          {myNotes.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {myNotes.map((n, i) => <div key={i} className={`${infoCard} text-sm text-off-black/75 whitespace-pre-wrap`}>{n}</div>)}
            </div>
          )}
          {noteOpen && (
            <form className="flex flex-col gap-2" onSubmit={async e => {
              e.preventDefault()
              const text = note.trim()
              if (!text) return
              await onNote(text)
              setAdded(prev => ({ ...prev, [deal.id]: [...(prev[deal.id] || []), text] }))
              setNote(''); setNoteOpen(false)
            }}>
              <textarea autoFocus rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Goes on the deal in Attio, with your name." className={`${inputBase} w-full resize-y`} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setNoteOpen(false); setNote('') }} className={btnGhost}>Cancel</button>
                <button type="submit" disabled={busy || !note.trim()} className={btnPrimary}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save to Attio'}</button>
              </div>
            </form>
          )}
        </section>
      )}

      {person?.description && (
        <section>
          <h3 className={`${sectionLabel} mb-2`}>About them</h3>
          <div className={infoCard}><p className="text-sm text-off-black/75 leading-snug">{person.description}</p></div>
        </section>
      )}

      {(deal.company?.description || deal.notes) && (
        <section>
          <h3 className={`${sectionLabel} mb-2`}>{deal.company?.name || deal.name}</h3>
          <div className={`${infoCard} space-y-2.5`}>
            {deal.company?.description && <p className={`text-sm text-off-black/75 leading-snug ${aboutOpen ? '' : 'line-clamp-3'}`}>{deal.company.description}</p>}
            {deal.company && (deal.company.location || deal.company.employeeRange || deal.company.categories.length > 0) && (
              <p className="text-xs text-off-black/50">{[deal.company.location, deal.company.employeeRange && `${deal.company.employeeRange} people`, ...deal.company.categories.slice(0, 3)].filter(Boolean).join(' · ')}</p>
            )}
            {deal.notes && (
              <div>
                <div className={cardLabel}>Team notes</div>
                <p className={`text-sm text-off-black/75 leading-snug whitespace-pre-wrap mt-0.5 break-words ${aboutOpen ? '' : 'line-clamp-5'}`}><Linked text={deal.notes} /></p>
              </div>
            )}
            {((deal.notes?.length || 0) > 240 || (deal.company?.description?.length || 0) > 160) && (
              <button onClick={() => setAboutOpen(o => !o)} className={textLink}>{aboutOpen ? 'Show less' : 'Show more'}</button>
            )}
          </div>
        </section>
      )}

    </div>
  )
}
