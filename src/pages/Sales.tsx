import PageHeader from '@/components/PageHeader'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Mail, SlidersHorizontal, BarChart3, Check, RefreshCw, PenLine, Search, Loader2 } from 'lucide-react'
import { salesApi, SalesApiError, type DealHit } from '@/lib/salesApi'
import {
  btnSecondary, btnHero, btnHeroSecondary, pageShell,
  segment, segmentGroup, listCard, listToolbar, toolbarInput,
} from '@/lib/ui'
import type { ScheduledEmail, Asset, Deal, DraftResult, Motion, Person, SalesStatus, TodayPayload, Variant } from '@/types/sales'
import Queue, { type QueueMode } from '@/components/sales/Queue'
import Composer, { type TemplateLibrary } from '@/components/sales/Composer'
import { whenLabel } from '@/lib/salesDates'
import ScheduledCard from '@/components/sales/ScheduledCard'
import FiltersMenu from '@/components/sales/FiltersMenu'
import WhoPane from '@/components/sales/WhoPane'
import LibraryPanel from '@/components/sales/LibraryPanel'
import SettingsModal from '@/components/sales/SettingsModal'
import ProgressModal from '@/components/sales/ProgressModal'
import NewEmail from '@/components/sales/NewEmail'
import LoadingStars from '@/components/sales/LoadingStars'
import SentEmail from '@/components/sales/SentEmail'
import { useDocumentHead } from '@/lib/useDocumentHead'

/**
 * Sales: a UI over Attio for the one job of sending the emails.
 *
 * The queue on the left is read live from Attio: New Outreach is the cap's
 * worth of deals nobody has written to, Follow Ups is every deal whose next
 * touch is due. The email in the middle is drafted from Attio's fields and
 * enrichment, edited in place, and sent through your Gmail after an undo
 * window. On send, Attio gets the touch count, the next action, Reached Out,
 * and a note with the email. The right column is the person and the deal as
 * Attio has them, and the library of decks and mockups to drag onto the
 * email. Nothing about a deal is stored here.
 */

type Prepared = { draft: DraftResult; variants: Variant[]; template: boolean }
const AI_KEY = 'sales.ai'

/** The tab title, only while Sales is the page on screen. */
function SalesHead() {
  useDocumentHead({ title: 'Sales · Trackstar' })
  return null
}

/** How old the queue can get, while you were on another page, before coming back reads it again (quietly). */
const STALE_MS = 10 * 60_000

/** A fresh key for one press of Send, so the server sends it once however often the request arrives. */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** The callback's fixed reason codes, in words. It never sends an error's own text. */
const GMAIL_REASONS: Record<string, string> = {
  state: 'the connection expired or was started in another browser. Press Connect Gmail again.',
  wrong_account: 'that Google account is not the email you sign in here with. Connect the Gmail for your own address.',
  no_refresh_token: 'Google did not give a lasting connection. Remove the app under Google Account > Security > Third-party access, then connect again.',
  no_user: 'your account was not found. Sign in again.',
  failed: 'something went wrong. Try again, and tell Matt if it keeps happening.',
}

/**
 * `active` is false while Sales is kept alive in the background (App.tsx):
 * it stays mounted so the queue, open drafts and selection survive a trip to
 * Fulfillment, and only a full page load starts it from scratch. While
 * inactive it does not listen to the keyboard or own the tab title.
 */
export default function Sales({ active = true }: { active?: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()

  const [status, setStatus] = useState<SalesStatus | null>(null)
  const [today, setToday] = useState<TodayPayload | null>(null)
  const [todayError, setTodayError] = useState<{ message: string; code?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<QueueMode>(() => { try { return localStorage.getItem('sales.mode') === 'followups' ? 'followups' : 'new' } catch { return 'new' } })
  const [scope, setScope] = useState<'mine' | 'all'>(() => { try { return localStorage.getItem('sales.scope') === 'all' ? 'all' : 'mine' } catch { return 'mine' } })
  const [motion, setMotion] = useState<Motion | null>(null)
  const [query, setQuery] = useState('')
  // Send later: the waiting email open in the middle, and a deal to select once the queue reloads.
  const [openScheduled, setOpenScheduled] = useState<ScheduledEmail | null>(null)
  const pendingSelect = useRef<string | null>(null)
  const [library, setLibrary] = useState<TemplateLibrary | null>(null)
  // The saved templates, read once with the page so the Templates menu opens at once.
  const loadLibrary = useCallback(() => { salesApi.library().then(r => setLibrary({ templates: r.templates, fill: r.fill })).catch(() => { /* the menu says it is loading; Settings shows errors */ }) }, [])
  useEffect(() => { loadLibrary() }, [loadLibrary])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [personId, setPersonId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Deal | null>(null)
  const [prepared, setPrepared] = useState<Record<string, Prepared>>({})
  const [variantIndex, setVariantIndex] = useState(0)
  const [drafting, setDrafting] = useState(false)
  // Only a Rewrite with AI on is the model writing; a click just fills in the template.
  const [writing, setWriting] = useState(false)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [assets, setAssets] = useState<Asset[]>([])
  const [libraryConfigured, setLibraryConfigured] = useState(true)
  const [suggestedId, setSuggestedId] = useState<string | null>(null)
  const [attached, setAttached] = useState<Record<string, string[]>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [progressOpen, setProgressOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  // Written from New email: a deal at any stage, or a bare address as a synthetic deal.
  const [adhoc, setAdhoc] = useState<Deal | null>(null)
  const [busy, setBusy] = useState(false)
  const [aiOn, setAiOn] = useState<boolean>(() => { try { return localStorage.getItem(AI_KEY) !== 'off' } catch { return true } })
  const [problems, setProblems] = useState<string[] | null>(null)
  const [checking, setChecking] = useState(false)
  const inFlight = useRef(new Set<string>())
  /** Deals whose required example has already been put in, so removing it sticks. */
  const seeded = useRef(new Set<string>())
  const timers = useRef<Record<string, number>>({})

  useEffect(() => { try { localStorage.setItem(AI_KEY, aiOn ? 'on' : 'off') } catch { /* ignore */ } }, [aiOn])
  useEffect(() => { try { localStorage.setItem('sales.scope', scope) } catch { /* ignore */ } }, [scope])
  useEffect(() => { try { localStorage.setItem('sales.mode', mode) } catch { /* ignore */ } }, [mode])

  // Gmail's OAuth round trip lands back here with a flag in the query string.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const g = params.get('gmail')
    if (!g) return
    if (g === 'connected') toast.success(`Gmail connected${params.get('account') ? ` as ${params.get('account')}` : ''}`)
    else if (g === 'denied') toast.error('Gmail connection was canceled')
    else toast.error(`Gmail connection failed: ${GMAIL_REASONS[params.get('reason') || ''] || GMAIL_REASONS.failed}`, { duration: 10000 })
    navigate('/sales', { replace: true })
  }, [location.search, navigate])

  const loadStatus = useCallback(() => { salesApi.status().then(setStatus).catch(() => setStatus(null)) }, [])
  const loadedAt = useRef(0)
  const loadToday = useCallback(async (refresh = false) => {
    setLoading(true)
    try { setToday(await salesApi.today({ scope, motion, refresh })); setTodayError(null); loadedAt.current = Date.now() }
    catch (e) { const err = e as SalesApiError; setTodayError({ message: err.message, code: err.code }) }
    finally { setLoading(false) }
  }, [scope, motion])
  const assetsAt = useRef(0)
  // `refresh` skips the server's one-minute copy of the file list: after an
  // upload, rename or delete the change must show at once.
  const loadAssets = useCallback(async (dealId?: string | null, refresh = false) => {
    try { const r = await salesApi.assets(dealId || undefined, refresh); setAssets(r.assets); setLibraryConfigured(r.configured); setSuggestedId(r.suggestedId); assetsAt.current = Date.now() }
    catch { /* the library is optional */ }
  }, [])

  useEffect(() => { loadStatus(); loadAssets() }, [loadStatus, loadAssets])
  useEffect(() => { loadToday() }, [loadToday])

  // The list I/K walks: the active pill's rows, with sent-today first on New.
  const items: Deal[] = useMemo(() => {
    if (!today) return []
    // Skipped deals are selectable (to bring one back) but come last, and
    // nothing ever moves onto one on its own.
    const skipped = today.skipped
    if (mode === 'new') return [...today.sentToday, ...today.newOutreach, ...today.contactedBefore, ...today.needsContact, ...skipped]
    return [...today.followUps, ...today.later, ...today.exhausted, ...skipped]
  }, [mode, today])
  const sentIds = useMemo(() => new Set(today?.sentToday.map(d => d.id) || []), [today])

  useEffect(() => {
    if (pendingSelect.current && items.some(d => d.id === pendingSelect.current)) {
      setSelectedId(pendingSelect.current); pendingSelect.current = null; return
    }
    if (items.length === 0) { setSelectedId(null); return }
    if (!selectedId || !items.some(d => d.id === selectedId)) {
      const first = items.find(d => !sentIds.has(d.id) && !pendingIds.has(d.id) && d.hasEmail && !d.skippedUntil) || items[0]
      setSelectedId(first.id)
    }
  }, [items, selectedId, sentIds, pendingIds])

  const selected = useMemo(() => items.find(d => d.id === selectedId) || null, [items, selectedId])
  const deal: Deal | null = useMemo(() => adhoc || (detail && detail.id === selectedId ? { ...selected, ...detail } : selected), [adhoc, detail, selected, selectedId])
  const person: Person | null = useMemo(() => {
    if (!deal) return null
    return deal.people.find(p => p.id === personId) || deal.person || deal.people[0] || null
  }, [deal, personId])

  const aiActive = aiOn && Boolean(status?.llm.configured)
  const current = deal ? prepared[deal.id] : undefined
  const variants = useMemo(() => current?.variants || [], [current])
  const cap = today?.cap ?? 10
  const sentCount = today?.sentTodayCount ?? 0
  const capReached = sentCount + pendingIds.size >= cap
  const gmailConnected = Boolean(status?.gmail.connected)
  const attachedAssets = useMemo(() => (deal ? (attached[deal.id] || []) : []).map(id => assets.find(a => a.id === id)).filter((a): a is Asset => Boolean(a)), [attached, deal, assets])
  const suggested = useMemo(() => assets.find(a => a.id === suggestedId) || null, [assets, suggestedId])

  /**
   * Draft one deal. A click fills in the template for its next touch, with
   * no model call; the model only writes when a rep presses Rewrite (`force`)
   * with AI on.
   */
  const prepare = useCallback(async (d: Deal, opts: { silent: boolean; force?: boolean; personId?: string | null }) => {
    const target = (opts.personId && d.people.find(p => p.id === opts.personId)) || d.person
    if (!target?.email || d.exhausted) return
    const key = `${d.id}:${target.id}`
    if (inFlight.current.has(key)) return
    const cached = prepared[d.id]
    if (!opts.force && cached) return
    const useModel = Boolean(opts.force) && aiActive
    inFlight.current.add(key)
    if (!opts.silent) { setDrafting(true); setWriting(useModel) }
    try {
      const draft = await salesApi.variants(d.id, target.id, !useModel, Boolean(opts.force))
      setPrepared(prev => ({ ...prev, [d.id]: { draft, variants: draft.variants, template: !useModel } }))
      if (!opts.silent) { setVariantIndex(0); if (draft.warning) toast.warning(draft.warning) }
    } catch (e) {
      if (!opts.silent) toast.error(`Drafting failed: ${(e as Error).message}`)
    } finally {
      if (!opts.silent) setDrafting(false)
      inFlight.current.delete(key)
    }
  }, [prepared, aiActive])

  // On selection: the full deal (history), the draft, the library's pick, and the next one quietly.
  useEffect(() => {
    if (adhoc) return
    if (!selected) { setDetail(null); return }
    let cancelled = false
    setVariantIndex(0)
    setPersonId(null)
    salesApi.deal(selected.id).then(r => { if (!cancelled) setDetail(r.deal) }).catch(() => {})
    loadAssets(selected.id)
    if (!sentIds.has(selected.id)) {
      prepare(selected, { silent: false }).then(() => {
        if (cancelled) return
        const idx = items.findIndex(d => d.id === selected.id)
        const next = items.slice(idx + 1).find(d => !sentIds.has(d.id) && !pendingIds.has(d.id) && d.hasEmail)
        if (next) prepare(next, { silent: true })
      })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, status, aiActive, adhoc])

  /** New email: a deal from the search, at any stage. */
  const pickDeal = useCallback(async (hit: DealHit) => {
    setNewOpen(false)
    try {
      const r = await salesApi.deal(hit.id)
      setAdhoc(r.deal); setPersonId(null); setVariantIndex(0); setProblems(null)
      loadAssets(r.deal.id)
      if (r.deal.person?.email) prepare({ ...r.deal, exhausted: false }, { silent: false })
    } catch (e) { toast.error((e as Error).message) }
  }, [prepare, loadAssets])
  /** New email: a bare address. A synthetic deal so the composer has something to hold. */
  const pickAddress = useCallback((email: string) => {
    setNewOpen(false)
    const id = `adhoc:${email.toLowerCase()}`
    const person: Person = { id, firstName: '', lastName: '', fullName: email, email, emails: [email], title: null, description: null, linkedin: null, location: null, lastInteractionAt: null, lastEmailAt: null, webUrl: null }
    const synthetic: Deal = { id, name: email, stage: 'Not Contacted', motion: null, pipeline: 'RACE', ownerId: null, company: null, people: [person], person, hasEmail: true, touchCount: 0, nextAction: null, nextActionDate: null, raceDate: null, runners: null, tier: null, sizeTier: null, priority: null, notes: null, value: null, units: null, createdAt: null, webUrl: null, nextTouchNumber: null, nextAngle: null, exhausted: false, lastSentAt: null, lastSubject: null, skippedUntil: null, overdueDays: 0, reason: 'One-off' }
    setAdhoc(synthetic); setPersonId(null); setVariantIndex(0); setProblems(null); setSuggestedId(null)
    setPrepared(prev => ({ ...prev, [id]: { draft: { touchNumber: 0, step: { angle: 'free', purpose: 'Whatever you want to say. Your signature is added on send.', subject: '', nextActionDays: 0 }, exhausted: false, variants: [], personId: id, dealId: id, model: 'you' }, variants: [{ subject: '', body: 'Hey there,\n\n' }], template: true } }))
  }, [])

  const advance = useCallback((fromId: string) => {
    const idx = items.findIndex(d => d.id === fromId)
    const ok = (d: Deal) => d.id !== fromId && !sentIds.has(d.id) && !pendingIds.has(d.id) && d.hasEmail && !d.skippedUntil
    const next = items.slice(idx + 1).find(ok) || items.find(ok)
    setSelectedId(next ? next.id : null)
  }, [items, sentIds, pendingIds])

  const checkDraft = useCallback(async () => {
    const v = variants[variantIndex]
    if (!deal || !v || deal.id.startsWith('adhoc:')) { setProblems(null); return }
    setChecking(true)
    try { setProblems((await salesApi.check({ dealId: deal.id, subject: v.subject, body: v.body })).problems) }
    catch { setProblems(null) }
    finally { setChecking(false) }
  }, [deal, variants, variantIndex])
  useEffect(() => { setProblems(null) }, [deal?.id, variantIndex])

  const noteSync = (sync?: { ok: boolean; skipped?: string; error?: string }) => {
    if (!sync || sync.ok) return
    toast.warning(`Sent, but Attio was not updated: ${sync.error || sync.skipped || 'unknown reason'}. The nightly CRM upkeep will reconcile it.`, { duration: 10000 })
  }

  /** Send, after an undo window. Selection moves on immediately so the rhythm holds. */
  const send = useCallback(() => {
    const v = variants[variantIndex]
    if (!deal || !person?.email || !v || pendingIds.has(deal.id)) return
    if (!gmailConnected) { toast.error('Connect Gmail in Settings to send.'); return }
    if (capReached) { toast.error(`That is ${cap} for today. Raise the cap in Settings if you mean to.`); return }
    if (problems && problems.length) { toast.error(problems[0]); return }
    const assetIds = attachedAssets.map(a => a.id)
    const isAdhoc = Boolean(adhoc)
    const free = deal.id.startsWith('adhoc:')
    // One key per press of Send: a retry or a double fire of the same send is refused by the server.
    const idempotencyKey = newIdempotencyKey()
    const payload = { dealId: deal.id, personId: person.id, subject: v.subject, body: v.body, assetIds, adhoc: isAdhoc, idempotencyKey }
    const freePayload = { to: person.email as string, subject: v.subject, body: v.body, assetIds, idempotencyKey }
    const id = deal.id
    const first = person.firstName || person.fullName
    const undo = today?.undoSeconds ?? 10

    setPendingIds(prev => new Set(prev).add(id))
    if (isAdhoc) setAdhoc(null); else advance(id)

    const fire = async () => {
      try {
        const r = free ? await salesApi.sendTo(freePayload) : await salesApi.send(payload)
        toast.success(`Sent to ${first}`)
        noteSync(r.sync)
        setPrepared(prev => { const n = { ...prev }; delete n[id]; return n })
        setAttached(prev => { const n = { ...prev }; delete n[id]; return n })
      } catch (e) {
        toast.error(`Not sent to ${first}: ${(e as Error).message}`, { duration: 8000 })
        if (isAdhoc) setAdhoc(deal); else setSelectedId(id)
      } finally {
        setPendingIds(prev => { const n = new Set(prev); n.delete(id); return n })
        delete timers.current[id]
        loadToday()
      }
    }

    if (undo > 0) {
      timers.current[id] = window.setTimeout(fire, undo * 1000)
      toast(`Sending to ${first} in ${undo}s`, {
        duration: undo * 1000,
        action: {
          label: 'Undo',
          onClick: () => {
            window.clearTimeout(timers.current[id]); delete timers.current[id]
            setPendingIds(prev => { const n = new Set(prev); n.delete(id); return n })
            setSelectedId(id)
            toast.message(`Held. ${first} is back in the queue.`)
          },
        },
      })
    } else {
      fire()
    }
  }, [variants, variantIndex, deal, person, pendingIds, gmailConnected, capReached, cap, attachedAssets, today?.undoSeconds, advance, loadToday, problems, adhoc])

  // Send later: check it now, send it from Gmail at `at`. The deal leaves the
  // queue and waits under Scheduled until then.
  const schedule = useCallback(async (at: Date) => {
    const v = variants[variantIndex]
    if (!deal || !person?.email || !v) return
    if (problems && problems.length) { toast.error(problems[0]); return }
    const free = deal.id.startsWith('adhoc:')
    const id = deal.id
    try {
      await salesApi.schedule({
        ...(free ? { to: person.email } : { dealId: deal.id, personId: person.id }),
        subject: v.subject, body: v.body, assetIds: attachedAssets.map(a => a.id), adhoc: Boolean(adhoc), sendAt: at.toISOString(),
      })
      toast.success(`Scheduled for ${whenLabel(at)}. It goes from your Gmail then.`)
      setPrepared(prev => { const n = { ...prev }; delete n[id]; return n })
      setAttached(prev => { const n = { ...prev }; delete n[id]; return n })
      if (adhoc) setAdhoc(null); else advance(id)
      loadToday()
    } catch (e) { toast.error((e as Error).message, { duration: 8000 }) }
  }, [variants, variantIndex, deal, person, problems, attachedAssets, adhoc, advance, loadToday])

  const openScheduledItem = useCallback((item: ScheduledEmail) => { setAdhoc(null); setOpenScheduled(item) }, [])
  const selectDeal = useCallback((id: string) => { setOpenScheduled(null); setSelectedId(id) }, [])

  /** Take a scheduled email back into the composer, as written. */
  const editScheduled = useCallback(async (item: ScheduledEmail) => {
    try {
      const { scheduled: s } = await salesApi.cancelScheduled(item.id)
      setOpenScheduled(null)
      const text = [{ subject: s.subject, body: s.body }]
      if (!s.dealId) {
        pickAddress(s.toEmail)
        const id = `adhoc:${s.toEmail.toLowerCase()}`
        setPrepared(prev => ({ ...prev, [id]: { ...prev[id], variants: text } }))
        setAttached(prev => ({ ...prev, [id]: s.assetIds }))
        loadToday()
        return
      }
      const draft: DraftResult = { touchNumber: s.touchNumber || 1, step: { angle: '', purpose: '', subject: '', nextActionDays: 0 }, exhausted: false, variants: text, personId: s.personId || '', dealId: s.dealId, model: 'scheduled' }
      seeded.current.add(s.dealId)
      setPrepared(prev => ({ ...prev, [s.dealId as string]: { draft, variants: text, template: true } }))
      setAttached(prev => ({ ...prev, [s.dealId as string]: s.assetIds }))
      setVariantIndex(0)
      if (s.adhoc && item.deal) { setAdhoc(item.deal); loadToday(); return }
      pendingSelect.current = s.dealId
      setMode((s.touchNumber || 1) === 1 ? 'new' : 'followups')
      await loadToday()
      toast.message('Back in the composer. Send it, or schedule it again.')
    } catch (e) { toast.error((e as Error).message) }
  }, [pickAddress, loadToday])

  const cancelScheduled = useCallback(async (item: ScheduledEmail) => {
    try { await salesApi.cancelScheduled(item.id); setOpenScheduled(null); toast.message('Canceled. It is back in the queue.'); loadToday() }
    catch (e) { toast.error((e as Error).message) }
  }, [loadToday])

  const sendScheduledNow = useCallback(async (item: ScheduledEmail) => {
    try { const r = await salesApi.sendScheduledNow(item.id); setOpenScheduled(null); toast.success(`Sent to ${item.deal?.person?.firstName || item.toEmail}`); noteSync(r.sync); loadToday() }
    catch (e) { toast.error((e as Error).message, { duration: 8000 }) }
  }, [loadToday])

  /**
   * Remove: out for good (Lost in Attio; a PR contact Not interested). The
   * page moves on at once; Undo puts the stage back.
   */
  const remove = useCallback(async (reason?: string) => {
    if (!deal) return
    const target = deal
    try {
      const r = await salesApi.remove(target.id, reason)
      if (adhoc) setAdhoc(null); else advance(target.id)
      toast(`Removed ${target.name}`, {
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: async () => {
            try { await salesApi.restore(target.id, r.previous); toast.success(`${target.name} is back at ${r.previous}`); await loadToday(); setSelectedId(target.id) }
            catch (e) { toast.error((e as Error).message) }
          },
        },
      })
      loadToday()
    } catch (e) { toast.error((e as Error).message) }
  }, [deal, adhoc, advance, loadToday])

  /** Undo a skip: the deal goes back into today's list, still selected. */
  const unskip = useCallback(async () => {
    if (!deal) return
    try { await salesApi.unskip(deal.id); toast.success(`${deal.name} is back in today's list`); await loadToday() }
    catch (e) { toast.error((e as Error).message) }
  }, [deal, loadToday])

  const skip = useCallback(async (reason?: string) => {
    if (!deal) return
    if (adhoc) { setAdhoc(null); return }
    try { await salesApi.skip(deal.id, reason); toast.message(`${deal.name} moved to tomorrow`); advance(deal.id); loadToday() }
    catch (e) { toast.error((e as Error).message) }
  }, [deal, advance, loadToday, adhoc])

  const addNote = useCallback(async (text: string) => {
    if (!deal) return
    setBusy(true)
    try { await salesApi.addNote(deal.id, text); toast.success('Noted in Attio') }
    catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }, [deal])

  // Back from another page after a while: read the queue again, quietly. The
  // stars only show when there is nothing on screen yet.
  useEffect(() => {
    if (active && loadedAt.current && Date.now() - loadedAt.current > STALE_MS) { loadToday(); loadStatus() }
    // Thumbnail links last 12 hours; sign new ones well before.
    if (active && assetsAt.current && Date.now() - assetsAt.current > 6 * 3600_000) loadAssets(selectedId, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Keyboard: ⌘↵ sends, S skips. Only while Sales is the page on screen.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); return }
      const t = e.target as HTMLElement
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return
      if (settingsOpen || progressOpen || newOpen) return
      switch (e.key.toLowerCase()) {
        case 's': e.preventDefault(); skip(); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, send, skip, settingsOpen, progressOpen, newOpen])

  const updateVariant = (v: Variant) => {
    if (!deal || !current) return
    const next = current.variants.slice(); next[variantIndex] = v
    setPrepared(prev => ({ ...prev, [deal.id]: { ...current, variants: next } }))
  }
  // A charity first touch has to carry an example, so put the library's pick
  // in as a normal attachment the moment the draft says it is touch 1. It is
  // a chip like any other: removable, and nothing is added behind your back.
  // A sequence step's template can carry its own images: those go in the
  // same way, once per deal, and win over the library's pick.
  useEffect(() => {
    if (!deal || !current?.draft || seeded.current.has(deal.id)) return
    const fromTemplate = (current.draft.templateAssetIds || []).filter(id => assets.some(a => a.id === id))
    const needsImage = deal.pipeline === 'CHARITY' && current.draft.touchNumber === 1
    if (!fromTemplate.length && (!needsImage || !suggested)) return
    // Once per deal, so taking the chip off keeps it off.
    seeded.current.add(deal.id)
    const ids = fromTemplate.length ? fromTemplate : [suggested!.id]
    setAttached(prev => (prev[deal.id]?.length ? prev : { ...prev, [deal.id]: ids }))
  }, [deal, current?.draft, suggested, assets])

  const rewrite = () => { if (deal && !deal.id.startsWith('adhoc:')) prepare({ ...deal, exhausted: adhoc ? false : deal.exhausted }, { silent: false, force: true, personId }) }
  const revise = async (instruction: string) => {
    const v = variants[variantIndex]
    if (!deal || !v) return
    try {
      const r = await salesApi.revise({ dealId: deal.id, subject: v.subject, body: v.body, instruction })
      updateVariant({ subject: r.subject, body: r.body })
      setProblems(null)
    } catch (e) { toast.error((e as Error).message) }
  }
  const attach = (a: Asset) => {
    if (!deal) return
    const k = deal.id
    setAttached(prev => ({ ...prev, [k]: [...new Set([...(prev[k] || []), a.id])] }))
  }
  const attachIds = (ids: string[]) => {
    if (!deal) return
    const k = deal.id
    const known = ids.filter(id => assets.some(a => a.id === id))
    if (known.length) setAttached(prev => ({ ...prev, [k]: [...new Set([...(prev[k] || []), ...known])] }))
  }
  const detach = (id: string) => {
    if (!deal) return
    const k = deal.id
    setAttached(prev => ({ ...prev, [k]: (prev[k] || []).filter(x => x !== id) }))
  }

  const isSent = Boolean(!adhoc && selectedId && sentIds.has(selectedId))
  const queueClear = !adhoc && today && (mode === 'new' ? today.newOutreach.length === 0 : today.followUps.length === 0) && pendingIds.size === 0

  const ownerName = today?.member?.name || status?.attio.member?.name || status?.me.firstName || 'Mine'
  const newCount = today?.newOutreach.length ?? null
  const dueCount = today?.followUps.length ?? null

  return (
    <div className={pageShell}>
      {active && <SalesHead />}
      <div className="px-3 md:px-5 w-full flex flex-col h-full">
        <PageHeader title="Sales" pill={`${sentCount} of ${cap} sent today`} subtitle={today ? `${today.followUps.length} due for a touch` : undefined} />
        {/* Header: stars and title on one line, the day's count on the right. */}
        <div className="pt-4 md:pt-5 pb-3 md:pb-4 hidden md:flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-7 md:h-8 w-auto shrink-0 object-contain" />
            <h1 className="text-2xl md:text-[28px] font-bold text-off-black leading-none">Sales</h1>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm text-off-black/60">
            <span className="flex items-center gap-2">
              <span><b className="text-off-black tabular-nums">{sentCount}</b> of {cap} sent today</span>
              <span className="hidden sm:flex gap-[3px]" aria-label={`${sentCount} of ${cap} sent`}>
                {Array.from({ length: cap }).map((_, i) => (
                  <span key={i} className={`block w-[12px] h-[6px] rounded-[3px] ${i < sentCount ? 'bg-dark-fill' : i < sentCount + pendingIds.size ? 'bg-amber-400' : 'bg-off-black/10'}`} />
                ))}
              </span>
            </span>
            {today && <span className="hidden md:inline"><b className="text-off-black tabular-nums">{today.counts.week.sent}</b> this week</span>}
            {today && <span className="hidden md:inline"><b className="text-off-black tabular-nums">{today.followUps.length}</b> due for a touch</span>}
          </div>
        </div>

        {status && !status.gmail.connected && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 mb-3 text-sm text-amber-800 flex-shrink-0">
            <span><Mail className="w-4 h-4 inline mr-1.5 -mt-0.5" />Connect your Gmail to send from here.</span>
            <a href={salesApi.gmailConnectUrl} className={btnSecondary}>Connect Gmail</a>
          </div>
        )}
        {todayError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 mb-3 text-sm text-red-800 flex-shrink-0">
            <span>{todayError.code === 'attio_not_configured' ? 'Attio is not connected, so there is no queue to show.' : todayError.code === 'not_a_rep' ? todayError.message : `Could not read the queue: ${todayError.message}`}</span>
            <button onClick={() => setSettingsOpen(true)} className={btnSecondary}>Settings</button>
          </div>
        )}

        <section className="flex-1 flex flex-col min-h-0 pb-3">
          <div className={listCard}>
            {/* Search and filters, inside the card like the order list's. */}
            <div className={listToolbar}>
              <div className="flex flex-col md:flex-row gap-2 md:gap-3">
                <div className={`${segmentGroup} self-start md:self-stretch shrink-0`}>
                  <button onClick={() => setMode('new')} className={`${segment(mode === 'new', 'md')} h-full`}>
                    New Outreach{newCount !== null && <span className="ml-1.5 tabular-nums opacity-60">{newCount}</span>}
                  </button>
                  <button onClick={() => setMode('followups')} className={`${segment(mode === 'followups', 'md')} h-full`}>
                    Follow Ups{dueCount !== null && <span className="ml-1.5 tabular-nums opacity-60">{dueCount}</span>}
                  </button>
                </div>
                <div className="relative flex-1">
                  <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-off-black/40" />
                  <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search people and deals..." className={toolbarInput} />
                </div>
                <button onClick={() => loadToday(true)} className="inline-flex items-center justify-center gap-2 px-4 py-2.5 md:py-3 bg-subtle-gray border border-border-gray rounded-md text-sm text-off-black/70 hover:bg-off-black/5 transition-colors" title="Re-read Attio">
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /><span className="md:hidden">Refresh</span>
                </button>
              </div>
            </div>

            {/* The first read of the queue can take a while; show the stars running laps. */}
            {!today && !todayError ? <LoadingStars /> : (
            /* Three panes in the one card: who is next, the email, who they are. */
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
              <Queue
                filters={<FiltersMenu scope={scope} onScope={setScope} motion={motion} onMotion={setMotion} ownerName={ownerName} />}
                mode={mode} scope={scope} today={today} pendingSendIds={pendingIds} selectedId={openScheduled ? null : selectedId} onSelect={selectDeal} loading={loading} query={query} openScheduledId={openScheduled?.id || null} onOpenScheduled={openScheduledItem} />

              {openScheduled ? (
                <ScheduledCard
                  key={openScheduled.id} item={openScheduled} assets={assets}
                  onEdit={() => editScheduled(openScheduled)} onCancel={() => cancelScheduled(openScheduled)} onSendNow={() => sendScheduledNow(openScheduled)}
                />
              ) : queueClear && !selected && !adhoc ? (
                <div className="flex-1 min-w-0 flex items-center justify-center min-h-[320px]">
                  <div className="text-center max-w-[44ch] px-6">
                    <Check className="w-8 h-8 mx-auto text-success-green mb-2" />
                    <div className="text-xl font-bold text-off-black">{mode === 'new' ? `New outreach is done. ${sentCount} sent today.` : 'Nothing due.'}</div>
                    <p className="text-sm text-off-black/60 mt-2">
                      {mode === 'new'
                        ? (sentCount >= cap ? 'That is the cap. ' : '') + (today?.followUps.length ? `${today.followUps.length} are due under Follow Ups.` : 'Tomorrow\'s batch comes from Attio in the morning.')
                        : today?.later.length ? `${today.later.length} coming up this week.` : 'Nothing on the clock.'}
                    </p>
                  </div>
                </div>
              ) : isSent && selected && deal ? (
                <SentEmail deal={deal} sentAt={selected.sentAt} signature={status?.signature} assets={assets} />
              ) : (
                <Composer
                  deal={deal} person={person} draft={current?.draft || null}
                  variants={variants} index={Math.min(variantIndex, Math.max(0, variants.length - 1))}
                  drafting={drafting} writing={writing} gmailConnected={gmailConnected} aiActive={aiActive}
                  canSend={gmailConnected && !capReached} capReached={capReached}
                  problems={problems} checking={checking} onCheck={checkDraft}
                  attachments={attachedAssets} onAttach={attach} onDetach={detach}
                  onChange={updateVariant}
                  onPrev={() => setVariantIndex(i => Math.max(0, i - 1))} onNext={() => setVariantIndex(i => Math.min(variants.length - 1, i + 1))}
                  onRewrite={rewrite} onRevise={revise} onSend={send} onSkip={skip} onRemove={remove} onUnskip={unskip} adhoc={Boolean(adhoc)} signature={status?.signature} library={library} onSchedule={schedule} onTemplateSaved={loadLibrary} onAttachIds={attachIds}
                />
              )}

              <aside className="w-full lg:w-[320px] xl:w-[340px] shrink-0 lg:overflow-y-auto border-t lg:border-t-0 lg:border-l border-border-gray p-5 space-y-6 min-h-0">
                <WhoPane
                  deal={openScheduled ? openScheduled.deal : deal}
                  person={openScheduled ? (openScheduled.deal?.people.find(p => p.id === openScheduled.personId) || openScheduled.deal?.person || null) : person}
                  busy={busy} onNote={addNote}
                  onSelectPerson={id => { setPersonId(id); if (deal) { setPrepared(prev => { const n = { ...prev }; delete n[deal.id]; return n }); prepare(deal, { silent: false, force: true, personId: id }) } }}
                />
                <LibraryPanel assets={assets} configured={libraryConfigured} attachedIds={new Set(attachedAssets.map(a => a.id))} onAttach={attach} onChanged={() => loadAssets(selectedId, true)}
                  onRenamed={(from, to) => setAttached(prev => Object.fromEntries(Object.entries(prev).map(([k, ids]) => [k, ids.map(x => (x === from ? to : x))])))} />
              </aside>
            </div>
            )}
          </div>

          {/* Bottom row: the page's own actions. */}
          <div className="flex items-center justify-between gap-3 mt-3 flex-shrink-0">
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={() => setSettingsOpen(true)} className={btnHeroSecondary} title="Settings"><SlidersHorizontal className="w-4 h-4" /><span className="hidden md:inline">Settings</span></button>
              <button onClick={() => setProgressOpen(true)} className={btnHeroSecondary}><BarChart3 className="w-4 h-4" /><span className="hidden md:inline">Progress</span></button>
              <button onClick={() => setNewOpen(true)} className={btnHero} title="Write to any deal, or any address"><PenLine className="w-4 h-4" /> New email</button>
            </div>
          </div>
        </section>

      {settingsOpen && <SettingsModal status={status} aiOn={aiOn} onAiChange={setAiOn} onClose={() => { setSettingsOpen(false); loadStatus(); loadToday(); loadLibrary() }} />}
      {progressOpen && <ProgressModal scope={scope} onClose={() => setProgressOpen(false)} />}
      {newOpen && <NewEmail onPickDeal={pickDeal} onPickAddress={pickAddress} onClose={() => setNewOpen(false)} />}
      </div>
    </div>
  )
}
