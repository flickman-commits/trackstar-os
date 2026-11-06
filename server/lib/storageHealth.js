/**
 * Watch that Supabase Storage still takes uploads. On 2026-11-02 every write
 * (customer photos, comment images, render PDFs) hung for an afternoon while
 * reads kept working, and nobody knew until uploads spun forever in the app.
 *
 * Each auto-import run (every 10 minutes) writes a tiny file and deletes it.
 * If two tries in a row fail, Slack hears about it, again every hour while it
 * lasts, and once more when uploads work again. State lives in SystemConfig
 * (storage_upload_health) so every instance agrees on what was already said.
 */
import prisma from '../db.js'
import { storage } from './storage.js'
import { slackTo } from './slack.js'

const KEY = 'storage_upload_health'
const BUCKET = 'order-comments'
const TRY_MS = 15000
const REMIND_MS = 60 * 60 * 1000


// Plain fetch, not storage(): that client covers for a write that saves but
// never answers, which is exactly what this has to notice.
async function tryUpload() {
  const path = `_health/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`
  const base = `${process.env.SUPABASE_URL}/storage/v1/object`
  const headers = { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY }
  const started = Date.now()
  try {
    const res = await fetch(`${base}/${BUCKET}/${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain', 'x-upsert': 'true' }, body: 'ok', signal: AbortSignal.timeout(TRY_MS) })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? `no answer in ${TRY_MS / 1000}s` : err.message }
  }
  await storage().storage.from(BUCKET).remove([path]).catch(() => {})
  return { ok: true, ms: Date.now() - started }
}

export async function checkStorageUploads() {
  let result = await tryUpload().catch(err => ({ ok: false, reason: err.message }))
  if (!result.ok) result = await tryUpload().catch(err => ({ ok: false, reason: err.message }))

  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } })
  const state = row ? JSON.parse(row.value) : {}
  const now = Date.now()
  const save = value => prisma.systemConfig.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } })

  if (result.ok) {
    if (state.failingSince) {
      const mins = Math.round((now - new Date(state.failingSince).getTime()) / 60000)
      await slackTo('alerts', `:white_check_mark: *Uploads are working again* (Supabase Storage). They were down about ${mins} minutes. Re-render any orders that failed with "Upload failed" in that window.`, { or: 'matt' })
      await save({})
    }
    return result
  }

  const failingSince = state.failingSince || new Date(now).toISOString()
  const lastAlert = state.alertedAt ? new Date(state.alertedAt).getTime() : 0
  if (now - lastAlert >= REMIND_MS) {
    const first = !state.alertedAt
    await slackTo('alerts', `:rotating_light: *${first ? 'Uploads are failing' : 'Uploads are still failing'}* (Supabase Storage, since ${new Date(failingSince).toUTCString()}). Customer photo uploads, comment images and render PDFs will not save. Error: ${String(result.reason).slice(0, 200)}. Check the Supabase dashboard (usage, restart project) or status.supabase.com.`, { or: 'matt' })
    await save({ failingSince, alertedAt: new Date(now).toISOString() })
  } else if (!state.failingSince) {
    await save({ ...state, failingSince })
  }
  return result
}
