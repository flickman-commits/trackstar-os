/**
 * Typed client for /api/support/*. One place that knows the URLs and the
 * shapes, so the Support screens never touch fetch or JSON directly.
 */
import { apiFetch } from '@/lib/api'
import type { SenderFilter, BackfillResult, InboxPayload, InboxSort, InboxView, InstagramBackfillResult, InstagramStatus, Macro, MailboxStatus, Note, SyncResult, ThreadDetail, ThreadRow, ThreadStatus, RoutingRules } from '@/types/support'

const API_BASE = import.meta.env.VITE_API_URL || ''

export class SupportApiError extends Error {
  code?: string
  constructor(message: string, code?: string) { super(message); this.code = code }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = data as { error?: string; code?: string }
    throw new SupportApiError(d.error || `Request failed (${res.status})`, d.code)
  }
  return data as T
}
const post = <T,>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) })
const act = <T,>(id: string, action: string, extra: Record<string, unknown> = {}) => post<T>('/api/support/thread', { id, action, ...extra })

/**
 * A fresh key for one press of a button that moves money or changes an
 * order. Made when the confirm step opens and sent with the request, so a
 * double click or a retry of the same press is refused by the server
 * instead of running twice. A new press gets a new key.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** A Support conversation with an order's customer, as the order view lists it. */
export interface OrderConversation { id: string; subject: string; status: ThreadStatus; snippet: string; lastMessageAt: string; snoozed: boolean; channel: string; assignee: string | null }

export const supportApi = {
  status: () => request<MailboxStatus>('/api/support/gmail?action=status'),
  // TrackstarOS's "Email customer": a new conversation about one order.
  orderConversations: (orderId: string) => request<{ threads: OrderConversation[] }>(`/api/support/compose?orderId=${encodeURIComponent(orderId)}`),
  // A place to PUT one attachment from the rep's computer; the reply names it by ref.
  uploadSlot: (filename: string, contentType: string, size: number) => post<{ ref: string; uploadUrl: string; filename: string }>('/api/support/upload', { filename, contentType, size }),
  emailCustomer: (orderId: string, subject: string, text: string) => post<{ threadId: string; to: string; subject: string }>('/api/support/compose', { orderId, subject, text }),
  connectUrl: `${API_BASE}/api/support/gmail?action=connect`,
  disconnect: () => post<{ success: boolean }>('/api/support/gmail', { action: 'disconnect' }),
  sync: () => post<SyncResult>('/api/support/sync', {}),
  backfill: () => post<BackfillResult>('/api/support/backfill', {}),
  // Instagram: the @trackstar_art connection. DMs arrive by webhook; there is no sync to call.
  instagramStatus: () => request<InstagramStatus>('/api/support/instagram?action=status'),
  instagramConnectUrl: `${API_BASE}/api/support/instagram?action=connect`,
  instagramToken: (accessToken: string) => post<{ success: boolean; username: string }>('/api/support/instagram', { action: 'token', accessToken }),
  instagramBackfill: () => post<InstagramBackfillResult>('/api/support/instagram', { action: 'backfill' }),
  instagramDisconnect: () => post<{ success: boolean }>('/api/support/instagram', { action: 'disconnect' }),
  inbox: (view: InboxView, sort: InboxSort, q = '') => request<InboxPayload>(`/api/support/threads?view=${encodeURIComponent(view)}&sort=${sort}&q=${encodeURIComponent(q)}`),
  thread: (id: string) => request<ThreadDetail>(`/api/support/thread?id=${encodeURIComponent(id)}`),
  assign: (id: string, assigneeId: string | null) => act<ThreadRow>(id, 'assign', { assigneeId }),
  setStatus: (id: string, status: ThreadStatus) => act<ThreadRow>(id, 'status', { status }),
  snooze: (id: string, until: string | null) => act<ThreadRow>(id, 'snooze', { until }),
  setPriority: (id: string, priority: boolean) => act<ThreadRow>(id, 'priority', { priority }),
  setTags: (id: string, tags: string[]) => act<ThreadRow>(id, 'tags', { tags }),
  addNote: (id: string, body: string, mentions: string[]) => act<Note>(id, 'note', { body, mentions }),
  deleteNote: (id: string, noteId: string) => act<{ id: string }>(id, 'deleteNote', { noteId }),
  markUnread: (id: string) => act<{ ok: boolean }>(id, 'unread'),
  reply: (id: string, text: string, close = false, attachments: string[] = []) => post<ThreadDetail>('/api/support/reply', { id, text, close, attachments }),
  settings: () => request<{ defaultAssigneeId: string | null; playbook?: { text: string; edited: boolean; updatedAt: string | null }; forwarders?: string[]; routing?: RoutingRules; draftModel?: string; draftModels?: { id: string; label: string; note: string }[]; draftModelPinned?: boolean }>('/api/support/settings'),
  saveDraftModel: (model: string) => post<{ draftModel: string }>('/api/support/settings', { action: 'draftModel', model }),
  saveRouting: (routing: RoutingRules, applyToOpen = false) => post<{ routing: RoutingRules; assigned: number }>('/api/support/settings', { action: 'routing', routing, applyToOpen }),
  saveForwarders: (emails: string[]) => post<{ forwarders: string[] }>('/api/support/settings', { action: 'forwarders', emails }),
  savePlaybook: (text: string) => post<{ playbook: { text: string; edited: boolean } }>('/api/support/settings', { action: 'playbook', text }),
  resetPlaybook: () => post<{ playbook: { text: string; edited: boolean } }>('/api/support/settings', { action: 'playbookReset' }),
  /** Turn a correction to a draft into playbook rules, then save the approved ones. */
  proposeLessons: (noteId: string, feedback: string) => post<{ lessons: string[] }>('/api/support/teach', { action: 'propose', noteId, feedback }),
  saveLessons: (lessons: string[]) => post<{ playbook: { text: string; edited: boolean } }>('/api/support/teach', { action: 'save', lessons }),
  redraft: (id: string, instruction: string) => act<Note>(id, 'redraft', { instruction }),
  setProposal: (id: string, noteId: string, proposalId: string, status: 'done' | 'dismissed') => act<Note>(id, 'proposal', { noteId, proposalId, status }),
  merge: (id: string, sourceIds: string[]) => act<ThreadDetail>(id, 'merge', { sourceIds }),
  // Attach an order to this customer by its number, for when they ordered under another email.
  linkOrder: (id: string, number: string) => act<ThreadDetail>(id, 'linkOrder', { number }),
  unlinkOrder: (id: string, number: string) => act<ThreadDetail>(id, 'unlinkOrder', { number }),
  saveSettings: (defaultAssigneeId: string | null, applyToOpen = false) => post<{ defaultAssigneeId: string | null; assigned: number }>('/api/support/settings', { defaultAssigneeId, applyToOpen }),
  filters: () => request<{ filters: SenderFilter[] }>('/api/support/filters'),
  addFilter: (pattern: string) => post<{ pattern: string; filed: number; filters: SenderFilter[] }>('/api/support/filters', { action: 'add', pattern }),
  removeFilter: (pattern: string) => post<{ pattern: string; restored: number; filters: SenderFilter[] }>('/api/support/filters', { action: 'remove', pattern }),
  macros: () => request<{ macros: Macro[] }>('/api/support/macros'),
  /** The quick actions beside a conversation (server/domain/support/actions.js). */
  action: <T = Record<string, unknown>,>(action: string, body: Record<string, unknown>) => post<T>('/api/support/actions', { action, ...body }),
  // A new Artelo order (reprint or replacement): 'prep' then 'create'.
  arteloOrder: <T = Record<string, unknown>,>(body: Record<string, unknown>) => post<T>('/api/support/artelo', body),
  saveMacro: (m: { id?: string; name: string; shortcut?: string; body: string }) => post<Macro>('/api/support/macros', { action: 'save', ...m }),
  deleteMacro: (id: string) => post<{ id: string }>('/api/support/macros', { action: 'delete', id }),
  useMacro: (id: string) => post<{ ok: boolean }>('/api/support/macros', { action: 'use', id }),
}
