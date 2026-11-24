/**
 * /api/support/help - Support > Help: the help center, the Ask box and case
 * tags (server/domain/support/helpCenter.js, cases.js).
 *
 * Anyone on Support (capability "support"):
 *   GET                                   the article list
 *   GET  ?topics=1                        the short playbook cards (helpTopics.js)
 *   GET  ?slug=                           one article, with its versions
 *   GET  ?search=                         articles that match, best first, with an excerpt
 *   GET  ?log=1                           recent questions and the corrections waiting
 *   GET  ?case=<threadId>                 a conversation's case tag, and the choices
 *   POST { action:'ask', question, threadId?, previousId? }  answer a question (logged)
 *   POST { action:'feedback', id, helpful?, correction? } Helpful, or Not right with the right answer
 *   POST { action:'case', threadId, type?, outcome?, summary? }  correct a case tag
 * Admins:
 *   POST { action:'save', slug?, title, group, body, pinned?, reviewEveryDays? }  create or edit an article (versioned)
 *   POST { action:'reviewed', slug }                      it is still right: the stale checks start over
 *   POST { action:'restore', versionId }                  put an earlier version back
 *   POST { action:'delete', slug }
 *   POST { action:'review', id, decision }                approve a correction into Answers from the team, or dismiss it
 */
import { setCors } from '../../_lib/auth.js'
import { requireCapability, recordAudit } from '../../_lib/users.js'
import { listArticles, getArticle, searchArticles, saveArticle, markReviewed, restoreArticleVersion, deleteArticle, ask, feedback, reviewCorrection, questionLog } from '../../../server/domain/support/helpCenter.js'
import { listTopics } from '../../../server/domain/support/helpTopics.js'
import { setCase, CASE_TYPES, CASE_OUTCOMES, CASE_SELECT } from '../../../server/domain/support/cases.js'
import { publicMessage, publicStatus } from '../../../server/domain/support/errors.js'
import prisma from '../../_lib/prisma.js'

const ADMIN_ACTIONS = new Set(['save', 'restore', 'delete', 'review', 'reviewed'])

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  try {
    const user = await requireCapability(req, res, 'support')
    if (!user) return
    if (req.method === 'GET') {
      const q = req.query || {}
      if (q.topics) return res.status(200).json({ topics: await listTopics(), isAdmin: user.role === 'admin' })
      if (q.slug) return res.status(200).json({ article: await getArticle(q.slug) })
      if (q.search) return res.status(200).json({ results: (await searchArticles(String(q.search).slice(0, 300), { limit: 12 })).map(({ body, ...r }) => r) })
      if (q.log) return res.status(200).json(await questionLog())
      if (q.case) {
        const t = await prisma.supportThread.findUnique({ where: { id: String(q.case) }, select: CASE_SELECT })
        return res.status(200).json({ case: t, types: CASE_TYPES, outcomes: CASE_OUTCOMES })
      }
      return res.status(200).json({ articles: await listArticles(), isAdmin: user.role === 'admin' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    if (ADMIN_ACTIONS.has(b.action) && user.role !== 'admin' && !user.isSystem) return res.status(403).json({ error: 'Only an admin can change the help center.' })

    if (b.action === 'ask') return res.status(200).json(await ask(b.question, { threadId: b.threadId || null, previousId: b.previousId || null, actor: user }))
    if (b.action === 'feedback') {
      const row = await feedback(b.id, { helpful: b.helpful === true, correction: b.correction }, { actor: user })
      return res.status(200).json({ question: row })
    }
    if (b.action === 'case') {
      const c = await setCase(b.threadId, { type: b.type, outcome: b.outcome, summary: b.summary }, { actor: user })
      return res.status(200).json({ case: c })
    }
    if (b.action === 'save') {
      const a = await saveArticle({ slug: b.slug || undefined, title: b.title, group: b.group, body: b.body, pinned: typeof b.pinned === 'boolean' ? b.pinned : undefined, reviewEveryDays: b.reviewEveryDays }, { actor: user })
      await recordAudit({ action: 'support.help_article', summary: `${b.slug ? 'Edited' : 'Added'} the help article "${a.title}"`, detail: { slug: a.slug }, actor: user })
      return res.status(200).json({ article: await getArticle(a.slug), articles: await listArticles() })
    }
    if (b.action === 'reviewed') {
      const a = await markReviewed(b.slug, { actor: user })
      await recordAudit({ action: 'support.help_article', summary: `Confirmed "${a.title}" is still right`, detail: { slug: a.slug }, actor: user })
      return res.status(200).json({ article: await getArticle(a.slug), articles: await listArticles() })
    }
    if (b.action === 'restore') {
      const a = await restoreArticleVersion(b.versionId, { actor: user })
      await recordAudit({ action: 'support.help_article', summary: `Restored an earlier version of "${a.title}"`, detail: { slug: a.slug, versionId: b.versionId }, actor: user })
      return res.status(200).json({ article: await getArticle(a.slug) })
    }
    if (b.action === 'delete') {
      await deleteArticle(b.slug)
      await recordAudit({ action: 'support.help_article', summary: `Deleted the help article ${b.slug}`, detail: { slug: b.slug }, actor: user })
      return res.status(200).json({ articles: await listArticles() })
    }
    if (b.action === 'review') {
      const row = await reviewCorrection(b.id, b.decision, { actor: user })
      await recordAudit({ action: 'support.help_correction', summary: `${row.review === 'approved' ? 'Approved' : 'Dismissed'} a help center correction`, detail: { id: row.id }, actor: user })
      return res.status(200).json({ question: row, ...(await questionLog()) })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error('[API /support/help]', error)
    return res.status(publicStatus(error)).json({ error: publicMessage(error, 'The help center could not do that. Try again.') })
  }
}
