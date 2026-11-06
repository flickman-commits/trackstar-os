/**
 * The approval portal's HTML, with link-preview tags for THIS order.
 *
 * iMessage, Slack and LinkedIn read the raw HTML and never run the JavaScript,
 * so every shared portal link previewed as the app's own shell: the Trackstar
 * logo and the words "TrackstarOS". A partner sees a link to a
 * dashboard rather than a link to their designs.
 *
 * This serves the same single-page app with the same bundle, having swapped
 * four tags in the <head> for the partner's name and their first design. It
 * runs for everybody rather than sniffing for crawlers, because the user agent
 * a link preview arrives under is not reliably distinguishable from Safari's,
 * and because a page that shows something different to robots is a page nobody
 * can debug.
 *
 * It never blocks the portal. Any failure - bad token, expired token, database
 * down, HTML fetch failed - falls through to the untouched shell, which is
 * exactly what was served before this existed.
 */
import { shellUrl } from '../../../server/lib/shellOrigin.js'
import prisma from '../../_lib/prisma.js'

const DEFAULT_TITLE = 'TrackstarOS'

/**
 * The built shell, cached for the life of the warm function.
 *
 * It only changes on deploy, and a warm instance serving it from memory means
 * the portal does not depend on a second network hop per visit. One retry
 * covers a cold start racing the static host.
 */
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
      if (attempt === 1) console.error('[approval-preview] shell fetch failed:', err.message)
    }
  }
  return null
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * "<partner> x Trackstar", unless they are already one of ours.
 *
 * Partner names in the database are not tidy: one of them is literally
 * "Mitch Flippo MFG x Trackstar x Release Foundation". Appending to that gives
 * "... x Release Foundation x Trackstar", so a name that already says Trackstar
 * is left exactly as it is.
 */
/**
 * Partners: "<partner> x Trackstar". Everyone else: the person's name, since
 * the link is going to them and it reads as theirs in a message thread.
 * "Matt Flickman Design Proof | Trackstar".
 */
export function previewTitle(order) {
  const race = (order?.raceName || '').trim()
  if (order?.trackstarOrderType === 'race_partner' && race) {
    if (/trackstar/i.test(race)) return race
    return `${race} x Trackstar`
  }
  const person = (order?.runnerName || order?.customerName || '').trim()
  const who = person || race
  return who ? `${who} Design Proof | Trackstar` : DEFAULT_TITLE
}

export function buildMeta(order) {
  const proof = order?.proofs?.[0]
  const count = order?.proofs?.length || 0
  const title = previewTitle(order)
  const description = count > 1
    ? `${count} design options ready for your review.`
    : 'Your design is ready for review.'
  return { title, description, image: proof?.imageUrl || null }
}

/** Replace the shell's preview tags rather than appending duplicates. */
export function injectMeta(html, { title, description, image }) {
  let out = html
  const set = (pattern, replacement) => {
    out = pattern.test(out) ? out.replace(pattern, replacement) : out
  }
  set(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  set(/<meta property="og:title" content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${escapeHtml(title)}" />`)
  set(/<meta property="og:description" content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${escapeHtml(description)}" />`)
  if (image) {
    set(/<meta property="og:image" content="[^"]*"\s*\/?>/i,
        `<meta property="og:image" content="${escapeHtml(image)}" />`)
    // Without this the design shows as a thumbnail beside the text instead of
    // filling the card, which defeats the point of showing it at all.
    if (!/twitter:card/i.test(out)) {
      out = out.replace(/<\/head>/i,
        `  <meta name="twitter:card" content="summary_large_image" />\n  <meta name="twitter:image" content="${escapeHtml(image)}" />\n  </head>`)
    }
  }
  return out
}

export default async function handler(req, res) {
  const token = req.query?.token
  const url = shellUrl(req)
  let html = url ? await loadShell(url) : null
  if (!html) {
    // Deliberately not a redirect to /index.html. That would change the URL,
    // and the router would then see "/index.html" instead of the approval path,
    // dropping the partner on the dashboard rather than their designs. Better
    // to say what happened and let them retry the link they already have.
    console.error('[approval-preview] app shell unavailable, serving a retry page')
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(503).send(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Trackstar</title>' +
      '<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem;text-align:center;color:#1A1A1A">' +
      '<p style="font-size:15px;line-height:1.6">We could not load your designs just now. Please refresh this page.</p>' +
      '<p><a href="" onclick="location.reload();return false" style="color:#4600D6;font-weight:600">Try again</a></p></div>'
    )
  }

  try {
    if (token) {
      const record = await prisma.approvalToken.findUnique({
        where: { token },
        select: {
          expiresAt: true,
          order: {
            select: {
              raceName: true,
              runnerName: true,
              customerName: true,
              trackstarOrderType: true,
              proofs: {
                where: { status: 'pending' },
                orderBy: { version: 'asc' },
                select: { imageUrl: true },
              },
            },
          },
        },
      })
      // An expired link still previews as the partner's, because the recipient
      // has not opened it yet and the name is the useful part either way.
      if (record?.order) html = injectMeta(html, buildMeta(record.order))
    }
  } catch (err) {
    console.error('[approval-preview] preview lookup failed, serving the plain shell:', err.message)
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  // Short shared cache so a preview fetch and the click that follows do not
  // both hit the database, without pinning a stale design for long.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600')
  return res.status(200).send(html)
}
