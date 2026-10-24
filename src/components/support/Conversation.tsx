import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Archive, Bold, ChevronDown, Clock, Italic, Link as LinkIcon, Loader2, Mail, Paperclip, RotateCcw, Send, Star, StickyNote, Trash2, Zap, X, Search } from 'lucide-react'
import { toast } from 'sonner'
import { btnGhost, btnPrimary, btnSecondary } from '@/lib/ui'
import { supportApi } from '@/lib/supportApi'
import { when } from '@/lib/supportDates'
import { fillMacro, tagStoreLinks } from '@/lib/supportStatus'
import AssigneePicker, { Avatar } from '@/components/AssigneePicker'
import { ChannelMark, CustomerAvatar } from './ConversationList'
import DraftCard from './DraftCard'
import { nameCase } from '@/lib/nameCase'
import RichReply, { type RichReplyHandle } from './RichReply'
import Attachments from './Attachments'
import type { Macro, Message, Mockup, Note, Proposal, Teammate, ThreadDetail, ThreadStatus } from '@/types/support'

/**
 * The conversation, Intercom's middle column.
 *
 * A header with the customer, the star, who has it, and Close with Snooze
 * under its chevron. A timeline of the customer's messages, our replies,
 * the team's internal notes (yellow, never sent, with @mentions) and the
 * events that happened to the thread. A composer with two tabs: Reply goes
 * out as fast@, Note stays here. Macros drop a saved reply in; Send and
 * close does both in one go. Everything has a key.
 *
 * An Instagram thread uses the same timeline and the same two tabs; the
 * reply goes out as a DM from @trackstar_art, starts empty (DMs are short,
 * no greeting or sign-off), and is held when Meta's 24-hour window after
 * the customer's last message has closed.
 */
type Item = { at: string; kind: 'message'; m: Message } | { at: string; kind: 'note'; n: Note }

/** Macros for a "/query": shortcut starts first, then name or shortcut contains. Spaces read as dashes. */
function macroMatches(macros: Macro[], query: string): Macro[] {
  const q = query.toLowerCase().trim()
  const dashed = q.replace(/\s+/g, '-')
  const starts = macros.filter(m => (m.shortcut || '').startsWith(dashed))
  const rest = q ? macros.filter(m => !starts.includes(m) && (m.name.toLowerCase().includes(q) || (m.shortcut || '').includes(dashed))) : []
  if (starts.length || rest.length || dashed.length < 4) return [...starts, ...rest].slice(0, 8)
  // Nothing exact: a misspelling (/colombus) still finds the macro whose shortcut is a letter or two off.
  const near = (m: Macro) => Math.min(...(m.shortcut || '').split('-').concat(m.shortcut || '').map(w => typoDistance(dashed, w.slice(0, dashed.length + 1))))
  return macros.map(m => ({ m, d: near(m) })).filter(x => x.d <= (dashed.length >= 7 ? 2 : 1)).sort((a, b) => a.d - b.d).map(x => x.m).slice(0, 8)
}

/** Edit distance, for short words. */
function typoDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length]
}

function Bubble({ m }: { m: Message }) {
  const [showQuoted, setShowQuoted] = useState(false)
  const out = m.direction === 'out'
  const who = out ? (m.sentBy ? `${m.sentBy.firstName} from Trackstar` : (m.fromName || 'Trackstar')) : (m.fromName || m.fromEmail || 'Instagram user')
  return (
    <div className={`flex items-end gap-2 ${out ? 'justify-end' : 'justify-start'}`}>
      {!out && <CustomerAvatar name={m.fromName} email={m.fromEmail || m.fromName} size={26} />}
      <div className={`max-w-[88%] md:max-w-[72%] rounded-2xl px-4 py-3 ${out ? 'bg-dark-fill text-white rounded-br-md' : 'bg-subtle-gray border border-border-gray text-off-black rounded-bl-md'}`}>
        <div className={`flex items-baseline justify-between gap-4 mb-1 text-[11px] ${out ? 'text-white/55' : 'text-off-black/50'}`}>
          <span className="font-medium truncate">{who}</span>
          <span className="shrink-0 tabular-nums">{when(m.sentAt)}</span>
        </div>
        {(m.text || m.attachments.length === 0) && <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">{m.text || <span className={out ? 'text-white/50' : 'text-off-black/40'}>(no text)</span>}</div>}
        {m.attachments.length > 0 && <Attachments messageId={m.id} attachments={m.attachments} out={out} />}
        {m.quoted && (
          <button onClick={() => setShowQuoted(v => !v)} className={`mt-2 inline-flex items-center gap-1 text-[11px] ${out ? 'text-white/50 hover:text-white/80' : 'text-off-black/40 hover:text-off-black/70'}`}>
            <ChevronDown className={`w-3 h-3 transition-transform ${showQuoted ? 'rotate-180' : ''}`} />{showQuoted ? 'Hide quoted text' : 'Show quoted text'}
          </button>
        )}
        {showQuoted && m.quoted && <div className={`mt-2 pt-2 border-t text-xs whitespace-pre-wrap break-words ${out ? 'border-white/15 text-white/55' : 'border-border-gray text-off-black/50'}`}>{m.quoted}</div>}
      </div>
      {out && m.sentBy && <Avatar user={m.sentBy} size={26} />}
    </div>
  )
}

/** A note with the @names bold, or an event as one quiet line. */
function NoteCard({ n, team, meId, isAdmin, onDelete }: { n: Note; team: Teammate[]; meId: string; isAdmin: boolean; onDelete: () => void }) {
  if (n.kind === 'event') {
    return (
      <div className="flex items-center gap-3 text-[11px] text-off-black/45 px-2">
        <span className="flex-1 border-t border-border-gray/80" />
        <span className="shrink-0">{n.body} · {when(n.createdAt)}</span>
        <span className="flex-1 border-t border-border-gray/80" />
      </div>
    )
  }
  const names = team.map(u => `${u.firstName} ${u.lastName}`.trim()).filter(Boolean).sort((a, b) => b.length - a.length)
  const parts: (string | { name: string })[] = []
  let rest = n.body
  const re = names.length ? new RegExp(`@(${names.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g') : null
  if (re) {
    let last = 0
    for (const m of rest.matchAll(re)) {
      parts.push(rest.slice(last, m.index)); parts.push({ name: m[1] }); last = (m.index || 0) + m[0].length
    }
    parts.push(rest.slice(last)); rest = ''
  } else parts.push(rest)
  const mine = n.author?.id === meId
  return (
    <div className="flex items-start gap-2">
      {n.author ? <Avatar user={n.author} size={26} /> : <span className="w-[26px] h-[26px] rounded-full bg-amber-200" />}
      <div className="group max-w-[88%] md:max-w-[72%] rounded-2xl rounded-tl-md px-4 py-3 bg-amber-50 border border-amber-200 text-off-black">
        <div className="flex items-baseline justify-between gap-4 mb-1 text-[11px] text-amber-900/70">
          <span className="font-medium inline-flex items-center gap-1"><StickyNote className="w-3 h-3" />{n.authorName} · note</span>
          <span className="shrink-0 tabular-nums inline-flex items-center gap-2">
            {when(n.createdAt)}
            {(mine || isAdmin) && <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-amber-900/50 hover:text-red-600" title="Delete note"><Trash2 className="w-3 h-3" /></button>}
          </span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {parts.map((p, i) => typeof p === 'string' ? p : <span key={i} className="font-semibold text-amber-900 bg-amber-100 rounded px-0.5">@{p.name}</span>)}
        </div>
      </div>
    </div>
  )
}

/** The reply, as the playbook opens and closes one, with the rest to write. A DM starts empty. */
function starter(thread: ThreadDetail, me: Teammate) {
  if (thread.channel === 'instagram') return ''
  const first = nameCase((thread.customerName || '').trim().split(/\s+/)[0] || '')
  return `Hey${first ? ` ${first}` : ''},\n\n\n\nThanks,\n${me.firstName} from Trackstar`
}
/** True when nothing has been written between the greeting and the sign-off. */
function isBlank(text: string) {
  return text.replace(/^Hey[^\n]*,\n/, '').replace(/\n+Thanks,\n[^\n]*$/, '').trim().length === 0
}
/** The first name a macro greets: the display name's first word, never an @handle. */
function firstNameOf(thread: ThreadDetail) {
  const n = (thread.customerName || '').trim()
  if (!n || n.startsWith('@')) return ''
  return n.split(/\s+/)[0]
}

const SNOOZES: { label: string; until: () => Date }[] = [
  { label: 'Later today', until: () => { const d = new Date(); d.setHours(d.getHours() + 4); return d } },
  { label: 'Tomorrow morning', until: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d } },
  { label: 'In 3 days', until: () => { const d = new Date(); d.setDate(d.getDate() + 3); d.setHours(9, 0, 0, 0); return d } },
  { label: 'Next week', until: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d } },
]

/** A small popover that closes on outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return { open, setOpen, ref }
}

/** The macro menu: search, pick, done. */
function MacroMenu({ macros, onPick, onClose }: { macros: Macro[]; onPick: (m: Macro) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? macros.filter(m => m.name.toLowerCase().includes(s) || m.body.toLowerCase().includes(s)) : macros
  }, [macros, q])
  useEffect(() => { setIdx(0) }, [q])
  return (
    <div className="absolute left-0 bottom-full mb-1 w-[380px] max-w-[90vw] rounded-lg bg-white border border-border-gray shadow-[0_8px_30px_rgba(0,0,0,0.14)] z-30 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-gray">
        <Search className="w-3.5 h-3.5 text-off-black/40" />
        <input
          ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Search macros"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(list.length - 1, i + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
            if (e.key === 'Enter' && list[idx]) { e.preventDefault(); onPick(list[idx]) }
            if (e.key === 'Escape') onClose()
          }}
          className="flex-1 text-sm focus:outline-none placeholder:text-off-black/35"
        />
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {list.length === 0 && <div className="px-3 py-4 text-xs text-off-black/45">No macro matches.</div>}
        {list.map((m, i) => (
          <button key={m.id} onMouseEnter={() => setIdx(i)} onClick={() => onPick(m)} className={`w-full text-left px-3 py-2 border-b border-border-gray/60 last:border-b-0 ${i === idx ? 'bg-subtle-gray' : ''}`}>
            <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium text-off-black truncate">{m.name}</span>{m.shortcut && <span className="text-[11px] font-mono text-off-black/50 shrink-0">/{m.shortcut}</span>}</div>
            <div className="text-[11px] text-off-black/50 truncate">{m.body.replace(/\s+/g, ' ')}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Conversation({ thread, team, me, isAdmin, busy, macros, expectedHandle = 'trackstar_art', onAssign, onStatus, onSnooze, onPriority, onMarkUnread, onReply, onNote, onDeleteNote, onRedraft, onMerge, onUseMacro, onRefresh, replyRef, noteRef, insertRef, attachRef }: {
  thread: ThreadDetail
  /** The Instagram account replies go out as, without the @. */
  expectedHandle?: string
  team: Teammate[]
  me: Teammate
  isAdmin: boolean
  busy: boolean
  macros: Macro[]
  onAssign: (id: string | null) => void
  onStatus: (s: ThreadStatus) => void
  onSnooze: (until: string | null) => void
  onPriority: (p: boolean) => void
  onMarkUnread: () => void
  onReply: (text: string, close: boolean, attachments: string[]) => Promise<boolean>
  onNote: (body: string, mentions: string[]) => Promise<boolean>
  onDeleteNote: (noteId: string) => void
  onRedraft: (instruction: string) => Promise<void>
  onMerge: (ids: string[]) => void
  onUseMacro: (id: string) => void
  /** Reload this conversation after an approved suggested action. */
  onRefresh: () => void
  /** Lets the page's keyboard shortcuts focus the composer. */
  replyRef: React.RefObject<RichReplyHandle>
  noteRef: React.RefObject<HTMLTextAreaElement>
  /** The Actions panel drops lines into the reply through this. */
  insertRef: React.MutableRefObject<((text: string) => void) | null>
  /** And mockups onto it through this. */
  attachRef: React.MutableRefObject<((m: Mockup) => void) | null>
}) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [text, setText] = useState(() => starter(thread, me))
  const [note, setNote] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [mentionQ, setMentionQ] = useState<string | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [sending, setSending] = useState(false)
  const [attached, setAttached] = useState<Mockup[]>([])
  const [enlarged, setEnlarged] = useState<{ src: string; label: string } | null>(null)
  const [slashQ, setSlashQ] = useState<string | null>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  const [uploading, setUploading] = useState(0)
  // A code made from a suggested action, for the [CODE] in a draft not used yet.
  const [madeCode, setMadeCode] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const close = usePopover()
  const macro = usePopover()

  useEffect(() => { setText(starter(thread, me)); setNote(''); setMentionIds([]); setMode('reply'); setAttached([]) }, [thread.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [thread.id, thread.messages.length, thread.notes.length])

  const timeline = useMemo<Item[]>(() => {
    const items: Item[] = [
      ...thread.messages.map(m => ({ at: m.sentAt, kind: 'message' as const, m })),
      ...thread.notes.map(n => ({ at: n.createdAt, kind: 'note' as const, n })),
    ]
    return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  }, [thread.messages, thread.notes])

  // Only the newest draft offers Use and Redraft; older ones fold away.
  const latestDraftId = useMemo(() => [...thread.notes].reverse().find(n => n.kind === 'draft')?.id || null, [thread.notes])
  const ig = thread.channel === 'instagram'
  const wrote = !isBlank(text)
  const hasEmDash = /—/.test(text)
  const snoozed = thread.snoozedUntil && new Date(thread.snoozedUntil) > new Date()
  // Meta's rule for a DM. The server says the same thing again on Send; this is so nobody types a reply that cannot go.
  const window = ig ? thread.replyWindow : null
  const windowClosed = Boolean(window && !window.open)
  const canSend = wrote && !sending && !hasEmDash && !busy && !windowClosed && uploading === 0

  const send = async (closeAfter = false) => {
    if (!canSend) return
    setSending(true)
    try { if (await onReply(text.trim(), closeAfter, attached.map(m => m.ref))) { setText(starter(thread, me)); setAttached([]) } }
    finally { setSending(false) }
  }
  const addNote = async () => {
    if (!note.trim() || sending) return
    setSending(true)
    try {
      // Keep only the mentions whose @name is still in the text.
      const keep = mentionIds.filter(id => { const u = team.find(x => x.id === id); return u && note.includes(`@${u.firstName} ${u.lastName}`.trim()) })
      if (await onNote(note.trim(), keep)) { setNote(''); setMentionIds([]) }
    } finally { setSending(false) }
  }

  // @mentions: typing @ in a note offers the team; Enter or click inserts the name.
  const mentionMatches = useMemo(() => {
    if (mentionQ === null) return []
    const s = mentionQ.toLowerCase()
    return team.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(s)).slice(0, 6)
  }, [mentionQ, team])
  const onNoteChange = (v: string, caret: number) => {
    setNote(v)
    const before = v.slice(0, caret)
    const m = before.match(/(?:^|\s)@([\w ]{0,30})$/)
    setMentionQ(m ? m[1] : null)
    setMentionIdx(0)
  }
  const pickMention = (u: Teammate) => {
    const el = noteRef.current
    const caret = el ? el.selectionStart : note.length
    const before = note.slice(0, caret).replace(/@([\w ]{0,30})$/, '')
    const name = `${u.firstName} ${u.lastName}`.trim()
    const next = `${before}@${name} ${note.slice(caret)}`
    setNote(next)
    setMentionIds(ids => (ids.includes(u.id) ? ids : [...ids, u.id]))
    setMentionQ(null)
    requestAnimationFrame(() => { if (el) { const pos = before.length + name.length + 2; el.focus(); el.setSelectionRange(pos, pos) } })
  }

  /** Bold, italic or a link on the selected words (the toolbar and ⌘B / ⌘I / ⌘K). */
  const wrapSelection = (kind: 'bold' | 'italic' | 'link') => replyRef.current?.format(kind)

  /** Put text into the reply: between the greeting and sign-off when nothing is written yet, else at the caret. */
  const placeInReply = (body: string, replaceSlash = false) => {
    const editor = replyRef.current
    setSlashQ(null)
    if (replaceSlash) {
      // The "/shortcut" being typed goes away with the pick.
      const typed = editor?.lineBeforeCaret().match(/\/[\w-]*(?: [\w-]*){0,2}$/)?.[0] || ''
      editor?.insert(body, typed.length)
      return
    }
    if (ig ? !text.trim() : isBlank(text)) {
      let next: string
      let upTo: string
      if (ig) { next = body; upTo = body }
      else {
        const greet = text.match(/^Hey[^\n]*,\n/)?.[0] || ''
        const sign = text.match(/\n+Thanks,\n[^\n]*$/)?.[0] || ''
        next = `${greet}\n${body}\n${sign}`
        upTo = `${greet}\n${body}`
      }
      setText(next)
      requestAnimationFrame(() => editor?.focusLine(upTo.split('\n').length - 1, 'end'))
      return
    }
    editor?.insert(body)
  }
  useEffect(() => { insertRef.current = (t: string) => { setMode('reply'); placeInReply(t) } })
  useEffect(() => {
    attachRef.current = (m: Mockup) => {
      setMode('reply')
      setAttached(list => list.some(x => x.ref === m.ref) ? list.filter(x => x.ref !== m.ref) : list.length >= 6 ? list : [...list, m])
    }
  })

  // Files from the rep's computer: picked, dropped or pasted into the reply. Straight to storage, then attached by ref.
  const fileInput = useRef<HTMLInputElement>(null)
  const upload = async (files: File[]) => {
    const room = 6 - attached.length
    const take = files.filter(f => (ig ? f.type.startsWith('image/') : f.type.startsWith('image/') || f.type === 'application/pdf')).slice(0, Math.max(0, room))
    if (take.length < files.length) toast.error(ig ? 'Instagram takes pictures only, up to 6' : 'Images and PDFs only, up to 6 a reply')
    for (const f of take) {
      setUploading(n => n + 1)
      try {
        const slot = await supportApi.uploadSlot(f.name || 'pasted-image.png', f.type, f.size)
        const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.type || 'application/octet-stream', 'x-upsert': 'false' }, body: f })
        if (!put.ok) throw new Error(`${f.name} did not upload`)
        const thumbUrl = f.type.startsWith('image/') && !/hei[cf]/.test(f.type) ? URL.createObjectURL(f) : null
        setAttached(list => [...list, { ref: slot.ref, orderId: '', kind: 'upload', label: slot.filename, thumbUrl, at: new Date().toISOString() }])
      } catch (e) { toast.error((e as Error).message) }
      finally { setUploading(n => n - 1) }
    }
  }

  // /shortcut: a slash at the start of a word in the reply offers the macros; Enter or Tab drops one in.
  // Built in, not saved: /tracking drops in the customer's newest tracking link, Artelo's first (one per order with tracking).
  const builtins = useMemo<Macro[]>(() => {
    const orders = thread.context?.orders || []
    const withTracking = orders.map(o => {
      const t = [...o.tracking].reverse().find(x => x.fromArtelo && x.url) || [...o.tracking].reverse().find(x => x.url) || null
      return t ? { o, t } : null
    }).filter((x): x is { o: (typeof orders)[number]; t: (typeof orders)[number]['tracking'][number] } => Boolean(x))
    return withTracking.map(({ o, t }, i) => ({
      id: `builtin:tracking:${o.number}`,
      name: `Tracking link · #${o.number}${t.company ? ` · ${t.company}` : ''}${t.deliveredAt ? ' · delivered' : ''}`,
      shortcut: i === 0 ? 'tracking' : `tracking-${o.number}`,
      body: t.url || '',
      uses: 0,
      updatedAt: t.at || '',
      createdBy: null,
    } as Macro))
  }, [thread.context])
  const allMacros = useMemo(() => [...builtins, ...macros], [builtins, macros])
  const slashMatches = useMemo(() => (slashQ === null ? [] : macroMatches(allMacros, slashQ)), [slashQ, allMacros])
  const onReplyChange = (v: string) => {
    setText(v)
    // A space may continue the query ("/marine corps"); it only stays open while something matches.
    const m = (replyRef.current?.lineBeforeCaret() || '').match(/(?:^|\s)\/([\w-]*(?: [\w-]*){0,2})$/)
    const q = m ? m[1] : null
    setSlashQ(q !== null && q.includes(' ') && !macroMatches(allMacros, q).length ? null : q)
    setSlashIdx(0)
  }
  const pickSlash = (m: Macro) => {
    placeInReply(fillMacro(m.body, { firstName: firstNameOf(thread), rep: me.firstName, channel: thread.channel }), true)
    if (!m.id.startsWith('builtin:')) onUseMacro(m.id)
  }

  // The orders this conversation is about: under their email, or linked by a teammate.
  const verifiedNumbers = useMemo(() => (thread.context?.orders || []).map(o => String(o.number)), [thread.context])

  /** Run a suggested action from Claude's draft, the same call the Actions panel makes, then mark it done. */
  const approveProposal = async (n: Note, p: Proposal, idempotencyKey: string) => {
    try {
      if (p.type === 'shippingAddress') {
        await supportApi.action('shippingAddress', { id: thread.id, shopifyOrderId: p.shopifyOrderId, address: p.address, idempotencyKey })
        toast.success(`#${p.orderNumber} ship-to changed in Shopify. Artelo still needs it.`)
      } else if (p.type === 'discount') {
        const out = await supportApi.action<{ code: string }>('discount15', { id: thread.id, percent: p.percent })
        setMadeCode(out.code)
        setText(t => (t.includes('[CODE]') ? t.replace(/\[CODE\]/g, out.code) : t))
        try { await navigator.clipboard.writeText(out.code) } catch { /* it is in the reply or the draft */ }
        toast.success(`${out.code} created${text.includes('[CODE]') ? ' and put in the reply' : '; it goes in when you use the draft'}`)
      } else if (p.type === 'changeItem') {
        const out = await supportApi.action<{ number: string; now: string; invoiced: boolean; owed: number }>('changeItem', { id: thread.id, shopifyOrderId: p.shopifyOrderId, size: p.size, frame: p.frame, idempotencyKey })
        toast.success(`#${out.number} is now ${out.now}${out.invoiced ? `; invoice sent for $${out.owed.toFixed(2)}` : ''}`)
      } else if (p.type === 'orderNote') {
        await supportApi.action('orderNote', { id: thread.id, orderId: p.orderId, text: p.text })
        toast.success(`Note left on #${p.orderNumber}`)
      }
      await supportApi.setProposal(thread.id, n.id, p.id, 'done')
      onRefresh()
    } catch (e) { toast.error((e as Error).message) }
  }
  const dismissProposal = async (n: Note, p: Proposal) => {
    try { await supportApi.setProposal(thread.id, n.id, p.id, 'dismissed'); onRefresh() } catch (e) { toast.error((e as Error).message) }
  }

  const insertMacro = (m: Macro) => {
    macro.setOpen(false)
    placeInReply(fillMacro(m.body, { firstName: firstNameOf(thread), rep: me.firstName, channel: thread.channel }))
    onUseMacro(m.id)
  }

  // Escalate, Close (with snooze and waiting) and Reopen: down with Send, so every action on the conversation sits in one row.
  const statusActions = (
    <span className="inline-flex items-center gap-2">
          {thread.status !== 'escalated' && thread.status !== 'closed' && (
            <button onClick={() => onStatus('escalated')} disabled={busy} className={btnSecondary} title="Pull Matt in"><AlertTriangle className="w-3.5 h-3.5" /> Escalate</button>
          )}
          {thread.status === 'closed' ? (
            <button onClick={() => onStatus('open')} disabled={busy} className={btnPrimary}><RotateCcw className="w-3.5 h-3.5" /> Reopen</button>
          ) : (
            <div className="relative inline-flex" ref={close.ref}>
              <button onClick={() => onStatus('closed')} disabled={busy} className={`${btnPrimary} rounded-r-none`} title="Close (c)"><Archive className="w-3.5 h-3.5" /> Close <Kbd>C</Kbd></button>
              <button onClick={() => close.setOpen(v => !v)} disabled={busy} className={`${btnPrimary} rounded-l-none px-1.5 border-l border-white/20`} title="Snooze, or mark waiting"><ChevronDown className="w-3.5 h-3.5" /></button>
              {close.open && (
                <div className="absolute right-0 bottom-full mb-1 w-52 p-1 rounded-lg bg-white border border-border-gray shadow-[0_6px_24px_rgba(0,0,0,0.12)] z-20">
                  <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-off-black/40">Snooze</div>
                  {SNOOZES.map(s => <button key={s.label} onClick={() => { close.setOpen(false); onSnooze(s.until().toISOString()) }} className="w-full text-left px-3 py-1.5 text-sm rounded-md hover:bg-subtle-gray">{s.label}</button>)}
                  {snoozed && <button onClick={() => { close.setOpen(false); onSnooze(null) }} className="w-full text-left px-3 py-1.5 text-sm rounded-md hover:bg-subtle-gray text-off-black/60">Unsnooze</button>}
                  {thread.status === 'open' && <><div className="my-1 border-t border-border-gray" /><button onClick={() => { close.setOpen(false); onStatus('waiting') }} className="w-full text-left px-3 py-1.5 text-sm rounded-md hover:bg-subtle-gray">Mark waiting on customer</button></>}
                </div>
              )}
            </div>
          )}
    </span>
  )

  return (
    <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-white">
      {/* Header: who and what on the left; star, unread and who has it on the right, on the same line. */}
      <div className="px-5 py-3 border-b border-border-gray shrink-0">
        <div className="flex items-start gap-3">
          <CustomerAvatar name={thread.customerName} email={thread.customerEmail || thread.igUsername} size={34} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-off-black leading-tight truncate">{thread.customerName || (ig && thread.igUsername ? `@${thread.igUsername}` : '') || thread.customerEmail || 'Unknown sender'}<span className="font-normal text-off-black/45 text-xs ml-2">{thread.customerEmail}</span></div>
            <div className="text-[13px] text-off-black/70 leading-snug inline-flex items-start gap-1.5 max-w-full break-words">
              <ChannelMark channel={thread.channel} />
              {ig ? (
                thread.igUsername ? <a href={`https://instagram.com/${thread.igUsername}`} target="_blank" rel="noopener noreferrer" className="hover:text-off-black hover:underline">{thread.customerName && thread.customerName !== `@${thread.igUsername}` ? `@${thread.igUsername} · ` : ''}Instagram</a> : <span>Instagram DM</span>
              ) : <span>{thread.subject || '(no subject)'}</span>}
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-0.5 -mt-0.5">
            {snoozed && <span className="mr-1 text-[11px] text-off-black/50 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(thread.snoozedUntil as string).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>}
            <button onClick={() => onPriority(!thread.priority)} disabled={busy} className={`${btnGhost} px-1.5`} title={thread.priority ? 'Remove priority (p)' : 'Mark priority (p)'}>
              <Star className={`w-4 h-4 ${thread.priority ? 'text-amber-500 fill-amber-500' : 'text-off-black/40'}`} />
            </button>
            <button onClick={onMarkUnread} disabled={busy} className={`${btnGhost} px-1.5`} title="Mark unread (u)">
              <Mail className="w-4 h-4 text-off-black/40" />
            </button>
            <AssigneePicker team={team} value={thread.assignee?.id || null} meId={me.id} onChange={onAssign} firstNameOnly />
          </div>
        </div>
      </div>

      {/* The customer wrote again instead of replying: offer to fold the others in. */}
      {(() => {
        const others = thread.channel === 'email' ? thread.pastThreads.filter(p => p.status !== 'closed') : []
        if (!others.length) return null
        return (
          <div className="px-5 py-2 border-b border-amber-200 bg-amber-50 text-xs text-amber-900 flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0">
            <span>{(thread.customerName || 'This customer').split(/\s+/)[0]} has {others.length} other open conversation{others.length === 1 ? '' : 's'}{others.length === 1 ? `: "${others[0].subject || '(no subject)'}"` : ''}.</span>
            <button onClick={() => { if (globalThis.confirm(`Merge ${others.length === 1 ? 'it' : `all ${others.length}`} into this conversation? Their messages move here; this cannot be undone.`)) onMerge(others.map(o => o.id)) }}
              className="font-semibold text-[#4600D6] hover:underline underline-offset-2">Merge {others.length === 1 ? 'it' : 'them'} here</button>
          </div>
        )
      })()}

      {/* Timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 bg-[#fcfcfc]">
        {timeline.map(it => it.kind === 'note' && it.n.kind === 'draft'
          ? <DraftCard key={it.n.id} n={it.n} latest={it.n.id === latestDraftId} answered={thread.messages.some(m => m.direction === 'out' && new Date(m.sentAt) > new Date(it.n.createdAt))} onRedraft={onRedraft}
              verifiedNumbers={verifiedNumbers} onApprove={(p, key) => approveProposal(it.n, p, key)} onDismiss={p => dismissProposal(it.n, p)}
              onUse={body => { setMode('reply'); setText(tagStoreLinks(body.replace(/\{\{rep\}\}/g, me.firstName).replace(/\[CODE\]/g, c => madeCode || c), thread.channel)); requestAnimationFrame(() => replyRef.current?.focusLine(0, 'start')) }} />
          : it.kind === 'message'
          ? <Bubble key={it.m.id} m={it.m} />
          : <NoteCard key={it.n.id} n={it.n} team={team} meId={me.id} isAdmin={isAdmin} onDelete={() => onDeleteNote(it.n.id)} />)}
        <div ref={bottom} />
      </div>

      {/* Composer */}
      <div className={`border-t border-border-gray shrink-0 transition-colors ${mode === 'note' ? 'bg-amber-50' : 'bg-white'}`}>
        <div className="px-4 pt-2 flex items-center gap-1 text-[13px]">
          <button onClick={() => { setMode('reply'); requestAnimationFrame(() => replyRef.current?.focus()) }} className={`px-3 py-1.5 rounded-t-md border-b-2 ${mode === 'reply' ? 'border-dark-fill text-off-black font-semibold' : 'border-transparent text-off-black/50 hover:text-off-black'}`}>Reply</button>
          <button data-note-tab onClick={() => { setMode('note'); requestAnimationFrame(() => noteRef.current?.focus()) }} className={`px-3 py-1.5 rounded-t-md border-b-2 inline-flex items-center gap-1.5 ${mode === 'note' ? 'border-amber-500 text-amber-900 font-semibold' : 'border-transparent text-off-black/50 hover:text-off-black'}`}><StickyNote className="w-3.5 h-3.5" />Note</button>
          <span className="ml-auto text-[11px] text-off-black/40 truncate">{mode === 'reply' ? (ig ? `Reply as @${expectedHandle} to ${thread.igUsername ? `@${thread.igUsername}` : 'them'} on Instagram` : '') : 'Only the team sees notes. @ to mention someone.'}</span>
        </div>
        {mode === 'reply' && window && (window.mode === 'closed' || window.mode === 'none' || window.mode === 'human_agent') && (
          <div className={`mx-4 mt-2 rounded-md border px-3 py-2 text-xs inline-flex items-start gap-2 ${windowClosed ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border-gray bg-subtle-gray text-off-black/70'}`}>
            <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {window.reason}
              {windowClosed && window.closesAt && window.mode === 'closed' && <> It closed {when(window.closesAt)}.</>}
              {windowClosed && <> You can still leave a note for the team.</>}
            </span>
          </div>
        )}
        {mode === 'reply' ? (
          <div className="px-4 pb-3">
            <div className="relative rounded-md border border-border-gray bg-white focus-within:ring-2 focus-within:ring-off-black/10 focus-within:border-off-black/30">
              {/* Formatting, attach and macros sit on the reply box itself. */}
              <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-border-gray">
              {!ig && (
                <span className="inline-flex items-center rounded-md border border-border-gray overflow-hidden" title="Formatting: **bold**, _italic_, [text](link). Links are made from bare addresses too.">
                  <button type="button" onClick={() => wrapSelection('bold')} className="px-2 py-1.5 text-off-black/60 hover:bg-subtle-gray hover:text-off-black" title="Bold (⌘B)"><Bold className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => wrapSelection('italic')} className="px-2 py-1.5 text-off-black/60 hover:bg-subtle-gray hover:text-off-black border-l border-border-gray" title="Italic (⌘I)"><Italic className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => wrapSelection('link')} className="px-2 py-1.5 text-off-black/60 hover:bg-subtle-gray hover:text-off-black border-l border-border-gray" title="Link (⌘K)"><LinkIcon className="w-3.5 h-3.5" /></button>
                </span>
              )}
              <input ref={fileInput} type="file" multiple accept={ig ? 'image/*' : 'image/*,application/pdf'} className="hidden"
                onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) upload(fs) }} />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={attached.length >= 6} className={`${btnGhost} text-xs`} title={ig ? 'Attach pictures (or paste or drop them in the reply)' : 'Attach images or a PDF (or paste or drop them in the reply)'}><Paperclip className="w-3.5 h-3.5" /> Attach</button>
              <div className="relative" ref={macro.ref}>
                <button data-macro-button onClick={() => macro.setOpen(v => !v)} className={`${btnGhost} text-xs`} title="Insert a saved reply (m), or type / in the reply"><Zap className="w-3.5 h-3.5" /> Macro</button>
                {macro.open && <MacroMenu macros={macros} onPick={insertMacro} onClose={() => macro.setOpen(false)} />}
              </div>
              </div>
              <RichReply
                bare
                ref={replyRef} value={text} onChange={onReplyChange} plain={ig} minHeight={ig ? 96 : 176} disabled={sending || windowClosed}
                onFiles={files => upload(files)}
                placeholder={ig ? (windowClosed ? 'Replies are held until they write again' : 'Write the DM. Keep it short, like a text. / for a macro.') : 'Write the reply. / for a macro.'}
                onKeyDown={e => {
                  if (slashQ !== null && slashMatches.length) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => Math.min(slashMatches.length - 1, i + 1)); return }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => Math.max(0, i - 1)); return }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(slashMatches[slashIdx]); return }
                    if (e.key === 'Escape') { setSlashQ(null); return }
                  }
                  // ⌘↵ sends and closes (most replies finish the conversation); ⌘⇧↵ sends and keeps it open. With nothing written, ⌘↵ just closes.
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    if (wrote) send(!e.shiftKey)
                    else if (!e.shiftKey && thread.status !== 'closed') onStatus('closed')
                  }
                }}
              />
              {slashQ !== null && slashMatches.length > 0 && (
                <div className="absolute left-0 bottom-full mb-1 w-[380px] max-w-[90vw] p-1 rounded-lg bg-white border border-border-gray shadow-[0_8px_30px_rgba(0,0,0,0.14)] z-30">
                  {slashMatches.map((m, i) => (
                    <button key={m.id} onMouseDown={e => { e.preventDefault(); pickSlash(m) }} onMouseEnter={() => setSlashIdx(i)} className={`w-full text-left px-2.5 py-1.5 rounded-md ${i === slashIdx ? 'bg-subtle-gray' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-off-black truncate">{m.name}</span>
                        {m.shortcut && <span className="text-[11px] font-mono text-off-black/50 shrink-0">/{m.shortcut}</span>}
                      </div>
                      <div className="text-[11px] text-off-black/50 truncate">{m.body.replace(/\s+/g, ' ')}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* An attached mockup, full size. Click anywhere or press Esc to close. */}
            {enlarged && (
              <div className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center p-4 md:p-10 cursor-zoom-out" onClick={() => setEnlarged(null)} onKeyDown={e => { if (e.key === 'Escape') setEnlarged(null) }} tabIndex={-1} ref={el => el?.focus()}>
                <img src={enlarged.src} alt={enlarged.label} className="max-w-full max-h-[85vh] object-contain rounded shadow-2xl bg-white" />
                <div className="mt-3 text-sm text-white/80">{enlarged.label}</div>
                <button onClick={() => setEnlarged(null)} className="absolute top-4 right-4 text-white/70 hover:text-white" title="Close (Esc)"><X className="w-6 h-6" /></button>
              </div>
            )}
            {(attached.length > 0 || uploading > 0) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {uploading > 0 && <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border-gray bg-subtle-gray text-xs text-off-black/60"><Loader2 className="w-3.5 h-3.5 animate-spin" />Uploading {uploading}</span>}
                {attached.map(m => (
                  <span key={m.ref} className="inline-flex items-center gap-2 pl-1 pr-2 py-1 rounded-md border border-border-gray bg-subtle-gray text-xs text-off-black/75">
                    {m.thumbUrl
                      ? <button type="button" onClick={() => setEnlarged({ src: m.thumbUrl!, label: m.label })} title="Click to enlarge" className="shrink-0 cursor-zoom-in"><img src={m.thumbUrl} alt="" className="w-8 h-8 rounded object-cover bg-white border border-border-gray hover:ring-2 hover:ring-off-black/20" /></button>
                      : <Paperclip className="w-3.5 h-3.5" />}
                    {m.label}
                    <button onClick={() => setAttached(list => list.filter(x => x.ref !== m.ref))} className="text-off-black/40 hover:text-off-black" title="Remove"><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
              {hasEmDash && <span className="text-[11px] text-red-600 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />No em dashes in anything a customer sees</span>}
              {ig && window?.open && window.mode === 'standard' && window.closesAt && <span className="text-[11px] text-off-black/45 inline-flex items-center gap-1" title="Instagram allows a reply within 24 hours of their last message"><Clock className="w-3 h-3" />Window closes {when(window.closesAt)}</span>}
            </div>
            {/* One row, left to right: Send, Send and close (the usual), Escalate, Close. */}
            <div className="mt-2 flex items-center gap-2">
              <button onClick={() => send(false)} disabled={!canSend} className={btnSecondary} title="Send and keep it open (⌘⇧↵)">
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
              </button>
              <button onClick={() => send(true)} disabled={!canSend} className={`${btnPrimary} whitespace-nowrap`}>Send and close <Kbd>⌘↵</Kbd></button>
              <span className="w-px h-6 bg-border-gray mx-0.5 shrink-0" />
              {statusActions}
            </div>
          </div>
        ) : (
          <div className="px-4 pb-3 relative">
            <textarea
              ref={noteRef} value={note} rows={4} disabled={sending} placeholder="Leave a note for the team..."
              onChange={e => onNoteChange(e.target.value, e.target.selectionStart)}
              onKeyDown={e => {
                if (mentionQ !== null && mentionMatches.length) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(mentionMatches.length - 1, i + 1)); return }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(0, i - 1)); return }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionMatches[mentionIdx]); return }
                  if (e.key === 'Escape') { setMentionQ(null); return }
                }
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); addNote() }
              }}
              className="w-full px-3 py-2.5 text-sm bg-white border border-amber-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-200 resize-y leading-relaxed"
            />
            {mentionQ !== null && mentionMatches.length > 0 && (
              <div className="absolute left-4 bottom-full mb-1 w-56 p-1 rounded-lg bg-white border border-border-gray shadow-[0_6px_24px_rgba(0,0,0,0.12)] z-30">
                {mentionMatches.map((u, i) => (
                  <button key={u.id} onMouseDown={e => { e.preventDefault(); pickMention(u) }} className={`w-full text-left px-2 py-1.5 text-sm rounded-md flex items-center gap-2 ${i === mentionIdx ? 'bg-subtle-gray' : ''}`}>
                    <Avatar user={u} size={18} />{u.firstName} {u.lastName}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-amber-900/60">Mentioned teammates see it under Mentions.</span>
              <span className="flex-1" />
              {statusActions}
              <button onClick={() => { setNote(''); setMentionIds([]); setMode('reply') }} className={btnGhost}><X className="w-3.5 h-3.5" /> Cancel</button>
              <button onClick={addNote} disabled={!note.trim() || sending} className="shrink-0 whitespace-nowrap inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <StickyNote className="w-3.5 h-3.5" />} Add note
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** A keyboard shortcut shown inside a button's label. */
function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border border-current/25 text-[10px] font-medium leading-none opacity-60 font-sans">{children}</kbd>
}
