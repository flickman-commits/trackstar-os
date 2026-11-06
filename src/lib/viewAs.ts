/** Settings > People > View as: start, switch or stop viewing TrackstarOS as someone (api/_routes/admin/view-as.js). */
const API_BASE = import.meta.env.VITE_API_URL || ''

export type ViewAsPerson = { id: string; name: string; roleLabel: string }

/** The people an admin can view as, read with the admin's own session. */
export async function listViewAsPeople(): Promise<ViewAsPerson[]> {
  const res = await fetch(`${API_BASE}/api/admin/view-as`, { credentials: 'include' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Could not load the team')
  return data.users || []
}

/** Start (userId) or stop (null) viewing as someone, then reload so every page reads as them. */
export async function setViewAs(userId: string | null) {
  const res = await fetch(`${API_BASE}/api/admin/view-as`, {
    method: userId ? 'POST' : 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: userId ? JSON.stringify({ userId }) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'That did not work')
  window.location.assign('/')
}
