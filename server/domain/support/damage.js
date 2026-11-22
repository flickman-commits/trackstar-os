/**
 * Damage reports: a customer told us a print arrived broken or damaged
 * (Matt, 2026-11-21: "the percentage of orders that arrive broken or
 * damaged"). Stats > "Orders that arrived damaged" counts them.
 *
 * The pass reads a conversation once the customer has written something it
 * has not read. Most conversations never mention damage, so it first looks
 * for a damage word in what the customer wrote (DAMAGE_WORDS), and only those
 * go to Claude, which decides whether a print or frame really arrived broken
 * or damaged (not lost, not the wrong print, not "will it be damaged?").
 *
 * A person's call wins: Mark as damaged / Not damaged on the conversation
 * saves source "person", and the pass never changes that row again.
 * api/_routes/cron/support-triage.js runs the pass; scripts/backfill-damage-reports.js
 * reads the history once.
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured, llmInfo } from '../../lib/llm.js'
import { stripQuoted } from './mailbox.js'
import { customerBlock, customerField, UNTRUSTED_RULE } from './untrusted.js'
import { recordAudit } from '../../../api/_lib/users.js'
import { UserError } from './errors.js'

const MODEL = 'claude-sonnet-5-5'
// A word that can mean damage, in what the customer wrote. Wide on purpose: Claude decides.
export const DAMAGE_WORDS = /\b(broke|broken|break|damag\w*|crack\w*|shatter\w*|smash\w*|dent\w*|bent|bend|crush\w*|scratch\w*|torn|tear|ripped|chipped|creas\w*|wrinkl\w*|water|wet|glass|loose)\b/i
const MAX_MESSAGES = 12
const CONCURRENCY = 4

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }

const SYSTEM = `You read customer support conversations for Trackstar, which sells personalized race prints, framed or unframed, shipped by our print partner.

Decide one thing: did the customer report that a print or frame they received ARRIVED BROKEN OR DAMAGED? That means physical damage on arrival: cracked or shattered glass or acrylic, a broken, bent, dented, chipped or scratched frame, a torn, creased, bent, scuffed or water-damaged print, a crushed box with the print damaged inside.

Not damage: an order that has not arrived or was lost, the wrong print, name, time, size or frame, a typo, a print they do not like, a question about packaging or whether it might get damaged, damage they caused themselves later, or damage to something that is not our product.

${UNTRUSTED_RULE}

Reply as JSON: {"damaged": true or false, "message": the number of the customer message where they first report it (null when not damaged), "order": the order number it is about if the conversation names one (digits only, no #) or null, "summary": "<at most 10 words: what is damaged, e.g. 'Glass cracked on the 12x18 frame'; no em dashes>"}`

function conversationText(thread, messages) {
  const lines = []
  let n = 0
  for (const m of messages) {
    const body = clip(m.channel === 'instagram' ? m.bodyText : stripQuoted(m.bodyText), 1500)
    if (!body) continue
    if (m.direction === 'in') { n++; lines.push(`CUSTOMER message ${n} on ${new Date(m.sentAt).toDateString()}:\n${customerBlock(body)}`) }
    else lines.push(`TRACKSTAR on ${new Date(m.sentAt).toDateString()}:\n${body}`)
  }
  return `Subject: ${customerField(thread.subject)}\n\n${lines.join('\n\n')}`
}

/** The customer's messages, oldest first, numbered the way the prompt numbers them. */
const inbound = messages => messages.filter(m => m.direction === 'in' && (m.channel === 'instagram' ? m.bodyText : stripQuoted(m.bodyText)).trim())

/** Read one conversation. Returns { damaged, reportedAt, orderNumber, summary, usage } or { damaged: false } without asking when no damage word appears. */
export async function readThread(thread) {
  const messages = await prisma.supportMessage.findMany({ where: { threadId: thread.id }, orderBy: { sentAt: 'asc' }, select: { direction: true, channel: true, bodyText: true, sentAt: true } })
  const theirs = inbound(messages)
  if (!theirs.some(m => DAMAGE_WORDS.test(m.channel === 'instagram' ? m.bodyText : stripQuoted(m.bodyText)))) return { damaged: false, asked: false }
  // The first messages hold the report nearly always; keep the opening and the end of a long one.
  const shown = messages.length > MAX_MESSAGES * 2 ? [...messages.slice(0, MAX_MESSAGES), ...messages.slice(-MAX_MESSAGES)] : messages
  const out = await complete({
    system: SYSTEM,
    prompt: `${conversationText(thread, shown)}\n\nDid the customer report that a print or frame arrived broken or damaged?`,
    json: true,
    maxTokens: 400,
    effort: 'low',
    model: llmInfo().provider === 'anthropic' ? MODEL : undefined,
    cacheSystem: true,
    purpose: 'support.damage',
  })
  const j = out.json || {}
  if (j.damaged !== true) return { damaged: false, asked: true, usage: out.usage }
  const shownIn = inbound(shown)
  const at = shownIn[Math.max(0, (Number(j.message) || 1) - 1)] || shownIn[0] || theirs[0]
  const order = String(j.order || '').replace(/\D/g, '') || null
  return { damaged: true, asked: true, usage: out.usage, reportedAt: at?.sentAt || thread.lastInboundAt, orderNumber: order, summary: clip(String(j.summary || '').replace(/\s*[—–]\s*/g, ', '), 90) }
}

/**
 * The pass: every conversation the customer wrote in since it was last read,
 * oldest first, up to `limit`, inside `budgetMs`. A row a person decided is
 * left alone, and so is one already found damaged. `dryRun` reads and
 * decides without saving.
 */
export async function detectDamage({ limit = 1500, budgetMs = 200_000, dryRun = false, log = () => {} } = {}) {
  if (!isLlmConfigured()) return { status: 'skipped', reason: 'No model is configured.' }
  const started = Date.now()
  const due = await prisma.$queryRaw`
    SELECT t.id, t.subject, t.status, t."customerEmail", t."lastInboundAt"
    FROM "SupportThread" t LEFT JOIN "DamageReport" d ON d."threadId" = t.id
    WHERE t.filtered = false AND t."mergedIntoId" IS NULL AND t."lastInboundAt" IS NOT NULL
      AND (t."damageCheckedAt" IS NULL OR t."damageCheckedAt" < t."lastInboundAt")
      AND (d.id IS NULL OR (d.source = 'claude' AND d.damaged = false))
    ORDER BY t."lastInboundAt" ASC
    LIMIT ${limit}`
  const found = [], usage = { input: 0, output: 0 }
  let read = 0, asked = 0, failed = 0, next = 0, firstError = null
  async function one(t) {
    try {
      const r = await readThread(t)
      read++
      if (r.asked) asked++
      for (const k of Object.keys(usage)) usage[k] += r.usage?.[k] || 0
      if (r.damaged) { found.push({ id: t.id, email: t.customerEmail, ...r }); log(`damaged: ${t.customerEmail || t.id} ${r.orderNumber ? `#${r.orderNumber} ` : ''}${r.summary}`) }
      if (dryRun) return
      if (r.damaged) {
        const data = { customerEmail: String(t.customerEmail || '').toLowerCase(), orderNumber: r.orderNumber, reportedAt: new Date(r.reportedAt), summary: r.summary, damaged: true, source: 'claude' }
        await prisma.damageReport.upsert({ where: { threadId: t.id }, create: { threadId: t.id, ...data }, update: data })
        // A note where the team is working; a closed conversation from the history gets none.
        if (t.status !== 'closed') await prisma.supportNote.create({ data: { threadId: t.id, kind: 'note', body: `Damage report: ${r.summary || 'the customer says it arrived damaged'}. Counted in Stats; use Not damaged on this conversation if that is wrong.`, authorName: 'Claude' } })
      }
      await prisma.supportThread.update({ where: { id: t.id }, data: { damageCheckedAt: new Date() } })
    } catch (e) {
      failed++
      firstError ||= String(e?.message || e).slice(0, 300)
    }
  }
  async function worker() { while (next < due.length && Date.now() - started < budgetMs) await one(due[next++]) }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { status: dryRun ? 'dry-run' : 'done', due: due.length, read, asked, found: found.length, failed, firstError, left: due.length - next, usage, reports: found }
}

/** A person's call from the conversation: it arrived damaged, or it did not. Kept either way. */
export async function setDamage(threadId, damaged, actor) {
  const t = await prisma.supportThread.findUnique({ where: { id: String(threadId || '') }, select: { id: true, subject: true, customerEmail: true, lastInboundAt: true, createdAt: true } })
  if (!t) throw new UserError('No such conversation')
  const by = [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || actor?.email || 'Someone'
  const prior = await prisma.damageReport.findUnique({ where: { threadId: t.id } })
  const first = damaged && !prior ? await prisma.supportMessage.findFirst({ where: { threadId: t.id, direction: 'in' }, orderBy: { sentAt: 'asc' }, select: { sentAt: true } }) : null
  const data = { damaged: Boolean(damaged), source: 'person', decidedBy: by, customerEmail: String(t.customerEmail || '').toLowerCase() }
  const row = await prisma.damageReport.upsert({
    where: { threadId: t.id },
    create: { threadId: t.id, reportedAt: first?.sentAt || t.lastInboundAt || t.createdAt, summary: damaged ? 'Marked by a person' : '', ...data },
    update: data,
  })
  await prisma.supportNote.create({ data: { threadId: t.id, kind: 'event', body: `${by} marked this ${damaged ? 'as a damaged print' : 'as not a damaged print'}`, authorId: actor?.id || null, authorName: by } })
  await recordAudit({ action: damaged ? 'support.damage-on' : 'support.damage-off', summary: `${damaged ? 'Damaged print' : 'Not a damaged print'}: "${t.subject}"`, detail: { threadId: t.id }, actor })
  return shape(row)
}

/** What the conversation shows. */
export const shape = d => d ? { damaged: d.damaged, summary: d.summary, orderNumber: d.orderNumber, reportedAt: d.reportedAt, source: d.source, decidedBy: d.decidedBy } : null

const WINDOW_DAYS = 60

/**
 * For Stats: orders placed in the window (one per Shopify or Etsy order) and
 * how many of those had a damage report within 60 days, matched by the
 * order number the conversation names or else the customer's email. Also the
 * damage reports made in the window.
 */
export async function damageStats({ since, until }) {
  const [rate, reports, first] = await Promise.all([
    prisma.$queryRaw`
      WITH orders AS (
        SELECT o.source, o."parentOrderNumber" AS number, min(replace(o."shopifyOrderData"->>'name', '#', '')) AS name,
               min(o."createdAt") AS placed, lower(min(o."customerEmail")) AS email
        FROM "Order" o
        WHERE o.source IN ('shopify', 'etsy') AND o."trackstarOrderType" IN ('standard', 'custom')
        GROUP BY o.source, o."parentOrderNumber"
        HAVING min(o."createdAt") >= ${since} AND min(o."createdAt") < ${until}
      )
      SELECT count(*)::int AS orders,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "DamageReport" d
               WHERE d.damaged = true
                 AND (d."orderNumber" IN (o.number, o.name) OR (d."orderNumber" IS NULL AND o.email <> '' AND d."customerEmail" = o.email))
                 AND d."reportedAt" >= o.placed - interval '1 day'
                 AND d."reportedAt" < o.placed + make_interval(days => ${WINDOW_DAYS}::int)
             ))::int AS damaged
      FROM orders o`,
    prisma.damageReport.count({ where: { damaged: true, reportedAt: { gte: since, lt: until } } }),
    prisma.$queryRaw`SELECT min(m."sentAt") AS at FROM "SupportMessage" m WHERE m.direction = 'in'`,
  ])
  const r = rate[0] || { orders: 0, damaged: 0 }
  const trackedFrom = first[0]?.at ? new Date(first[0].at) : null
  return {
    windowDays: WINDOW_DAYS,
    orders: r.orders,
    damaged: r.damaged,
    pct: r.orders ? Math.round((r.damaged / r.orders) * 1000) / 10 : null,
    reports,
    stillCounting: until.getTime() > Date.now() - WINDOW_DAYS * 86_400_000,
    partial: !trackedFrom || trackedFrom > since,
  }
}
