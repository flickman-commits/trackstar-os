/**
 * The People pages' data: who is on the team, what each person can do, and
 * the few things about a person that live on other screens (where orders
 * and conversations go, pay, API keys). All admin only.
 */
import type { Capability, Caps, Role } from '@/lib/roles'

const API_BASE = import.meta.env.VITE_API_URL || ''

export type PersonStatus = 'active' | 'invited' | 'deactivated'

export interface Person {
  id: string
  email: string
  firstName: string
  lastName: string
  name: string
  role: string
  extraRoles?: string[]
  extraCaps?: string[]
  deniedCaps?: string[]
  /** Every role they have, main one first. */
  roles: Role[]
  /** Everything they can do in all: '*' for an admin. */
  caps: Caps
  status: PersonStatus
  isActive: boolean
  hasPassword: boolean
  lastLoginAt: string | null
  lastSeenAt: string | null
  createdAt: string
  inviteExpiresAt: string | null
  hourlyRateCents: number | null
  customRateCents: number | null
  customRepeatRateCents: number | null
}

export interface CapabilityInfo { id: Capability; group: string; label: string; blurb?: string }
export interface RoleInfo { id: Role; label: string; members: { id: string; name: string }[] }
export interface RolesPayload {
  roles: RoleInfo[]
  capabilities: CapabilityInfo[]
  caps: Record<string, Capability[]>
  defaults: Record<string, Capability[]>
}

export function api(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await api(path)
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || 'Could not load')
  return d as T
}

export async function postJson<T = unknown>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const res = await api(path, { method, body: JSON.stringify(body) })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || 'That did not work')
  return d as T
}

export const loadPeople = () => getJson<{ users: Person[] }>('/api/admin/users').then(d => d.users || [])
export const loadRoles = () => getJson<RolesPayload>('/api/admin/roles')

export function ago(iso: string | null): string {
  if (!iso) return 'Never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const dollars = (cents: number | null | undefined) => cents == null ? '' : (cents / 100).toFixed(2)
export const toCents = (text: string): number | null => {
  const t = text.trim().replace(/^\$/, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}
