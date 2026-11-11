/**
 * Loading a customer-facing page by its link (Manage your order, photo
 * upload, runner and partner intake, survey).
 *
 * Only a 404 or 410 means the link itself is gone. A busy server (429), a
 * server error, or a phone between signal bars used to show the same "this
 * link isn't working" card, which reads as final and sends the customer to
 * email support. Those are now "couldn't load, try again".
 */
export class LoadError extends Error {
  readonly gone: boolean
  readonly status: number | null
  readonly code: string | null
  constructor(gone: boolean, status: number | null = null, code: string | null = null) {
    super(gone ? 'gone' : 'unavailable')
    this.gone = gone
    this.status = status
    this.code = code
  }
}

export async function loadPublic<T>(url: string): Promise<T> {
  let res: Response
  try { res = await fetch(url) } catch { throw new LoadError(false) }
  const data = await res.json().catch(() => ({}))
  if (res.status === 404 || res.status === 410) throw new LoadError(true, res.status, (data as { error?: string })?.error || null)
  if (!res.ok) throw new LoadError(false, res.status, (data as { error?: string })?.error || null)
  return data as T
}

/** A network failure on a button ("Load failed", "Failed to fetch") as a sentence a customer can act on. */
export const OFFLINE = 'We could not reach Trackstar just now. Check your connection and try again.'
