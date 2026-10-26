import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import Linkify from '@/components/Linkify'
import { Upload, Copy, Loader2, Check, ImagePlus, RefreshCw, CheckCircle2, AlertTriangle, X, Send, RotateCcw, MessageSquare, ExternalLink, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch } from '@/lib/api'
import { useIsAdmin } from '@/lib/auth'

const API_BASE = import.meta.env.VITE_API_URL || ''

interface Proof {
  id: string
  orderId: string
  version: number
  batch: number
  imageUrl: string
  thumbnailUrl: string | null
  fileName: string | null
  /** What this proof is an option FOR, e.g. "Half Marathon". Null = the only
   *  thing on this order, which is every custom and standard order. */
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

interface ApprovalToken {
  id: string
  orderId: string
  token: string
  expiresAt: string
  createdAt: string
}

interface ProofManagerProps {
  orderId: string
  orderNumber: string
  displayOrderNumber: string
  designStatus?: string
  customerEmail?: string | null
  onDesignStatusChange?: (newStatus: string) => void
  onLatestFeedback?: (feedback: string | null) => void
  // When true, hides the "Send to Customer" / "Re-send Email" buttons.
  // Used for race-partner orders where Matt shares the approval link manually.
  disableEmail?: boolean
  // When true, proofs can be labelled by what they are an option for, so a
  // partner sent designs for two products approves one of each. Partner orders
  // only: a custom order is one design and the label would be a question with
  // one answer.
  allowGroups?: boolean
  // The order view's sidebar carries Re-send and Message customer as actions:
  // given this, they leave the proofs area and the messages open as a dialog.
  onActions?: (a: ProofActions) => void
  // The section heading. The approval link's Copy / Open / Regenerate sit on
  // its right; the link itself is not shown.
  heading?: ReactNode
}

export type ProofActions = { resend: (() => void) | null; resending: boolean; openMessages: () => void; newReply: boolean; messageCount: number }

/**
 * Compact picker for what a design is an option for. Existing labels on the
 * order are offered first so a second upload matches the first spelling
 * exactly; "New label" swaps the select for a small text input.
 */
function LabelPicker({ value, options, onChange, disabled, className = '' }: {
  value: string
  options: string[]
  onChange: (label: string) => void
  disabled?: boolean
  className?: string
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const commit = () => {
    const next = draft.trim()
    setAdding(false)
    setDraft('')
    if (next && next !== value) onChange(next)
  }
  if (adding) {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setAdding(false); setDraft('') }
        }}
        placeholder="e.g. Half Marathon"
        className={`px-2 py-1 text-[11px] border border-border-gray rounded bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20 ${className}`}
      />
    )
  }
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={e => {
        if (e.target.value === '__new__') setAdding(true)
        else onChange(e.target.value)
      }}
      className={`px-2 py-1 text-[11px] border border-border-gray rounded bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20 disabled:opacity-50 ${className}`}
    >
      <option value="">No label</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__new__">New label…</option>
    </select>
  )
}

export default function ProofManager({ orderId, designStatus, customerEmail, onDesignStatusChange, onLatestFeedback, disableEmail, allowGroups, onActions, heading }: ProofManagerProps) {
  const [proofs, setProofs] = useState<Proof[]>([])
  const [approvalToken, setApprovalToken] = useState<ApprovalToken | null>(null)
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null)
  // Messaging is collapsed by default; it pops open when a customer reply is waiting.
  const [showMessaging, setShowMessaging] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [filePreviews, setFilePreviews] = useState<{ name: string; preview: string }[]>([])
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [overridingId, setOverridingId] = useState<string | null>(null)
  const isAdmin = useIsAdmin()
  const [isSending, setIsSending] = useState(false)
  const [sendNote, setSendNote] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [isAsking, setIsAsking] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  // Applies to everything in this upload. Uploading two half-marathon options
  // then two marathon options is two uploads with two labels, which is how the
  // designer already works.
  const [groupLabel, setGroupLabel] = useState('')
  const [relabelingId, setRelabelingId] = useState<string | null>(null)
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null)

  /** Rename a label across every pending proof that carries it. */
  const renameGroup = async (from: string, to: string) => {
    setRenamingLabel(null)
    const next = to.trim()
    if (next === from) return
    const targets = proofs.filter(p => p.status === 'pending' && (p.groupLabel || '') === from)
    for (const t of targets) await setProofGroup(t.id, next)
  }

  /** Set or clear what an already-uploaded proof is an option for. */
  const setProofGroup = async (proofId: string, label: string) => {
    setRelabelingId(proofId)
    try {
      const res = await apiFetch(`${API_BASE}/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-group-label', proofId, groupLabel: label }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Could not update the label')
        return
      }
      const { proof } = await res.json()
      setProofs(prev => prev.map(p => (p.id === proofId ? { ...p, groupLabel: proof.groupLabel } : p)))
    } catch {
      toast.error('Could not update the label')
    } finally {
      setRelabelingId(null)
    }
  }

  // Compact mode: after approval, just show thumbnails — no upload UI, no big approval link
  const isCompact = ['approved_by_customer', 'final_pdf_uploaded', 'sent_to_production'].includes(designStatus || '')

  // Latest callback without making it a fetch dependency: the parent passes an
  // inline function, and refetching proofs on every parent render is wrong.
  const onLatestFeedbackRef = useRef(onLatestFeedback)
  useEffect(() => { onLatestFeedbackRef.current = onLatestFeedback }, [onLatestFeedback])

  const fetchData = useCallback(async () => {
    try {
      const [proofsRes, tokenRes] = await Promise.all([
        apiFetch(`${API_BASE}/api/proofs?orderId=${orderId}`),
        apiFetch(`${API_BASE}/api/proofs?action=token&orderId=${orderId}`)
      ])

      if (proofsRes.ok) {
        const data = await proofsRes.json()
        setProofs(data.proofs)
        setMessages(data.messages || [])
        // Expose latest customer feedback for revision banner
        const revisionProof = [...data.proofs].reverse().find((p: Proof) => p.status === 'revision_requested' && p.customerFeedback)
        onLatestFeedbackRef.current?.(revisionProof?.customerFeedback || null)
      }

      if (tokenRes.ok) {
        const data = await tokenRes.json()
        setApprovalToken(data.approvalToken)
        // Build URL client-side to always use the correct frontend origin
        setApprovalUrl(`${window.location.origin}/approve/${data.approvalToken.token}`)
      }
    } catch (err) {
      console.error('[ProofManager] Fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const addFiles = (files: File[]) => {
    const remaining = 20 - selectedFiles.length
    const toAdd = files.slice(0, remaining)
    if (toAdd.length === 0) {
      toast.error('Maximum 20 files')
      return
    }

    setSelectedFiles(prev => [...prev, ...toAdd])

    toAdd.forEach(file => {
      const isPdfFile = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      if (isPdfFile) {
        setFilePreviews(prev => [...prev, { name: file.name, preview: 'pdf' }])
      } else {
        const reader = new FileReader()
        reader.onload = (ev) => {
          setFilePreviews(prev => [...prev, { name: file.name, preview: ev.target?.result as string }])
        }
        reader.readAsDataURL(file)
      }
    })
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    addFiles(files)
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) addFiles([file])
        break
      }
    }
  }

  const removeFile = (idx: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== idx))
    setFilePreviews(prev => prev.filter((_, i) => i !== idx))
  }

  const clearFiles = () => {
    setSelectedFiles([])
    setFilePreviews([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const uploadProofs = async () => {
    if (selectedFiles.length === 0) return
    setIsUploading(true)

    let uploaded = 0
    let lastToken: typeof approvalToken = null
    let lastUrl: string | null = null

    try {
      for (const file of selectedFiles) {
        // The file goes to storage directly: our API sits behind a 4.5 MB
        // request cap that a PNG preview blows through. Ask for a signed
        // slot, put the bytes there, then create the record from its URL.
        const slotRes = await apiFetch(`${API_BASE}/api/proofs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'upload-url', orderId, filename: file.name, contentType: file.type }),
        })
        if (!slotRes.ok) {
          const data = await slotRes.json().catch(() => ({ error: 'Could not start the upload' }))
          toast.error(`Failed to upload ${file.name}: ${data.error}`)
          continue
        }
        const slot = await slotRes.json()
        const put = await fetch(slot.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file })
        if (!put.ok) {
          const text = await put.text().catch(() => '')
          toast.error(`Failed to upload ${file.name}: storage said ${put.status}${text ? ` ${text.slice(0, 80)}` : ''}`)
          continue
        }

        const res = await apiFetch(`${API_BASE}/api/proofs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, imageUrl: slot.publicUrl, imageName: file.name, groupLabel: groupLabel.trim() || undefined }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: `server returned ${res.status}` }))
          toast.error(`Failed to upload ${file.name}: ${data.error}`)
          continue
        }

        const data = await res.json()
        setProofs(prev => [...prev, data.proof])
        if (data.approvalToken) {
          lastToken = data.approvalToken
          lastUrl = `${window.location.origin}/approve/${data.approvalToken.token}`
        }
        uploaded++
      }

      if (lastToken) {
        setApprovalToken(lastToken)
        setApprovalUrl(lastUrl)
      }
      clearFiles()
      toast.success(`${uploaded} proof${uploaded !== 1 ? 's' : ''} uploaded`)

      // Auto-advance from not_started → in_progress on first upload
      if (designStatus === 'not_started' && uploaded > 0) {
        onDesignStatusChange?.('in_progress')
      }
    } catch {
      toast.error('Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  // Admin: the customer approved the wrong option; record the right one.
  const overrideApproval = async (proof: Proof) => {
    if (!confirm(`Make option v${proof.version} the approved one? The option they approved becomes rejected. The customer is not emailed.`)) return
    setOverridingId(proof.id)
    try {
      const res = await apiFetch(`${API_BASE}/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'override-approval', proofId: proof.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'That did not work'); return }
      setProofs(data.proofs)
      toast.success(data.inProduction
        ? `v${proof.version} is now the approved option. This order is already in production, so check the file Artelo has.`
        : `v${proof.version} is now the approved option`)
    } catch {
      toast.error('Could not reach the server')
    } finally {
      setOverridingId(null)
    }
  }

  const deleteProof = async (proofId: string) => {
    setDeletingId(proofId)
    try {
      const res = await apiFetch(`${API_BASE}/api/proofs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proofId })
      })
      if (res.ok) {
        setProofs(prev => prev.filter(p => p.id !== proofId))
        toast.success('Proof deleted')
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Delete failed')
      }
    } catch {
      toast.error('Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const generateToken = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate-token', orderId })
      })
      if (res.ok) {
        const data = await res.json()
        setApprovalToken(data.approvalToken)
        setApprovalUrl(`${window.location.origin}/approve/${data.approvalToken.token}`)
        toast.success('Approval link generated')
      }
    } catch {
      toast.error('Failed to generate link')
    }
  }

  const copyLink = async () => {
    if (!approvalUrl) return
    try {
      await navigator.clipboard.writeText(approvalUrl)
    } catch {
      // Fallback for HTTP / insecure contexts where clipboard API fails
      const textarea = document.createElement('textarea')
      textarea.value = approvalUrl
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    toast.success('Approval link copied')
    setTimeout(() => setCopied(false), 2000)
  }

  const sendToCustomer = async () => {
    if (!customerEmail) {
      toast.error('No customer email on this order')
      return
    }
    setIsSending(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/proofs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-to-customer', orderId, note: sendNote.trim() || null })
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to send')
        return
      }
      if (data.approvalUrl) {
        setApprovalUrl(data.approvalUrl)
      }
      onDesignStatusChange?.('awaiting_review')
      setSendNote('')
      toast.success(`Proofs emailed to ${customerEmail}`)
    } catch {
      toast.error('Failed to send email')
    } finally {
      setIsSending(false)
    }
  }

  const askCustomer = async () => {
    if (!question.trim()) return
    if (!customerEmail) {
      toast.error('No customer email on this order')
      return
    }
    setIsAsking(true)
    try {
      const res = await apiFetch(`${API_BASE}/api/orders/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message-customer', orderId, body: question.trim() })
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to send question')
        return
      }
      setQuestion('')
      await fetchData()
      toast.success(`Question emailed to ${customerEmail}`)
    } catch {
      toast.error('Failed to send question')
    } finally {
      setIsAsking(false)
    }
  }

  const awaitingDanReply = messages.length > 0 && messages[messages.length - 1].sender === 'customer'

  const hasPendingProofs = proofs.some(p => p.status === 'pending')
  const canSend = hasPendingProofs && customerEmail && !disableEmail
  const showSendButton = canSend && ['in_progress', 'in_revision'].includes(designStatus || '')
  // Show note field when there are pending proofs to send, OR when files are selected (about to upload)
  const showNoteField = (showSendButton || selectedFiles.length > 0) && ['in_progress', 'in_revision'].includes(designStatus || '')
  const showResendButton = canSend && designStatus === 'awaiting_review'
  const sendRef = useRef(sendToCustomer)
  sendRef.current = sendToCustomer
  useEffect(() => {
    onActions?.({ resend: showResendButton ? () => sendRef.current() : null, resending: isSending, openMessages: () => setShowMessaging(true), newReply: awaitingDanReply, messageCount: messages.length })
  }, [onActions, showResendButton, isSending, awaitingDanReply, messages.length])
  const isRevision = designStatus === 'in_revision'

  const statusBadge = (proof: Proof) => {
    if (proof.status === 'approved') {
      return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700"><CheckCircle2 className="w-2.5 h-2.5" />Approved</span>
    }
    if (proof.status === 'revision_requested') {
      return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700"><AlertTriangle className="w-2.5 h-2.5" />Revision</span>
    }
    if (proof.status === 'rejected') {
      return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-600">Rejected</span>
    }
    return <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">Pending</span>
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-4 h-4 animate-spin text-off-black/30" />
      </div>
    )
  }

  // Lightbox overlay for full-screen proof viewing
  const lightbox = lightboxUrl && (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[9999] cursor-pointer"
      onClick={() => setLightboxUrl(null)}
    >
      <button
        onClick={() => setLightboxUrl(null)}
        className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
      >
        <X className="w-8 h-8" />
      </button>
      <img
        src={lightboxUrl}
        alt="Proof preview"
        className="max-w-[90vw] max-h-[90vh] object-contain select-none"
        onClick={e => e.stopPropagation()}
        draggable={false}
      />
    </div>
  )

  // ═══ Designer ↔ customer Q&A — compose a question + see replies ═══
  // Rendered in both compact and full modes so Dan can always reach the
  // customer. Disabled (with a hint) when there's no email on the order.
  // In the sidebar layout a new reply shows as a badge on the action, not a dialog that opens by itself.
  const messagingOpen = showMessaging || (!onActions && awaitingDanReply)
  const labelOptions = [...new Set(proofs.map(p => p.groupLabel).filter((l): l is string => !!l))]
  const messagingInline = (
    <div className="border border-border-gray rounded-md bg-white">
      <button
        type="button"
        onClick={() => setShowMessaging(!messagingOpen)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-left"
      >
        <MessageSquare className="w-3.5 h-3.5 text-off-black/50" />
        <p className="text-[11px] font-semibold text-off-black/60 uppercase tracking-wider">Message customer</p>
        {awaitingDanReply && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-100 text-purple-700">New reply</span>
        )}
        {messages.length > 0 && !awaitingDanReply && (
          <span className="text-[10px] text-off-black/40">({messages.length})</span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-off-black/40 ml-auto transition-transform ${messagingOpen ? 'rotate-180' : ''}`} />
      </button>

      {messagingOpen && (
      <div className="px-3 pb-3 space-y-2">
      {messages.length > 0 && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {messages.map(m => {
            const isDesigner = m.sender === 'designer'
            return (
              <div key={m.id} className="flex" style={{ justifyContent: isDesigner ? 'flex-end' : 'flex-start' }}>
                <div className={`max-w-[85%] px-2.5 py-1.5 rounded-lg ${isDesigner ? 'bg-dark-fill text-white' : 'bg-purple-50 text-off-black border border-purple-200'}`}>
                  <p className="text-[9px] font-semibold opacity-60 mb-0.5">{isDesigner ? 'Dan' : 'Customer'}</p>
                  <p className="text-xs whitespace-pre-wrap leading-snug"><Linkify text={m.body} /></p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={customerEmail ? 'Ask the customer a question…' : 'No customer email on this order'}
        disabled={!customerEmail || isAsking}
        className="w-full px-3 py-2 border border-border-gray rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-off-black/20 resize-none bg-white disabled:opacity-50"
        rows={2}
      />
      <button
        onClick={askCustomer}
        disabled={isAsking || !question.trim() || !customerEmail}
        className="w-full px-3 py-2 text-xs font-medium text-white bg-dark-fill hover:opacity-90 rounded-md transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
      >
        {isAsking ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
        ) : (
          <><Send className="w-3.5 h-3.5" /> Email question to customer</>
        )}
      </button>
      </div>
      )}
    </div>
  )
  const messagingBlock = !onActions ? messagingInline : messagingOpen ? (
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={() => setShowMessaging(false)}>
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-full overflow-auto" onClick={e => e.stopPropagation()}>
        {messagingInline}
      </div>
    </div>
  ) : null

  // ═══ COMPACT MODE: just thumbnails for reference ═══
  if (isCompact && proofs.length > 0) {
    return (
      <div className="space-y-2">
        {lightbox}
        <div className="flex flex-wrap gap-2">
          {[...proofs].reverse().map((proof) => (
            <div key={proof.id} className="relative group">
              {proof.imageUrl.toLowerCase().includes('.pdf') ? (
                <a href={proof.imageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-border-gray bg-white hover:bg-gray-50 transition-colors">
                  <span className="text-sm">📄</span>
                  <span className="text-[10px] text-off-black/50 max-w-[80px] truncate">{proof.fileName || `v${proof.version}`}</span>
                </a>
              ) : (
                <button onClick={() => setLightboxUrl(proof.imageUrl)} className="block">
                  <img
                    src={proof.thumbnailUrl || proof.imageUrl}
                    alt={`Proof v${proof.version}`}
                    className="h-14 w-14 object-cover rounded-md border border-border-gray hover:opacity-90 transition-opacity cursor-pointer"
                  />
                </button>
              )}
              <div className="absolute -top-1 -right-1">
                {statusBadge(proof)}
              </div>
            </div>
          ))}
        </div>
        {/* Minimal approval link — just a copy button */}
        {approvalUrl && (
          <button
            onClick={copyLink}
            className="text-[10px] text-off-black/30 hover:text-off-black/50 flex items-center gap-1 transition-colors"
          >
            {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
            {copied ? 'Copied approval link' : 'Copy approval link'}
          </button>
        )}
        {messagingBlock}
      </div>
    )
  }

  // ═══ FULL MODE: upload UI, approval link, proof history ═══
  const pendingCount = proofs.filter(p => p.status === 'pending').length
  // Adding proofs sits under the current batch, where the next one joins it.
  const uploadBlock = (
    <>
      {/* Upload Proofs. Small until files are chosen; the label picker only
          shows once there is something to label. */}
      {filePreviews.length > 0 ? (
        <div className="bg-subtle-gray border border-border-gray rounded-md p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {filePreviews.map((fp, idx) => (
              <div key={idx} className="relative">
                {fp.preview === 'pdf' ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border-gray bg-white">
                    <span className="text-lg">📄</span>
                    <p className="text-[10px] font-medium text-off-black truncate max-w-[120px]">{fp.name}</p>
                  </div>
                ) : (
                  <img src={fp.preview} alt={fp.name} className="h-16 w-16 object-cover rounded-md border border-border-gray" />
                )}
                <button
                  onClick={() => removeFile(idx)}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center hover:bg-red-600"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            {selectedFiles.length < 20 && (
              <label className="cursor-pointer flex items-center justify-center h-16 w-16 rounded-md border-2 border-dashed border-border-gray hover:border-off-black/30 transition-colors">
                <ImagePlus className="w-4 h-4 text-off-black/30" />
                <input type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
              </label>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {allowGroups && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-off-black/50 whitespace-nowrap">Options for</span>
                <LabelPicker value={groupLabel} options={labelOptions} onChange={setGroupLabel} />
              </div>
            )}
            <button
              onClick={uploadProofs}
              disabled={isUploading}
              className="px-3 py-1.5 text-xs font-medium text-white bg-dark-fill hover:opacity-90 rounded-md transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {isUploading ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading {selectedFiles.length}...</>
              ) : (
                <><Upload className="w-3.5 h-3.5" /> Upload {selectedFiles.length} proof{selectedFiles.length !== 1 ? 's' : ''}</>
              )}
            </button>
            <button onClick={clearFiles} className="px-2 py-1.5 text-xs text-off-black/40 hover:text-off-black/60 transition-colors">
              Clear
            </button>
          </div>
        </div>
      ) : (
        // One big target: click to pick, drag files in, or paste.
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); addFiles(Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'))) }}
          className={`cursor-pointer flex flex-col items-center justify-center gap-1.5 w-full rounded-lg border-2 border-dashed text-center transition-colors ${proofs.length ? 'py-5' : 'py-10'} ${dragging ? 'border-[#4600D6] bg-[#4600D6]/[0.04]' : 'border-border-gray bg-subtle-gray/40 hover:border-off-black/25 hover:bg-subtle-gray'}`}
        >
          <ImagePlus className={`w-6 h-6 ${dragging ? 'text-[#4600D6]' : 'text-off-black/35'}`} />
          <span className="text-sm font-medium text-off-black/75">{pendingCount > 0 ? 'Add proofs to this batch' : 'Upload proofs'}</span>
          <span className="text-xs text-off-black/40">Click to choose, drag them in, or paste from the clipboard</span>
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
        </label>
      )}

      {/* Note for customer — visible when uploading or ready to send */}
      {showNoteField && (
        <textarea
          value={sendNote}
          onChange={(e) => setSendNote(e.target.value)}
          placeholder="Add a note for the customer (optional)..."
          className="w-full px-3 py-2 border border-border-gray rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-off-black/20 resize-none bg-white"
          rows={2}
        />
      )}

      {/* Send to Customer */}
      {showSendButton && (
        <div>
          <button
            onClick={sendToCustomer}
            disabled={isSending}
            className="w-full px-3 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
            ) : (
              <><Send className="w-4 h-4" /> {isRevision ? 'Send Updated Proofs' : 'Send Proofs to Customer'}</>
            )}
          </button>
        </div>
      )}

      {showResendButton && !onActions && (
        <button
          onClick={sendToCustomer}
          disabled={isSending}
          className="w-full px-3 py-1.5 text-xs text-amber-700 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {isSending ? (
            <><Loader2 className="w-3 h-3 animate-spin" /> Resending...</>
          ) : (
            <><RotateCcw className="w-3 h-3" /> Re-send Email to Customer</>
          )}
        </button>
      )}

    </>
  )

  return (
    <div className="space-y-3" onPaste={handlePaste}>
      {lightbox}
      {/* The heading, with the approval link's actions on its right. Sending
          the proofs makes the link; there is nothing to generate by hand. */}
      <div className="flex items-center justify-between gap-2 -mb-1.5">
        {heading}
        {approvalUrl && (
          <div className="flex items-center gap-1">
            <button
              onClick={copyLink}
              className="px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:text-blue-800 rounded transition-colors flex items-center gap-1"
              title="Copy the approval link"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a
              href={approvalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:text-blue-800 rounded transition-colors flex items-center gap-1"
              title="Open the portal in a new tab"
            >
              <ExternalLink className="w-3 h-3" />
              Open
            </a>
            <button
              onClick={generateToken}
              className="px-1 py-0.5 text-[10px] text-off-black/30 hover:text-off-black/50 transition-colors"
              title="Regenerate link"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Proof History — thumbnail grid grouped by batch */}
      {(() => {
        const currentBatch = proofs.filter(p => p.status === 'pending')
        const previousProofs = proofs.filter(p => p.status !== 'pending')

        // The current batch is what the customer is looking at: big enough to judge, click to enlarge.
        const renderThumbnail = (proof: Proof, big = false) => (
          <div key={proof.id} className="relative group">
            {proof.imageUrl.toLowerCase().includes('.pdf') ? (
              <a href={proof.imageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-border-gray bg-white hover:bg-gray-50 transition-colors">
                <span className="text-sm">📄</span>
                <span className="text-[10px] text-off-black/50 max-w-[80px] truncate">{proof.fileName || `v${proof.version}`}</span>
              </a>
            ) : (
              <button onClick={() => setLightboxUrl(proof.imageUrl)} className="block" title="Enlarge">
                <img
                  src={big ? proof.imageUrl : (proof.thumbnailUrl || proof.imageUrl)}
                  alt={`Proof v${proof.version}`}
                  className={big
                    ? 'h-48 w-auto max-w-[15rem] rounded-lg border border-border-gray hover:opacity-90 transition-opacity cursor-zoom-in'
                    : 'h-14 w-14 object-cover rounded-md border border-border-gray hover:opacity-90 transition-opacity cursor-pointer'}
                  loading="lazy"
                />
              </button>
            )}
            <div className={big ? 'absolute top-1.5 right-1.5' : 'absolute -top-1 -right-1'}>
              {statusBadge(proof)}
            </div>
            {/* Always visible: a double upload has to be undoable without
                hunting for a hover target, and the label picker below used
                to cover the old one on partner orders. */}
            <button
              onClick={() => { if (confirm('Delete this proof?')) deleteProof(proof.id) }}
              disabled={deletingId === proof.id}
              className="absolute -top-1.5 -left-1.5 z-10 bg-white border border-border-gray shadow-sm rounded-full w-5 h-5 flex items-center justify-center text-off-black/50 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition-colors disabled:opacity-50"
              title="Delete this proof"
            >
              {deletingId === proof.id ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <X className="w-3 h-3" strokeWidth={2.5} />
              )}
            </button>
            {/* The label sits under the thumbnail, always visible, so what
                each option is for can be read at a glance and changed in place. */}
            {allowGroups && proof.status === 'pending' && (
              <div className={`mt-1 ${big ? 'w-36' : 'w-14'}`}>
                <LabelPicker
                  value={proof.groupLabel || ''}
                  options={labelOptions}
                  disabled={relabelingId === proof.id}
                  onChange={label => setProofGroup(proof.id, label)}
                  className="w-full !px-1 !py-0.5 !text-[9px]"
                />
              </div>
            )}
            {isAdmin && (proof.status === 'rejected' || proof.status === 'revision_requested') && (
              <button
                onClick={() => overrideApproval(proof)}
                disabled={overridingId === proof.id}
                className="mt-1 w-14 text-[9px] text-center text-off-black/45 hover:text-off-black underline decoration-dotted disabled:opacity-50"
                title="The customer meant this one: make it the approved option"
              >
                {overridingId === proof.id ? 'Saving…' : 'Make approved'}
              </button>
            )}
            {allowGroups && proof.status !== 'pending' && proof.groupLabel && (
              <p className="mt-1 w-14 text-[9px] text-center text-off-black/40 truncate" title={proof.groupLabel}>{proof.groupLabel}</p>
            )}
          </div>
        )

        // Group previous proofs by batch number (descending — most recent first)
        const batchMap = new Map<number, Proof[]>()
        previousProofs.forEach(p => {
          const b = p.batch || 1
          if (!batchMap.has(b)) batchMap.set(b, [])
          batchMap.get(b)!.push(p)
        })
        const sortedBatches = [...batchMap.entries()].sort((a, b) => b[0] - a[0])

        return (
          <>
            {/* Current batch */}
            {currentBatch.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-off-black/40 uppercase tracking-wider mb-1.5">Current batch ({currentBatch.length})</p>
                {allowGroups && currentBatch.some(p => p.groupLabel) ? (
                  <div className="space-y-2">
                    {(() => {
                      const groups = new Map<string, Proof[]>()
                      currentBatch.forEach(p => {
                        const k = p.groupLabel || ''
                        if (!groups.has(k)) groups.set(k, [])
                        groups.get(k)!.push(p)
                      })
                      return [...groups.entries()].map(([label, items]) => (
                        <div key={label || '__none__'} className="border border-border-gray rounded-md p-2 bg-white">
                          <div className="flex items-center gap-2 mb-1.5">
                            {renamingLabel === label ? (
                              <input
                                autoFocus
                                type="text"
                                defaultValue={label}
                                onBlur={e => renameGroup(label, e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') renameGroup(label, (e.target as HTMLInputElement).value)
                                  if (e.key === 'Escape') setRenamingLabel(null)
                                }}
                                className="px-2 py-0.5 text-[11px] border border-border-gray rounded bg-white focus:outline-none focus:ring-1 focus:ring-off-black/20"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setRenamingLabel(label)}
                                className="text-[11px] font-semibold text-off-black/70 hover:text-off-black"
                                title="Rename this label"
                              >
                                {label || 'No label'}
                              </button>
                            )}
                            <span className="text-[10px] text-off-black/35">{items.length} option{items.length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {[...items].reverse().map(p => renderThumbnail(p, true))}
                          </div>
                        </div>
                      ))
                    })()}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {[...currentBatch].reverse().map(p => renderThumbnail(p, true))}
                  </div>
                )}
              </div>
            )}

            {uploadBlock}

            {/* Previous batches — grouped by round */}
            {sortedBatches.map(([batchNum, batchProofs]) => {
              const feedback = [...batchProofs].reverse().find(p => p.customerFeedback)
              const batchDate = batchProofs[0]?.createdAt
                ? new Date(batchProofs[0].createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : null
              return (
                <div key={batchNum} className="mt-3">
                  <p className="text-[10px] font-semibold text-off-black/30 uppercase tracking-wider mb-1.5">
                    Batch {batchNum}{batchDate ? ` - ${batchDate}` : ''} ({batchProofs.length})
                  </p>
                  {feedback && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-2">
                      <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-0.5">Customer Feedback</p>
                      <p className="text-xs text-amber-900">{feedback.customerFeedback}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 opacity-60">
                    {[...batchProofs].reverse().map(p => renderThumbnail(p))}
                  </div>
                </div>
              )
            })}
          </>
        )
      })()}

      {messagingBlock}
    </div>
  )
}
