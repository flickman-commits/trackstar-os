/**
 * Shared API fetch wrapper for merchant API calls (not the customer-facing
 * approval portal). Auth rides on an httpOnly session cookie set by the login
 * flow — `credentials: 'include'` sends it. No secret is held in the client.
 * On 401 the person is told once, with a Reload button, instead of the page
 * reloading on its own: an automatic reload threw away whatever was open (an
 * edit, a reply being written, the Sales queue).
 */
import { toast } from 'sonner'

let toldSignedOut = false

/**
 * When this tab last asked the server to change something. A list request
 * already in flight from before that time may describe the world before the
 * change, so readers that share requests (Dashboard loadView) start a new one.
 */
export let lastWriteAt = 0

/**
 * Wrapper around fetch that includes the session cookie.
 * Same signature as native fetch.
 */
export async function apiFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const method = String(init?.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') lastWriteAt = Date.now()
  const response = await fetch(url, { ...init, credentials: 'include' })
  if (response.status === 401 && !toldSignedOut) {
    // Session expired or ended (signed out elsewhere, password changed). Say so
    // and let them copy anything unsaved before Reload shows the sign-in.
    toldSignedOut = true
    toast.error('You were signed out. Copy anything you have not saved, then reload to sign in again.', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => window.location.reload() },
    })
  }
  return response
}
