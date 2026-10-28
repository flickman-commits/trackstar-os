import { useState, useEffect, useCallback, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Copy, Loader2, FlaskConical, Pencil, Check, X, ChevronDown as ChevronDownIcon, ChevronUp, ChevronLeft, ImagePlus, MessageSquareText, Send, CloudSun, Download, ArrowUpRight, Mail, Shuffle, Clock, RotateCcw } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { Design } from '@/lib/useDesign'
import { raceNotRunYet, showsRaceNotRun } from '@/lib/raceStatus'
import ProofManager, { type ProofActions } from '@/components/ProofManager'
import PostApprovalChecklist from '@/components/PostApprovalChecklist'
import CustomFinalPdf from '@/components/CustomFinalPdf'
import AddPhotoPanel from '@/components/AddPhotoPanel'
import { DesignCard, DesignReview, DesignDetailsTags, DesignFileLinks } from '@/components/DesignPanel'
import SourceLinks from '@/components/SourceLinks'
import AssigneePicker from '@/components/AssigneePicker'
import OrderConversations from '@/components/support/OrderConversations'
import ProofShowcase from '@/components/ProofShowcase'
import PhotoCropper from '@/components/PhotoCropper'
import OrderProduction from '@/components/orders/OrderProduction'
import ConvertToCustomModal from '@/components/orders/ConvertToCustomModal'
import Linkify from '@/components/Linkify'
import OrderTags, { HoverTip } from '@/components/OrderTags'
import type { ToastMessage } from '@/components/orders/Toast'
import {
  type ActiveView, type DesignStatus, type EditValues, type Order, type OrderComment, type PossibleMatch,
  DESIGN_STATUS_CONFIG, designLabel, selectableDesignStatuses, mapOrder,
} from '@/components/orders/orderModel'
import {
  TZ, formatDueDate, isDueDateUrgent, dueIsLive, orderAge, formatOrderPlacedAt, getStatusDisplay,
  generateFilename as filenameFor, orderItemCount, orderItemPosition,
} from '@/components/orders/orderFormat'
import {
  CollapsibleSection, CopyableField, PartnerInfoFields, CustomDetailsFields, PendingField,
  MissingDateField, NotAvailableField, ApprovalEmailField,
} from '@/components/orders/fields'

type TeamMember = { id: string; firstName: string; lastName: string }

export interface OrderDetailProps {
  /** The open order, or null when none is. Mounted either way, so what it holds survives closing and reopening as it always has. */
  order: Order | null
  /** The loaded list, for the order's other prints. */
  orders: Order[]
  activeView: ActiveView
  /** The open order's automated print. The Dashboard owns it: its review also moves the list and the keyboard shortcuts. */
  design: Design
  raceShorthands: Record<string, string>
  team: TeamMember[]
  myId: string | null
  /** Suggested runners per order number, for the Accept buttons. */
  possibleMatches: Record<string, PossibleMatch[]>
  setPossibleMatches: Dispatch<SetStateAction<Record<string, PossibleMatch[]>>>
  /** The runner edit. The Dashboard holds it because S/D and Esc stop while it is open. */
  edit: {
    isEditing: boolean
    setIsEditing: Dispatch<SetStateAction<boolean>>
    values: EditValues
    setValues: Dispatch<SetStateAction<EditValues>>
  }
  /** Previous and next in the visible queue, and closing. */
  nav: {
    /** Open in the table's place rather than as a popup over the completed list. */
    inline: boolean
    index: number
    total: number
    go: (direction: 'next' | 'prev') => void
    close: () => void
  }
  /** What the detail view changes on the page around it. */
  actions: {
    setOrders: Dispatch<SetStateAction<Order[]>>
    setSelectedOrder: Dispatch<SetStateAction<Order | null>>
    fetchOrders: () => Promise<void>
    loadTeam: () => void
    setToast: Dispatch<SetStateAction<ToastMessage | null>>
    markAsCompleted: (orderNumber: string) => Promise<void>
    assignOrder: (orderId: string, assigneeId: string | null) => Promise<void>
    /** Open the "Email customer" modal for this order. */
    emailCustomer: (order: Order) => void
  }
}

/**
 * One order, open: the header, then a custom or partner order's design and
 * proofs, or a standard order's product, research, runner and race data, the
 * customer photo, the automated print and the actions. Opens in the table's
 * place, or as a popup over the completed list.
 */
export default function OrderDetail({
  order: selectedOrder, orders, activeView, design, raceShorthands, team, myId,
  possibleMatches: possibleMatchesMap, setPossibleMatches: setPossibleMatchesMap,
  edit: { isEditing, setIsEditing, values: editValues, setValues: setEditValues },
  nav: { inline: inlineDetail, index: currentOrderIndex, total: navTotal, go: navigateOrder, close: closeModal },
  actions: { setOrders, setSelectedOrder, fetchOrders, loadTeam, setToast, markAsCompleted, assignOrder, emailCustomer: setEmailingOrder },
}: OrderDetailProps) {
  const { isAdmin, can, user } = useAuth()
  const generateFilename = (o: Order) => filenameFor(o, raceShorthands)
  const getOrderItemCount = (parentOrderNumber: string) => orderItemCount(orders, parentOrderNumber)
  const getOrderItemPosition = (o: Order) => orderItemPosition(orders, o)

  const [isResearching, setIsResearching] = useState(false)
  // The race year, set by hand from the Order Details card (a missing or wrong year).
  const [yearDraft, setYearDraft] = useState<string | null>(null)
  const [savingYear, setSavingYear] = useState(false)
  useEffect(() => { setYearDraft(null) }, [selectedOrder?.id])

  // Change frame: edits the Shopify order, and Artelo follows (support/changeItem.js, as Support's Change size or frame).
  const [frameMenu, setFrameMenu] = useState<{ current: string | null; frames: { frame: string; difference: number }[] } | null>(null)
  const [frameBusy, setFrameBusy] = useState(false)
  useEffect(() => { setFrameMenu(null) }, [selectedOrder?.id])
  const canChangeFrame = isAdmin && selectedOrder?.source === 'shopify' && selectedOrder.status !== 'completed'

  const openFrameMenu = async () => {
    if (!selectedOrder || frameBusy) return
    if (frameMenu) { setFrameMenu(null); return }
    setFrameBusy(true)
    try {
      const r = await apiFetch('/api/orders/change-frame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'options', orderId: selectedOrder.id }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not read the frames')
      if (!d.frames?.length) throw new Error(`No other frame at ${d.size || 'this size'}`)
      setFrameMenu({ current: d.current, frames: d.frames })
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not read the frames', type: 'error' })
    } finally {
      setFrameBusy(false)
    }
  }

  const changeFrameTo = async (option: { frame: string; difference: number }) => {
    if (!selectedOrder) return
    const money = option.difference > 0 ? `It costs $${option.difference.toFixed(2)} more, so Shopify emails the customer an invoice for the difference.`
      : option.difference < 0 ? `It costs $${(-option.difference).toFixed(2)} less; refund the difference in Shopify.` : 'Same price: the customer is not emailed or charged.'
    if (!confirm(`Change this print from ${frameMenu?.current || 'its frame'} to ${option.frame}? ${money} Artelo picks it up within about 10 minutes.`)) return
    setFrameBusy(true)
    try {
      const r = await apiFetch('/api/orders/change-frame', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'change', orderId: selectedOrder.id, frame: option.frame }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not change the frame')
      setFrameMenu(null)
      setToast({ message: `Changed to ${d.now}.${d.invoiced ? ` Shopify invoiced the customer $${Number(d.owed).toFixed(2)}.` : ''} Artelo follows within about 10 minutes.`, type: 'success' })
      await fetchOrders()
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not change the frame', type: 'error' })
    } finally {
      setFrameBusy(false)
    }
  }

  // Personalization photo: opened on demand, never held as a durable link.
  const [photoError, setPhotoError] = useState<string | null>(null)

  /**
   * Exchange the stored path for a short-lived signed URL and open it.
   *
   * The bucket is private, so there is no URL to render in an <img> or an
   * href up front — and deliberately so: a durable link to a customer's photo
   * is a privacy problem we could not walk back once it is in a Slack thread.
   * The URL is minted per click and expires in 15 minutes.
   *
   * The window is opened synchronously and navigated after the fetch, because
   * a window.open() that happens after an await is treated as a popup and gets
   * blocked in Safari.
   */

  // Inline preview of the customer photo. The bucket is private, so we mint a
  // signed URL as soon as a photo order is opened. Seeing the actual image
  // beats a link Eli has to remember to click.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoLoading, setPhotoLoading] = useState(false)

  useEffect(() => { setShowCommentBox(false) }, [selectedOrder?.orderNumber])

  useEffect(() => {
    const path = selectedOrder?.photoPath
    setPhotoUrl(null)
    if (!path) return
    let cancelled = false
    setPhotoLoading(true)
    setPhotoError(null)
    apiFetch(`/api/admin/photo-signed-url?path=${encodeURIComponent(path)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.message || `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((data) => { if (!cancelled) setPhotoUrl(data.url) })
      .catch((err) => { if (!cancelled) setPhotoError(err instanceof Error ? err.message : 'Could not load photo') })
      .finally(() => { if (!cancelled) setPhotoLoading(false) })
    return () => { cancelled = true }
  }, [selectedOrder?.photoPath])

  /** Save the customer photo to disk. Falls back to opening it if the fetch is blocked. */
  async function downloadPersonalizationPhoto(order: Order) {
    if (!photoUrl) return
    try {
      const res = await fetch(photoUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const ext = (order.photoPath?.split('.').pop() || 'jpg').split('?')[0]
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${order.displayOrderNumber}_photo.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    } catch {
      window.open(photoUrl, '_blank')
    }
  }


  const [photoConfirming, setPhotoConfirming] = useState(false)

  /** Toggle the "photo is on the artwork" confirmation for a photo order. */
  async function setPhotoPlaced(orderNumber: string, placed: boolean) {
    setPhotoConfirming(true); setPhotoError(null)
    try {
      const r = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'photo-placed', orderNumber, placed }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.message || `HTTP ${r.status}`)
      }
      const { order } = await r.json()
      const placedAt = order?.photoPlacedAt ?? null
      // Patch both the list and the open order so the gate updates immediately.
      setOrders(prev => prev.map(o => o.orderNumber === orderNumber ? { ...o, photoPlacedAt: placedAt } : o))
      setSelectedOrder(prev => prev && prev.orderNumber === orderNumber ? { ...prev, photoPlacedAt: placedAt } : prev)
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not update photo confirmation')
    } finally {
      setPhotoConfirming(false)
    }
  }

  // Photo orders get an explicit sign-off. The photo is the one element a
  // normal proof does not show, and a print that ships without it is a
  // reprint and a refund. Shared by the standard and custom views.
  // The script places the photo itself; an approved render of this photo is the confirmation.
  const photoByRender = !!(selectedOrder?.photoPath && design.job?.status === 'done' && design.job.spec.photoPath === selectedOrder.photoPath)
  const photoPlaced = !!selectedOrder?.photoPlacedAt || photoByRender
  // Re-crop the customer's photo by hand and render the design again with it.
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [cropBusy, setCropBusy] = useState(false)
  const [converting, setConverting] = useState(false)
  const cropExport = useRef<(() => Promise<File>) | null>(null)
  useEffect(() => { setCropFile(null) }, [selectedOrder?.id])
  const openCrop = async () => {
    if (!photoUrl) return
    try {
      const blob = await (await fetch(photoUrl)).blob()
      setCropFile(new File([blob], 'customer-photo.' + (blob.type.split('/')[1] || 'jpg'), { type: blob.type || 'image/jpeg' }))
    } catch { setToast({ message: 'Could not load the photo to crop', type: 'error' }) }
  }
  const cropAndRerender = async () => {
    if (!selectedOrder || !cropExport.current) return
    setCropBusy(true)
    try {
      const cropped = await cropExport.current()
      const post = async (body: Record<string, unknown>) => {
        const r = await apiFetch('/api/orders/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error || 'Request failed')
        return d
      }
      const slot = await post({ action: 'upload-url', filename: cropped.name })
      const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': cropped.type, 'x-upsert': 'false' }, body: cropped })
      if (!put.ok) throw new Error('The cropped photo did not upload')
      await post({ action: 'replace', orderId: selectedOrder.id, path: slot.path })
      setSelectedOrder(prev => prev && prev.id === selectedOrder.id ? { ...prev, photoPath: slot.path, photoPlacedAt: null } : prev)
      setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, photoPath: slot.path, photoPlacedAt: null } : o))
      setCropFile(null)
      if (design.canManage) await design.create()
      setToast({ message: design.canManage ? 'Photo cropped. Re-rendering the design.' : 'Photo cropped.', type: 'success' })
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not crop the photo', type: 'error' })
    } finally { setCropBusy(false) }
  }

  const photoCard = selectedOrder?.photoPath ? (
      <div
        className={`rounded-md border p-3 ${
          photoPlaced
            ? 'bg-green-50 border-green-300'
            : 'bg-[#4600D6]/5 border-[#4600D6]/40'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${photoPlaced ? 'text-green-800' : 'text-[#4600D6]'}`}>
              {photoByRender ? 'Customer photo, placed by the script'
                : selectedOrder.photoPlacedAt
                ? 'Photo confirmed on artwork'
                : 'This print includes a customer photo'}
            </p>
            <p className={`text-[11px] mt-0.5 ${photoPlaced ? 'text-green-700' : 'text-[#4600D6]/80'}`}>
              {photoByRender ? 'Check it on the design. Approving the design confirms it.'
                : selectedOrder.photoPlacedAt
                ? `Confirmed ${new Date(selectedOrder.photoPlacedAt).toLocaleString()}`
                : 'Place this photo on the print before completing this order.'}
            </p>
            {photoByRender ? null : (
            <label className={`mt-2 inline-flex items-center gap-2 cursor-pointer select-none ${photoConfirming ? 'opacity-50' : ''}`}>
              <input
                type="checkbox"
                checked={!!selectedOrder.photoPlacedAt}
                disabled={photoConfirming}
                onChange={() => setPhotoPlaced(selectedOrder.orderNumber, !selectedOrder.photoPlacedAt)}
                className={`w-4 h-4 cursor-pointer ${selectedOrder.photoPlacedAt ? 'accent-green-600' : 'accent-[#4600D6]'}`}
              />
              <span className={`text-xs font-semibold ${selectedOrder.photoPlacedAt ? 'text-green-800' : 'text-[#4600D6]'}`}>
                {photoConfirming ? 'Saving...' : 'Photo placed on artwork'}
              </span>
            </label>
            )}
          </div>

          {/* The photo on the right, its two actions stacked to its left. */}
          <div className="flex-none flex items-start gap-2">
            <div className="flex flex-col gap-1.5 w-[104px]">
              <button
                type="button"
                onClick={() => downloadPersonalizationPhoto(selectedOrder)}
                disabled={!photoUrl}
                className="w-full inline-flex items-center justify-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded bg-dark-fill text-white hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Download className="w-3 h-3" />
                Download
              </button>
              {design.canManage && (
                <button
                  type="button"
                  onClick={openCrop}
                  disabled={!photoUrl || cropBusy}
                  className="w-full inline-flex items-center justify-center whitespace-nowrap text-[11px] font-semibold px-2 py-1.5 rounded border border-off-black/20 bg-white text-off-black hover:bg-subtle-gray disabled:opacity-40"
                >
                  Crop &amp; re-render
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => photoUrl && window.open(photoUrl, '_blank')}
              disabled={!photoUrl}
              title={photoUrl ? 'Open full size' : undefined}
              className="w-28 h-28 rounded border border-black/10 bg-white overflow-hidden flex items-center justify-center disabled:cursor-default"
            >
              {photoLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-off-black/30" />
              ) : photoUrl ? (
                <img src={photoUrl} alt="Customer photo" className="h-full w-full object-cover" />
              ) : (
                <span className="text-[10px] text-off-black/40 px-2 text-center">No preview</span>
              )}
            </button>
          </div>
        </div>
        {/* Cropping opens over the page, so the photo is big enough to frame and nothing below shifts. */}
        {cropFile && createPortal(
          <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
            onClick={() => { if (!cropBusy) setCropFile(null) }}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' && !cropBusy) setCropFile(null) }}>
            <div role="dialog" aria-modal="true" aria-label="Crop the customer photo" tabIndex={-1} ref={el => el?.focus()}
              className="bg-white rounded-lg shadow-2xl w-full max-w-[520px] max-h-full overflow-auto p-5 outline-none" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <h3 className="text-base font-semibold text-off-black">Crop the customer photo</h3>
                  <p className="text-xs text-off-black/55 mt-0.5">The square is what prints. The cropped photo replaces this one, and a new design renders with it.</p>
                </div>
                <button type="button" onClick={() => setCropFile(null)} disabled={cropBusy} className="p-1 -m-1 text-off-black/40 hover:text-off-black" aria-label="Close"><X className="w-4 h-4" /></button>
              </div>
              <PhotoCropper file={cropFile} exportRef={cropExport} />
              <div className="mt-4 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setCropFile(null)} disabled={cropBusy} className="px-3 py-2 text-sm text-off-black/60 hover:text-off-black">Cancel</button>
                <button type="button" onClick={cropAndRerender} disabled={cropBusy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-dark-fill text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  {cropBusy && <Loader2 className="w-4 h-4 animate-spin" />} Crop &amp; re-render
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    ) : null

  // Comments state for custom orders
  const [orderComments, setOrderComments] = useState<OrderComment[]>([])
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [newCommentText, setNewCommentText] = useState('')
  // Comment composer stays collapsed until asked for. Auto-opens when the
  // order already has a thread worth replying to.
  const [showCommentBox, setShowCommentBox] = useState(false)
  // Re-send and Message customer, handed up by the custom order's ProofManager for the sidebar.
  const [proofActions, setProofActions] = useState<ProofActions | null>(null)
  // Custom order on the phone: the proofs lead; the rest opens on demand.
  const [customDetailsOpen, setCustomDetailsOpen] = useState(false)
  const [commentImageFile, setCommentImageFile] = useState<File | null>(null)
  const [commentImagePreview, setCommentImagePreview] = useState<string | null>(null)
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [latestFeedback, setLatestFeedback] = useState<string | null>(null)
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false)
  const commentFileInputRef = useRef<HTMLInputElement>(null)

  // Accept a suggested match for an ambiguous result
  // Reload one order (its Shopify order's rows) into the list and the open
  // view. The full /api/orders read this replaced took long enough that
  // "Researching..." seemed stuck, and it swapped in a different list.
  const reloadOrder = async (orderNumber: string) => {
    const row = selectedOrder?.orderNumber === orderNumber ? selectedOrder : null
    const parent = row?.parentOrderNumber || orderNumber.replace(/-\d+$/, '')
    const data = await apiFetch(`/api/orders?number=${encodeURIComponent(parent)}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    const fresh: Order[] = (data?.orders || []).map(mapOrder)
    if (!fresh.length) return
    setOrders(prev => prev.map(o => fresh.find(f => f.orderNumber === o.orderNumber) || o))
    const mine = fresh.find(f => f.orderNumber === orderNumber)
    if (mine) setSelectedOrder(prev => (prev?.orderNumber === orderNumber ? mine : prev))
  }

  const acceptMatch = async (orderNumber: string, match: { name: string; bib: string; time: string; pace?: string; eventType?: string; resultsUrl?: string }) => {
    try {
      setToast({ message: 'Accepting match...', type: 'info' })

      const response = await apiFetch(`/api/orders/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept-match', orderNumber, match })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to accept match')
      }

      setToast({
        message: `Match accepted: ${match.name} - Bib: ${match.bib}, Time: ${match.time}`,
        type: 'success'
      })

      // Clear possible matches for this order
      setPossibleMatchesMap(prev => {
        const next = { ...prev }
        delete next[orderNumber]
        return next
      })

      await reloadOrder(orderNumber)
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error accepting match:', error)
      const message = error instanceof Error ? error.message : 'Failed to accept match'
      setToast({ message, type: 'error' })
    }
  }

  // A standard order's design is approved: the only time Mark as Completed shows for it.
  const standardDesignApproved = design.job?.status === 'done' && design.job.review === 'approved'
  // No usable design from the script: none made, the render failed, or the
  // design was rejected or closed (Eli makes those by hand when the file has a
  // problem a re-render cannot fix). Completing it says "Made by Hand". A design
  // rendering or waiting for review gets no button, so nothing completes past it.
  const standardNoDesign = Boolean(design.state) && (!design.job || design.job.status === 'failed'
    || (design.job.status === 'done' && (design.job.review === 'rejected' || design.job.review === 'closed')))

  // Re-open a completed order. Brings it back into the active queue with
  // status='ready' (if research exists) or 'pending' (if it doesn't), so
  // it shows up in the standard view again and can be re-edited / printed.
  const reopenOrder = async (orderNumber: string) => {
    const ok = window.confirm('Re-open this order? It will go back into the active queue and disappear from the completed list.')
    if (!ok) return
    try {
      const response = await apiFetch(`/api/orders/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen', orderNumber })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to re-open order')
      }

      setToast({ message: 'Order re-opened - back in the queue', type: 'success' })
      setSelectedOrder(null)
      await fetchOrders()
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error re-opening order:', error)
      const msg = error instanceof Error ? error.message : 'Failed to re-open order'
      setToast({ message: msg, type: 'error' })
    }
  }

  // "Notify Customer of Delay" — Dan's emergency-only button for custom orders
  const [delayDialogOpen, setDelayDialogOpen] = useState(false)
  const [delayDaysInput, setDelayDaysInput] = useState('3')
  const [isSendingDelay, setIsSendingDelay] = useState(false)

  const openDelayDialog = () => {
    setDelayDaysInput('3')
    setDelayDialogOpen(true)
  }
  const closeDelayDialog = () => {
    if (isSendingDelay) return
    setDelayDialogOpen(false)
  }
  const sendDelayNotice = async (orderNumber: string) => {
    const days = parseInt(delayDaysInput, 10)
    if (!Number.isFinite(days) || days < 1 || days > 60) {
      setToast({ message: 'Days late must be a whole number between 1 and 60', type: 'error' })
      return
    }
    setIsSendingDelay(true)
    try {
      const response = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notify-custom-delay', orderNumber, daysLate: days })
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to send delay notice')
      }
      setToast({ message: `Delay notice sent - promised ${days} day${days === 1 ? '' : 's'} late`, type: 'success' })
      setDelayDialogOpen(false)
      // Update local state immediately so the badge shows up without a refetch
      const sentAt = new Date().toISOString()
      setSelectedOrder(prev => prev ? { ...prev, delayNoticeSentAt: sentAt, delayNoticeDaysLate: days } : prev)
      setOrders(prev => prev.map(o => o.orderNumber === orderNumber ? { ...o, delayNoticeSentAt: sentAt, delayNoticeDaysLate: days } : o))
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to send delay notice'
      setToast({ message: msg, type: 'error' })
    } finally {
      setIsSendingDelay(false)
    }
  }

  const [isSaving, setIsSaving] = useState(false)

  // Race Data edit mode state — covers date, weather, temp on the Race record.
  // Variables retain the "weather" naming for backward compat with the rest of
  // the file, but the UI label is "Race Data".
  const [isEditingWeather, setIsEditingWeather] = useState(false)
  const [weatherEditValues, setWeatherEditValues] = useState<{
    raceDate: string  // ISO YYYY-MM-DD (HTML date input format)
    weatherCondition: string
    weatherTemp: string
  }>({ raceDate: '', weatherCondition: '', weatherTemp: '' })
  const [isSavingWeather, setIsSavingWeather] = useState(false)

  // Weather calculator — micro-modal (date + city) that computes race-window
  // weather (avg 7am–1pm) via Open-Meteo and saves it to the race.
  const [showWeatherCalc, setShowWeatherCalc] = useState(false)
  const [weatherCalcCity, setWeatherCalcCity] = useState('')
  const [weatherCalcDate, setWeatherCalcDate] = useState('')
  const [isCalculatingWeather, setIsCalculatingWeather] = useState(false)
  // Confirm a race year's calculated weather for printing.
  const [confirmingWeather, setConfirmingWeather] = useState(false)
  const confirmWeather = async (order: Order) => {
    if (!order.raceId) return
    setConfirmingWeather(true)
    try {
      const res = await apiFetch('/api/races/confirm-weather', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raceId: order.raceId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setToast({ message: data.error || 'Could not confirm the weather', type: 'error' }); return }
      setSelectedOrder(prev => prev && prev.raceId === order.raceId ? { ...prev, weatherConfirmedAt: data.weatherConfirmedAt, weatherConfirmedBy: data.weatherConfirmedBy } : prev)
      setToast({ message: `Weather confirmed for every ${order.effectiveRaceName || order.raceName} ${order.effectiveRaceYear || order.raceYear} order`, type: 'success' })
      fetchOrders()
    } finally { setConfirmingWeather(false) }
  }
  // Confirm a race date against its sources. With no source on file (a date a
  // config set), it asks for the page the date was checked on and saves it.
  const [confirmingDate, setConfirmingDate] = useState(false)
  const confirmRaceDate = async (order: Order, askForSource = false) => {
    if (!order.raceId) return
    let sourceUrl: string | null = null
    if (askForSource) {
      sourceUrl = window.prompt(`Paste a link that shows ${order.effectiveRaceName || order.raceName} ${order.effectiveRaceYear || order.raceYear} was on ${order.raceDate} (the race's site, a results page, a news story):`)?.trim() || null
      if (!sourceUrl) return
    }
    setConfirmingDate(true)
    try {
      const res = await apiFetch('/api/races/confirm-weather', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raceId: order.raceId, field: 'date', sourceUrl }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setToast({ message: data.error || 'Could not confirm the date', type: 'error' }); return }
      setSelectedOrder(prev => prev && prev.raceId === order.raceId ? { ...prev, raceDateVerified: true, raceDateConfirmedBy: data.raceDateConfirmedBy, ...(sourceUrl ? { raceDateSourceUrl: sourceUrl } : {}) } : prev)
      setToast({ message: `Race date confirmed for every ${order.effectiveRaceName || order.raceName} ${order.effectiveRaceYear || order.raceYear} order`, type: 'success' })
      fetchOrders()
    } finally { setConfirmingDate(false) }
  }
  // Which weather field's info popover is open (order-scoped; null = none).
  const [showWeatherInfo, setShowWeatherInfo] = useState(false)

  const openWeatherCalc = (order: Order) => {
    setWeatherCalcCity(order.raceLocation || order.raceName || '')
    setWeatherCalcDate(order.raceDateIso || '')
    setShowWeatherCalc(true)
  }

  const calculateWeather = async (order: Order) => {
    if (!weatherCalcCity.trim() || !weatherCalcDate) {
      setToast({ message: 'Enter a city and date', type: 'error' })
      return
    }
    setIsCalculatingWeather(true)
    // Close the calculator so the spinner on the weather values shows it working.
    setShowWeatherCalc(false)
    try {
      const send = (reason?: string) => apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'calculate-weather',
          raceId: order.raceId,
          city: weatherCalcCity.trim(),
          date: weatherCalcDate,
          reason,
        }),
      })
      let res = await send()
      let data = await res.json()
      // A print of this race year was already approved: changing its weather needs a reason.
      if (res.status === 409 && data.needsReason) {
        const reason = window.prompt(`${data.error}\n\nWhy is the weather changing?`)
        if (!reason?.trim()) return
        res = await send(reason.trim())
        data = await res.json()
      }
      if (!res.ok) {
        setToast({ message: data.error || 'Could not calculate weather', type: 'error' })
        return
      }
      setToast({ message: `Weather: ${data.condition} · ${data.temp}`, type: 'success' })
      setShowWeatherCalc(false)
      // Refresh the order so the new weather + info breakdown show.
      const refreshed = await apiFetch(`/api/orders?type=${activeView}`).then(r => r.json())
      const updated = refreshed.orders?.find((o: { orderNumber: string }) => o.orderNumber === order.orderNumber)
      if (updated) {
        setSelectedOrder({ ...selectedOrder!, ...updated, displayOrderNumber: updated.displayOrderNumber || updated.orderNumber })
      }
      await fetchOrders()
    } catch {
      setToast({ message: 'Failed to calculate weather', type: 'error' })
    } finally {
      setIsCalculatingWeather(false)
    }
  }

  // Start editing mode
  const startEditing = (order: Order) => {
    setEditValues({
      runnerNameOverride: order.runnerNameOverride || order.runnerName || '',
      bibNumber: order.bibNumber || '',
      officialTime: order.officialTime || '',
      officialPace: order.officialPace || '',
      ...(order.isTriathlon ? {
        swimTime: order.swimTime || '', swimDistance: order.swimDistance || '',
        bikeTime: order.bikeTime || '', bikeDistance: order.bikeDistance || '',
        runTime: order.runTime || '', runDistance: order.runDistance || '',
      } : {}),
    })
    setIsEditing(true)
  }

  // Cancel editing
  const cancelEditing = () => {
    setIsEditing(false)
    setEditValues({ runnerNameOverride: '', bibNumber: '', officialTime: '', officialPace: '' })
  }

  // Start editing race data (date, weather, temp)
  const startEditingWeather = (order: Order) => {
    setWeatherEditValues({
      raceDate: order.raceDateIso || '',
      // Stored lowercase ("sunny"); the options are capitalized.
      weatherCondition: order.weatherCondition ? order.weatherCondition.charAt(0).toUpperCase() + order.weatherCondition.slice(1).toLowerCase() : '',
      weatherTemp: order.weatherTemp || ''
    })
    setIsEditingWeather(true)
  }

  // Cancel editing race data
  const cancelEditingWeather = () => {
    setIsEditingWeather(false)
    setWeatherEditValues({ raceDate: '', weatherCondition: '', weatherTemp: '' })
  }

  // Save race data edits (date + weather)
  const saveWeather = async (order: Order, reason?: string) => {
    if (!order.raceId) {
      setToast({ message: 'No race data to update', type: 'error' })
      return
    }
    setIsSavingWeather(true)
    try {
      const response = await apiFetch(`/api/orders/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: order.orderNumber,
          raceId: order.raceId,
          raceDate: weatherEditValues.raceDate || null,
          weatherTemp: weatherEditValues.weatherTemp || null,
          weatherCondition: weatherEditValues.weatherCondition || null,
          // Only a changed date needs a source link.
          raceDateSourceUrl: weatherEditValues.raceDate && weatherEditValues.raceDate !== (order.raceDateIso || '')
            ? (window.prompt('Link where this date is confirmed (results page or race site).') || undefined) : undefined,
          reason,
        })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        // A race year that has already printed keeps a record of why its weather changed.
        if (!reason && /needs a reason/i.test(err.error || '')) {
          const why = window.prompt(`${err.error}\n\nWhy is it changing?`)
          if (why && why.trim()) { setIsSavingWeather(false); return saveWeather(order, why.trim()) }
          setToast({ message: 'Not saved: a reason is needed to change printed weather', type: 'error' })
          return
        }
        setToast({ message: err.error || 'Failed to save race data', type: 'error' })
        return
      }
      setToast({ message: 'Race data updated!', type: 'success' })
      setIsEditingWeather(false)
      await fetchOrders()

      // Update selected order with new data
      const updatedOrders = await apiFetch(`/api/orders?type=${activeView}`).then(r => r.json())
      const updated = updatedOrders.orders?.find((o: { orderNumber: string }) => o.orderNumber === order.orderNumber)
      if (updated) {
        setSelectedOrder({
          ...selectedOrder!,
          ...updated,
          displayOrderNumber: updated.displayOrderNumber || updated.orderNumber
        })
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error saving race data:', error)
      setToast({ message: 'Failed to save race data', type: 'error' })
    } finally {
      setIsSavingWeather(false)
    }
  }

  // Save overrides
  const saveOverrides = async (orderNumber: string, originalOrder: Order) => {
    setIsSaving(true)
    try {
      // Only send what actually changed.
      const updates: Record<string, string | number | null> = {}

      if (editValues.runnerNameOverride !== originalOrder.runnerName) {
        updates.runnerNameOverride = editValues.runnerNameOverride || null
      } else if (originalOrder.runnerNameOverride !== null) {
        updates.runnerNameOverride = null
      }

      // Result fields write through to the research record.
      if (editValues.bibNumber !== (originalOrder.bibNumber || '')) {
        updates.bibNumber = editValues.bibNumber || null
      }
      if (editValues.officialTime !== (originalOrder.officialTime || '')) {
        updates.officialTime = editValues.officialTime || null
      }
      if (editValues.officialPace !== (originalOrder.officialPace || '')) {
        updates.officialPace = editValues.officialPace || null
      }
      if (originalOrder.isTriathlon) {
        for (const k of ['swimTime', 'swimDistance', 'bikeTime', 'bikeDistance', 'runTime', 'runDistance'] as const) {
          if ((editValues[k] ?? '') !== (originalOrder[k] || '')) updates[k] = editValues[k] || null
        }
      }

      const response = await apiFetch(`/api/orders/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber, raceId: originalOrder.raceId, ...updates })
      })

      if (!response.ok) throw new Error('Failed to save changes')

      setToast({ message: 'Changes saved!', type: 'success' })
      setIsEditing(false)
      await reloadOrder(orderNumber)
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error saving overrides:', error)
      setToast({ message: 'Failed to save changes', type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  // The inline order view scrolls on its own; each order starts at the top.
  const detailScrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { detailScrollRef.current?.scrollTo(0, 0) }, [selectedOrder?.id])

  // A new race year: the server clears the old year's results and closes
  // designs made from them, then research runs again for the new year.
  const saveYear = async () => {
    if (!selectedOrder || yearDraft == null) return
    const year = Number(yearDraft)
    const now = new Date().getFullYear()
    if (!Number.isInteger(year) || year < 1970 || year > now + 1) { setToast({ message: `Enter a year between 1970 and ${now + 1}`, type: 'error' }); return }
    // The same year is still worth saving on a "Year missing" order: it confirms it.
    if (year === Number(selectedOrder.effectiveRaceYear || selectedOrder.raceYear) && selectedOrder.status !== 'missing_year') { setYearDraft(null); return }
    setSavingYear(true)
    try {
      const r = await apiFetch('/api/orders/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: selectedOrder.orderNumber, yearOverride: year }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not change the year')
      setYearDraft(null)
      setSelectedOrder(prev => prev ? { ...prev, effectiveRaceYear: year, status: prev.status === 'completed' ? prev.status : 'pending', bibNumber: undefined, officialTime: undefined, officialPace: undefined, researchStatus: undefined } : prev)
      setToast({ message: `Year set to ${year}. Researching ${year}…`, type: 'success' })
      await fetchOrders()
      await researchOrder(selectedOrder.orderNumber)
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not change the year', type: 'error' })
    } finally {
      setSavingYear(false)
    }
  }

  // Research a single order
  const researchOrder = async (orderNumber: string) => {
    setIsResearching(true)
    try {
      setToast({ message: 'Researching runner...', type: 'info' })

      const response = await apiFetch(`/api/orders/research-runner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Always a fresh search with what is on the order now, even over a saved result.
        body: JSON.stringify({ orderNumber, force: true })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Research failed')
      }

      const data = await response.json()

      if (data.found) {
        // Optimiztically update the selected order so the modal shows results immediately
        setSelectedOrder(prev => prev ? {
          ...prev,
          bibNumber: data.results.bibNumber,
          officialTime: data.results.officialTime,
          officialPace: data.results.officialPace,
          eventType: data.results.eventType,
          researchStatus: 'found' as const,
          // Keep hadNoTime as set by the customer at order time. Don't let
          // research toggle it — the "No Time" choice is the customer's
          // explicit opt-out, not a "we couldn't find one" placeholder.
        } : prev)
        setToast({
          message: `Found! Bib: ${data.results.bibNumber}, Time: ${data.results.officialTime}`,
          type: 'success'
        })
      } else if (data.ambiguous) {
        // Store possible matches for this order so the UI can show "Accept" buttons
        if (data.possibleMatches?.length > 0) {
          setPossibleMatchesMap(prev => ({ ...prev, [orderNumber]: data.possibleMatches }))
          setToast({
            message: `Found ${data.possibleMatches.length} possible match${data.possibleMatches.length > 1 ? 'es' : ''} - please verify`,
            type: 'info'
          })
        } else {
          setToast({
            message: 'Multiple runners found with that name',
            type: 'error'
          })
        }
      } else {
        setToast({
          message: data.kept ? 'No match this time. The result already on the order was kept.' : 'Runner not found in race results',
          type: 'error'
        })
      }

      await reloadOrder(orderNumber)
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error researching order:', error)
      const message = error instanceof Error ? error.message : 'Research failed'
      setToast({ message, type: 'error' })
    } finally {
      setIsResearching(false)
    }
  }

  // Update design status for custom orders
  const updateDesignStatus = async (orderNumber: string, designStatus: DesignStatus) => {
    // Optimiztically update UI immediately before the API call
    const previousStatus = selectedOrder?.designStatus
    if (selectedOrder?.orderNumber === orderNumber) {
      setSelectedOrder(prev => prev ? { ...prev, designStatus } : null)
    }
    setOrders(prev => prev.map(o => o.orderNumber === orderNumber ? { ...o, designStatus } : o))

    try {
      const response = await apiFetch('/api/orders/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'design-status', orderNumber, designStatus })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || errorData.error || 'Failed to update design status')
      }

      setToast({ message: `Design status updated to ${(DESIGN_STATUS_CONFIG[designStatus] || DESIGN_STATUS_CONFIG.not_started).label}`, type: 'success' })
      fetchOrders() // Refresh in background
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error updating design status:', error)
      // Roll back optimiztic update on failure
      if (selectedOrder?.orderNumber === orderNumber && previousStatus) {
        setSelectedOrder(prev => prev ? { ...prev, designStatus: previousStatus } : null)
      }
      setOrders(prev => prev.map(o => o.orderNumber === orderNumber ? { ...o, designStatus: previousStatus || o.designStatus } : o))
      const message = error instanceof Error ? error.message : 'Failed to update design status'
      setToast({ message, type: 'error' })
    }
  }

  // ====== COMMENTS FUNCTIONS ======

  const fetchComments = useCallback(async (orderId: string) => {
    setIsLoadingComments(true)
    try {
      const response = await apiFetch(`/api/orders/comments?orderId=${orderId}`)
      if (!response.ok) throw new Error('Failed to fetch comments')
      const data = await response.json()
      setOrderComments(data.comments || [])
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching comments:', error)
      setOrderComments([])
    } finally {
      setIsLoadingComments(false)
    }
  }, [])

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Strip the data:image/xxx;base64, prefix
        resolve(result.split(',')[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const submitComment = async () => {
    if (!selectedOrder || (!newCommentText.trim() && !commentImageFile)) return
    setIsSubmittingComment(true)
    try {
      let imageData: string | null = null
      let imageName: string | null = null
      if (commentImageFile) {
        imageData = await fileToBase64(commentImageFile)
        imageName = commentImageFile.name
      }

      const response = await apiFetch('/api/orders/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          text: newCommentText.trim() || null,
          imageData,
          imageName
        })
      })

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Failed to add comment')
      }
      const data = await response.json()
      setOrderComments(prev => [data.comment, ...prev])
      setNewCommentText('')
      setCommentImageFile(null)
      if (commentImagePreview) URL.revokeObjectURL(commentImagePreview)
      setCommentImagePreview(null)
      // Update commentCount on the order in the list so the icon shows
      setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, commentCount: (o.commentCount || 0) + 1 } : o))
      setSelectedOrder(prev => prev ? { ...prev, commentCount: (prev.commentCount || 0) + 1 } : prev)
      setToast({ message: 'Comment added', type: 'success' })
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error adding comment:', error)
      setToast({ message: error instanceof Error ? error.message : 'Failed to add comment', type: 'error' })
    } finally {
      setIsSubmittingComment(false)
    }
  }

  const deleteComment = async (commentId: string) => {
    try {
      const response = await apiFetch('/api/orders/comments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId })
      })
      if (!response.ok) throw new Error('Failed to delete comment')
      setOrderComments(prev => prev.filter(c => c.id !== commentId))
      // Update commentCount on the order in the list
      if (selectedOrder) {
        setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, commentCount: Math.max((o.commentCount || 0) - 1, 0) } : o))
        setSelectedOrder(prev => prev ? { ...prev, commentCount: Math.max((prev.commentCount || 0) - 1, 0) } : prev)
      }
      setToast({ message: 'Comment deleted', type: 'success' })
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error deleting comment:', error)
      setToast({ message: 'Failed to delete comment', type: 'error' })
    }
  }

  const sendFollowUp = async (orderId: string) => {
    setIsSendingFollowUp(true)
    try {
      const res = await apiFetch(`/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-to-customer', orderId })
      })
      const data = await res.json()
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to send follow-up', type: 'error' })
        return
      }
      setToast({ message: 'Follow-up email sent', type: 'success' })
      // Update proofSentAt locally
      setSelectedOrder(prev => prev ? { ...prev, proofSentAt: new Date().toISOString() } : prev)
    } catch {
      setToast({ message: 'Failed to send follow-up', type: 'error' })
    } finally {
      setIsSendingFollowUp(false)
    }
  }

  const handleCommentPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          setCommentImageFile(file)
          setCommentImagePreview(URL.createObjectURL(file))
        }
        break
      }
    }
  }

  const handleCommentFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setCommentImageFile(file)
      setCommentImagePreview(URL.createObjectURL(file))
    }
  }

  const clearCommentImage = () => {
    setCommentImageFile(null)
    if (commentImagePreview) URL.revokeObjectURL(commentImagePreview)
    setCommentImagePreview(null)
    if (commentFileInputRef.current) commentFileInputRef.current.value = ''
  }

  // Load comments when any order modal opens
  useEffect(() => {
    if (selectedOrder?.id) {
      fetchComments(selectedOrder.id)
      setNewCommentText('')
      setCommentImageFile(null)
      setCommentImagePreview(null)
    } else {
      setOrderComments([])
    }
  }, [selectedOrder?.id, fetchComments])

  // Admin only: move a custom order to rush by hand, so it cuts the line.
  const [rushEditing, setRushEditing] = useState<string | null>(null)
  const setRush = async (orderId: string, rush: boolean, dueDate?: string) => {
    try {
      const res = await apiFetch('/api/orders/rush', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, rush, dueDate }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not update rush')
      const patch = { isRushOrder: data.order.isRushOrder, rushOverride: data.order.rushOverride, dueDate: data.order.dueDate, rushUnpaid: false }
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...patch } : o))
      setSelectedOrder(prev => prev && prev.id === orderId ? { ...prev, ...patch } : prev)
      setRushEditing(null)
      setToast({ message: rush ? 'Marked rush. It moves up the custom queue.' : 'Rush removed. Back to the standard due date.', type: 'success' })
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not update rush', type: 'error' })
    }
  }

  const removeManualPhoto = async (orderId: string) => {
    if (!confirm('Remove this photo from the print? The Photo Add-On stays on the Shopify order; refund it there if needed.')) return
    try {
      const res = await apiFetch('/api/orders/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', orderId }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not remove')
      fetchOrders()
      setSelectedOrder(prev => prev && prev.id === orderId ? { ...prev, photoPath: null, photoAddedManually: false, photoUnpaid: false } : prev)
    } catch (e) { setToast({ message: e instanceof Error ? e.message : 'Could not remove', type: 'error' }) }
  }

  // Admin: we are not charging for this photo. It counts as paid and the
  // print renders again with it on.
  const markPhotoFree = async (orderId: string) => {
    if (!confirm('Add this photo free? No Photo Add-On charge; the print renders again with the photo on it.')) return
    try {
      const res = await apiFetch('/api/orders/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'free', orderId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not mark the photo free')
      setSelectedOrder(prev => prev && prev.id === orderId ? { ...prev, photoUnpaid: false } : prev)
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, photoUnpaid: false } : o))
      setToast({ message: data.rendering ? `Photo marked free. Rendering v${data.rendering} with the photo.` : `Photo marked free.${data.reasons?.length ? ` Not rendering yet: ${data.reasons.join('. ')}` : ''}`, type: 'success' })
      fetchOrders()
    } catch (e) { setToast({ message: e instanceof Error ? e.message : 'Could not mark the photo free', type: 'error' }) }
  }

  // Admin: cancel a creator's free sample. The order leaves the queue and the
  // creator goes back to pending, to approve again later or decline.
  const cancelCreatorSample = async (order: Order) => {
    if (!confirm(`Cancel the creator sample for ${order.effectiveRunnerName || order.runnerName || 'this creator'}? The order is removed and the creator goes back to pending.`)) return
    try {
      const res = await apiFetch('/api/orders/cancel-creator-sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Could not cancel the sample')
      setOrders(prev => prev.filter(o => o.id !== order.id))
      setSelectedOrder(null)
      setToast({ message: 'Creator sample cancelled', type: 'success' })
      loadTeam()
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not cancel the sample', type: 'error' })
    }
  }

  const handleCopyEmail = (order: Order) => {
    const emailText = `Hi,

I'm reaching out regarding order ${order.orderNumber} for ${order.runnerName}'s ${order.raceName} ${order.raceYear} print.

${order.flagReason}

Could you please verify the runner's name and race details?

Thank you!`
    navigator.clipboard.writeText(emailText)
  }

  // Comments as an amber note near the top of the order, where they get read:
  // usually a spelling fix on a standard order, or a reference photo and
  // instructions on a custom one.
  const commentsCallout = () => orderComments.length > 0 ? (
                    <div className="bg-amber-50 border border-amber-300 rounded-md px-3 py-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquareText className="w-3.5 h-3.5 text-amber-700" />
                        <span className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">
                          {orderComments.length === 1 ? 'Note on this order' : `${orderComments.length} notes on this order`}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {orderComments.map(comment => (
                          <div key={comment.id}>
                            {comment.imageUrl && (
                              <a href={comment.imageUrl} target="_blank" rel="noopener noreferrer">
                                <img src={comment.imageUrl} alt="Attachment" className="max-h-32 rounded-md mb-1.5 border border-amber-200 hover:opacity-90" />
                              </a>
                            )}
                            {comment.text && <p className="text-[13px] leading-snug text-amber-900 whitespace-pre-wrap"><Linkify text={comment.text} /></p>}
                            <div className="flex items-center justify-between gap-2 mt-0.5">
                              <span className="text-[11px] text-amber-700/70">
                                {comment.authorName ? `${comment.authorName} · ` : ''}
                                {new Date(comment.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </span>
                              <button onClick={() => deleteComment(comment.id)} className="text-[11px] text-amber-700/60 hover:text-red-600">Delete</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
  ) : null

  if (!selectedOrder) return null

  return (
    <>
      {converting && (
        <ConvertToCustomModal
          order={selectedOrder}
          onClose={() => setConverting(false)}
          onDone={async (message) => {
            setConverting(false)
            setToast({ message, type: 'success' })
            closeModal()
            await fetchOrders()
          }}
        />
      )}
      <div
        ref={detailScrollRef}
        // The order view only ever scrolls down: overflow-y alone would let anything
        // too wide scroll it sideways too (and hide the left edge of the order).
        className={inlineDetail ? 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden pb-36 md:pb-8' : 'fixed inset-0 bg-off-black/60 flex items-center justify-center p-4 z-50'}
        onClick={(e) => {
          // Close modal when clicking on backdrop (not modal content)
          if (!inlineDetail && e.target === e.currentTarget && !isEditing) {
            closeModal()
          }
        }}
      >
        <div className={inlineDetail ? 'bg-white border border-border-gray rounded-md w-full' : 'bg-white rounded-none md:rounded-md max-w-[45rem] w-full max-h-[90vh] overflow-y-auto shadow-xl'} onClick={(e) => e.stopPropagation()}>
          <div className="p-4 md:p-6">
            {/* Header. Stays pinned at the top while the order scrolls under it. */}
            <div className="sticky top-0 z-30 -mx-4 -mt-4 px-4 pt-3 pb-2.5 mb-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-5 md:pb-4 md:mb-6 bg-white/95 backdrop-blur border-b border-border-gray rounded-t-md flex items-center justify-between">
              <div className="flex items-center gap-2 md:gap-3 min-w-0">
                {inlineDetail && (
                  <button onClick={closeModal} title="Back to orders (Esc)" className="inline-flex items-center gap-1 -ml-1 px-1.5 py-1 text-off-black/60 hover:text-off-black hover:bg-off-black/5 rounded transition-colors">
                    <ChevronLeft className="w-5 h-5 md:w-4 md:h-4" />
                    <span className="text-sm hidden md:inline">Orders</span>
                  </button>
                )}
                {(selectedOrder.trackstarOrderType === 'custom' || selectedOrder.trackstarOrderType === 'race_partner')
                  ? (() => {
                      // Where a standard order's status sits, and it is the control: pick a status from it.
                      const cur = DESIGN_STATUS_CONFIG[selectedOrder.designStatus as DesignStatus] ? selectedOrder.designStatus as DesignStatus : 'not_started'
                      const cfg = DESIGN_STATUS_CONFIG[cur]
                      return (
                        <label className={`order-last md:order-none relative shrink-0 inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-full border border-border-gray text-[11px] md:text-xs font-medium whitespace-nowrap cursor-pointer ${cfg.bgColor} ${cfg.color}`} title="Change the design status">
                          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} aria-hidden />
                          {designLabel(cur, selectedOrder.trackstarOrderType)}
                          <ChevronDownIcon className="w-3 h-3 opacity-60" />
                          <select
                            value={cur}
                            onChange={e => updateDesignStatus(selectedOrder.orderNumber, e.target.value as DesignStatus)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            aria-label="Design status"
                          >
                            {selectableDesignStatuses(selectedOrder.trackstarOrderType, selectedOrder.designStatus).map(st => (
                              <option key={st} value={st}>{designLabel(st, selectedOrder.trackstarOrderType)}</option>
                            ))}
                          </select>
                        </label>
                      )
                    })()
                  : (() => { const d = getStatusDisplay(selectedOrder); return (
                      <span className="order-last md:order-none shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-border-gray bg-white text-[11px] md:text-xs text-off-black/70 whitespace-nowrap" title={selectedOrder.pipeline?.fix || d.label}>
                        <span className={`w-2 h-2 rounded-full ${d.dot || 'bg-off-black/25'}`} />{d.label}
                      </span>
                    ) })()}
                <div className="min-w-0">
                  <h3 className="text-lg md:text-heading-md text-off-black whitespace-nowrap leading-tight">
                    {selectedOrder.trackstarOrderType === 'race_partner'
                      ? (selectedOrder.partnerName || selectedOrder.raceName || 'Partner')
                      : `Order ${selectedOrder.displayOrderNumber}`}
                  </h3>
                  {/* When it was ordered, pinned with the number on a phone. */}
                  {selectedOrder.trackstarOrderType === 'standard' && (() => { const age = orderAge(selectedOrder); return <div className={`md:hidden text-[11px] leading-tight ${age.cls}`}>{age.label}</div> })()}
                </div>
                {selectedOrder.trackstarOrderType === 'race_partner' && (
                  <span className="px-2 py-0.5 bg-teal-100 text-teal-700 text-xs font-medium rounded">
                    partner
                  </span>
                )}
                {selectedOrder.hasOverrides && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                    edited
                  </span>
                )}
                {(selectedOrder.notes || (selectedOrder.commentCount ?? 0) > 0) && (
                  <HoverTip text="Has notes or comments"><MessageSquareText className="w-4 h-4 text-amber-500 cursor-help" /></HoverTip>
                )}
                {(selectedOrder.trackstarOrderType === 'standard' || selectedOrder.trackstarOrderType === 'custom' || selectedOrder.trackstarOrderType === 'race_partner' || !selectedOrder.trackstarOrderType) && team.length > 0 && (
                  <span className="ml-1 hidden md:inline">
                    <AssigneePicker
                      team={team}
                      value={selectedOrder.assigneeId || null}
                      meId={myId}
                      onChange={id => assignOrder(selectedOrder.id, id)}
                      // Custom orders are handed out by the Head of Design (or an admin).
                      readOnly={selectedOrder.trackstarOrderType === 'custom' && !can('orders.assign_custom')}
                      readOnlyReason="Custom orders are assigned by the Head of Design"
                    />
                  </span>
                )}
              </div>
              <div className="hidden md:flex items-center gap-1">
                {/* S/D navigation — only shown when the open order is in the
                    current visible queue (filteredOrders). Buttons reflect
                    the keyboard shortcuts so the affordance is discoverable. */}
                {currentOrderIndex >= 0 && (
                  <>
                    <button
                      onClick={() => navigateOrder('prev')}
                      disabled={currentOrderIndex <= 0}
                      title="Previous order (press S)"
                      className="inline-flex items-center gap-1.5 px-1.5 py-1 text-off-black/60 hover:text-off-black hover:bg-off-black/5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      <kbd className="font-mono text-[10px] font-semibold w-5 h-5 inline-flex items-center justify-center bg-white border border-off-black/20 rounded shadow-[0_1px_0_0_rgba(0,0,0,0.15)] leading-none text-off-black/70">S</kbd>
                    </button>
                    <button
                      onClick={() => navigateOrder('next')}
                      disabled={currentOrderIndex >= navTotal - 1}
                      title="Next order (press D)"
                      className="inline-flex items-center gap-1.5 px-1.5 py-1 text-off-black/60 hover:text-off-black hover:bg-off-black/5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <kbd className="font-mono text-[10px] font-semibold w-5 h-5 inline-flex items-center justify-center bg-white border border-off-black/20 rounded shadow-[0_1px_0_0_rgba(0,0,0,0.15)] leading-none text-off-black/70">D</kbd>
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] text-off-black/40 px-1.5 tabular-nums">
                      {currentOrderIndex + 1} / {navTotal}
                    </span>
                  </>
                )}
                {!inlineDetail && (
                  <button
                    onClick={closeModal}
                    className="text-off-black/40 hover:text-off-black text-2xl leading-none transition-colors px-1"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-5">

              {/* ========== CUSTOM / RACE PARTNER DETAIL VIEW ========== */}
              {(selectedOrder.trackstarOrderType === 'custom' || selectedOrder.trackstarOrderType === 'race_partner') ? (
                <>
                  {/* === DESKTOP FULL DETAIL VIEW (Custom) === */}
                  {(() => {
                    // Stage-based collapse logic
                    const ds = selectedOrder.designStatus as DesignStatus
                    const isProductionStage = ['final_pdf_uploaded', 'sent_to_production'].includes(ds)


                    return (
                  <div className="space-y-4">
                  {/* On the phone, lead with the work: the proofs, big. Everything
                      else waits behind Details (customDetailsOpen). */}
                  {selectedOrder.trackstarOrderType === 'custom' && (
                    <div className="md:hidden space-y-3">
                      <ProofShowcase orderId={selectedOrder.id} />
                      <div className="flex items-center justify-end gap-2">
                        <button type="button" onClick={() => setCustomDetailsOpen(v => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-[#4600D6]">
                          {customDetailsOpen ? 'Hide details' : 'Details'} <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${customDetailsOpen ? 'rotate-180' : ''}`} />
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Same shape as a standard order: the work on the left, and a
                      sidebar with the status, what is being made, its tags, the
                      design details and the smaller actions. */}
                  <div className={`flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-6 md:items-start ${selectedOrder.trackstarOrderType === 'custom' && !customDetailsOpen ? 'hidden md:grid' : ''}`}>
                  <aside className="order-2 md:order-none md:col-start-2 md:row-start-1 md:sticky md:top-0 space-y-4 mt-6 md:mt-0">
                  {/* What is being made. No Shopify or Artelo links on a custom order: the designers work from the proofs, not the shop. */}
                  <div className="bg-subtle-gray border border-border-gray rounded-md p-3">
                    <div className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-0.5">{selectedOrder.trackstarOrderType === 'race_partner' ? 'Partner Order' : 'Order Details'}</div>
                    <h3 className="text-lg font-bold text-off-black leading-tight min-w-0">
                      {selectedOrder.effectiveRaceName || selectedOrder.raceName || 'Custom'}{' '}
                      {(selectedOrder.effectiveRaceYear || selectedOrder.raceYear) && (
                        <span className="inline-flex items-center px-2 py-0.5 border rounded text-xs font-semibold align-middle whitespace-nowrap bg-white border-border-gray text-off-black">
                          {selectedOrder.effectiveRaceYear || selectedOrder.raceYear}
                        </span>
                      )}
                    </h3>
                    {(selectedOrder.effectiveRunnerName || selectedOrder.runnerName) && selectedOrder.trackstarOrderType === 'custom' && (
                      <div className="text-sm text-off-black/65 mt-0.5">{selectedOrder.effectiveRunnerName || selectedOrder.runnerName}</div>
                    )}
                    {/* The artboard size is what the designer builds to. */}
                    {(selectedOrder.productSize || selectedOrder.photoPath) && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {selectedOrder.productSize && (
                          <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black" title="Artboard size">{selectedOrder.productSize}</span>
                        )}
                        {selectedOrder.photoPath && (
                          <span className="inline-flex items-center px-2 py-1 rounded border text-xs font-semibold bg-[#4600D6]/10 text-[#4600D6] border-[#4600D6]/25">Photo on print</span>
                        )}
                      </div>
                    )}
                    {/* The file's name and where approval emails go, with what is being made. */}
                    {selectedOrder.trackstarOrderType === 'custom' && (
                      <div className="mt-3 pt-2 border-t border-border-gray space-y-1">
                        <CopyableField label="Filename" value={generateFilename(selectedOrder)} />
                        {selectedOrder.trackstarOrderType === 'custom' ? (
                          <ApprovalEmailField
                            order={selectedOrder}
                            onSaved={(email) => {
                              setSelectedOrder(prev => prev && prev.id === selectedOrder.id ? { ...prev, customerEmail: email } : prev)
                              setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, customerEmail: email } : o))
                              setToast({ message: `Approval emails now go to ${email}`, type: 'success' })
                            }}
                          />
                        ) : selectedOrder.customerEmail && (
                          <div className="flex justify-between items-center">
                            <span className="text-body-sm text-off-black/60">Email</span>
                            <span className="text-body-sm font-medium text-off-black">{selectedOrder.customerEmail}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Admins jump to the order where it lives, as on a standard order. */}
                    {isAdmin && selectedOrder.trackstarOrderType === 'custom' && (selectedOrder.shopifyAdminUrl || selectedOrder.etsyOrderUrl || selectedOrder.arteloUrl) && (
                      <div className="mt-3 pt-3 border-t border-border-gray flex gap-2">
                        {selectedOrder.shopifyAdminUrl && (
                          <a href={selectedOrder.shopifyAdminUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors" title="Open this order in Shopify">
                            <img src="/shopify-icon.png" alt="" className="w-4 h-4" /> Shopify <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                          </a>
                        )}
                        {selectedOrder.etsyOrderUrl && (
                          <a href={selectedOrder.etsyOrderUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors" title="Open this order in Etsy">
                            <span className="w-4 h-4 inline-flex items-center justify-center rounded-[3px] bg-[#F1641E] text-white text-[10px] font-bold leading-none">E</span> Etsy <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                          </a>
                        )}
                        {selectedOrder.arteloUrl && (
                          <a href={selectedOrder.arteloUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors" title="Open this order in Artelo">
                            <img src="/artelo-icon.png" alt="" className="w-4 h-4 rounded-[3px]" /> Artelo <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Due, ordered, sent and rush, as tags. */}
                  {selectedOrder.trackstarOrderType !== 'race_partner' && (
                    <div>
                      <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Tags</h4>
                      <div className="flex flex-wrap items-center gap-1.5">
                      {!isProductionStage && <span className={`inline-flex items-center gap-1 px-2.5 py-1 bg-white border rounded text-sm ${isDueDateUrgent(selectedOrder.dueDate, dueIsLive(selectedOrder)) ? 'border-red-200 text-red-600 font-medium' : 'border-border-gray text-off-black/70'}`}>
                        <span>⏳</span>
                        <span>Due {formatDueDate(selectedOrder.dueDate, dueIsLive(selectedOrder))}</span>
                      </span>}
                      {selectedOrder.orderPlacedAt && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-border-gray rounded text-sm text-off-black/60"
                          title={`Ordered on ${new Date(selectedOrder.orderPlacedAt).toLocaleString('en-US', { timeZone: TZ })}`}
                        >
                          <span>📅</span>
                          <span>Ordered {formatOrderPlacedAt(selectedOrder.orderPlacedAt)}</span>
                        </span>
                      )}
                      {/* Once sent, the dates that matter: ordered, and sent to production. */}
                      {isProductionStage && selectedOrder.completedAt && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-sm bg-emerald-50 text-emerald-700 border-emerald-200"
                          title={`Sent to production ${new Date(selectedOrder.completedAt).toLocaleString('en-US', { timeZone: TZ })}`}
                        >
                          <span>🟢</span>
                          <span>Sent {formatOrderPlacedAt(selectedOrder.completedAt)}</span>
                        </span>
                      )}
                      {selectedOrder.isRushOrder && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded border text-sm font-semibold bg-amber-50 text-amber-800 border-amber-200">⚡ Rush (4-day)</span>
                      )}
                      {/* No Shopify or Artelo links on a custom order: the designers work from the proofs, not the shop. */}
                      {/* Admin only: cut the line by hand. Defaults to 4 days
                          from purchase, like a paid rush; any date can be set. */}
                      {isAdmin && !isProductionStage && !selectedOrder.isRushOrder && rushEditing !== selectedOrder.id && (
                        <button
                          onClick={() => setRushEditing(selectedOrder.id)}
                          className="inline-flex items-center px-2.5 py-1 rounded border border-dashed border-amber-300 text-sm font-medium text-amber-800 hover:bg-amber-50"
                          title="Admin: move this order to rush so it cuts the line"
                        >
                          ⚡ Expedite this order (4d turnaround)
                        </button>
                      )}
                      {isAdmin && rushEditing === selectedOrder.id && (() => {
                        const placed = selectedOrder.orderPlacedAt || selectedOrder.createdAt
                        // 4 days from purchase, like a paid rush, but never a day
                        // already gone: an old order would land overdue at once.
                        const local = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                        const fourDays = local(new Date(Math.max(new Date(placed).getTime() + 4 * 86400000, Date.now())))
                        return (
                          <form
                            onSubmit={e => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('due') as HTMLInputElement).value; setRush(selectedOrder.id, true, v) }}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-amber-300 bg-amber-50"
                          >
                            <span className="text-xs font-medium text-amber-800">Rush, due</span>
                            <input name="due" type="date" defaultValue={fourDays} className="text-xs bg-white border border-amber-200 rounded px-1.5 py-0.5" />
                            <button type="submit" className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded px-2 py-0.5">Save</button>
                            <button type="button" onClick={() => setRushEditing(null)} className="text-xs text-amber-800/70 px-1">Cancel</button>
                          </form>
                        )
                      })()}
                      {isAdmin && selectedOrder.rushOverride && (
                        <button onClick={() => setRush(selectedOrder.id, false)} className="text-xs text-off-black/45 hover:text-red-600 underline underline-offset-2" title="Admin: back to the standard 2-week due date">
                          Remove rush
                        </button>
                      )}
                      {selectedOrder.rushUnpaid && (
                        <span
                          className="inline-flex items-center px-2.5 py-1 rounded border text-sm font-semibold bg-red-50 text-red-700 border-red-200"
                          title="Rush was asked for but not paid: either the rush charge is missing, or it was added to the order and the customer has not paid it yet. Standard 2-week turnaround until they do; it switches to rush on its own once paid."
                        >
                          Rush not paid
                        </span>
                      )}
                      </div>
                    </div>
                  )}

                  {/* Smaller things you can do to the order. */}
                  <div>
                    <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Actions</h4>
                    <div className="flex flex-col items-stretch gap-1.5">
                      {selectedOrder.trackstarOrderType === 'custom' && !isProductionStage && !showCommentBox && (
                        <button onClick={() => setShowCommentBox(true)} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2">
                          <Plus className="w-3.5 h-3.5" /> Add comment
                        </button>
                      )}
                      {/* From the proofs (ProofManager onActions): send the proof email again, and the proof Q&A with the customer. */}
                      {selectedOrder.trackstarOrderType === 'custom' && proofActions?.resend && (
                        <button onClick={proofActions.resend} disabled={proofActions.resending} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2 disabled:opacity-50">
                          {proofActions.resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Re-send proofs to customer
                        </button>
                      )}
                      {selectedOrder.trackstarOrderType === 'custom' && proofActions && !isProductionStage && (
                        <button onClick={proofActions.openMessages} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2" title="Ask the customer a question about the design; their reply comes back here">
                          <MessageSquareText className="w-3.5 h-3.5" /> Message customer
                          {proofActions.newReply
                            ? <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-100 text-purple-700 no-underline">New reply</span>
                            : proofActions.messageCount > 0 ? <span className="text-off-black/40 font-normal">({proofActions.messageCount})</span> : null}
                        </button>
                      )}
                      {selectedOrder.customerEmail && can('support') && (
                        <button onClick={() => setEmailingOrder(selectedOrder)} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2" title={`Email ${selectedOrder.customerEmail} from fast@ (opens a Support conversation)`}>
                          <Mail className="w-3.5 h-3.5" /> Email customer from Support
                        </button>
                      )}
                      {/* A customer emails a photo after ordering: it goes on the order for the designer. */}
                      {selectedOrder.trackstarOrderType === 'custom' && (isAdmin || user?.role === 'head_designer' || user?.role === 'designer') && !isProductionStage && (
                        <AddPhotoPanel
                          custom
                          replace={!!selectedOrder.photoPath}
                          key={`custom-photo-${selectedOrder.id}-${selectedOrder.photoPath ? 'r' : 'a'}`}
                          currentId={selectedOrder.id}
                          isShopify={false}
                          prints={[{ id: selectedOrder.id, label: selectedOrder.displayOrderNumber, hasPhoto: !!selectedOrder.photoPath }]}
                          onDone={() => { fetchOrders(); setToast({ message: selectedOrder.photoPath ? 'Photo replaced.' : 'Photo added. It shows at the top of the order.', type: 'success' }) }}
                        />
                      )}
                      {/* Emergency delay notice: findable, not the main action. */}
                      {selectedOrder.trackstarOrderType === 'custom' && selectedOrder.customerEmail && !isProductionStage && (
                        <button onClick={openDelayDialog} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2">
                          <Clock className="w-3.5 h-3.5" /> Notify customer of a delay
                        </button>
                      )}
                      {ds === 'sent_to_production' && (
                        <button onClick={() => updateDesignStatus(selectedOrder.orderNumber, 'not_started')} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2">
                          <RotateCcw className="w-3.5 h-3.5" /> Reopen order
                        </button>
                      )}
                      {selectedOrder.trackstarOrderType === 'custom' && showCommentBox && (
                        <div className="w-full bg-subtle-gray border border-border-gray rounded-md p-3 space-y-2">
                          <textarea
                            value={newCommentText}
                            onChange={(e) => setNewCommentText(e.target.value)}
                            onPaste={handleCommentPaste}
                            placeholder="Add a comment or paste an image..."
                            className="w-full px-3 py-2 border border-border-gray rounded-md text-body-sm focus:outline-none focus:ring-2 focus:ring-off-black/20 resize-none bg-white"
                            rows={2}
                          />
                          {commentImagePreview && (
                            <div className="relative inline-block">
                              <img src={commentImagePreview} alt="Upload preview" className="max-h-32 rounded-md border border-border-gray" />
                              <button onClick={clearCommentImage} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <label className="cursor-pointer px-3 py-1.5 text-xs border border-border-gray rounded-md hover:bg-white transition-colors text-off-black/60">
                              <ImagePlus className="w-3 h-3 inline mr-1" />
                              Image
                              <input ref={commentFileInputRef} type="file" accept="image/*" onChange={handleCommentFileSelect} className="hidden" />
                            </label>
                            <span className="text-xs text-off-black/40 flex-1">or paste</span>
                            <button onClick={() => { setShowCommentBox(false); setNewCommentText(''); clearCommentImage() }} className="px-2 py-1.5 text-xs text-off-black/50 hover:text-off-black">Cancel</button>
                            <button
                              onClick={submitComment}
                              disabled={isSubmittingComment || (!newCommentText.trim() && !commentImageFile)}
                              className="px-4 py-1.5 text-xs bg-dark-fill text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 font-medium"
                            >
                              {isSubmittingComment ? 'Adding...' : 'Add'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  </aside>

                  {/* The work: notes from the team, the step it is on, the proofs, and what the customer asked for. */}
                  <div className="order-1 md:order-none md:col-start-1 md:row-start-1 min-w-0 flex flex-col gap-4">
                  {/* What the customer gave the designer, first: what they asked for, and their photo beside it. */}
                  {selectedOrder.trackstarOrderType === 'custom' && !isProductionStage && (
                    <div className={`grid gap-3 ${selectedOrder.photoPath ? 'md:grid-cols-2' : ''}`}>
                      <div className="bg-purple-50 border border-purple-200 rounded-md p-4">
                        <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wider mb-1">Creative Direction</p>
                        <p className="text-body-sm text-purple-800 whitespace-pre-wrap">{selectedOrder.creativeDirection?.trim() || "They didn't give any - do your thing!"}</p>
                      </div>
                      {selectedOrder.photoPath && (
                        <div className="bg-[#4600D6]/5 border border-[#4600D6]/30 rounded-md p-4 flex gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-semibold text-[#4600D6] uppercase tracking-wider mb-1">Customer Photo</p>
                            <p className="text-xs text-[#4600D6]/80">For the photo window on the design.</p>
                            <button type="button" onClick={() => downloadPersonalizationPhoto(selectedOrder)} disabled={!photoUrl}
                              className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded bg-dark-fill text-white hover:opacity-90 disabled:opacity-40">
                              <Download className="w-3 h-3" /> Download
                            </button>
                          </div>
                          {photoUrl && (
                            <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0" title="Open full size">
                              <img src={photoUrl} alt="Customer photo" className="h-28 w-28 object-cover rounded border border-border-gray" />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {selectedOrder.trackstarOrderType === 'custom' && commentsCallout()}

                  {/* Delay-notice banner — shown when Dan has emailed the customer
                      warning them about a delay. The due date itself isn't changed
                      (we keep it as the original promise) - this is purely a flag. */}
                  {selectedOrder.delayNoticeSentAt && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-2">
                      <span className="text-base leading-none">⏰</span>
                      <div className="flex-1 text-xs">
                        <p className="font-medium text-amber-900">
                          Pushed due date {selectedOrder.delayNoticeDaysLate ?? '?'} day{selectedOrder.delayNoticeDaysLate === 1 ? '' : 's'} - email sent
                        </p>
                        <p className="text-amber-700/80 mt-0.5">
                          Customer notified {new Date(selectedOrder.delayNoticeSentAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ═══ STAGE-SPECIFIC PRIMARY ACTION — always at the top ═══ */}

                  {/* Customer approved: the designer uploads the custom order's final PDF here
                      (Drive + Artelo library, Slack ping to Matt); an admin attaches it in Artelo
                      and marks it complete. */}
                  {(ds === 'approved_by_customer' || ds === 'final_pdf_uploaded') && selectedOrder.trackstarOrderType === 'custom' && (
                    <CustomFinalPdf
                      orderId={selectedOrder.id}
                      displayOrderNumber={selectedOrder.displayOrderNumber || selectedOrder.orderNumber}
                      fileName={generateFilename(selectedOrder).replace(/\.pdf$/i, '')}
                      designStatus={ds}
                      arteloOrderUrl={selectedOrder.arteloUrl}
                      canAttach={isAdmin}
                      onUploaded={() => {
                        setSelectedOrder(prev => prev && prev.id === selectedOrder.id ? { ...prev, designStatus: 'final_pdf_uploaded' } : prev)
                        setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, designStatus: 'final_pdf_uploaded' } : o))
                        fetchOrders()
                      }}
                      onComplete={() => updateDesignStatus(selectedOrder.orderNumber, 'sent_to_production')}
                    />
                  )}

                  {/* Partner order approved: upload the production file + photo to Drive and notify Eli */}
                  {(ds === 'approved_by_customer' || ds === 'final_pdf_uploaded') && selectedOrder.trackstarOrderType !== 'custom' && (
                    <PostApprovalChecklist
                      orderId={selectedOrder.id}
                      orderNumber={selectedOrder.orderNumber}
                      displayOrderNumber={selectedOrder.displayOrderNumber}
                      designStatus={ds}
                      onDesignStatusChange={(s) => updateDesignStatus(selectedOrder.orderNumber, s as DesignStatus)}
                      isPartner={selectedOrder.trackstarOrderType === 'race_partner'}
                      partnerName={selectedOrder.raceName}
                    />
                  )}

                  {/* Customer Feedback Banner — when in revision */}
                  {ds === 'in_revision' && latestFeedback && (
                    <div className="bg-orange-50 border border-orange-200 rounded-md p-4">
                      <p className="text-[10px] font-semibold text-orange-600 uppercase tracking-wider mb-1">Customer Feedback</p>
                      <p className="text-body-sm text-orange-800 whitespace-pre-wrap">{latestFeedback}</p>
                    </div>
                  )}

                  {/* Awaiting Review Info */}
                  {ds === 'awaiting_review' && (() => {
                    const daysSinceSent = selectedOrder.proofSentAt
                      ? Math.floor((Date.now() - new Date(selectedOrder.proofSentAt).getTime()) / (1000 * 60 * 60 * 24))
                      : null
                    const needsFollowUp = daysSinceSent !== null && daysSinceSent >= 3
                    const daysText = daysSinceSent !== null
                      ? `${daysSinceSent} day${daysSinceSent !== 1 ? 's' : ''} ago`
                      : ''
                    return needsFollowUp ? (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🔔</span>
                          <div className="flex-1">
                            <p className="text-xs font-medium text-red-800">No response in {daysSinceSent} day{daysSinceSent !== 1 ? 's' : ''}</p>
                            <p className="text-[10px] text-red-600">Proofs were sent {daysText}.</p>
                          </div>
                        </div>
                        <button
                          onClick={() => sendFollowUp(selectedOrder.id)}
                          disabled={isSendingFollowUp}
                          className="w-full mt-2 px-3 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          {isSendingFollowUp ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Sending...</>
                          ) : (
                            <><Send className="w-3 h-3" /> Send Follow Up</>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="bg-amber-50 border border-amber-200 rounded-md p-3 flex items-center gap-2">
                        <span className="text-lg">⏳</span>
                        <div>
                          <p className="text-xs font-medium text-amber-800">Waiting for customer response</p>
                          <p className="text-[10px] text-amber-600">Proofs sent {daysText || 'today'}. You'll get a Slack notification when they respond.</p>
                        </div>
                      </div>
                    )
                  })()}

                  {/* Sent to production — done state */}
                  {ds === 'sent_to_production' && (
                    <PostApprovalChecklist
                      orderId={selectedOrder.id}
                      orderNumber={selectedOrder.orderNumber}
                      displayOrderNumber={selectedOrder.displayOrderNumber}
                      designStatus={ds}
                      onDesignStatusChange={(s) => updateDesignStatus(selectedOrder.orderNumber, s as DesignStatus)}
                      isPartner={selectedOrder.trackstarOrderType === 'race_partner'}
                      partnerName={selectedOrder.raceName}
                    />
                  )}

                  {/* Proofs & Approval: the main work until it is sent to production. */}
                  {ds !== 'sent_to_production' && (
                    <div>
                      <ProofManager
                        heading={
                          <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider">
                            Proofs &amp; Approval{selectedOrder.proofCount ? <span className="ml-1 text-off-black/30">({selectedOrder.proofCount})</span> : null}
                          </h4>
                        }
                        orderId={selectedOrder.id}
                        orderNumber={selectedOrder.orderNumber}
                        displayOrderNumber={selectedOrder.displayOrderNumber}
                        designStatus={selectedOrder.designStatus}
                        customerEmail={selectedOrder.customerEmail}
                        onDesignStatusChange={(s) => updateDesignStatus(selectedOrder.orderNumber, s as DesignStatus)}
                        onLatestFeedback={setLatestFeedback}
                        disableEmail={selectedOrder.trackstarOrderType === 'race_partner'}
                        allowGroups={selectedOrder.trackstarOrderType === 'race_partner'}
                        onActions={selectedOrder.trackstarOrderType === 'custom' ? setProofActions : undefined}
                      />
                    </div>
                  )}

                  {/* What goes on the print, to check the proofs against. */}
                  {!(isProductionStage && selectedOrder.trackstarOrderType === 'custom') && (
                    <div>
                      <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">{selectedOrder.trackstarOrderType === 'race_partner' ? 'Partner Info' : 'Design Details'}</h4>
                      <div className="bg-subtle-gray border border-border-gray rounded-md p-3 space-y-2">
                        {selectedOrder.trackstarOrderType === 'race_partner' ? (
                          <PartnerInfoFields
                            key={selectedOrder.orderNumber}
                            order={selectedOrder}
                            onToast={setToast}
                            onSaved={async () => {
                              await fetchOrders()
                              const refreshed = await apiFetch('/api/orders?type=race_partner').then(r => r.json())
                              const updated = refreshed.orders?.find((o: { orderNumber: string }) => o.orderNumber === selectedOrder.orderNumber)
                              if (updated) setSelectedOrder(prev => prev ? { ...prev, ...updated } : prev)
                            }}
                          />
                        ) : (
                          <CustomDetailsFields
                            key={selectedOrder.orderNumber}
                            order={selectedOrder}
                            onToast={setToast}
                            onSaved={async () => {
                              await fetchOrders()
                              const refreshed = await apiFetch(`/api/orders?number=${encodeURIComponent(selectedOrder.parentOrderNumber)}`).then(r => r.json())
                              const updated = refreshed.orders?.find((o: { orderNumber: string }) => o.orderNumber === selectedOrder.orderNumber)
                              if (updated) setSelectedOrder(prev => prev ? mapOrder(updated) : prev)
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}


                  {selectedOrder.trackstarOrderType !== 'custom' && photoCard}

                  {selectedOrder.notes && !isProductionStage && (
                    <div>
                      <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Notes</h4>
                      <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                        <p className="text-body-sm text-blue-800 whitespace-pre-wrap">{selectedOrder.notes}</p>
                      </div>
                    </div>
                  )}

                  {/* A partner order keeps its comment thread here; a custom order's notes are at the top. */}
                  {selectedOrder.trackstarOrderType === 'race_partner' && !isProductionStage && (
                    <CollapsibleSection
                      title="Comments"
                      defaultOpen={false}
                      badge={orderComments.length > 0 ? <span className="text-[10px] font-medium text-off-black/30">({orderComments.length})</span> : undefined}
                    >
                      <div className="bg-subtle-gray border border-border-gray rounded-md p-3 space-y-2 mb-3">
                        <textarea
                          value={newCommentText}
                          onChange={(e) => setNewCommentText(e.target.value)}
                          onPaste={handleCommentPaste}
                          placeholder="Add a comment or paste an image..."
                          className="w-full px-3 py-2 border border-border-gray rounded-md text-body-sm focus:outline-none focus:ring-2 focus:ring-off-black/20 resize-none bg-white"
                          rows={2}
                        />
                        {commentImagePreview && (
                          <div className="relative inline-block">
                            <img src={commentImagePreview} alt="Upload preview" className="max-h-32 rounded-md border border-border-gray" />
                            <button
                              onClick={clearCommentImage}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer px-3 py-1.5 text-xs border border-border-gray rounded-md hover:bg-white transition-colors text-off-black/60">
                            <ImagePlus className="w-3 h-3 inline mr-1" />
                            Image
                            <input ref={commentFileInputRef} type="file" accept="image/*" onChange={handleCommentFileSelect} className="hidden" />
                          </label>
                          <span className="text-xs text-off-black/40 flex-1">or paste</span>
                          <button
                            onClick={submitComment}
                            disabled={isSubmittingComment || (!newCommentText.trim() && !commentImageFile)}
                            className="px-4 py-1.5 text-xs bg-dark-fill text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 font-medium"
                          >
                            {isSubmittingComment ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      </div>
                      {isLoadingComments ? (
                        <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin inline text-off-black/40" /></div>
                      ) : orderComments.length === 0 ? (
                        <p className="text-xs text-off-black/40 text-center py-3">No comments yet</p>
                      ) : (
                        <div className="space-y-3 max-h-64 overflow-y-auto">
                          {orderComments.map(comment => (
                            <div key={comment.id} className="bg-white border border-border-gray rounded-md p-3 group">
                              {comment.imageUrl && (
                                <a href={comment.imageUrl} target="_blank" rel="noopener noreferrer">
                                  <img src={comment.imageUrl} alt="Attachment" className="max-h-48 rounded-md mb-2 border border-border-gray hover:opacity-90 cursor-pointer" />
                                </a>
                              )}
                              {comment.text && <p className="text-body-sm text-off-black whitespace-pre-wrap"><Linkify text={comment.text} /></p>}
                              <div className="flex items-center justify-between mt-2">
                                <span className="text-xs text-off-black/40">
                                  {comment.authorName ? `${comment.authorName} · ` : ''}
                            {new Date(comment.createdAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </span>
                                <button
                                  onClick={() => deleteComment(comment.id)}
                                  className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CollapsibleSection>
                  )}

                  <OrderConversations orderId={selectedOrder.id} enabled={!!selectedOrder.customerEmail && can('support')} />
                  </div>
                  </div>
                  </div>
                    )
                  })()}{/* end custom detail */}
                </>
              ) : (
                <>
              {/* ========== STANDARD ORDER DETAIL VIEW ========== */}

              {/* Order view: the print and the runner's details take the main
                  column, sized so the print can be checked against what the
                  customer entered. The sidebar holds the product, its links,
                  every tag, and the order's smaller actions. */}
              <div className="flex flex-col md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-6 md:items-start">
              <aside className="order-2 md:order-none md:col-start-2 md:row-start-1 md:sticky md:top-0 space-y-4 mt-6 md:mt-0">
              {/* Product details. The thumbnail is keyed off the stable
                  Shopify product_id so Eli can tell near-identical designs
                  apart at a glance (Chicago World Majors vs Chicago Race).
                  The ID drives the lookup but is not worth showing.
                  The card is what gets printed (race, year, size, frame) and
                  the links out; the photo, order date and discount are tags. */}
              <div className="bg-subtle-gray border border-border-gray rounded-md p-3">
                <div className="flex items-start gap-3">
                  {selectedOrder.productInfo?.heroImageUrl ? (
                    <a
                      href={selectedOrder.productInfo.heroImageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 block w-20 h-20 rounded border border-border-gray overflow-hidden bg-white hover:opacity-90 transition-opacity"
                      title="Click to view full size"
                    >
                      <img src={selectedOrder.productInfo.heroImageUrl} alt={selectedOrder.productInfo.label || 'Product'} className="w-full h-full object-cover" />
                    </a>
                  ) : (
                    <div className="flex-shrink-0 w-20 h-20 rounded border border-border-gray bg-white flex items-center justify-center text-2xl text-off-black/30">
                      📄
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <div className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider">Order Details</div>
                    </div>
                    {/* Race leads as the headline, year rides inline after its last word. */}
                    <h3 className="text-lg font-bold text-off-black leading-tight min-w-0">
                      {selectedOrder.effectiveRaceName || selectedOrder.raceName || 'Unknown Race'}{' '}
                      {yearDraft != null ? (
                        <span className="inline-flex items-center gap-1 align-middle">
                          <input
                            autoFocus
                            type="number"
                            inputMode="numeric"
                            value={yearDraft}
                            onChange={e => setYearDraft(e.target.value.slice(0, 4))}
                            onKeyDown={e => { if (e.key === 'Enter') saveYear(); if (e.key === 'Escape') setYearDraft(null) }}
                            disabled={savingYear}
                            className="w-[4.5rem] px-1.5 py-0.5 border border-off-black/30 rounded text-xs font-semibold bg-white focus:outline-none focus:ring-2 focus:ring-off-black/10"
                            aria-label="Race year"
                          />
                          <button onClick={saveYear} disabled={savingYear} title="Save the year and research again" className="p-1 rounded text-green-700 hover:bg-green-50 disabled:opacity-50">
                            {savingYear ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button onClick={() => setYearDraft(null)} disabled={savingYear} title="Cancel" className="p-1 rounded text-off-black/45 hover:bg-off-black/5"><X className="w-3.5 h-3.5" /></button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setYearDraft(String(selectedOrder.effectiveRaceYear || selectedOrder.raceYear || new Date().getFullYear()))}
                          disabled={selectedOrder.status === 'completed'}
                          title={selectedOrder.status === 'completed' ? 'Completed orders keep their year' : 'Change the race year. The old year\'s results are cleared and research runs again.'}
                          className={`group inline-flex items-center gap-1 px-2 py-0.5 border rounded text-xs font-semibold align-middle whitespace-nowrap transition-colors disabled:cursor-default ${
                            (selectedOrder.effectiveRaceYear || selectedOrder.raceYear)
                              ? 'bg-white border-border-gray text-off-black enabled:hover:border-off-black/40'
                              : 'bg-amber-50 border-amber-200 text-warning-amber enabled:hover:border-amber-400'
                          }`}
                        >
                          {selectedOrder.effectiveRaceYear || selectedOrder.raceYear || 'Set year'}
                          {selectedOrder.status !== 'completed' && <Pencil className="w-3 h-3 opacity-40 group-hover:opacity-80" />}
                        </button>
                      )}
                    </h3>
                    {/* A Shopify product the catalog does not know yet. */}
                    {selectedOrder.productInfo?.catalogRequired && !selectedOrder.productInfo.inCatalog && (
                      <span
                        className="inline-block mt-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[10px] font-medium"
                        title="This Shopify product isn't in server/lib/productCatalog.js. Add it to lock in the design variant and hero image."
                      >
                        not in catalog
                      </span>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="inline-flex items-center px-2 py-1 bg-white border border-border-gray rounded text-xs font-semibold text-off-black">
                        {selectedOrder.productSize}
                      </span>
                      {/* The frame, so the design goes on the right item in Artelo when
                          one order has the same print in two frames. */}
                      {selectedOrder.frameType && (() => {
                        const f = selectedOrder.frameType.replace(/Premium/i, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()
                        const black = /black/i.test(f), natural = /natural|oak/i.test(f) && !black
                        const chip = `inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-semibold ${black ? 'bg-off-black text-white border-off-black' : natural ? 'bg-[#e9d9bd] text-[#5c4425] border-[#d6c09a]' : 'bg-white text-off-black/70 border-border-gray'}`
                        const label = /unframed/i.test(f) ? 'Unframed' : f
                        if (!canChangeFrame) return <span className={chip}>{label}</span>
                        return (
                          <span className="relative inline-flex">
                            <button onClick={() => { void openFrameMenu() }} disabled={frameBusy} title="Change the frame: edits the Shopify order, and Artelo follows" className={`group ${chip} disabled:opacity-60`}>
                              {label}
                              {frameBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pencil className="w-3 h-3 opacity-50 group-hover:opacity-90" />}
                            </button>
                            {frameMenu && (
                              <div className="absolute left-0 top-full mt-1 z-20 min-w-[11rem] bg-white border border-border-gray rounded-md shadow-lg p-1">
                                <div className="px-2 py-1 text-[10px] font-semibold text-off-black/40 uppercase tracking-wider">Change frame to</div>
                                {frameMenu.frames.map(o => (
                                  <button key={o.frame} onClick={() => { void changeFrameTo(o) }} disabled={frameBusy} className="w-full flex items-center justify-between gap-3 px-2 py-1.5 rounded text-sm text-off-black hover:bg-off-black/5 disabled:opacity-50">
                                    {o.frame}
                                    {o.difference !== 0 && <span className="text-xs text-off-black/45">{o.difference > 0 ? '+' : '−'}${Math.abs(o.difference).toFixed(0)}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                          </span>
                        )
                      })()}
                    </div>
                  </div>
                </div>
                {(selectedOrder.shopifyAdminUrl || selectedOrder.etsyOrderUrl || selectedOrder.arteloUrl || selectedOrder.resultsUrl) && (
                  <div className="mt-3 pt-3 border-t border-border-gray">
                    <div className="flex gap-2">
                      {selectedOrder.shopifyAdminUrl && (
                        <a href={selectedOrder.shopifyAdminUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors" title="Open this order in Shopify">
                          <img src="/shopify-icon.png" alt="" className="w-4 h-4" /> Shopify <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                        </a>
                      )}
                      {selectedOrder.etsyOrderUrl && (
                        <a href={selectedOrder.etsyOrderUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors" title="Open this order in Etsy">
                          <span className="w-4 h-4 inline-flex items-center justify-center rounded-[3px] bg-[#F1641E] text-white text-[10px] font-bold leading-none">E</span> Etsy <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                        </a>
                      )}
                      {selectedOrder.arteloUrl && (
                        <a href={selectedOrder.arteloUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors" title="Open this order in Artelo">
                          <img src="/artelo-icon.png" alt="" className="w-4 h-4 rounded-[3px]" /> Artelo <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                        </a>
                      )}
                      {selectedOrder.resultsUrl && (
                        <a href={selectedOrder.resultsUrl} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-2 py-2 rounded-md border border-border-gray bg-white text-sm font-medium text-off-black hover:border-off-black/30 transition-colors" title="The runner's result on the timing site">
                          <span className="text-sm leading-none">🏁</span> Results <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Printed yet, shipped, delivered: checkable after the order is complete. */}
              {(selectedOrder.arteloUrl || selectedOrder.shopifyAdminUrl) && <OrderProduction orderId={selectedOrder.id} />}

              {/* Every tag for the order, in one place: the photo add-on, when it
                  was ordered (orange from 3 days, red after 5, like the table),
                  and any discount code (one per code; an order can carry a
                  product and a shipping discount at once). */}
              <div>
                <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Tags</h4>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Where the runner's numbers came from sits on the Runner card instead. */}
                  <OrderTags order={selectedOrder} size="md" className="contents" exclude={['trust']} />
                  {selectedOrder.orderPlacedAt && (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 border rounded text-xs ${(() => {
                        // Same colors as the table: orange from 3 days workable, red after 5.
                        const age = orderAge(selectedOrder)
                        return age.days > 5 ? 'bg-red-50 border-red-200 text-red-700 font-medium' : age.days >= 3 ? 'bg-orange-50 border-orange-200 text-orange-700 font-medium' : 'bg-white border-border-gray text-off-black/60'
                      })()}`}
                      title={`Ordered on ${new Date(selectedOrder.orderPlacedAt).toLocaleString('en-US', { timeZone: TZ })}`}
                    >
                      <span>📅</span>
                      <span>Ordered {formatOrderPlacedAt(selectedOrder.orderPlacedAt)}</span>
                    </span>
                  )}
                  {(selectedOrder.discountCodes || []).map((d) => (
                    <span
                      key={d.code}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium bg-yellow-50 text-yellow-900/70 border-yellow-200"
                      title={
                        d.amount
                          ? `${d.code} - ${d.type === 'percentage' ? 'percentage' : d.type === 'shipping' ? 'shipping' : 'fixed amount'} discount, $${d.amount} off`
                          : d.code
                      }
                    >
                      Discount: {d.code}
                    </span>
                  ))}
                </div>
              </div>

              {/* What the print was made from and what its PDF measured, as tags. */}
              <DesignDetailsTags d={design} />

              {/* The filename is for a print made by hand; a rendered one is named by the tool. */}
              {design.job?.status === 'done' ? (
                <DesignFileLinks d={design} />
              ) : (
                <div>
                  <div className="bg-subtle-gray border border-border-gray rounded-md px-3 py-1">
                    <CopyableField label="Filename" value={generateFilename(selectedOrder)} />
                  </div>
                  <DesignFileLinks d={design} />
                </div>
              )}

              {/* Smaller things you can do to an order. More will land here. */}
              {selectedOrder.trackstarOrderType === 'standard' && (
                <div>
                  <h4 className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Actions</h4>
                  <div className="flex flex-col items-stretch gap-1.5">
                    {!showCommentBox && (
                      <button onClick={() => setShowCommentBox(true)} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2">
                        <Plus className="w-3.5 h-3.5" /> Add comment
                      </button>
                    )}
                    {/* Run the lookup again after the name or year was corrected,
                        a missing year was configured, or the timing site was down. */}
                    {selectedOrder.hasScraperAvailable && (selectedOrder.effectiveRaceYear || selectedOrder.raceYear) && selectedOrder.status !== 'completed' && !isEditing && (
                      <button onClick={() => researchOrder(selectedOrder.orderNumber)} disabled={isResearching} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2 disabled:opacity-50">
                        {isResearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                        {isResearching ? 'Researching…' : selectedOrder.researchStatus === 'found' ? 'Re-run research' : 'Research runner'}
                      </button>
                    )}
                    {/* The customer asked for the print without their photo. */}
                    {selectedOrder.photoPath && design.canManage && selectedOrder.status !== 'completed' && !isEditing && (
                      <button onClick={async () => {
                          if (!confirm('Remove the customer photo from this print and render the design again without it? If they paid for the Photo Add-On, refund it in Shopify.')) return
                          try {
                            const res = await apiFetch('/api/orders/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', orderId: selectedOrder.id }) })
                            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not remove the photo')
                            setSelectedOrder(prev => prev && prev.id === selectedOrder.id ? { ...prev, photoPath: null, photoAddedManually: false, photoUnpaid: false, photoPlacedAt: null } : prev)
                            setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, photoPath: null, photoAddedManually: false, photoUnpaid: false, photoPlacedAt: null } : o))
                            await design.create()
                            setToast({ message: 'Photo removed. Re-rendering the design without it.', type: 'success' })
                          } catch (e) { setToast({ message: e instanceof Error ? e.message : 'Could not remove the photo', type: 'error' }) }
                        }}
                        className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2">
                        <X className="w-3.5 h-3.5" /> Remove photo &amp; re-render
                      </button>
                    )}
                    {/* A runner who ran a race we do not carry: design it as a custom print instead of refunding. */}
                    {design.canManage && selectedOrder.status !== 'completed' && !isEditing && (
                      <button onClick={() => setConverting(true)} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2" title="The runner ran a race we do not carry: make this print a custom design. Shopify is not changed.">
                        <Shuffle className="w-3.5 h-3.5" /> Convert to custom order
                      </button>
                    )}
                    {selectedOrder.customerEmail && can('support') && !isEditing && (
                      <button onClick={() => setEmailingOrder(selectedOrder)} className="self-start inline-flex items-center gap-1.5 text-xs font-medium text-[#4600D6] hover:underline underline-offset-2" title={`Email ${selectedOrder.customerEmail} from fast@ (opens a Support conversation)`}>
                        <Mail className="w-3.5 h-3.5" /> Email customer
                      </button>
                    )}
                {showCommentBox && (
                <div className="w-full bg-subtle-gray border border-border-gray rounded-md p-3 space-y-2">
                  <textarea
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    onPaste={handleCommentPaste}
                    placeholder="Add a comment or paste an image..."
                    className="w-full px-3 py-2 border border-border-gray rounded-md text-body-sm focus:outline-none focus:ring-2 focus:ring-off-black/20 resize-none bg-white"
                    rows={2}
                  />
                  {commentImagePreview && (
                    <div className="relative inline-block">
                      <img src={commentImagePreview} alt="Upload preview" className="max-h-32 rounded-md border border-border-gray" />
                      <button
                        onClick={clearCommentImage}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <label className="cursor-pointer px-3 py-1.5 text-xs border border-border-gray rounded-md hover:bg-white transition-colors text-off-black/60">
                      <ImagePlus className="w-3 h-3 inline mr-1" />
                      Image
                      <input ref={commentFileInputRef} type="file" accept="image/*" onChange={handleCommentFileSelect} className="hidden" />
                    </label>
                    <span className="text-xs text-off-black/40 flex-1">or paste</span>
                    <button onClick={() => { setShowCommentBox(false); setNewCommentText(''); clearCommentImage() }} className="px-2 py-1.5 text-xs text-off-black/50 hover:text-off-black">Cancel</button>
                    <button
                      onClick={submitComment}
                      disabled={isSubmittingComment || (!newCommentText.trim() && !commentImageFile)}
                      className="px-4 py-1.5 text-xs bg-dark-fill text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-40 font-medium"
                    >
                      {isSubmittingComment ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>
                )}
                    {!isAdmin ? null : selectedOrder.photoPath ? (
                      <AddPhotoPanel
                        replace
                        key={`replace-${selectedOrder.id}`}
                        currentId={selectedOrder.id}
                        isShopify={selectedOrder.source === 'shopify'}
                        prints={[]}
                        onDone={() => { fetchOrders(); setToast({ message: 'Photo replaced. Place it on the artwork again.', type: 'success' }) }}
                      />
                    ) : (
                      <AddPhotoPanel
                        key={selectedOrder.id}
                        currentId={selectedOrder.id}
                        isShopify={selectedOrder.source === 'shopify'}
                        prints={orders
                          .filter(o => o.parentOrderNumber === selectedOrder.parentOrderNumber && o.trackstarOrderType === 'standard')
                          .sort((a, b) => a.lineItemIndex - b.lineItemIndex)
                          .map(o => ({ id: o.id, label: `${o.displayOrderNumber}${getOrderItemCount(o.parentOrderNumber) > 1 ? ` item ${getOrderItemPosition(o)}` : ''}: ${o.effectiveRunnerName || o.runnerName || 'runner'}`, hasPhoto: !!o.photoPath }))}
                        onDone={({ charged, chargeError }) => {
                          fetchOrders()
                          setToast(chargeError
                            ? { message: chargeError, type: 'error' }
                            : { message: charged ? 'Photo added. Shopify is emailing the customer to pay for it.' : 'Photo added.', type: 'success' })
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
              {/* The customer's Support conversations that are still going, linked over. */}
              </aside>

              <div className="order-1 md:order-none md:col-start-1 md:row-start-1 min-w-0 flex flex-col gap-4">
              {/* A comment on a standard order is somebody flagging
                  something about this print, usually a spelling the
                  results site got wrong. It used to sit under the fold
                  past the filename, which is too late to read. */}
              {commentsCallout()}

              {/* Expedited shipping steps. The tag says it is expedited; this
                  block is the instructions. Artelo's API only sends Standard,
                  so the sender skips these (arteloSend.js) and a person picks
                  the label in Artelo, under $40 (what the customer pays). */}
              {selectedOrder.isExpedited && (
                <div className="bg-red-50 border-2 border-red-300 rounded-md p-4 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">🚀</span>
                    <span className="text-sm font-bold text-red-800 uppercase tracking-wide">Get this out the door fast</span>
                  </div>
                  <div className="text-xs text-red-900/90 leading-relaxed space-y-1.5">
                    <p>The customer paid for <strong>{selectedOrder.shippingMethod || 'expedited'}</strong> shipping.</p>
                    <ol className="list-decimal list-inside space-y-1 pl-1">
                      <li>Double-check that all personalization fields are filled in correctly.</li>
                      <li>Approve the design right away. No need to wait for Matt. The tool does not send expedited orders on its own: Artelo only sends Standard shipping from here.</li>
                      <li>
                        <strong>Manually attach and add expedited shipping to this order</strong> in Artelo: attach the print, then under <strong>Shipping</strong> click <strong>Change shipping method</strong> and pick <strong>UPS Next Day Air Saver</strong>, as long as it is <strong>under $40</strong> (what the customer paid).
                        If it is $40 or more, pick the fastest option under $40, and tell Matt if there is none.
                      </li>
                      <li>Send it to production in Artelo, then mark it complete here.</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* Creator-sample banner — shows for creator-program free samples.
                  Visible at the top of both mobile and desktop views since this
                  is the most important thing Elí needs to see before fulfilling. */}
              {selectedOrder.source === 'creator_sample' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 mb-3">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                      🎁 Creator
                    </span>
                    <span className="text-xs text-emerald-800 font-medium">Free sample for the Creator Program - do not charge.</span>
                    {isAdmin && selectedOrder.status !== 'completed' && (
                      <button
                        onClick={() => cancelCreatorSample(selectedOrder)}
                        className="ml-auto text-xs font-medium text-red-600/80 hover:text-red-700 underline underline-offset-2"
                        title="Admin: remove this sample from the queue; the creator goes back to pending"
                      >
                        Cancel sample
                      </button>
                    )}
                  </div>
                  {/* Print — surface frame type alongside size since creator
                      samples are manual orders. For regular orders Artelo
                      already has the frame baked in; for these, Elí needs
                      to pick it himself when creating the manual order. */}
                  <div className="mb-3">
                    <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-1.5">Print</div>
                    <div className="bg-white border border-emerald-200 rounded p-2.5 text-sm text-off-black/80 flex flex-wrap gap-x-4 gap-y-1">
                      <span><span className="text-off-black/50">Size:</span> <span className="font-medium">{selectedOrder.productSize || '-'}</span></span>
                      <span><span className="text-off-black/50">Frame:</span> <span className="font-medium">{selectedOrder.frameType || '-'}</span></span>
                    </div>
                  </div>
                  {selectedOrder.creatorShipping && (
                    <div>
                      <div className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider mb-1.5">Shipping Address</div>
                      <div className="bg-white border border-emerald-200 rounded p-2.5 text-sm text-off-black/80 leading-relaxed">
                        {selectedOrder.creatorShipping.name && <div className="font-medium">{selectedOrder.creatorShipping.name}</div>}
                        {selectedOrder.creatorShipping.address1 && <div>{selectedOrder.creatorShipping.address1}</div>}
                        {selectedOrder.creatorShipping.address2 && <div>{selectedOrder.creatorShipping.address2}</div>}
                        <div>
                          {[selectedOrder.creatorShipping.city, selectedOrder.creatorShipping.state, selectedOrder.creatorShipping.zip].filter(Boolean).join(', ')}
                        </div>
                        {selectedOrder.creatorShipping.country && selectedOrder.creatorShipping.country !== 'US' && (
                          <div>{selectedOrder.creatorShipping.country}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── ACTION ZONE ─────────────────────────────────────────
                  Anything that needs a decision, or gives context Eli has
                  to act on, lives here directly under the tags. Ordered by
                  urgency. The bottom of the modal is reference data only. */}
              <div className="space-y-3 empty:!hidden">
                {photoError && (
                  <p className="text-[11px] text-red-600">Photo: {photoError}</p>
                )}
                {selectedOrder.photoUnpaid && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <span className="font-semibold">Photo not paid.</span> It was added after the order and the customer has not paid the Photo Add-On yet. Hold this print until the Shopify order reads paid; it updates on its own within about 10 minutes of payment.
                    {isAdmin && (
                      <button onClick={() => markPhotoFree(selectedOrder.id)} className="ml-2 text-xs font-semibold underline underline-offset-2 text-red-800">Photo is free (don't charge)</button>
                    )}
                    {isAdmin && selectedOrder.photoAddedManually && (
                      <button onClick={() => removeManualPhoto(selectedOrder.id)} className="ml-2 text-xs underline underline-offset-2 text-red-700/80">Remove photo</button>
                    )}
                  </div>
                )}
                {!design.reserved && photoCard}
                {/* Customer's own numbers. Loud, because the whole point is
                    that nobody goes looking for a "better" answer: we
                    deliberately skip the scrape for these orders, so
                    anything on screen came from the shopper and is the
                    only version that is correct. */}
                {selectedOrder.researchSource === 'customer_supplied' && (
                  <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                    <h4 className="text-xs font-semibold text-blue-700 uppercase tracking-tight mb-1.5">
                      Customer hand entered this data
                    </h4>
                    <p className="text-body-sm text-blue-900">
                      Please use exactly what they entered. These numbers came
                      from the shopper at checkout, not from the timing site,
                      so do not research this order or correct the spelling.
                      If something looks wrong, ask them rather than changing it.
                    </p>
                  </div>
                )}

                {/* Research Status. Candidates from a search again show even
                    when the saved result was kept, or there is no way to accept one. */}
                {selectedOrder.researchStatus && (selectedOrder.researchStatus !== 'found' || possibleMatchesMap[selectedOrder.orderNumber]?.length > 0) && (
                  <div>
                    {(() => {
                      const status = selectedOrder.researchStatus === 'found' ? 'ambiguous' : selectedOrder.researchStatus
                      // Different visual treatment per status:
                      //   - no_scraper / year_not_configured = red (config gap, blocks fulfillment, dev needed)
                      //   - upstream_error / not_found / ambiguous = amber (transient or resolvable via manual verification)
                      const isConfigGap = (status === 'no_scraper' || status === 'year_not_configured') && !raceNotRunYet(selectedOrder)
                    // A future race is not a problem, just a wait, so it
                    // reads calm rather than amber.
                    const notRun = showsRaceNotRun(selectedOrder)
                    const boxClasses = notRun
                      ? 'bg-blue-50 border border-blue-200 rounded-md px-3 py-2'
                      : isConfigGap
                        ? 'bg-red-50 border border-red-200 rounded-md px-3 py-2'
                        : 'bg-amber-50 border border-amber-200 rounded-md px-3 py-2'
                    const textPrimary = notRun ? 'text-blue-900' : isConfigGap ? 'text-red-800' : 'text-amber-800'
                    const headingColor = notRun ? 'text-blue-800' : isConfigGap ? 'text-red-700' : 'text-amber-700'

                    const heading = notRun
                      ? 'Race has not happened yet'
                      : status === 'no_scraper'
                        ? 'No scraper for this race'
                      : status === 'year_not_configured'
                        ? 'Year not configured'
                      : status === 'upstream_error'
                        ? 'Timing site is down'
                      : status === 'time_unavailable'
                        ? 'Runner matched, time missing'
                      : status === 'not_found'
                        ? (possibleMatchesMap[selectedOrder.orderNumber]?.length
                            ? 'Runner not found - similar names below'
                            : 'Runner not found')
                      : status === 'ambiguous'
                        ? 'More than one match'
                      : null

                    // The tag at the top already says WHAT happened, so this
                    // block only says what to DO about it. One sentence, once.
                    // Raw scraper notes stay on the tooltip for debugging.
                    const raceLabel = `${selectedOrder.effectiveRaceName || selectedOrder.raceName} ${selectedOrder.effectiveRaceYear || selectedOrder.raceYear}`
                    const fix = notRun
                      ? `${raceLabel} has not been run yet, so there are no results to find. Come back after race day.`
                      : status === 'no_scraper'
                        ? `We have no scraper for "${selectedOrder.effectiveRaceName || selectedOrder.raceName}". A developer needs to add one, or alias this race onto an existing scraper. Research it by hand in the meantime.`
                      : status === 'year_not_configured'
                        ? `The scraper works but ${raceLabel} is not wired up yet. A developer needs to add this year's event IDs. Research it by hand in the meantime.`
                      : status === 'upstream_error'
                        ? 'The timing site is slow or down right now. Nothing is wrong with this order. Retry the lookup in a couple of minutes.'
                      : status === 'time_unavailable'
                        // The identity is settled - this is a copy job, not
                        // a search. Say so, or the operator re-researches
                        // an order that will never come back any better.
                        ? `We matched ${selectedOrder.runnerName} in the ${raceLabel} results and the bib above is confirmed, but the timing site blocks the page that holds the finish time. Open their result page below and enter the time by hand. Researching again will not help.`
                      : status === 'not_found'
                        ? (possibleMatchesMap[selectedOrder.orderNumber]?.length
                            // Suggestions, not matches. The list below shares
                            // a surname with the customer and nothing else, so
                            // the ask is "confirm", never "choose".
                            ? `We could not find ${selectedOrder.runnerName} in these results. The runners below have a similar name - only accept one if you can confirm on the results site that it is the same person. Otherwise look it up by hand.`
                            : 'Check the runner name and year are right, then research again. If it still comes up empty, look it up by hand.')
                      : status === 'ambiguous'
                        // Ask for a confirmation, never a bare choice. Even
                        // in real same-name ambiguity, guessing puts a
                        // stranger's finish time on a customer's poster -
                        // and every record written before this was fixed is
                        // stored as 'ambiguous' whether or not anyone
                        // actually matched, so this copy has to be safe for
                        // both. The bib is what separates two people.
                        ? (possibleMatchesMap[selectedOrder.orderNumber]?.length
                            // Only promise the bib when we actually have
                            // one. Records written before the search-row
                            // parser captured bibs have none, and pointing
                            // at a column that is not there is worse than
                            // saying nothing.
                            ? `More than one finisher has a name close to ${selectedOrder.runnerName}. Confirm on the results site which one is the customer before accepting${possibleMatchesMap[selectedOrder.orderNumber].some(m => m.bib) ? ' - the bib is the reliable way to tell them apart' : ''}.`
                            : 'Several runners share this name. Look them up on the results site to confirm which one is right.')
                      : null
                    if (!fix) return null

                    return (
                      <div className={boxClasses} title={selectedOrder.researchNotes || undefined}>
                        <p className={`text-[13px] leading-snug ${textPrimary}`}>
                          {heading && <span className={`font-semibold ${headingColor} mr-1.5`}>{heading}.</span>}
                          {fix}
                        </p>
                        {/* The runner's own result page, straight from the
                            timing site's search listing. We cannot read it -
                            that is the whole reason this box exists - but a
                            person in a normal browser can, and this saves
                            them searching the field for a name we already
                            matched. Deliberately here rather than only in
                            the Details header, because this is where the
                            instruction to copy the time is. */}
                        {status === 'time_unavailable' && selectedOrder.resultsUrl && (
                          <a
                            href={selectedOrder.resultsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 mt-2.5 px-3 py-1.5 bg-white border border-amber-300 rounded-md text-xs font-medium text-amber-900 hover:bg-amber-50 transition-colors"
                          >
                            Open {selectedOrder.bibNumber ? `bib ${selectedOrder.bibNumber}` : 'this runner'} on the results site ↗
                          </a>
                        )}
                      </div>
                    )
                  })()}

                    {/* Suggested matches with Accept buttons */}
                    {possibleMatchesMap[selectedOrder.orderNumber]?.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {possibleMatchesMap[selectedOrder.orderNumber].map((match, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-white border border-amber-200 rounded-md p-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-body-sm font-medium text-off-black">{match.name}</p>
                              <p className="text-xs text-off-black/60">
                                {[
                                  match.bib && `Bib: ${match.bib}`,
                                  match.time && `Time: ${match.time}`,
                                  match.pace && `Pace: ${match.pace}`,
                                  match.city && match.state && `${match.city}, ${match.state}`
                                ].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <button
                              onClick={() => acceptMatch(selectedOrder.orderNumber, match)}
                              className="ml-3 flex items-center gap-1.5 px-3 py-1.5 bg-success-green/10 text-success-green border border-success-green/30 rounded-md hover:bg-success-green/20 transition-colors text-xs font-medium"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Accept
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* The pipeline's own word on what is stuck, for the cases the
                    research notice above does not cover (a missing production
                    file, race data, a rejected or failed render). */}
                {selectedOrder.pipeline?.stage === 'action' && (selectedOrder.pipeline.kind !== 'data' || selectedOrder.pipeline.reason === 'Design rejected') && selectedOrder.pipeline.fix && (
                  <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    <p className="text-[13px] leading-snug text-red-800"><span className="font-semibold text-red-700 mr-1.5">{selectedOrder.pipeline.reason}.</span>{selectedOrder.pipeline.fix}</p>
                  </div>
                )}
                {/* The customer's open Support conversations, above the design: many are a request to change it. */}
                <OrderConversations variant="alert" orderId={selectedOrder.id} enabled={!!selectedOrder.customerEmail && can('support')} />
                {/* Missing year. The tag says it, this says what to do. */}
                {selectedOrder.status === 'missing_year' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                    <p className="text-body-sm text-amber-800">Contact the customer to confirm which year they ran this race.</p>
                  </div>
                )}
                {/* Flag Reason - only for flagged orders */}
                {selectedOrder.status === 'flagged' && selectedOrder.flagReason && (
                  <div>
                    <h4 className="text-xs font-semibold text-warning-amber uppercase tracking-tight mb-2">Flag Reason</h4>
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                      <p className="text-body-sm text-amber-800">{selectedOrder.flagReason}</p>
                    </div>
                  </div>
                )}
                {/* Notes - only show if there are notes */}
                {selectedOrder.notes && (
                  <div>
                    <h4 className="text-xs font-semibold text-off-black/50 uppercase tracking-tight mb-1.5">Notes</h4>
                    <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                      <p className="text-body-sm text-blue-800 whitespace-pre-wrap">{selectedOrder.notes}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* === DESKTOP FULL DETAIL VIEW === */}
              {/* Race, year, size, ordered date and the Edit pencil all moved
                  into the Product Details card above. */}

              {/* Runner Details — copy-pasteable name + research data, top of stack */}
              <div>
                {/* Runner and race side by side on desktop. Stacks on
                    narrow screens. Same data, half the vertical space.
                    With a finished render, the print sits to their left
                    so name, bib, time and weather can be checked at a glance. */}
                {/* The values are big: this panel is for checking what the customer entered against the print. */}
                <div className={`grid grid-cols-1 gap-3 ${design.reserved ? 'md:grid-cols-[minmax(0,1fr),minmax(0,347px)]' : 'md:grid-cols-2'}`}>
                  <div className={design.reserved ? 'flex flex-col gap-3 min-w-0' : 'contents'}>
                  <div className="bg-subtle-gray border border-border-gray rounded-md p-3 [&_span.font-medium:not(.rounded)]:!text-[19px] [&_span.font-medium:not(.rounded)]:!font-semibold [&_span.font-medium:not(.rounded)]:!leading-tight">
                    <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-border-gray min-h-[22px]">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider">Runner</span>
                        {/* Where these numbers came from (Verified, Customer typed, Entered by hand), next to them. */}
                        <OrderTags order={selectedOrder} only={['trust']} />
                      </span>
                      {/* Edits in place, the same way the Race card does. The results
                          link sits beside it: the printed time has to match that page,
                          because it is the page the customer checks. */}
                      {!isEditing && (
                        <span className="flex items-center gap-3">
                        {selectedOrder.resultsUrl && (
                          <a href={selectedOrder.resultsUrl} target="_blank" rel="noopener noreferrer" title="Check the time against the runner's official result"
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors">
                            Check results <ArrowUpRight className="w-3 h-3" />
                          </a>
                        )}
                        <button
                          onClick={() => startEditing(selectedOrder)}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        </span>
                      )}
                      {isEditing && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => saveOverrides(selectedOrder.orderNumber, selectedOrder)}
                            disabled={isSaving}
                            className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 transition-colors disabled:opacity-50"
                          >
                            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Save
                          </button>
                          <button
                            onClick={cancelEditing}
                            className="flex items-center gap-1 text-xs text-off-black/50 hover:text-off-black/70 transition-colors"
                          >
                            <X className="w-3 h-3" />
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      {isEditing ? (
                        /* Everything on this card is editable. Official
                           results are a starting point, not gospel: runners
                           sometimes want their own watch time on the print. */
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-body-sm text-off-black/60">Name</span>
                            <input
                              type="text"
                              value={editValues.runnerNameOverride}
                              onChange={(e) => setEditValues({ ...editValues, runnerNameOverride: e.target.value })}
                              className="text-body-sm font-medium text-off-black bg-white border border-border-gray rounded px-2 py-1 w-40 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-body-sm text-off-black/60">Bib</span>
                            <input
                              type="text"
                              value={editValues.bibNumber}
                              onChange={(e) => setEditValues({ ...editValues, bibNumber: e.target.value })}
                              placeholder="1234"
                              className="text-body-sm font-medium text-off-black bg-white border border-border-gray rounded px-2 py-1 w-40 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-body-sm text-off-black/60">Time</span>
                            <input
                              type="text"
                              value={editValues.officialTime}
                              onChange={(e) => setEditValues({ ...editValues, officialTime: e.target.value })}
                              placeholder="3:42:18"
                              className="text-body-sm font-medium text-off-black bg-white border border-border-gray rounded px-2 py-1 w-40 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          {selectedOrder.isTriathlon && (['swim', 'bike', 'run'] as const).map(leg => (
                            <div key={leg} className="flex justify-between items-center gap-2">
                              <span className="text-body-sm text-off-black/60 capitalize">{leg}</span>
                              <span className="inline-flex gap-1.5">
                                <input type="text" value={editValues[`${leg}Time`] ?? ''} onChange={(e) => setEditValues({ ...editValues, [`${leg}Time`]: e.target.value })}
                                  placeholder={leg === 'swim' ? '00:40:15' : leg === 'bike' ? '01:03:50' : '01:03:39'}
                                  className="text-body-sm font-medium text-off-black bg-white border border-border-gray rounded px-2 py-1 w-24 text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                <input type="text" value={editValues[`${leg}Distance`] ?? ''} onChange={(e) => setEditValues({ ...editValues, [`${leg}Distance`]: e.target.value })}
                                  placeholder={leg === 'swim' ? '1.5 mi' : leg === 'bike' ? '18 mi' : '8 mi'}
                                  className="text-body-sm font-medium text-off-black bg-white border border-border-gray rounded px-2 py-1 w-20 text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                              </span>
                            </div>
                          ))}
                          {!selectedOrder.isTriathlon && (
                          <div className="flex justify-between items-center">
                            <span className="text-body-sm text-off-black/60">Pace</span>
                            <input
                              type="text"
                              value={editValues.officialPace}
                              onChange={(e) => setEditValues({ ...editValues, officialPace: e.target.value })}
                              placeholder="8:29"
                              className="text-body-sm font-medium text-off-black bg-white border border-border-gray rounded px-2 py-1 w-40 text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          )}
                        </>
                      ) : (
                        <>
                          {(selectedOrder.effectiveRunnerName || selectedOrder.runnerName) ? (
                            <CopyableField label="Name" value={selectedOrder.effectiveRunnerName || selectedOrder.runnerName} />
                          ) : (
                            <PendingField label="Name" />
                          )}
                          {selectedOrder.bibNumber ? (
                            <CopyableField label="Bib" value={selectedOrder.bibNumber} />
                          ) : selectedOrder.hasScraperAvailable ? (
                            <PendingField label="Bib" />
                          ) : (
                            <NotAvailableField label="Bib" />
                          )}
                          {/* hadNoTime is the customer's explicit "no time on
                              the poster" opt-in. It wins over any result. */}
                          {selectedOrder.hadNoTime ? (
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-off-black/40 w-16">Time</span>
                              <span className="text-xs px-2 py-1 bg-warning-amber/10 text-warning-amber border border-warning-amber/20 rounded">
                                ⚠️ No Time
                              </span>
                            </div>
                          ) : selectedOrder.officialTime ? (
                            <CopyableField label="Time" value={selectedOrder.officialTime} />
                          ) : selectedOrder.timeFromName ? (
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-off-black/40 w-16">Time</span>
                              <span className="text-xs px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                                ⏱ {selectedOrder.timeFromName}
                              </span>
                            </div>
                          ) : selectedOrder.hasScraperAvailable ? (
                            <PendingField label="Time" />
                          ) : (
                            <NotAvailableField label="Time" />
                          )}
                          {selectedOrder.isTriathlon ? (['swim', 'bike', 'run'] as const).map(leg => {
                            const t = selectedOrder[`${leg}Time`], d = selectedOrder[`${leg}Distance`]
                            const label = leg.charAt(0).toUpperCase() + leg.slice(1)
                            return t || d
                              ? <CopyableField key={leg} label={label} value={[t, d].filter(Boolean).join(' · ')} />
                              : <NotAvailableField key={leg} label={label} />
                          }) : selectedOrder.hadNoTime ? (
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-off-black/40 w-16">Pace</span>
                              <span className="text-xs px-2 py-1 bg-warning-amber/10 text-warning-amber border border-warning-amber/20 rounded">
                                ⚠️ No Pace
                              </span>
                            </div>
                          ) : selectedOrder.officialPace ? (
                            <CopyableField label="Pace" value={selectedOrder.officialPace} />
                          ) : selectedOrder.hasScraperAvailable ? (
                            <PendingField label="Pace" />
                          ) : (
                            <NotAvailableField label="Pace" />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="bg-subtle-gray border border-border-gray rounded-md p-3 [&_span.font-medium:not(.rounded)]:!text-[19px] [&_span.font-medium:not(.rounded)]:!font-semibold [&_span.font-medium:not(.rounded)]:!leading-tight">
                    <div className="flex items-center justify-between pb-1.5 mb-2 border-b border-border-gray min-h-[22px]">
                      <span className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider">Race</span>
                      <div className="flex items-center gap-3">
                      {!isEditingWeather && selectedOrder.raceId && (
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => openWeatherCalc(selectedOrder)}
                                className="flex items-center gap-1 text-xs text-off-black/50 hover:text-off-black transition-colors"
                                title="Calculate weather from date + city"
                              >
                                <CloudSun className="w-3 h-3" />
                                Re-Calculate Weather
                              </button>
                              <button
                                onClick={() => startEditingWeather(selectedOrder)}
                                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors"
                              >
                                <Pencil className="w-3 h-3" />
                                Edit
                              </button>
                            </div>
                          )}
                          {isEditingWeather && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => saveWeather(selectedOrder)}
                                disabled={isSavingWeather}
                                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 transition-colors disabled:opacity-50"
                              >
                                {isSavingWeather ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Save
                              </button>
                              <button
                                onClick={cancelEditingWeather}
                                className="flex items-center gap-1 text-xs text-off-black/50 hover:text-off-black/70 transition-colors"
                              >
                                <X className="w-3 h-3" />
                                Cancel
                              </button>
                            </div>
                          )}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {selectedOrder.eventType ? (
                        // Flag non-marathon events so the designer doesn't
                        // assume "Marathon" by default — Half, 10K, 5K, etc.
                        // use different templates.
                        (() => {
                          const isMarathon = /^marathon$/i.test(selectedOrder.eventType.trim())
                          return (
                            <div className="flex justify-between items-center">
                              <span className="text-body-sm text-off-black/60">Event</span>
                              <div className="flex items-center gap-2">
                                {!isMarathon && (
                                  <span
                                    className="inline-flex items-center px-1.5 py-0.5 bg-warning-amber/15 text-warning-amber border border-warning-amber/30 text-[10px] font-bold rounded leading-none"
                                    title="Not the full marathon - double-check the template"
                                  >
                                    !!
                                  </span>
                                )}
                                <span className={`text-body-sm font-medium ${isMarathon ? 'text-off-black' : 'text-warning-amber'}`}>{selectedOrder.eventType}</span>
                                {selectedOrder.eventTypeSource && selectedOrder.eventTypeSource !== 'research' && (
                                  <span className="text-[11px] text-off-black/40" title={selectedOrder.eventTypeSource === 'customer' ? 'What the customer chose at checkout. Research confirms it.' : 'From the product name. Research confirms which event the runner actually ran.'}>
                                    {selectedOrder.eventTypeSource === 'customer' ? 'per customer' : 'per product'}
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })()
                      ) : selectedOrder.hasScraperAvailable ? (
                        <PendingField label="Event" />
                      ) : (
                        <NotAvailableField label="Event" />
                      )}
                      {isEditingWeather ? (
                        <div className="flex justify-between items-center">
                          <span className="text-body-sm text-off-black/60">Date</span>
                          <input
                            type="date"
                            value={weatherEditValues.raceDate}
                            onChange={(e) => setWeatherEditValues(prev => ({ ...prev, raceDate: e.target.value }))}
                            className="w-40 px-2 py-1 text-sm text-right border border-border-gray rounded bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                          />
                        </div>
                      ) : selectedOrder.raceDate ? (
                        <CopyableField label="Date" value={selectedOrder.raceDate} aside={
                          <span className="inline-flex items-center gap-1.5 text-[11px]">
                            {selectedOrder.raceDateVerified ? (
                              <span className="px-1.5 py-0.5 rounded font-medium bg-green-50 text-green-700 border border-green-200" title={selectedOrder.raceDateConfirmedBy ? `Confirmed by ${selectedOrder.raceDateConfirmedBy}` : 'Confirmed against a source on file'}>Confirmed</span>
                            ) : (selectedOrder.raceDateSourceUrl || selectedOrder.raceDateEvidence) ? (
                              <>
                                <span className="px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Read off a results page; a person has not checked it against the sources yet. Prints wait for it.">Suggested</span>
                                <button type="button" onClick={() => confirmRaceDate(selectedOrder)} disabled={confirmingDate}
                                  className="px-1.5 py-0.5 rounded font-semibold bg-off-black text-white hover:opacity-90 disabled:opacity-40">
                                  {confirmingDate ? '…' : 'Confirm'}
                                </button>
                              </>
                            ) : selectedOrder.raceId ? (
                              <>
                                <span className="px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700 border border-amber-200" title="No source on file for this date, so prints wait for it. Confirm asks for the page you checked it on.">No source</span>
                                <button type="button" onClick={() => confirmRaceDate(selectedOrder, true)} disabled={confirmingDate}
                                  className="px-1.5 py-0.5 rounded font-semibold bg-off-black text-white hover:opacity-90 disabled:opacity-40">
                                  {confirmingDate ? '…' : 'Confirm'}
                                </button>
                              </>
                            ) : null}
                            <SourceLinks url={selectedOrder.raceDateSourceUrl} evidence={selectedOrder.raceDateEvidence} />
                          </span>
                        } />
                      ) : selectedOrder.raceId ? (
                        // The race row exists and has no date, which now
                        // means nobody has verified one - computed dates are
                        // gone, so waiting will not produce it. Ask.
                        <MissingDateField onAdd={() => startEditingWeather(selectedOrder)} />
                      ) : selectedOrder.hasScraperAvailable ? (
                        // No race row yet. Research creates one and fills in
                        // whatever the config has, so this really is pending.
                        <PendingField label="Date" />
                      ) : (
                        <NotAvailableField label="Date" />
                      )}
                      {isEditingWeather ? (
                        <div className="flex justify-between items-center">
                          <span className="text-body-sm text-off-black/60">Weather</span>
                          <select
                            value={weatherEditValues.weatherCondition}
                            onChange={(e) => setWeatherEditValues(prev => ({ ...prev, weatherCondition: e.target.value }))}
                            className="w-40 px-2 py-1 text-sm text-right border border-border-gray rounded bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                          >
                            <option value="">--</option>
                            <option value="Sunny">Sunny</option>
                            <option value="Cloudy">Cloudy</option>
                            <option value="Rainy">Rainy</option>
                            <option value="Snowy">Snowy</option>
                          </select>
                        </div>
                      ) : isCalculatingWeather ? (
                        <div className="flex justify-between items-center py-1">
                          <span className="text-body-sm text-off-black/60">Weather</span>
                          <span className="inline-flex items-center gap-2 text-xs text-off-black/50 mr-9"><Loader2 className="w-5 h-5 animate-spin text-off-black/40" /> Calculating</span>
                        </div>
                      ) : selectedOrder.weatherCondition ? (
                        (() => {
                          let b: { method?: string; place?: string; date?: string; avgTempF?: number; counts?: Record<string, number>; hours?: { hour: number; tempF: number; condition: string }[] } | null = null
                          try { b = selectedOrder.weatherDetails ? JSON.parse(selectedOrder.weatherDetails) : null } catch { b = null }
                          return (
                            <div className="relative">
                              {/* Explanation sits inline with the label so it
                                  does not cost its own row. */}
                              <CopyableField
                                label="Weather"
                                value={selectedOrder.weatherCondition}
                                aside={
                                  <span className="inline-flex items-center gap-1.5">
                                    {/* Calculated weather prints only once a person confirms it. */}
                                    {selectedOrder.weatherConfirmedAt ? (
                                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-50 text-green-700 border border-green-200" title={`Confirmed${selectedOrder.weatherConfirmedBy ? ` by ${selectedOrder.weatherConfirmedBy}` : ''} ${new Date(selectedOrder.weatherConfirmedAt).toLocaleString()}`}>Confirmed</span>
                                    ) : (
                                      <>
                                        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Calculated from the hourly breakdown; a person has not confirmed it yet. Prints wait for it.">Calculated</span>
                                        <button type="button" onClick={() => confirmWeather(selectedOrder)} disabled={confirmingWeather}
                                          className="px-1.5 py-0.5 rounded text-[11px] font-semibold bg-off-black text-white hover:opacity-90 disabled:opacity-40">
                                          {confirmingWeather ? '…' : 'Confirm'}
                                        </button>
                                      </>
                                    )}
                                    <button type="button" onClick={() => setShowWeatherInfo(v => !v)} title={b ? 'How this weather was worked out' : 'No breakdown on file for this weather'}
                                      className="text-[11px] text-off-black/50 underline decoration-dotted underline-offset-2 hover:text-off-black">source</button>
                                  </span>
                                }
                              />
                              {showWeatherInfo && !b && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setShowWeatherInfo(false)} />
                                  <div className="absolute right-0 top-full mt-1 z-20 w-64 bg-white border border-border-gray rounded-md shadow-lg p-3 text-[11px] text-off-black/70">
                                    No breakdown is on file for this weather (entered by hand or computed before breakdowns were kept). Re-Calculate Weather to get one.
                                  </div>
                                </>
                              )}
                              {b && showWeatherInfo && (
                                  <>
                                    {/* Click-away backdrop — clicking anywhere else closes the popover */}
                                    <div className="fixed inset-0 z-10" onClick={() => setShowWeatherInfo(false)} />
                                  <div className="absolute right-0 top-full mt-1 z-20 w-72 bg-white border border-border-gray rounded-md shadow-lg p-3 text-left" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      onClick={() => setShowWeatherInfo(false)}
                                      className="absolute top-2 right-2 text-off-black/30 hover:text-off-black/70 transition-colors"
                                      title="Close"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                    <p className="text-[11px] text-off-black/60 leading-snug mb-2 pr-5">
                                      {b.method} {b.place ? `· ${b.place}` : ''}{b.date ? ` · ${b.date}` : ''}
                                    </p>
                                    <p className="text-xs font-medium text-off-black mb-1.5">
                                      Avg {b.avgTempF}°F · {(['sunny','cloudy','rainy','snowy'] as const).filter(k => b!.counts?.[k]).map(k => `${b!.counts![k]} ${k}`).join(', ')}
                                    </p>
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                                      {(b.hours || []).map(h => (
                                        <div key={h.hour} className="flex justify-between text-[10px] text-off-black/60">
                                          <span>{h.hour}:00</span>
                                          <span>{h.tempF}° · {h.condition}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  </>
                              )}
                            </div>
                          )
                        })()
                      ) : (
                        <PendingField label="Weather" />
                      )}
                      {isEditingWeather ? (
                        <div className="flex justify-between items-center">
                          <span className="text-body-sm text-off-black/60">Temp</span>
                          <input
                            type="text"
                            value={weatherEditValues.weatherTemp}
                            onChange={(e) => setWeatherEditValues(prev => ({ ...prev, weatherTemp: e.target.value }))}
                            placeholder="e.g. 65°F"
                            className="w-40 px-2 py-1 text-sm text-right border border-border-gray rounded focus:outline-none focus:ring-1 focus:ring-off-black/20"
                          />
                        </div>
                      ) : isCalculatingWeather ? (
                        <div className="flex justify-between items-center py-1">
                          <span className="text-body-sm text-off-black/60">Temp</span>
                          <Loader2 className="w-5 h-5 animate-spin text-off-black/40 mr-9" />
                        </div>
                      ) : selectedOrder.weatherTemp ? (
                        <CopyableField label="Temp" value={selectedOrder.weatherTemp} aside={
                          // The temperature is part of the same check as the condition.
                          selectedOrder.weatherConfirmedAt
                            ? <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-green-50 text-green-700 border border-green-200" title={`Confirmed${selectedOrder.weatherConfirmedBy ? ` by ${selectedOrder.weatherConfirmedBy}` : ''} ${new Date(selectedOrder.weatherConfirmedAt).toLocaleString()}`}>Confirmed</span>
                            : <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200" title="Calculated; confirm it beside the weather above">Calculated</span>
                        } />
                      ) : (
                        <PendingField label="Temp" />
                      )}
                    </div>
                  </div>
                  {/* The customer photo sits under the runner and race details, beside the print it went into. */}
                  {design.reserved && photoCard}
                  </div>
                  {/* The print sits to the right of the details it was made from. */}
                  {design.reserved && <div className="flex min-w-0 order-first md:order-none"><DesignCard d={design} /></div>}
                </div>
              </div>

              {/* Phone: the review buttons and previous/next order live in a bar
                  above the bottom menu, under the thumb, at every scroll position. */}
              {inlineDetail && (
                <div className="md:hidden fixed inset-x-0 z-40 px-3" style={{ bottom: 'calc(env(safe-area-inset-bottom) + 92px)' }}>
                  <div className="flex items-stretch gap-2 rounded-xl border border-border-gray bg-white/95 backdrop-blur p-2 shadow-[0_8px_30px_rgba(0,0,0,0.12)]">
                    <button onClick={() => navigateOrder('prev')} disabled={currentOrderIndex <= 0} aria-label="Previous order" className="shrink-0 w-11 rounded-md border border-border-gray text-off-black/60 disabled:opacity-30 inline-flex items-center justify-center">
                      <ChevronUp className="w-5 h-5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      {(design.job?.status === 'done' && (design.job.review === 'pending' || design.job.review === 'approved')) ? (
                        <DesignReview compact d={design} arteloOrderUrl={selectedOrder.status !== 'completed' ? selectedOrder.arteloUrl : null} onComplete={() => markAsCompleted(selectedOrder.orderNumber)} />
                      ) : (
                        <div className="h-full flex items-center justify-center text-[13px] text-off-black/55 text-center px-1">
                          {selectedOrder.pipeline?.reason || getStatusDisplay(selectedOrder).label}
                        </div>
                      )}
                    </div>
                    <button onClick={() => navigateOrder('next')} disabled={currentOrderIndex < 0 || currentOrderIndex >= navTotal - 1} aria-label="Next order" className="shrink-0 w-11 rounded-md border border-border-gray text-off-black/60 disabled:opacity-30 inline-flex items-center justify-center">
                      <ChevronDownIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Weather calculator micro-modal */}
              {showWeatherCalc && (
                <div
                  className="fixed inset-0 z-[70] flex items-center justify-center p-4"
                  style={{ backgroundColor: 'rgba(26,26,26,0.5)' }}
                  onClick={(e) => { if (e.target === e.currentTarget) setShowWeatherCalc(false) }}
                >
                  <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1.5">
                        <CloudSun className="w-4 h-4 text-off-black/60" />
                        <h3 className="text-sm font-semibold text-off-black">Calculate Weather</h3>
                      </div>
                      <button onClick={() => setShowWeatherCalc(false)} className="text-off-black/40 hover:text-off-black">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-[11px] text-off-black/50 mb-3 leading-snug">
                      Averages the hourly temps from 7am–1pm and picks the dominant condition (sunny / cloudy / rainy / snowy).
                    </p>
                    <label className="block text-[11px] font-semibold text-off-black/50 uppercase tracking-wider mb-1">City</label>
                    <input
                      value={weatherCalcCity}
                      onChange={(e) => setWeatherCalcCity(e.target.value)}
                      placeholder="Boston, MA"
                      className="w-full mb-3 px-3 py-2 border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                    />
                    <label className="block text-[11px] font-semibold text-off-black/50 uppercase tracking-wider mb-1">Date</label>
                    <input
                      type="date"
                      value={weatherCalcDate}
                      onChange={(e) => setWeatherCalcDate(e.target.value)}
                      className="w-full mb-4 px-3 py-2 border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20"
                    />
                    <button
                      onClick={() => calculateWeather(selectedOrder)}
                      disabled={isCalculatingWeather || !weatherCalcCity.trim() || !weatherCalcDate}
                      className="w-full px-3 py-2.5 text-sm font-medium text-white bg-dark-fill hover:opacity-90 rounded-md transition-opacity disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                      {isCalculatingWeather ? <><Loader2 className="w-4 h-4 animate-spin" /> Calculating…</> : 'Calculate & save'}
                    </button>
                  </div>
                </div>
              )}

              {/* Review, filename, comments */}
              <div className="space-y-5">

              {/* Filename. One value, so it gets one row rather than a
                  section header wrapping a card wrapping a label. */}
              {/* Reviewing the automated print is the main action here, so it is big.
                  Once approved, the same spot sends you to Artelo to attach the file. */}
              <div className="space-y-2">
                <div className="hidden md:block"><DesignReview d={design} arteloOrderUrl={selectedOrder.status !== 'completed' ? selectedOrder.arteloUrl : null} onComplete={() => markAsCompleted(selectedOrder.orderNumber)} /></div>
              </div>

              </div>

              {/* Main action */}
              <div>
              {/* Actions */}
              <div className="flex gap-3 pt-3">
                {/* Mark as Completed is always available (except for already-
                    completed / flagged orders, which have their own actions).
                    Sometimes we fulfill without running research on this tool,
                    so the button needs to be reachable even when status is
                    still 'pending' or 'missing_year'. When Research Runner
                    also shows, both share the row 50/50. */}
                {selectedOrder.status !== 'completed' &&
                 selectedOrder.status !== 'flagged' &&
                 // An approved design has its own Mark as complete beside Attach in Artelo.
                 !((selectedOrder.pipeline?.stage === 'attach' || (design.job?.status === 'done' && design.job.review === 'approved')) && selectedOrder.arteloUrl) &&
                 // A standard print completes once its design is approved. With no design
                 // from the script at all, it was made by hand, and the button says so.
                 // While a design is rendering or waiting for review, there is no button.
                 (selectedOrder.trackstarOrderType !== 'standard' || standardDesignApproved || standardNoDesign) &&
                 !isEditing && (
                  <button
                    onClick={() => markAsCompleted(selectedOrder.orderNumber)}
                    className={`flex-1 px-5 py-3 rounded-md hover:opacity-90 transition-opacity font-medium text-white ${selectedOrder.pipeline?.stage === 'attach' ? 'bg-[#4600D6]' : 'bg-dark-fill'}`}
                  >
                    {selectedOrder.pipeline?.stage === 'attach' ? 'Attached in Artelo, mark done' : selectedOrder.trackstarOrderType === 'standard' && !standardDesignApproved ? 'Mark as Complete (Made by Hand)' : 'Mark as Completed'}
                    {!(selectedOrder.trackstarOrderType === 'standard' && !standardDesignApproved) && <kbd className="ml-2 hidden md:inline-flex items-center px-1.5 py-0.5 rounded border border-white/30 text-[11px] font-medium opacity-70 font-sans">F</kbd>}
                  </button>
                )}
                {/* Re-open — only for already-completed orders. Sends the
                    order back into the active queue. */}
                {selectedOrder.status === 'completed' && !isEditing && (
                  <button
                    onClick={() => reopenOrder(selectedOrder.orderNumber)}
                    className="flex-1 px-5 py-3 bg-white border-2 border-amber-300 text-amber-700 rounded-md hover:bg-amber-50 transition-colors font-medium"
                  >
                    ↩ Re-Open Order
                  </button>
                )}
                {selectedOrder.status === 'flagged' && !isEditing && (
                  <>
                    <button className="flex-1 px-5 py-3 bg-dark-fill text-white rounded-md hover:opacity-90 transition-opacity font-medium">
                      Resolve Flag
                    </button>
                    <button
                      onClick={() => handleCopyEmail(selectedOrder)}
                      className="flex items-center gap-2 px-5 py-3 bg-white border border-border-gray text-off-black rounded-md hover:bg-subtle-gray transition-colors"
                    >
                      <Copy className="w-4 h-4" />
                      Copy Email
                    </button>
                  </>
                )}
                {!isEditing && !inlineDetail && (
                  <button
                    onClick={closeModal}
                    className="px-5 py-3 bg-white border border-border-gray text-off-black rounded-md hover:bg-subtle-gray transition-colors"
                  >
                    Close
                  </button>
                )}
              </div>
              </div>{/* end hidden md:block wrapper */}
              </div>
              </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Notify Customer of Delay — emergency dialog for custom orders.
          Sends a Resend email apologizing for the delay, stores the flag
          on the order so a banner appears in the modal, and DMs Matt. */}
      {delayDialogOpen && selectedOrder && (
        <div
          className="fixed inset-0 bg-off-black/60 flex items-center justify-center p-4 z-[60]"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDelayDialog()
          }}
        >
          <div className="bg-white rounded-md max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-heading-md text-off-black flex items-center gap-2">
                  <span>⏰</span> Notify Customer of Delay
                </h3>
                <button
                  onClick={closeDelayDialog}
                  disabled={isSendingDelay}
                  className="text-off-black/40 hover:text-off-black text-2xl leading-none disabled:opacity-40"
                >
                  ×
                </button>
              </div>

              {/* Warning copy — make the consequence obvious */}
              <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-4">
                <p className="text-xs font-semibold text-amber-900 mb-1">
                  Emergency use only
                </p>
                <p className="text-xs text-amber-800/90 leading-relaxed">
                  This emails the customer that their order will be late. We do <strong>not</strong> want to make a habit of this - only use it when a delay is unavoidable. The due date will stay the same; a flag will appear on this order showing it was sent.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-off-black/60 uppercase tracking-wider mb-1.5">
                    Customer
                  </label>
                  <div className="text-sm text-off-black">
                    {selectedOrder.customerName ? `${selectedOrder.customerName} · ` : ''}
                    <span className="text-off-black/60">{selectedOrder.customerEmail}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-off-black/60 uppercase tracking-wider mb-1.5">
                    How many days late will it be?
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={delayDaysInput}
                    onChange={(e) => setDelayDaysInput(e.target.value)}
                    disabled={isSendingDelay}
                    className="w-full px-3 py-2 border border-border-gray rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-off-black/20 disabled:opacity-50"
                    autoFocus
                  />
                  <p className="text-[11px] text-off-black/50 mt-1.5">
                    Email will tell them their mockup may arrive ~{delayDaysInput || '?'} day{delayDaysInput === '1' ? '' : 's'} after their original due date.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-6">
                <button
                  onClick={closeDelayDialog}
                  disabled={isSendingDelay}
                  className="px-4 py-2 text-sm font-medium text-off-black/70 hover:bg-subtle-gray rounded-md transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={() => sendDelayNotice(selectedOrder.orderNumber)}
                  disabled={isSendingDelay || !delayDaysInput.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSendingDelay && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSendingDelay ? 'Sending…' : 'Send Delay Notice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
