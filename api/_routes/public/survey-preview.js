/**
 * /vote/{token} served with link-preview tags for that survey: its title and
 * the first design, so the story link previews as the designs rather than as
 * the app's shell. Same approach and same fallbacks as approval-preview.js.
 */
import { shellUrl } from '../../../server/lib/shellOrigin.js'
import prisma from '../../_lib/prisma.js'
import { injectMeta } from './approval-preview.js'

let cachedShell = null
async function loadShell(url) {
  if (cachedShell) return cachedShell
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'trackstar-preview' } })
      if (!res.ok) throw new Error(`shell ${res.status}`)
      const text = await res.text()
      if (!text.includes('<script')) throw new Error('shell had no bundle')
      cachedShell = text
      return cachedShell
    } catch (err) {
      if (attempt === 1) console.error('[survey-preview] shell fetch failed:', err.message)
    }
  }
  return null
}

export default async function handler(req, res) {
  const url = shellUrl(req)
  let html = url ? await loadShell(url) : null
  if (!html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trackstar</title><p style="font-family:-apple-system,Helvetica,Arial,sans-serif;text-align:center;margin-top:30vh">Please refresh this page.</p>')
  }
  try {
    const token = String(req.query?.token || '')
    if (token) {
      const s = await prisma.designSurvey.findUnique({
        where: { token },
        select: { title: true, question: true, options: { orderBy: { sortOrder: 'asc' }, take: 1, select: { imageUrl: true } }, _count: { select: { options: true } } },
      })
      if (s) {
        html = injectMeta(html, {
          title: `Vote: ${s.title} | Trackstar`,
          description: s.question || `Pick your favorite of ${s._count.options} new designs.`,
          image: s.options[0]?.imageUrl || null,
        })
      }
    }
  } catch (err) {
    console.error('[survey-preview] lookup failed, serving the plain shell:', err.message)
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600')
  return res.status(200).send(html)
}
