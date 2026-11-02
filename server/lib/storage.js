/**
 * The one Supabase Storage client (proofs, photos, production files,
 * attachments, sales assets). Service role, server side only, made once per
 * instance rather than once per request in fifteen places.
 *
 * WRITES THAT SAVE BUT NEVER ANSWER
 * On 2026-11-02 Supabase Storage stored every upload and then never replied:
 * its gateway gave up with a 504 after 60s while the file sat intact in the
 * bucket. Every upload in the tool failed though nothing was lost. So a write
 * gets WRITE_WAIT_MS to answer; after that, or on a 504, we look the object
 * up in storage.objects (reads kept working) and, if it was written since the
 * request started, answer as Storage would have. A delete is checked the same
 * way. Anything else (a real 4xx, a file that is not there) fails as before.
 */
import { createClient } from '@supabase/supabase-js'
import prisma from '../db.js'

const WRITE_WAIT_MS = 20_000

let client = null

/**
 * Whether `bucket/name` exists and was written at or after `since` (a Date).
 * Read from Postgres, not the Storage API, so it works while Storage writes hang.
 */
export async function storedSince(bucket, name, since) {
  const rows = await prisma.$queryRaw`select updated_at from storage.objects where bucket_id = ${bucket} and name = ${name} limit 1`
  if (!rows.length) return false
  // A second of slack: storage stamps the row, we stamp the start.
  return !since || new Date(rows[0].updated_at).getTime() >= since.getTime() - 1000
}

async function exists(bucket, name) {
  const rows = await prisma.$queryRaw`select 1 from storage.objects where bucket_id = ${bucket} and name = ${name} limit 1`
  return rows.length > 0
}

/** Which bucket and object a Storage write URL is for, or null for anything else. */
export function writeTarget(url, method) {
  const m = String(url).match(/\/storage\/v1\/object\/(upload\/sign\/)?([^?]+)/)
  if (!m) return null
  const rest = decodeURIComponent(m[2])
  if (!m[1] && /^(sign|list|move|copy|info|public|authenticated|upload)\//.test(rest)) return null
  const [bucket, ...name] = rest.split('/')
  if (method === 'DELETE') return name.length ? null : { bucket, name: null }
  if (method !== 'POST' && method !== 'PUT') return null
  return name.length ? { bucket, name: name.join('/') } : null
}

async function patientFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input.url
  const method = String(init.method || 'GET').toUpperCase()
  const target = writeTarget(url, method)
  if (!target) return fetch(input, init)

  const started = new Date()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), WRITE_WAIT_MS)
  const signal = init.signal ? AbortSignal.any([init.signal, ctrl.signal]) : ctrl.signal
  let res = null
  try {
    res = await fetch(input, { ...init, signal })
    if (res.status !== 504) return res
  } catch (err) {
    if (!ctrl.signal.aborted || init.signal?.aborted) throw err
  } finally {
    clearTimeout(timer)
  }

  if (target.name) {
    if (await storedSince(target.bucket, target.name, started)) {
      console.warn(`[storage] ${target.bucket}/${target.name}: no answer from Storage, but the file is saved`)
      return new Response(JSON.stringify({ Key: `${target.bucket}/${target.name}`, Id: null }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  } else {
    // A delete: { prefixes: [...] } in the body.
    let names = []
    try { names = JSON.parse(String(init.body || '{}')).prefixes || [] } catch { /* not ours to judge */ }
    const left = []
    for (const n of names) if (await exists(target.bucket, n)) left.push(n)
    if (names.length && !left.length) {
      console.warn(`[storage] delete in ${target.bucket}: no answer from Storage, but the files are gone`)
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }
  }
  return res || new Response(JSON.stringify({ statusCode: '504', error: 'Timeout', message: 'Supabase Storage did not answer' }), { status: 504, headers: { 'content-type': 'application/json' } })
}

export function storage() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, global: { fetch: patientFetch } })
  }
  return client
}
