/**
 * /apply served with its own link-preview tags, so a shared link reads
 * "Trackstar Creator Program" with the creator photos instead of the app's
 * shell ("TrackstarOS"). Same approach and fallbacks as
 * approval-preview.js. The image is public/og-creator-program.jpg.
 */
import { shellUrl } from '../../../server/lib/shellOrigin.js'
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
      if (attempt === 1) console.error('[creator-preview] shell fetch failed:', err.message)
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
    return res.status(503).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trackstar Creator Program</title><p style="font-family:Helvetica,Arial,sans-serif;text-align:center;margin-top:30vh">Please refresh this page.</p>')
  }
  html = injectMeta(html, {
    title: 'Trackstar Creator Program',
    description: 'A personalized Trackstar print of the race you ran, in exchange for 3 short videos.',
    image: `${proto}://${host}/og-creator-program.jpg`,
  })
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).send(html)
}
