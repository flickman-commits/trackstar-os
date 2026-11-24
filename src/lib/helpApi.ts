/** Support > Help: the help center, the Ask box and case tags (api/_routes/support/help.js). */
import { apiFetch } from '@/lib/api'

const API_BASE = import.meta.env.VITE_API_URL || ''

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`${API_BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`)
  return data as T
}
const post = <T,>(body: unknown) => request<T>('/api/support/help', { method: 'POST', body: JSON.stringify(body) })

export type ArticleRow = { id: string; slug: string; title: string; group: string; position: number; pinned: boolean; updatedAt: string; reviewedAt: string | null; reviewEveryDays: number; stale: string[] }
export type Article = Omit<ArticleRow, 'stale'> & { body: string; versions: { id: string; createdAt: string; createdById: string | null }[] }
export type AskAnswer = { id: string; headline: string; steps: string[]; reply: string; why: string; articles: { slug: string; title: string }[]; cases: { id: string; summary: string; typeLabel: string; outcomeLabel: string }[]; covered: boolean }
/** A playbook card (server/domain/support/helpTopics.js): one kind of message, one screen. */
export type Topic = { slug: string; title: string; body: string; steps: string[]; notes: string[]; replies: { label: string; text: string }[]; details: { slug: string; title: string }[] }
export type Question = { id: string; askedByName: string; threadId: string | null; question: string; answer: string; sources: { articles?: { slug: string; title: string }[]; cases?: { id: string; summary: string }[]; covered?: boolean } | null; feedback: 'helpful' | 'wrong' | null; correction: string | null; review: 'pending' | 'approved' | 'dismissed' | null; createdAt: string }
export type CaseTag = { id: string; caseType: string | null; caseOutcome: string | null; caseSummary: string | null; caseCostCents: number | null; caseTaggedAt: string | null; caseTaggedBy: string | null }
export type Choice = [string, string]

export const helpApi = {
  articles: () => request<{ articles: ArticleRow[]; isAdmin: boolean }>('/api/support/help'),
  topics: () => request<{ topics: Topic[]; isAdmin: boolean }>('/api/support/help?topics=1'),
  article: (slug: string) => request<{ article: Article }>(`/api/support/help?slug=${encodeURIComponent(slug)}`),
  search: (q: string) => request<{ results: { slug: string; title: string; group: string; excerpt: string }[] }>(`/api/support/help?search=${encodeURIComponent(q)}`),
  log: () => request<{ recent: Question[]; pending: Question[] }>('/api/support/help?log=1'),
  caseOf: (threadId: string) => request<{ case: CaseTag | null; types: Choice[]; outcomes: Choice[] }>(`/api/support/help?case=${encodeURIComponent(threadId)}`),
  ask: (question: string, opts: { threadId?: string | null; previousId?: string | null } = {}) => post<AskAnswer>({ action: 'ask', question, threadId: opts.threadId || null, previousId: opts.previousId || null }),
  helpful: (id: string) => post<{ question: Question }>({ action: 'feedback', id, helpful: true }),
  notRight: (id: string, correction: string) => post<{ question: Question }>({ action: 'feedback', id, correction }),
  setCase: (threadId: string, patch: { type?: string; outcome?: string; summary?: string }) => post<{ case: CaseTag }>({ action: 'case', threadId, ...patch }),
  save: (a: { slug?: string; title: string; group: string; body: string; pinned?: boolean; reviewEveryDays?: number }) => post<{ article: Article; articles: ArticleRow[] }>({ action: 'save', ...a }),
  reviewed: (slug: string) => post<{ article: Article; articles: ArticleRow[] }>({ action: 'reviewed', slug }),
  restore: (versionId: string) => post<{ article: Article }>({ action: 'restore', versionId }),
  remove: (slug: string) => post<{ articles: ArticleRow[] }>({ action: 'delete', slug }),
  review: (id: string, decision: 'approve' | 'dismiss') => post<{ recent: Question[]; pending: Question[] }>({ action: 'review', id, decision }),
}
