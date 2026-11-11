/**
 * PUT a file to a signed Supabase Storage upload URL.
 *
 * Supabase has stored files and then never answered: its gateway returns a
 * 504 after 60s while the file sits intact in the bucket (2026-11-02, every
 * upload for an afternoon). A 504 here is therefore treated as saved, and the
 * step after it, which reads or records the file, finds it. Any other failure
 * comes back unchanged.
 */
export async function putUpload(url: string, init: RequestInit): Promise<Response> {
  let res: Response
  // A dropped connection is a sentence a person can act on, not the browser's "Load failed".
  try { res = await fetch(url, { ...init, method: 'PUT' }) }
  catch { throw new Error('The upload did not get through. Check your connection and try again.') }
  if (res.status === 504) return new Response(null, { status: 200 })
  return res
}
