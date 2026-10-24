/** Shapes from /api/support/*. The server builds them in server/domain/support/threads.js. */

export type ThreadStatus = 'open' | 'waiting' | 'escalated' | 'closed'
/** A built-in view, or `teammate:<id>`. */
export type InboxView = 'inbox' | 'mentions' | 'unassigned' | 'all' | 'waiting' | 'escalated' | 'snoozed' | 'closed' | 'filtered' | `teammate:${string}`
export type InboxSort = 'waiting' | 'newest' | 'oldest' | 'priority'
/** Where the conversation happens: the fast@ mailbox, or a DM to @trackstar_art. */
export type Channel = 'email' | 'instagram'

export interface Teammate { id: string; firstName: string; lastName: string }

export interface ThreadRow {
  id: string
  channel: Channel
  /** The customer's Instagram handle, without the @. Empty for email. */
  igUsername: string
  subject: string
  customerEmail: string
  customerName: string
  status: ThreadStatus
  snoozedUntil: string | null
  assignee: Teammate | null
  priority: boolean
  tags: string[]
  snippet: string
  messageCount: number
  lastMessageAt: string
  lastInboundAt: string | null
  lastOutboundAt: string | null
  backfilled: boolean
  /** From a sender the team filtered out: shown only under Filtered. */
  filtered: boolean
  /** The customer wrote since you last opened it. */
  unread: boolean
}

export interface InboxCounts {
  inbox: number; mentions: number; unassigned: number; all: number
  waiting: number; escalated: number; snoozed: number
  byAssignee: Record<string, number>
}

export interface InboxPayload {
  threads: ThreadRow[]
  counts: InboxCounts
  team: Teammate[]
  tagSuggestions: string[]
  me: Teammate & { role: string }
}

export interface Attachment { filename: string; mimeType: string; size: number; attachmentId: string; url?: string | null }

export interface Message {
  id: string
  channel: Channel
  gmailMessageId: string | null
  igMessageId: string | null
  direction: 'in' | 'out'
  fromEmail: string
  fromName: string
  toEmails: string
  ccEmails: string
  subject: string
  /** What the person wrote, with the quoted thread underneath removed. */
  text: string
  /** The quoted part, for a "show quoted text" toggle. */
  quoted: string
  attachments: Attachment[]
  sentAt: string
  sentBy: Teammate | null
}

/** An internal note, or an event the system wrote (assigned, closed, snoozed). */
/** Claude's working behind a draft. */
export interface DraftData {
  scenario?: string
  summary?: string
  keyFacts?: string[]
  steps?: string[]
  actions?: { name: string; why: string }[]
  escalate?: { needed: boolean; reason: string }
  needsInfo?: string
  instruction?: string | null
  model?: string
  proposals?: Proposal[]
  /** Set when the orders were matched by a quoted number or a name, not the thread's email. */
  foundBy?: { by: 'orderNumber' | 'name'; orderNumbers?: string[] } | null
}

/** A suggested action on Claude's draft, filled in and waiting for a person's Approve. */
export interface Proposal {
  id: string
  type: 'shippingAddress' | 'discount' | 'orderNote' | 'changeItem'
  label: string
  orderNumber?: string
  shopifyOrderId?: string
  orderId?: string
  address?: Address
  percent?: number
  text?: string
  size?: string | null
  frame?: string | null
  status?: 'done' | 'dismissed'
  by?: string | null
}

export interface Note {
  id: string
  kind: 'note' | 'event' | 'draft'
  body: string
  data?: DraftData | null
  author: Teammate | null
  authorName: string
  mentions: string[]
  createdAt: string
}

export interface OrderItem {
  orderId: string
  orderNumber: string
  item: number
  type: string
  status: string
  designStatus: string | null
  runner: string
  race: string
  year: number
  size: string
  frame: string
  isRush: boolean
  dueDate: string | null
  approvalUrl: string | null
  hasPhoto: boolean
  heroImageUrl: string | null
  productLabel: string | null
}

export interface Address { name: string; address1: string; address2: string; city: string; province: string; zip: string; country: string; phone: string }

export interface CustomerOrder {
  number: string
  source: string
  shopifyOrderId: string | null
  adminUrl: string | null
  arteloUrl: string | null
  createdAt: string
  financialStatus: string | null
  fulfillmentStatus: string | null
  /** The order's total in dollars, when known. */
  totalUsd?: number | null
  discountCodes: string[]
  shipTo: Address | null
  shipToLine: string
  /** The address Artelo has, when we have its copy of the order. */
  arteloAddress: Address | null
  /** fromArtelo: the fulfillment Artelo created in Shopify, which is where its tracking lives. */
  tracking: { url: string | null; number: string | null; company: string | null; at: string | null; fromArtelo: boolean; deliveredAt: string | null }[]
  lineItems: { title: string; variant: string | null; quantity: number }[]
  items: OrderItem[]
  imported: boolean
  /** Designs and proofs that can go to the customer, newest first. */
  mockups: Mockup[]
  /** Here only because a teammate linked it to this customer by number (they ordered under another email). */
  linked?: boolean
  /** A replacement made in Artelo (never in Shopify): of the order numbered `of`. by: 'artelo' when Artelo made it (free), 'us' from New Artelo order. */
  replacement?: { of: string; stage: string; free: boolean; by: 'artelo' | 'us'; instructions: string | null }
}

/** A mockup a rep can attach: the page holds only the reference; the server sends the file. */
export interface Mockup { ref: string; orderId: string; kind: 'render' | 'proof' | 'upload'; label: string; thumbUrl: string | null; at: string }

export interface PastThread { id: string; subject: string; status: ThreadStatus; lastMessageAt: string; messageCount: number }

/** Meta's rule for a DM: a reply may go out within 24 hours of the customer's last message (7 days with the human-agent permission). */
export interface ReplyWindow {
  open: boolean
  mode: 'standard' | 'human_agent' | 'closed' | 'none'
  closesAt: string | null
  reason: string | null
}

export interface ThreadDetail extends ThreadRow {
  gmailThreadId: string | null
  createdAt: string
  messages: Message[]
  notes: Note[]
  /** Set on an Instagram thread; null for email, which has no window. */
  replyWindow: ReplyWindow | null
  customer: { email: string; name: string; instagram: string | null; firstSeen: string; conversations: number }
  /** spentUsd: what they have spent across these orders, refunds left out; bigSpender at $300 or more. */
  context: { orders: CustomerOrder[]; shopifyError: string | null; spentUsd?: number; bigSpender?: boolean }
  pastThreads: PastThread[]
  /** Order numbers the customer wrote that are real orders and not in the panel yet. */
  suggestedOrders?: { number: string; orderedAt: string; items: { race: string; year: number | null; runner: string | null }[] }[]
}

export interface Macro { id: string; name: string; shortcut: string | null; body: string; uses: number; updatedAt: string; createdBy: { id: string; firstName: string } | null }

export interface MailboxStatus {
  configured: boolean
  connected: boolean
  email: string | null
  expectedEmail: string
  backfill: { done: boolean; count: number; inProgress: boolean }
  lastImportedAt: string | null
}

export interface InstagramStatus {
  configured: boolean
  connected: boolean
  username: string | null
  accountId: string | null
  expectedHandle: string
  tokenExpiresAt: string | null
  humanAgent: boolean
  webhookConfigured: boolean
  lastImportedAt: string | null
}
export interface InstagramBackfillResult { conversations: number; seen: number; imported: number; failed: number }

export interface SyncResult { imported?: number; failed?: number; mode?: string; seen?: number; skipped?: string }
export interface BackfillResult { done: boolean; imported: number; total: number }

/** What Shopify says about a discount code a customer pasted. */
export interface CodeLookup {
  code: string
  found: boolean
  verdict: string
  title?: string
  value?: string
  status?: string
  startsAt?: string | null
  endsAt?: string | null
  usageLimit?: number | null
  used?: number
  oncePerCustomer?: boolean
  fromKlaviyo?: boolean
}

/** A sender kept out of the inbox: an address or a domain. */
export interface SenderFilter { pattern: string; addedBy: string | null; addedAt: string }

/** Who new conversations on a channel go to (server/domain/support/routing.js). */
export interface RoutingRule { mode: 'none' | 'person' | 'split'; people: { userId: string; weight: number }[] }
export interface RoutingRules { email: RoutingRule; instagram: RoutingRule }
