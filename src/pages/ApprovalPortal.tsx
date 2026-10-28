import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { toast } from 'sonner'
import { useParams } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2, AlertTriangle, X, Maximize2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react'

const PdfViewer = lazy(() => import('@/components/PdfViewer'))

import ProofFullscreen from '@/components/ProofFullscreen'
import DesignGallery from '@/components/DesignGallery'
import SlideToApprove from '@/components/SlideToApprove'

/**
 * The portal's surface, matched to the storefront.
 *
 * The shop moved to sections-as-cards on a warm off-white, so the page a
 * partner lands on from a text message should not look like a different
 * company's admin panel. Named here rather than sprinkled as hex literals,
 * because the same six values were previously spelled twelve different ways
 * down this file.
 *
 * INK is the storefront's own Inter stack, copied from custom-pdp.css rather
 * than approximated.
 */
const T = {
  page: '#F6F5F2',
  card: '#FFFFFF',
  line: '#E7E4DD',
  ink: '#1A1A1A',
  muted: '#6B6B6B',
  faint: '#9A9A9A',
  accent: '#4600D6',
  bar: '#242424',
  radius: 16,
  font: "Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  /** One card. Used for every section so they cannot drift apart. */
  cardStyle: {
    backgroundColor: '#FFFFFF',
    border: '1px solid #E7E4DD',
    borderRadius: 16,
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
  } as const,
}

const API_BASE = import.meta.env.VITE_API_URL || ''

interface Proof {
  id: string
  orderId: string
  version: number
  batch: number
  imageUrl: string
  thumbnailUrl: string | null
  fileName: string | null
  /** What this proof is an option FOR. Null on custom/standard orders, where
   *  every proof competes with every other. */
  groupLabel: string | null
  status: 'pending' | 'approved' | 'revision_requested' | 'rejected'
  customerFeedback: string | null
  createdAt: string
  updatedAt: string
}

interface Message {
  id: string
  sender: 'designer' | 'customer'
  body: string
  createdAt: string
}

interface OrderInfo {
  id: string
  orderNumber: string
  parentOrderNumber: string
  displayOrderNumber?: string
  customerName: string | null
  customerEmail: string | null
  raceName: string
  // Partner rows reuse raceName as the partner name and customerName as the
  // partner contact, so nothing new is fetched here - we only need to know
  // which kind of order this is to know how to address them.
  trackstarOrderType?: 'standard' | 'custom' | 'race_partner'
  designStatus: string
  designerNote: string | null
}

type PortalState = 'loading' | 'ready' | 'expired' | 'error' | 'all_approved' | 'revision_submitted'

function isPdf(url: string) {
  return url.toLowerCase().includes('.pdf')
}

export default function ApprovalPortal() {
  const { token } = useParams<{ token: string }>()
  const [state, setState] = useState<PortalState>('loading')
  const [order, setOrder] = useState<OrderInfo | null>(null)
  const [proofs, setProofs] = useState<Proof[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [reply, setReply] = useState('')
  const [sendingReply, setSendingReply] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // selectedProofId removed — each card now carries its own Approve + Make
  // Revisions buttons, so there's no separate "select a design" step.
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Which proof has its inline revision form expanded. null = none.
  // Customers were getting confused by the separate "select then act" flow,
  // so each design card now carries its own Approve + Make Revisions buttons,
  // and "Make Revisions" expands a textarea inline on that card.
  const [revisingProofId, setRevisingProofId] = useState<string | null>(null)
  // Lightweight confirmation modal for Approve clicks — prevents fat-finger
  // approvals (especially on mobile). Stores the proof being confirmed.
  const [confirmApproveProofId, setConfirmApproveProofId] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  // Which option full screen is showing, or null when it is closed.
  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null)
  const [showEarlierVersions, setShowEarlierVersions] = useState(false)
  const [activeSlide, setActiveSlide] = useState(0)
  // Which product the partner is looking at. Null means "whichever comes
  // first", so a single-product order needs no state at all.
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const carouselRef = useRef<HTMLDivElement>(null)

  const fetchData = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/proofs?action=approve&token=${token}`)
      if (res.status === 410) {
        setState('expired')
        return
      }
      if (!res.ok) {
        const data = await res.json()
        setErrorMessage(data.error || 'Something went wrong')
        setState('error')
        return
      }
      const data = await res.json()
      setOrder(data.order)
      setProofs(data.proofs)
      setMessages(data.messages || [])

      // Show approved screen only if designStatus confirms it AND a proof is approved
      // (prevents stuck "approved" screen after internal unapprove)
      const hasApprovedProof = data.proofs.some((p: Proof) => p.status === 'approved')
      const designConfirmsApproval = ['approved_by_customer', 'final_pdf_uploaded', 'sent_to_production'].includes(data.order.designStatus)
      if (hasApprovedProof && designConfirmsApproval) {
        setState('all_approved')
      } else {
        setState('ready')
      }
    } catch {
      setErrorMessage('Unable to load. Please check your connection and try again.')
      setState('error')
    }
  }, [token])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleApprove = async (proofId: string) => {
    if (!token || !proofId) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', token, proofId, approval: 'approve' })
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Something went wrong')
        return
      }
      setConfirmApproveProofId(null)
      await fetchData()
    } catch {
      toast.error('Unable to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSendReply = async () => {
    if (!token || !reply.trim()) return
    setSendingReply(true)
    try {
      const res = await fetch(`${API_BASE}/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'customer-message', token, body: reply.trim() })
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Something went wrong')
        return
      }
      setReply('')
      await fetchData()
    } catch {
      toast.error('Unable to send. Please try again.')
    } finally {
      setSendingReply(false)
    }
  }

  const [revisionOptionNum, setRevisionOptionNum] = useState<number | null>(null)

  const handleRequestRevision = async (proofId: string) => {
    if (!token || !feedback.trim() || !proofId) return
    const pendingProofs = proofs.filter(p => p.status === 'pending')
    const targetProof = pendingProofs.find(p => p.id === proofId)
    if (!targetProof) return

    // Numbered within its own product, matching the card the partner clicked.
    const optionIdx = pendingProofs
      .filter(p => (p.groupLabel ?? '') === (targetProof.groupLabel ?? ''))
      .indexOf(targetProof)

    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          token,
          proofId: targetProof.id,
          approval: 'request_revision',
          feedback: feedback.trim()
        })
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Something went wrong')
        return
      }
      setFeedback('')
      setRevisingProofId(null)
      setRevisionOptionNum(optionIdx + 1)
      // Only finish the visit if there is nothing else to answer. On a partner
      // order with designs for two products, asking for a tweak on one leaves
      // the other still waiting - sending them to the thank-you screen would
      // strand it.
      const othersLeft = pendingProofs.some(
        p => p.id !== targetProof.id && (p.groupLabel ?? '') !== (targetProof.groupLabel ?? '')
      )
      if (othersLeft) await fetchData()
      else setState('revision_submitted')
    } catch {
      toast.error('Unable to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ═══ LOADING ═══
  // ═══ Derived from state, so it must sit above the early returns below.
  // Hooks cannot run conditionally, and the arrow-key effect lives here. ═══
  const pendingProofs = proofs.filter(p => p.status === 'pending')

  // How many distinct things they are choosing between. One unnamed group is
  // the ordinary case and reads exactly as it always did.
  const pendingGroups = [...new Set(pendingProofs.map(p => p.groupLabel ?? ''))]
  // One product at a time. Seven designs for two products in a single strip is
  // the confusion Matt's designer hit: nothing tells you where the marathons
  // stop and the halves begin, so "Option 1 of 3" and a seven-dot rail
  // disagree about what you are choosing between.
  const currentGroup =
    activeGroup !== null && pendingGroups.includes(activeGroup)
      ? activeGroup
      : pendingGroups[0] ?? ''
  const visibleProofs = pendingProofs.filter(p => (p.groupLabel ?? '') === currentGroup)

  /**
   * Scroll the carousel to an option, measured off the slide itself.
   *
   * Every caller used to compute `index * offsetWidth`, which ignores the
   * gap-3 between slides. The error compounds - by the third option it lands
   * 24px short, snap pulls it back to the previous slide, and you end up one
   * option behind where you asked to be. Reading the child's real position has
   * no such drift whatever the gap or padding is.
   */
  const slideOffset = useCallback((i: number) => {
    const el = carouselRef.current
    const child = el?.children?.[i] as HTMLElement | undefined
    if (!el || !child) return null
    return child.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft
  }, [])

  const goToSlide = useCallback((i: number, behavior: ScrollBehavior = 'smooth') => {
    const left = slideOffset(i)
    setActiveSlide(i)
    const el = carouselRef.current
    if (!el || left === null) return

    // A mandatory snap container cancels smooth scrollTo outright in some
    // engines: the call returns, nothing moves, and the carousel silently
    // ignores the dots, the arrows and the arrow keys. That is why none of
    // them worked. Ask for smooth, then check whether it actually started, and
    // jump if it did not. Only a scroll that never began gets corrected, so
    // browsers where smooth works still animate.
    const before = el.scrollLeft
    el.scrollTo({ left, behavior })
    if (behavior !== 'smooth' || Math.abs(left - before) < 2) return
    window.setTimeout(() => {
      const now = carouselRef.current
      if (now && Math.abs(now.scrollLeft - before) < 2) {
        now.scrollTo({ left, behavior: 'auto' })
      }
    }, 150)
  }, [slideOffset])

  /** Which slide is currently centred, by proximity rather than by arithmetic. */
  const nearestSlide = useCallback(() => {
    const el = carouselRef.current
    if (!el) return 0
    let best = 0, bestDist = Infinity
    for (let i = 0; i < el.children.length; i++) {
      const left = slideOffset(i)
      if (left === null) continue
      const d = Math.abs(left - el.scrollLeft)
      if (d < bestDist) { bestDist = d; best = i }
    }
    return best
  }, [slideOffset])

  // Left and right move through the options on the page too, not only in full
  // screen. Guarded on the focused element so the arrow keys still edit text
  // when somebody is typing revision notes, and skipped while full screen is
  // open because that has its own handler.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (fullscreenIndex !== null) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const count = visibleProofs.length
      if (count < 2) return
      e.preventDefault()
      const next = Math.min(count - 1, Math.max(0, nearestSlide() + (e.key === 'ArrowRight' ? 1 : -1)))
      goToSlide(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreenIndex, visibleProofs.length, goToSlide, nearestSlide])

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: T.page, fontFamily: T.font }}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" style={{ color: '#666666' }} />
          <p style={{ color: '#666666', fontSize: '14px' }}>Loading your design...</p>
        </div>
      </div>
    )
  }

  // ═══ ERROR ═══
  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: T.page, fontFamily: T.font }}>
        <div className="text-center max-w-sm">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-8 mx-auto mb-8" />
          <XCircle className="w-12 h-12 mx-auto mb-4" style={{ color: '#4600D6' }} />
          <h1 style={{ color: '#1A1A1A', fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>Something went wrong</h1>
          <p style={{ color: '#666666', fontSize: '14px' }}>{errorMessage}</p>
        </div>
      </div>
    )
  }

  // ═══ EXPIRED ═══
  if (state === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: T.page, fontFamily: T.font }}>
        <div className="text-center max-w-sm">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-8 mx-auto mb-8" />
          <AlertTriangle className="w-12 h-12 mx-auto mb-4" style={{ color: '#4600D6' }} />
          <h1 style={{ color: '#1A1A1A', fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>Link expired</h1>
          <p style={{ color: '#666666', fontSize: '14px' }}>This approval link has expired. Reach out to us and we'll send a fresh one.</p>
        </div>
      </div>
    )
  }

  // ═══ APPROVED ═══
  if (state === 'all_approved') {
    const approvedProof = proofs.find(p => p.status === 'approved')
    const pastProofsForApproved = proofs.filter(p => p.status !== 'approved' && p.status !== 'pending')

    // Group past proofs by batch
    const batchMap = new Map<number, Proof[]>()
    pastProofsForApproved.forEach(p => {
      const b = p.batch || 1
      if (!batchMap.has(b)) batchMap.set(b, [])
      batchMap.get(b)!.push(p)
    })
    const sortedBatches = [...batchMap.entries()].sort((a, b) => b[0] - a[0])

    return (
      <div className="min-h-screen" style={{ backgroundColor: T.page, fontFamily: T.font }}>
        {/* Lightbox */}
        {lightboxUrl && (
          <div
            className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 cursor-pointer"
            onClick={() => setLightboxUrl(null)}
          >
            <button onClick={() => setLightboxUrl(null)} className="absolute top-4 right-4" style={{ color: '#999999' }}>
              <X className="w-8 h-8" />
            </button>
            <img
              src={lightboxUrl}
              alt="Proof preview"
              className="max-w-full max-h-[90vh] object-contain select-none"
              onClick={e => e.stopPropagation()}
              draggable={false}
              onContextMenu={e => e.preventDefault()}
            />
          </div>
        )}

        <div className="max-w-md mx-auto px-4 py-8">
          {/* Logo */}
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-6 mx-auto mb-8" />

          {/* Approved design — hero image */}
          {approvedProof && !isPdf(approvedProof.imageUrl) && (
            <div
              className="mx-auto mb-6 overflow-hidden cursor-pointer"
              style={{ maxWidth: '320px', border: '1px solid #E0E0E0' }}
              onClick={() => setLightboxUrl(approvedProof.imageUrl)}
            >
              <img
                src={approvedProof.imageUrl}
                alt="Your approved design"
                className="w-full h-auto object-contain hover:opacity-95 transition-opacity"
                draggable={false}
                onContextMenu={e => e.preventDefault()}
              />
            </div>
          )}
          {approvedProof && isPdf(approvedProof.imageUrl) && (
            <div className="mx-auto mb-6 text-center">
              <a
                href={approvedProof.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2"
                style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', color: '#666666', fontSize: '13px' }}
              >
                📄 View your approved design (PDF)
              </a>
            </div>
          )}

          {/* Confirmation text */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5" style={{ color: '#4600D6' }} />
              <h1 style={{ color: '#1A1A1A', fontSize: '20px', fontWeight: 700, letterSpacing: '0.01em' }}>
                Design approved.
              </h1>
            </div>
            <p style={{ color: '#666666', fontSize: '14px', lineHeight: 1.6, marginBottom: '4px' }}>
              We'll send your design to production right away.
              <br />
              It will arrive in 7 business days - stoked for you to get it!
            </p>
            <p style={{ color: '#999999', fontSize: '13px' }}>Order #{order?.displayOrderNumber || order?.parentOrderNumber}</p>
          </div>

          {/* CTAs */}
          <div className="flex gap-3 mb-8 mx-auto" style={{ maxWidth: '320px' }}>
            <a
              href="https://yotpo.com/go/nHef7FVS"
              target="_blank"
              rel="noopener noreferrer"
              className="w-1/2 text-center px-3 py-2.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: 'transparent', border: '1px solid #4600D6', color: '#4600D6', borderRadius: 0 }}
            >
              Leave a Review
            </a>
            <a
              href="https://www.trackstar.art/collections/marathons"
              target="_blank"
              rel="noopener noreferrer"
              className="w-1/2 text-center px-3 py-2.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: 'transparent', border: '1px solid #4600D6', color: '#4600D6', borderRadius: 0 }}
            >
              Build Your Collection
            </a>
          </div>

          {/* The other options from the final round, then earlier rounds.
              Approved, but still browseable full screen: a partner will want
              to show colleagues what else was on the table. */}
          {(() => {
            const finalBatch = approvedProof?.batch ?? Math.max(0, ...proofs.map(p => p.batch || 1))
            const finalOthers = proofs.filter(p => (p.batch || 1) === finalBatch && p.status !== 'approved' && p.status !== 'pending')
            const earlier = sortedBatches.filter(([b]) => b !== finalBatch)
            if (finalOthers.length === 0 && earlier.length === 0) return null
            return (
              <div className="space-y-6">
                {finalOthers.length > 0 && (
                  <DesignGallery proofs={finalOthers} title={`Also in this round - ${finalOthers.length} other option${finalOthers.length !== 1 ? 's' : ''}`} muted />
                )}
                {earlier.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowEarlierVersions(!showEarlierVersions)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-sm transition-colors"
                      style={{ color: '#999999' }}
                    >
                      {showEarlierVersions ? (
                        <><ChevronUp className="w-4 h-4" /> Hide earlier rounds</>
                      ) : (
                        <><ChevronDown className="w-4 h-4" /> View {earlier.length} earlier round{earlier.length !== 1 ? 's' : ''}</>
                      )}
                    </button>
                    {showEarlierVersions && (
                      <div className="space-y-6 mt-2">
                        {earlier.map(([batchNum, batchProofs]) => {
                          const feedback = batchProofs.find(p => p.status === 'revision_requested' && p.customerFeedback)?.customerFeedback || null
                          return (
                            <div key={batchNum}>
                              <DesignGallery proofs={batchProofs} title={`Round ${batchNum} - ${batchProofs.length} option${batchProofs.length !== 1 ? 's' : ''}`} muted />
                              {feedback && (
                                <div className="mt-2 px-4 py-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid #E0E0E0' }}>
                                  <p className="text-xs font-medium mb-1" style={{ color: '#4600D6' }}>Your feedback:</p>
                                  <p className="text-sm" style={{ color: '#666666' }}>{feedback}</p>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* Footer */}
          <div className="mt-12 pt-6 text-center" style={{ borderTop: '1px solid #E0E0E0' }}>
            <p style={{ fontSize: '11px', color: '#999999', letterSpacing: '0.05em' }}>
              Trackstar - Celebrating athletic achievement.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ═══ REVISION SUBMITTED — success state ═══
  if (state === 'revision_submitted') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: T.page, fontFamily: T.font }}>
        <div className="text-center max-w-sm">
          <img src="/trackstar-stars-transparent.png" alt="Trackstar" className="h-8 mx-auto mb-8" />
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(200, 85, 61, 0.1)' }}>
            <CheckCircle2 className="w-10 h-10" style={{ color: '#C8553D' }} />
          </div>
          <h1 style={{ color: '#1A1A1A', fontSize: '24px', fontWeight: 700, marginBottom: '12px', letterSpacing: '0.01em' }}>
            Revision request received.
          </h1>
          <p style={{ color: '#666666', fontSize: '15px', lineHeight: 1.6, marginBottom: '8px' }}>
            {revisionOptionNum ? `You requested changes to Option ${revisionOptionNum}. ` : ''}We'll update your design and send a new version for review.
          </p>
          <p style={{ color: '#999999', fontSize: '13px' }}>Order #{order?.displayOrderNumber || order?.parentOrderNumber}</p>
        </div>
      </div>
    )
  }

  // Switching product starts you at that product's first option, not wherever
  // you happened to be scrolled in the last one.
  const selectGroup = (group: string) => {
    setActiveGroup(group)
    setActiveSlide(0)
    carouselRef.current?.scrollTo({ left: 0, behavior: 'auto' })
  }
  const pastProofs = proofs.filter(p => p.status !== 'pending')
  const hasPendingProofs = pendingProofs.length > 0

  // Race organizers, charities, and anyone else we co-brand with all land here.
  // The stored type is still 'race_partner' - it predates the charities - but
  // the portal only cares that this is a partner rather than a customer.
  const isPartner = order?.trackstarOrderType === 'race_partner'
  // Partner rows carry the organization in raceName; customerName is the
  // contact there, so it cannot stand in as the name on the header.
  const partnerName = order?.raceName || 'Our partner'

  // Approve confirmation modal — prevents fat-finger approvals, especially
  // on mobile. Reads the proof out of state so the same modal handles any
  // option the customer picked.
  const proofBeingConfirmed = confirmApproveProofId
    ? proofs.find(p => p.id === confirmApproveProofId)
    : null
  const proofBeingConfirmedOptionNum = proofBeingConfirmed
    ? proofs.filter(p => p.status === 'pending').indexOf(proofBeingConfirmed) + 1
    : null

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.page, fontFamily: T.font }}>
      {/* Approve confirmation modal */}
      {proofBeingConfirmed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(26, 26, 26, 0.6)' }}
          onClick={(e) => { if (e.target === e.currentTarget && !submitting) setConfirmApproveProofId(null) }}
        >
          <div className="max-w-sm w-full" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0' }}>
            <div className="p-6">
              <h3 style={{ color: '#1A1A1A', fontSize: '18px', fontWeight: 700, margin: '0 0 12px' }}>
                Approve {proofBeingConfirmedOptionNum && proofs.filter(p => p.status === 'pending').length > 1 ? `Option ${proofBeingConfirmedOptionNum}` : 'this design'}?
              </h3>
              <p style={{ color: '#666666', fontSize: '14px', margin: '0 0 20px', lineHeight: 1.55 }}>
                {isPartner
                  ? 'This locks in the design we will build the rest of the partnership around. No more changes after this - last chance to request revisions if you spot anything.'
                  : "We'll send this design straight to production. No more changes after this - last chance to request revisions if you spot anything."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmApproveProofId(null)}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 text-sm font-medium transition-colors disabled:opacity-40"
                  style={{ backgroundColor: '#FFFFFF', color: '#1A1A1A', border: '1px solid #E0E0E0' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleApprove(confirmApproveProofId!)}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 text-sm font-bold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 uppercase tracking-wide"
                  style={{ backgroundColor: '#4600D6', color: '#FFFFFF' }}
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {fullscreenIndex !== null && visibleProofs[fullscreenIndex] && (
        <ProofFullscreen
          proofs={visibleProofs}
          index={fullscreenIndex}
          onIndexChange={setFullscreenIndex}
          onClose={() => {
            const landOn = fullscreenIndex
            setFullscreenIndex(null)
            // Come back to whatever they navigated to in there, rather than
            // dumping them at the option they opened.
            if (landOn !== null) goToSlide(landOn)
          }}
          counterLabel={
            (pendingGroups.length === 1 && visibleProofs[fullscreenIndex].groupLabel
              ? `${visibleProofs[fullscreenIndex].groupLabel}: ` : '') +
            (visibleProofs.length === 1 ? 'Your design' : `Option ${fullscreenIndex + 1} of ${visibleProofs.length}`)
          }
        />
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 transition-colors"
            style={{ color: '#999999' }}
          >
            <X className="w-8 h-8" />
          </button>
          <img
            src={lightboxUrl}
            alt="Proof preview"
            className="max-w-full max-h-[90vh] object-contain select-none"
            onClick={e => e.stopPropagation()}
            draggable={false}
            onContextMenu={e => e.preventDefault()}
          />
        </div>
      )}

      {/* A floating dark pill rather than a full-width bar, per the reference
          Matt sent, and the same dark grey as the tool's own rail so the two
          Trackstar surfaces rhyme.

          The logo sits in a white chip. The asset is purple artwork on a light
          background with no alpha channel, so dropped straight onto the dark
          bar it would show as a pale rectangle - and the purple is too close to
          the bar in value to knock out cleanly. A white chip keeps the mark on
          the ground it was drawn for. A proper light-on-dark lockup would let
          it sit directly on the bar. */}
      <div className="max-w-3xl mx-auto px-4 pt-3 pb-1">
        <div
          className="flex items-center justify-between gap-3 pl-1.5 pr-1.5 py-1.5"
          style={{ backgroundColor: T.bar, borderRadius: 24 }}
        >
          <span
            className="flex items-center justify-center shrink-0 overflow-hidden"
            // #F3F3F3 is the logo file's own background, sampled from the
            // asset, so the chip and the artwork meet with no visible seam.
            style={{ backgroundColor: '#F3F3F3', borderRadius: 999, padding: '2px 10px' }}
          >
            <img src="/trackstar-logo.png" alt="Trackstar" className="h-8 w-auto" />
          </span>
          {/* The partner's name lives in the bar, beside the mark. It is still
              the page's h1 - it is the title, it just sits where a title sits
              in the reference. Wraps rather than truncates, per Matt: a
              partner should see their whole name, so the bar grows to fit. */}
          {isPartner && (
            <h1
              className="flex-1 min-w-0 py-1"
              style={{ color: '#FFFFFF', fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.3, margin: 0 }}
            >
              {partnerName}
            </h1>
          )}
          {!isPartner && (
            <span className="flex items-center gap-2 pr-2 min-w-0">
              {order?.customerName && (
                <span className="truncate" style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 500 }}>
                  {order.customerName}
                </span>
              )}
              <span className="shrink-0" style={{ color: 'rgba(255,255,255,0.55)', fontSize: '12px' }}>
                #{order?.displayOrderNumber || order?.parentOrderNumber}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="mb-4">
          {/* The partner's own name is the headline - a touch larger and
              heavier than the customer greeting it replaces, because here it
              is the subject of the page rather than a salutation. */}
          {/* Partners' title moved up into the bar. Customers keep the greeting. */}
          {!isPartner && (
            <h1 style={{ color: '#1A1A1A', fontSize: '24px', fontWeight: 700, marginBottom: '4px', letterSpacing: '-0.01em' }}>
              {order?.customerName ? `Hey ${order.customerName}.` : 'Your design is ready.'}
            </h1>
          )}
          {isPartner && (
            // A pill, all caps, purple on white, per Matt. It reads as a
            // credit line rather than a sentence, which is what it is.
            <span
              className="inline-block mb-3"
              style={{
                backgroundColor: T.card,
                color: T.accent,
                border: `1px solid ${T.line}`,
                borderRadius: 8,
                padding: '5px 10px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Presented by Trackstar
            </span>
          )}
          {hasPendingProofs ? (
            <p style={{ color: '#666666', fontSize: '15px', lineHeight: 1.6 }}>
              {/* A partner is a collaborator, so the ask is an opinion rather
                  than a transaction: no count of what they bought, and an
                  explicit invitation to say what they want changed. */}
              {isPartner
                ? (pendingGroups.length > 1
                    // Several products in one send. Saying "choose your
                    // favorite" here would read as one pick when we need one
                    // per product.
                    ? `We've got designs for ${pendingGroups.length} pieces below: ${pendingGroups.map(g => g || 'your design').join(' and ')}. Choose your favorite for each. Feel free to leave comments on how you'd like things revised.`
                    : pendingProofs.length === 1
                    ? "Take a look and let us know what you think. Feel free to leave comments on how you'd like things revised."
                    : "Choose your favorite below. Feel free to leave comments on how you'd like things revised.")
                : (pendingProofs.length === 1
                    ? "Take a look and let us know what you think."
                    : `We've prepared ${pendingProofs.length} options. Pick your favorite.`)
              }
            </p>
          ) : (
            <div>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md mb-3"
                style={{ backgroundColor: 'rgba(217, 119, 6, 0.12)', color: '#B45309', fontSize: '12px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}
              >
                In revision
              </span>
              <p style={{ color: '#666666', fontSize: '15px', lineHeight: 1.6 }}>
                {isPartner
                  ? "We're working on those revisions now. We'll be in touch shortly. The designs from this round are below if you want to look through them in the meantime."
                  : "We're working on your revisions. Check back soon. You can still look through the designs below."}
              </p>
            </div>
          )}
          {/* "Don't email us" callout — light purple, sits right under the
              subheader so customers see it before they even scroll to the
              designs. Brand purple #4600D6 at low opacity.

              Customers only. Telling a partner not to email us reads as a
              support policy, and that relationship runs on email in both
              directions. */}
          {hasPendingProofs && !isPartner && (
            <div style={{ marginTop: '14px', padding: '12px 16px', backgroundColor: 'rgba(70, 0, 214, 0.05)', border: '1px solid rgba(70, 0, 214, 0.15)', borderRadius: 12 }}>
              <p style={{ color: '#1A1A1A', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                <strong style={{ color: '#4600D6' }}>Please don't email us with revisions</strong> - tap <strong>Request Revision to this Design</strong> on the design you want changed.
              </p>
            </div>
          )}
          {order?.designerNote && (
            <div style={{ ...T.cardStyle, marginTop: '16px', padding: '14px 16px', borderLeft: `3px solid ${T.accent}` }}>
              <p style={{ color: '#666666', fontSize: '12px', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>Note from our designer</p>
              <p style={{ color: '#1A1A1A', fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap' as const, margin: 0 }}>{order.designerNote}</p>
            </div>
          )}
        </div>

        {/* Designer ↔ customer Q&A. Shows while we're still gathering info —
            i.e. before any designs are out for review. Once proofs are pending,
            the page is about picking/approving a design, so the thread is
            hidden to keep the focus there (the conversation already did its job
            of getting us what we needed). */}
        {messages.length > 0 && !hasPendingProofs && (
          <div className="mb-4" style={{ ...T.cardStyle, padding: '18px' }}>
            <p style={{ color: '#666666', fontSize: '12px', fontWeight: 600, marginBottom: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
              Questions from our designer
            </p>
            <div className="space-y-3" style={{ marginBottom: '16px' }}>
              {messages.map(m => {
                const isDesigner = m.sender === 'designer'
                return (
                  <div key={m.id} className="flex" style={{ justifyContent: isDesigner ? 'flex-start' : 'flex-end' }}>
                    <div style={{
                      maxWidth: '85%',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      backgroundColor: isDesigner ? '#F0EDF9' : '#4600D6',
                      color: isDesigner ? '#1A1A1A' : '#FFFFFF',
                    }}>
                      <p style={{ fontSize: '11px', fontWeight: 600, marginBottom: '3px', opacity: 0.7 }}>
                        {isDesigner ? 'Trackstar Design' : 'You'}
                      </p>
                      <p style={{ fontSize: '14px', lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, margin: 0 }}>{m.body}</p>
                    </div>
                  </div>
                )
              })}
            </div>
            <label htmlFor="customer-reply" style={{ color: '#1A1A1A', fontSize: '13px', fontWeight: 500, display: 'block', marginBottom: '6px' }}>
              Your reply
            </label>
            <textarea
              id="customer-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type your answer here…"
              className="w-full px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
              style={{ backgroundColor: '#FAFAFA', border: '1px solid #E0E0E0', color: '#1A1A1A' }}
              rows={3}
            />
            <button
              onClick={handleSendReply}
              disabled={sendingReply || !reply.trim()}
              className="w-full mt-2 px-4 py-3 text-sm font-bold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 uppercase tracking-wide"
              style={{ backgroundColor: '#4600D6', color: '#FFFFFF' }}
            >
              {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Send Reply'}
            </button>
          </div>
        )}

        {proofs.length === 0 ? (
          messages.length === 0 ? (
            <div className="p-8 text-center" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0' }}>
              <p style={{ color: '#666666', fontSize: '14px' }}>No designs uploaded yet. Check back soon.</p>
            </div>
          ) : null
        ) : (
          <>
            {/* Current batch of pending proofs — horizontal carousel */}
            {hasPendingProofs && (
              <>
                {/* One pill per product. Same control as the dashboard's
                    Standard / Custom / Partners switch, which is the pattern
                    Matt pointed at. */}
                {pendingGroups.length > 1 && (
                  <div className="flex justify-center mb-4">
                    <div
                      className="inline-flex items-center gap-1 p-1 rounded-full"
                      style={{ backgroundColor: T.card, border: `1px solid ${T.line}` }}
                    >
                      {pendingGroups.map(group => {
                        const isActive = group === currentGroup
                        const count = pendingProofs.filter(p => (p.groupLabel ?? '') === group).length
                        return (
                          <button
                            key={group}
                            onClick={() => selectGroup(group)}
                            className="px-4 py-2 rounded-full transition-colors"
                            style={{
                              backgroundColor: isActive ? T.bar : 'transparent',
                              color: isActive ? '#FFFFFF' : '#666666',
                              fontSize: '13px',
                              fontWeight: isActive ? 600 : 500,
                            }}
                          >
                            {group || 'Your design'}
                            <span style={{ opacity: 0.6, marginLeft: '6px', fontSize: '12px' }}>{count}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Swipe affordance — only when there are multiple designs.
                    Shows on mobile (where arrow buttons used to be hidden);
                    on desktop the side arrows do the job. */}
                {visibleProofs.length > 1 && (
                  <div className="md:hidden flex items-center justify-center gap-2 mb-3" style={{ color: '#666666', fontSize: '12px', fontWeight: 500 }}>
                    <ChevronLeft className="w-4 h-4" style={{ color: '#999999' }} />
                    <span>Swipe to see {visibleProofs.length === 2 ? 'the other design' : `all ${visibleProofs.length} designs`}</span>
                    <ChevronRight className="w-4 h-4" style={{ color: '#999999' }} />
                  </div>
                )}
                <div className="mb-4 mx-auto" style={{ maxWidth: 'min(512px, 100%)' }}>
                  <div className="relative">
                    <div
                      ref={carouselRef}
                      className="flex overflow-x-auto snap-x snap-mandatory gap-3 pb-2"
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
                      onScroll={() => {
                        setActiveSlide(nearestSlide())
                      }}
                    >
                      {visibleProofs.map((proof, idx) => {
                        const optionNum = idx + 1
                        const isRevising = revisingProofId === proof.id

                        return (
                          <div key={proof.id} className="snap-center shrink-0 w-full">
                            <div
                              className="overflow-hidden transition-all mx-1"
                              style={{
                                backgroundColor: T.card,
                                border: isRevising ? `2px solid ${T.ink}` : `1px solid ${T.line}`,
                                borderRadius: T.radius,
                                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                              }}
                            >
                              {/* Option header — compact */}
                              <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: '#FBFAF8', borderBottom: `1px solid ${T.line}` }}>
                                <div className="flex items-center gap-2">
                                  {/* Both this and the buttons below count
                                      within the visible product. They used to
                                      disagree - the header said "Option 1 of 3"
                                      over a button reading "Approve Option 2" -
                                      because the header counted inside the group
                                      and the buttons counted across every design
                                      on the order. */}
                                  <span
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold"
                                    style={{ backgroundColor: '#E0E0E0', color: '#666666' }}
                                  >
                                    {visibleProofs.length === 1 ? '✓' : optionNum}
                                  </span>
                                  <span style={{ color: '#1A1A1A', fontSize: '13px', fontWeight: 500 }}>
                                    {/* The pill above already names the product,
                                        so only repeat it when there is no pill. */}
                                    {pendingGroups.length === 1 && proof.groupLabel ? `${proof.groupLabel}: ` : ''}
                                    {visibleProofs.length === 1 ? 'Your Design' : `Option ${optionNum} of ${visibleProofs.length}`}
                                  </span>
                                </div>
                              </div>

                              {/* Proof display — fits viewport, 1:1 max */}
                              <div className="relative" style={{ backgroundColor: '#F5F5F5', maxHeight: 'calc(100vh - 280px)' }}>
                              {/* Clicking the artwork opens full screen too, but
                                  that is not discoverable on its own. */}
                              <button
                                onClick={() => setFullscreenIndex(idx)}
                                className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
                                style={{ backgroundColor: 'rgba(255,255,255,0.94)', color: '#1A1A1A', border: '1px solid #E0E0E0' }}
                                title="View this design full screen"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                                Full screen
                              </button>
                              <div className="flex items-center justify-center overflow-hidden" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                                {isPdf(proof.imageUrl) ? (
                                  <div className="w-full flex items-center justify-center" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                                    <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#666666' }} /></div>}>
                                      <PdfViewer url={proof.imageUrl} maxHeight={Math.round(window.innerHeight * 0.48)} />
                                    </Suspense>
                                  </div>
                                ) : (
                                  <div
                                    onClick={() => setFullscreenIndex(idx)}
                                    className="w-full flex items-center justify-center cursor-zoom-in"
                                    style={{ maxHeight: 'calc(100vh - 280px)' }}
                                  >
                                    <img
                                      src={proof.imageUrl}
                                      alt={`Option ${optionNum}`}
                                      className="w-full h-auto object-contain hover:opacity-95 transition-opacity"
                                      style={{ maxHeight: 'calc(100vh - 280px)' }}
                                      draggable={false}
                                      onContextMenu={e => e.preventDefault()}
                                    />
                                  </div>
                                )}
                              </div>
                              </div>

                              {/* Per-card action buttons — each design carries its
                                  own Approve + Make Revisions. No separate
                                  "select then act" step. */}
                              <div className="p-3 space-y-2" style={{ borderTop: `1px solid ${T.line}` }}>
                                {/* Phones slide to approve, which replaces the
                                    confirm dialog: the drag itself is the
                                    guard against a stray tap. Desktop keeps
                                    the button plus dialog. */}
                                <div className="md:hidden">
                                  <SlideToApprove
                                    label={visibleProofs.length === 1 ? 'Slide to approve' : `Slide to approve Option ${optionNum}`}
                                    disabled={submitting || isRevising}
                                    busy={submitting}
                                    onComplete={() => handleApprove(proof.id)}
                                  />
                                </div>
                                <button
                                  onClick={() => setConfirmApproveProofId(proof.id)}
                                  disabled={submitting || isRevising}
                                  className="hidden md:flex w-full px-4 py-3 text-sm font-bold transition-colors disabled:opacity-40 items-center justify-center gap-2 uppercase tracking-wide"
                                  style={{ backgroundColor: '#4600D6', color: '#FFFFFF' }}
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                  {visibleProofs.length === 1 ? 'Approve This Design' : `Approve Option ${optionNum}`}
                                </button>
                                <button
                                  onClick={() => {
                                    setRevisingProofId(isRevising ? null : proof.id)
                                    setFeedback('')
                                  }}
                                  disabled={submitting}
                                  className="w-full px-4 py-2.5 text-sm transition-colors disabled:opacity-40 flex items-center justify-center gap-2 rounded-[5px] md:rounded-none font-bold uppercase tracking-wide md:font-medium md:normal-case md:tracking-normal min-h-[58px] md:min-h-0"
                                  style={{
                                    backgroundColor: isRevising ? '#1A1A1A' : '#FFFFFF',
                                    color: isRevising ? '#FFFFFF' : '#1A1A1A',
                                    border: '1px solid #1A1A1A'
                                  }}
                                >
                                  {isRevising ? 'Close revisions form' : (visibleProofs.length === 1 ? 'Request Revision to this Design' : `Request Revision to Option ${optionNum}`)}
                                </button>

                                {/* Inline revisions form — expands below the
                                    buttons when "Make Revisions" is clicked.
                                    Keeps feedback visually tied to the design
                                    it belongs to. */}
                                {isRevising && (
                                  <div className="pt-3 mt-1 space-y-2" style={{ borderTop: '1px solid #F0EDE6' }}>
                                    <label htmlFor={`feedback-${proof.id}`} style={{ color: '#1A1A1A', fontSize: '13px', fontWeight: 500, display: 'block' }}>
                                      What changes would you like to {visibleProofs.length === 1 ? 'this design' : `Option ${optionNum}`}?
                                    </label>
                                    <textarea
                                      id={`feedback-${proof.id}`}
                                      value={feedback}
                                      onChange={(e) => setFeedback(e.target.value)}
                                      placeholder="e.g., Change the bib number to 1234 and make the text larger…"
                                      className="w-full px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300"
                                      style={{ backgroundColor: '#FAFAFA', border: '1px solid #E0E0E0', color: '#1A1A1A' }}
                                      rows={4}
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleRequestRevision(proof.id)}
                                      disabled={submitting || !feedback.trim()}
                                      className="w-full px-4 py-3 text-sm font-bold transition-colors disabled:opacity-40 flex items-center justify-center gap-2 uppercase tracking-wide"
                                      style={{ backgroundColor: '#1A1A1A', color: '#FFFFFF' }}
                                    >
                                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : `Send Revisions${visibleProofs.length > 1 ? ` for Option ${optionNum}` : ''}`}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Arrow buttons (desktop only) */}
                    {visibleProofs.length > 1 && (
                      <>
                        <button
                          onClick={() => goToSlide(Math.max(0, nearestSlide() - 1))}
                          className={`hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-9 h-9 items-center justify-center rounded-full transition-colors ${activeSlide === 0 ? 'opacity-30 pointer-events-none' : ''}`}
                          style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
                        >
                          <ChevronLeft className="w-5 h-5" style={{ color: '#1A1A1A' }} />
                        </button>
                        <button
                          onClick={() => goToSlide(Math.min(visibleProofs.length - 1, nearestSlide() + 1))}
                          className={`hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-9 h-9 items-center justify-center rounded-full transition-colors ${activeSlide >= visibleProofs.length - 1 ? 'opacity-30 pointer-events-none' : ''}`}
                          style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}
                        >
                          <ChevronRight className="w-5 h-5" style={{ color: '#1A1A1A' }} />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Dot indicators */}
                  {visibleProofs.length > 1 && (
                    <div className="flex items-center justify-center gap-1.5 mt-2">
                      {visibleProofs.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => goToSlide(idx)}
                          className="rounded-full transition-all"
                          style={{
                            width: idx === activeSlide ? '24px' : '8px',
                            height: '8px',
                            backgroundColor: idx === activeSlide ? '#1A1A1A' : '#E0E0E0'
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* The "don't email us" callout used to live here as a sticky
                    footer. Moved up under the subheader so customers see it
                    before they even start scrolling through designs. */}
              </>
            )}

            {/* Past proofs — grouped by batch */}
            {pastProofs.length > 0 && (() => {
              // Group past proofs by batch number, sorted descending (most recent batch first)
              const batchMap = new Map<number, Proof[]>()
              pastProofs.forEach(p => {
                const b = p.batch || 1
                if (!batchMap.has(b)) batchMap.set(b, [])
                batchMap.get(b)!.push(p)
              })
              const sortedBatches = [...batchMap.entries()].sort((a, b) => b[0] - a[0])
              // Find feedback per batch (the revision_requested proof with feedback)
              const getFeedback = (batchProofs: Proof[]) => {
                const revProof = batchProofs.find(p => p.status === 'revision_requested' && p.customerFeedback)
                return revProof?.customerFeedback || null
              }

              // In revision: the round just sent back is the one they want
              // to look at, so it gets the full gallery up top; older rounds
              // fold away as before.
              const latestBatch: [number, Proof[]] | null = hasPendingProofs ? null : (sortedBatches[0] ?? null)
              const foldable: [number, Proof[]][] = hasPendingProofs ? sortedBatches : sortedBatches.slice(1)

              return (
                <div className={hasPendingProofs ? 'mt-4' : ''}>
                  {!hasPendingProofs && latestBatch && (
                    <div className="mb-6">
                      <DesignGallery proofs={latestBatch[1]} title={`This round - ${latestBatch[1].length} option${latestBatch[1].length !== 1 ? 's' : ''}`} />
                      {getFeedback(latestBatch[1]) && (
                        <div className="mt-2 px-4 py-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid #E0E0E0', borderRadius: 12 }}>
                          <p className="text-xs font-medium mb-1" style={{ color: '#4600D6' }}>Your feedback:</p>
                          <p className="text-sm" style={{ color: '#666666' }}>{getFeedback(latestBatch[1])}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {foldable.length > 0 && (
                    <button
                      onClick={() => setShowEarlierVersions(!showEarlierVersions)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-sm transition-colors"
                      style={{ color: '#999999' }}
                    >
                      {showEarlierVersions ? (
                        <><ChevronUp className="w-4 h-4" /> Hide earlier rounds</>
                      ) : (
                        <><ChevronDown className="w-4 h-4" /> View {foldable.length} earlier round{foldable.length !== 1 ? 's' : ''}</>
                      )}
                    </button>
                  )}
                  {showEarlierVersions && foldable.length > 0 && (
                    <div className="space-y-6 mt-2">
                      {foldable.map(([batchNum, batchProofs]) => {
                        const feedback = getFeedback(batchProofs)
                        return (
                          <div key={batchNum}>
                            <p className="text-xs font-medium mb-2" style={{ color: '#999999', letterSpacing: '0.03em' }}>
                              Round {batchNum} - {batchProofs.length} option{batchProofs.length !== 1 ? 's' : ''}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {batchProofs.map(proof => {
                                const badgeStyle = proof.status === 'approved'
                                  ? { backgroundColor: 'rgba(70, 0, 214, 0.1)', color: '#4600D6' }
                                  : proof.status === 'rejected'
                                    ? { backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#DC2626' }
                                    : { backgroundColor: 'rgba(0,0,0,0.05)', color: '#666666' }
                                const badgeLabel = proof.status === 'approved' ? 'Approved'
                                  : proof.status === 'rejected' ? 'Rejected'
                                    : 'Revision'
                                return (
                                  <div key={proof.id} className="relative opacity-60">
                                    {isPdf(proof.imageUrl) ? (
                                      <div className="flex items-center gap-1.5 px-3 py-2 rounded-md" style={{ backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0' }}>
                                        <span className="text-lg">📄</span>
                                        <span style={{ fontSize: '10px', color: '#666666' }}>{proof.fileName || `v${proof.version}`}</span>
                                      </div>
                                    ) : (
                                      <button onClick={() => setLightboxUrl(proof.imageUrl)} className="block">
                                        <img
                                          src={proof.thumbnailUrl || proof.imageUrl}
                                          alt={`Option ${proof.version}`}
                                          className="h-16 w-16 object-cover rounded-md hover:opacity-90 transition-opacity"
                                          style={{ border: '1px solid #E0E0E0' }}
                                          draggable={false}
                                          onContextMenu={e => e.preventDefault()}
                                        />
                                      </button>
                                    )}
                                    <span
                                      className="absolute -top-1.5 -right-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium"
                                      style={badgeStyle}
                                    >
                                      {badgeLabel}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                            {feedback && (
                              <div className="mt-2 px-4 py-3" style={{ backgroundColor: '#FAFAFA', border: '1px solid #E0E0E0' }}>
                                <p className="text-xs font-medium mb-1" style={{ color: '#4600D6' }}>Your feedback:</p>
                                <p className="text-sm" style={{ color: '#666666' }}>{feedback}</p>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}
          </>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 text-center" style={{ borderTop: '1px solid #E0E0E0' }}>
          <p style={{ fontSize: '11px', color: '#999999', letterSpacing: '0.05em' }}>
            Trackstar - Celebrating athletic achievement.
          </p>
        </div>
      </div>
    </div>
  )
}
