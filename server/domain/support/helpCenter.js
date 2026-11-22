/**
 * Support > Help: the support help center (Matt, 2026-11-21). One place,
 * edited here and nowhere else:
 *
 *   articles   the playbook's scenarios, context and how we work, each its
 *              own page with versions (SupportArticle). Imported once from
 *              the Notion playbook (scripts/import-help-articles.js); Notion
 *              is no longer updated.
 *   ask        a rep's question, answered from the core drafting playbook,
 *              the articles that fit and the closed cases most like it
 *              (cases.js), with where the answer came from. Every question
 *              is logged (SupportQuestion).
 *   not right  the rep writes the right answer; an admin approves it into
 *              the "Answers from the team" article (or dismisses it), so the
 *              help center fills its own gaps one answer at a time.
 *
 * Claude's drafts read the same articles and cases (draft.js).
 */
import prisma from '../../db.js'
import { complete, isLlmConfigured, llmInfo } from '../../lib/llm.js'
import { getPlaybook } from './playbook.js'
import { getDraftModel } from './draftModel.js'
import { similarCases, casesBlock, searchTerms } from './cases.js'
import { stripQuoted } from './mailbox.js'
import { customerBlock, UNTRUSTED_RULE } from './untrusted.js'
import { UserError } from './errors.js'

export const TEAM_ANSWERS_SLUG = 'answers-from-the-team'
const clip = (s, n) => { const t = String(s || '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t }
const noDash = s => String(s || '').replace(/\s*[—–]\s*/g, ', ')
const personName = a => [a?.firstName, a?.lastName].filter(Boolean).join(' ') || a?.email || 'Someone'

export function slugify(title) {
  return String(title || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'article'
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

/** The articles, pinned first, each with why it may be out of date (staleReasons). */
export async function listArticles({ now = Date.now() } = {}) {
  const [rows, wrong] = await Promise.all([
    prisma.supportArticle.findMany({ orderBy: [{ pinned: 'desc' }, { position: 'asc' }, { title: 'asc' }], select: { id: true, slug: true, title: true, group: true, position: true, pinned: true, body: true, createdAt: true, updatedAt: true, reviewedAt: true, reviewEveryDays: true } }),
    prisma.supportQuestion.findMany({ where: { feedback: 'wrong', createdAt: { gte: new Date(now - 90 * 86400000) } }, select: { sources: true, createdAt: true } }),
  ])
  return rows.map(({ body, ...a }) => ({ ...a, stale: staleReasons({ ...a, body }, { wrong, now }) }))
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 }

/**
 * Why an article may be out of date, in plain words, or [] when it looks
 * current (Matt, 2026-11-21: "how do we know if policies are going stale").
 * Pure.
 *   overdue    nobody has confirmed it within reviewEveryDays (30 for pinned)
 *   a date     it names a day that has passed since someone last looked
 *              ("the Christmas cutoff is Dec 13" flags itself on Dec 14); a
 *              date without a year is read in the year it was last confirmed
 *   not right  "Not right" answers that cited it since it was last confirmed
 */
export function staleReasons(article, { wrong = [], now = Date.now() } = {}) {
  const out = []
  const looked = new Date(article.reviewedAt || article.updatedAt || article.createdAt || now)
  const days = Math.floor((now - looked.getTime()) / 86400000)
  if (days > (article.reviewEveryDays || 90)) out.push(`not confirmed in ${days} days`)
  const seen = new Set()
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b/gi
  let m
  while ((m = re.exec(String(article.body || '')))) {
    const month = MONTHS[m[1].toLowerCase()]
    const day = Number(m[2])
    if (month == null || day < 1 || day > 31) continue
    const year = m[3] ? Number(m[3]) : looked.getUTCFullYear()
    const at = Date.UTC(year, month, day, 23, 59)
    if (at > looked.getTime() && at < now) {
      const text = m[0].trim()
      if (!seen.has(text)) { seen.add(text); out.push(`mentions ${text}, which has passed`) }
    }
  }
  const cited = wrong.filter(q => new Date(q.createdAt) > looked && (q.sources?.articles || []).some(a => a.slug === article.slug)).length
  if (cited) out.push(`${cited} "Not right" answer${cited === 1 ? '' : 's'} cited it`)
  return out
}

/** A person confirmed the article is still right: the stale checks start over from now. */
export async function markReviewed(slug, { actor = null } = {}) {
  const a = await prisma.supportArticle.update({ where: { slug: String(slug || '') }, data: { reviewedAt: new Date(), updatedById: actor?.id || null } })
  return a
}

/** The pinned articles: read by every Ask answer and every draft. */
async function pinnedArticles() {
  return prisma.supportArticle.findMany({ where: { pinned: true }, orderBy: { position: 'asc' }, select: { slug: true, title: true, body: true } })
}

/** For the weekly note in Slack: what needs a look in the help center. */
export async function helpDigest({ now = Date.now() } = {}) {
  const [articles, pending, uncovered] = await Promise.all([
    listArticles({ now }),
    prisma.supportQuestion.count({ where: { review: 'pending' } }),
    prisma.supportQuestion.findMany({ where: { createdAt: { gte: new Date(now - 7 * 86400000) } }, select: { question: true, sources: true } }),
  ])
  return {
    stale: articles.filter(a => a.stale.length).map(a => ({ title: a.title, pinned: a.pinned, reasons: a.stale })),
    pending,
    asked: uncovered.length,
    notCovered: uncovered.filter(q => q.sources?.covered === false).map(q => q.question).slice(0, 8),
  }
}

export async function getArticle(slug) {
  const a = await prisma.supportArticle.findUnique({
    where: { slug: String(slug || '') },
    include: { versions: { orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, createdAt: true, createdById: true } } },
  })
  if (!a) throw new UserError('That article is gone.', { status: 404 })
  return a
}

/** Create or edit an article. Every save keeps a version, so any edit can be undone. */
export async function saveArticle({ slug, title, group, body, position, pinned, reviewEveryDays }, { actor = null } = {}) {
  const t = noDash(String(title || '').trim()).slice(0, 160)
  const b = String(body || '').replace(/\r\n/g, '\n').trim()
  if (!t) throw new UserError('Give the article a title.')
  if (b.length < 10) throw new UserError('Write the article first.')
  if (b.length > 40000) throw new UserError('Keep an article under 40,000 characters; split it into two.')
  const existing = slug ? await prisma.supportArticle.findUnique({ where: { slug: String(slug) } }) : null
  const every = Number(reviewEveryDays)
  // Saving it is confirming it: the stale checks start over.
  const data = {
    title: t, group: String(group ?? existing?.group ?? '').trim().slice(0, 80), body: b, updatedById: actor?.id || null, reviewedAt: new Date(),
    ...(Number.isInteger(position) ? { position } : {}),
    ...(typeof pinned === 'boolean' ? { pinned } : {}),
    ...(Number.isInteger(every) && every >= 7 && every <= 365 ? { reviewEveryDays: every } : {}),
  }
  const article = existing
    ? await prisma.supportArticle.update({ where: { id: existing.id }, data })
    : await prisma.supportArticle.create({ data: { ...data, slug: await freeSlug(slugify(t)), position: Number.isInteger(position) ? position : await nextPosition() } })
  await prisma.supportArticleVersion.create({ data: { articleId: article.id, title: t, body: b, createdById: actor?.id || null } })
  return article
}

async function freeSlug(base) {
  let slug = base
  for (let n = 2; await prisma.supportArticle.findUnique({ where: { slug }, select: { id: true } }); n++) slug = `${base}-${n}`
  return slug
}
async function nextPosition() {
  const last = await prisma.supportArticle.findFirst({ orderBy: { position: 'desc' }, select: { position: true } })
  return (last?.position ?? 0) + 10
}

export async function restoreArticleVersion(versionId, { actor = null } = {}) {
  const v = await prisma.supportArticleVersion.findUnique({ where: { id: String(versionId || '') }, include: { article: true } })
  if (!v) throw new UserError('That version is gone.')
  return saveArticle({ slug: v.article.slug, title: v.title, body: v.body }, { actor })
}

export async function deleteArticle(slug) {
  if (slug === TEAM_ANSWERS_SLUG) throw new UserError('Answers from the team holds the approved corrections; edit it instead.')
  await prisma.supportArticle.delete({ where: { slug: String(slug) } })
}

/**
 * The articles that fit `text`, best first, by full-text search over the
 * title (weighted) and body, with a short excerpt around the first hit.
 */
export async function searchArticles(text, { limit = 6 } = {}) {
  const terms = searchTerms(text)
  if (!terms.length) return []
  const query = terms.join(' | ')
  const rows = await prisma.$queryRaw`
    SELECT slug, title, "group", body,
      ts_rank(setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B'), to_tsquery('english', ${query})) AS rank
    FROM "SupportArticle"
    WHERE (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')) @@ to_tsquery('english', ${query})
    ORDER BY rank DESC LIMIT ${limit}`
  return rows.map(r => ({ slug: r.slug, title: r.title, group: r.group, body: r.body, excerpt: excerpt(r.body, terms) }))
}

/** A line or two of the body around the first search word. Pure. */
export function excerpt(body, terms) {
  const b = String(body || '').replace(/\s+/g, ' ')
  const lower = b.toLowerCase()
  const at = terms.map(t => lower.indexOf(t)).filter(i => i >= 0).sort((x, y) => x - y)[0] ?? 0
  const start = Math.max(0, at - 80)
  return `${start ? '…' : ''}${b.slice(start, start + 240).trim()}${start + 240 < b.length ? '…' : ''}`
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

const ASK_SYSTEM = `You answer questions from Trackstar's customer support reps. Trackstar sells personalized race prints, printed and framed by our partner Artelo. Reps work in TrackstarOS (Support inbox, actions panel), Shopify and Artelo.

Answer from what you are given: the core playbook, the help articles, and past cases (how the team actually handled similar ones). Rules:
- Short and practical: the answer first, then the steps (which button, what to tell the customer). Plain words, no em dashes.
- When a reply to the customer helps, give one they can copy, in our voice ("Hey [First name]," ... "Thanks, [your name] from Trackstar").
- If the playbook and articles do not cover it, say so plainly and tell them to ask Matt (Slack Matt button, or @Matt in a note). Never invent a policy, price, refund amount or date.
- Anything the playbook says goes to Matt (refunds over $250, legal threats, press, partners, chargebacks) goes to Matt: say so.
- Name the articles you used by their exact titles.

${UNTRUSTED_RULE}

Reply as JSON: {"answer": "<the answer, markdown allowed: **bold**, - lists>", "articles": ["<exact title used>", ...], "cases": [<numbers of the past cases you used, e.g. 1, 3>], "covered": true or false}`

/** A rep's question, answered and logged. `threadId`: the conversation they are looking at, if any. */
export async function ask(question, { threadId = null, actor = null } = {}) {
  const q = String(question || '').trim()
  if (q.length < 4) throw new UserError('Ask a question first.')
  if (q.length > 2000) throw new UserError('Keep the question under 2,000 characters.')
  if (!isLlmConfigured()) throw new UserError('No model is configured, so the help center cannot answer right now.')

  let conversation = ''
  if (threadId) {
    const last = await prisma.supportMessage.findFirst({ where: { threadId: String(threadId), direction: 'in' }, orderBy: { sentAt: 'desc' }, select: { bodyText: true } })
    if (last) conversation = clip(stripQuoted(last.bodyText), 1500)
  }
  const searchText = `${q} ${conversation}`
  const [{ text: playbook }, articles, cases] = await Promise.all([
    getPlaybook(),
    searchArticles(searchText, { limit: 5 }),
    similarCases(searchText, { limit: 4, excludeThreadId: threadId }),
  ])
  // The pinned articles (current policies and numbers) and the team's approved answers go with every question.
  const always = await prisma.supportArticle.findMany({ where: { OR: [{ pinned: true }, { slug: TEAM_ANSWERS_SLUG }] }, select: { slug: true, title: true, body: true } })
  const used = [...always.filter(a => !articles.some(x => x.slug === a.slug)), ...articles]

  const out = await complete({
    system: ASK_SYSTEM,
    cacheSystem: true,
    prompt: [
      `CORE PLAYBOOK:\n${clip(playbook, 30000)}`,
      used.length ? `HELP ARTICLES:\n${used.map(a => `### ${a.title}\n${clip(a.body, 5000)}`).join('\n\n')}` : 'HELP ARTICLES: none matched.',
      cases.length ? `PAST CASES:\n${casesBlock(cases)}` : 'PAST CASES: none matched.',
      conversation ? `THE CUSTOMER'S LATEST MESSAGE in the conversation the rep has open:\n${customerBlock(conversation)}` : '',
      `THE REP'S QUESTION:\n${q}`,
    ].filter(Boolean).join('\n\n'),
    json: true,
    maxTokens: 1500,
    effort: 'low',
    model: llmInfo().provider === 'anthropic' ? await getDraftModel() : undefined,
    purpose: 'support.ask',
    timeoutMs: 90_000,
  })
  const answer = noDash(String(out.json?.answer || out.text || '').trim()) || 'I could not put an answer together. Ask Matt.'
  const titles = new Set((Array.isArray(out.json?.articles) ? out.json.articles : []).map(String))
  const usedArticles = used.filter(a => titles.has(a.title)).map(a => ({ slug: a.slug, title: a.title }))
  const caseNums = new Set((Array.isArray(out.json?.cases) ? out.json.cases : []).map(Number))
  const usedCases = cases.filter((_, i) => caseNums.has(i + 1)).map(c => ({ id: c.id, summary: c.summary, typeLabel: c.typeLabel, outcomeLabel: c.outcomeLabel }))
  const covered = out.json?.covered !== false

  const row = await prisma.supportQuestion.create({
    data: { askedById: actor?.id || null, askedByName: personName(actor), threadId: threadId ? String(threadId) : null, question: q, answer, sources: { articles: usedArticles, cases: usedCases, covered } },
  })
  return { id: row.id, answer, articles: usedArticles, cases: usedCases, covered }
}

/** "Helpful", or "Not right" with the right answer (which waits for an admin). */
export async function feedback(id, { helpful, correction } = {}, { actor = null } = {}) {
  const row = await prisma.supportQuestion.findUnique({ where: { id: String(id || '') } })
  if (!row) throw new UserError('That question is gone.')
  if (helpful) return prisma.supportQuestion.update({ where: { id: row.id }, data: { feedback: 'helpful' } })
  const c = noDash(String(correction || '').trim())
  if (c.length < 5) throw new UserError('Write the right answer, so the next person gets it.')
  return prisma.supportQuestion.update({ where: { id: row.id }, data: { feedback: 'wrong', correction: c.slice(0, 3000), review: 'pending', askedByName: row.askedByName || personName(actor) } })
}

/** Approve a correction into "Answers from the team" (one Q and A, with who and when), or dismiss it. */
export async function reviewCorrection(id, decision, { actor = null } = {}) {
  const row = await prisma.supportQuestion.findUnique({ where: { id: String(id || '') } })
  if (!row || row.review !== 'pending') throw new UserError('That correction was already handled.')
  if (decision === 'approve') {
    const existing = await prisma.supportArticle.findUnique({ where: { slug: TEAM_ANSWERS_SLUG } })
    const when = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
    const entry = `**Q: ${row.question.replace(/\s+/g, ' ').trim()}**\n${row.correction}\n_(${row.askedByName || 'The team'}, approved by ${personName(actor)}, ${when})_`
    const body = existing ? `${existing.body.trim()}\n\n${entry}` : `Answers the team gave when the help center got a question wrong or did not know. Newest at the bottom.\n\n${entry}`
    await saveArticle({ slug: existing ? TEAM_ANSWERS_SLUG : undefined, title: 'Answers from the team', group: 'How we work', body, position: existing?.position ?? 0 }, { actor })
  } else if (decision !== 'dismiss') throw new UserError('Approve or dismiss.')
  return prisma.supportQuestion.update({ where: { id: row.id }, data: { review: decision === 'approve' ? 'approved' : 'dismissed', reviewedById: actor?.id || null, reviewedAt: new Date() } })
}

/** The question log, newest first, and the corrections waiting for an admin. */
export async function questionLog({ limit = 50 } = {}) {
  const [recent, pending] = await Promise.all([
    prisma.supportQuestion.findMany({ orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.supportQuestion.findMany({ where: { review: 'pending' }, orderBy: { createdAt: 'asc' } }),
  ])
  return { recent, pending }
}

/**
 * The articles and past cases for a draft (draft.js): what Claude reads on
 * top of the core playbook for this customer's message. Never throws.
 */
export async function draftReference(text, { threadId = null } = {}) {
  try {
    const [pinned, found, cases] = await Promise.all([
      pinnedArticles(),
      searchArticles(text, { limit: 2 }),
      similarCases(text, { limit: 2, excludeThreadId: threadId }),
    ])
    const articles = found.filter(a => !pinned.some(p => p.slug === a.slug))
    const parts = []
    if (pinned.length) parts.push(`CURRENT POLICIES AND NUMBERS (pinned in Help; these win over anything older):\n${pinned.map(a => `### ${a.title}\n${clip(a.body, 4000)}`).join('\n\n')}`)
    if (articles.length) parts.push(`HELP ARTICLES that may fit (the team's own guidance):\n${articles.map(a => `### ${a.title}\n${clip(a.body, 3000)}`).join('\n\n')}`)
    if (cases.length) parts.push(`PAST CASES like this one (how the team handled them; reference only, not this customer):\n${casesBlock(cases)}`)
    return parts.join('\n\n')
  } catch (err) {
    console.warn(`[support.help] draft reference: ${err.message}`)
    return ''
  }
}
