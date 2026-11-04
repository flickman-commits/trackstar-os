/**
 * The one layout for an email to a customer about their order: the proofs
 * email, a designer's question, a delay notice. Built to the brand guide's
 * email rules: it should read like a person wrote it. White background, the
 * black wordmark, Helvetica (email clients drop webfonts), -0.04em tracking,
 * 14px minimum, sentence case, one outline button as a bordered table cell
 * (Outlook drops borders on links), no dark header, no purple fills. The
 * footer is the site's: ink panel, white wordmark, Find their race, socials.
 *
 *   renderCustomerEmail({
 *     greeting: 'Hi Jane,',
 *     paragraphs: ['...', '...'],      // body, in order; may hold <strong> and <br>
 *     note: '...',                      // optional quoted note from the designer
 *     cta: { label: 'Review your design', url },   // optional, one
 *     after: ['...'],                   // optional small lines under the button
 *     signoff: 'Trackstar',             // default
 *   }) -> html
 */
const FONT = "Helvetica, Arial, sans-serif"
const INK = '#1A1A1A', MUTED = '#666666', ACCENT = '#4600D6', OFF = '#F6F5F2'
const LOGO = 'https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png'

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const LOGO_WHITE = 'https://www.trackstar.art/cdn/shop/files/Trackstar_White_Logo_Cropped.png'
// White social icons, served from this app (public/email), so no third party hosts our email's images.
const ICON_BASE = 'https://fast.trackstar.art/email/'
const SOCIAL = [
  ['https://www.instagram.com/trackstar_art', 'instagram-white.png', 'Instagram'],
  ['https://www.tiktok.com/@trackstar_art', 'tiktok-white.png', 'TikTok'],
  ['https://www.facebook.com/trackstarArt', 'facebook-white.png', 'Facebook'],
]
const p = (html, extra = '') => `<p style="margin:0 0 20px;font-size:18px;line-height:1.4;color:${INK};letter-spacing:-0.04em;font-family:${FONT};${extra}">${html}</p>`

/**
 * Short on purpose: what they need to know, one button, and at most one
 * callout. `signoff` may hold a line break ("Thanks,\nMatt from Trackstar").
 */
export function renderCustomerEmail({ greeting, paragraphs = [], note, callout, cta, after = [], signoff = 'Thanks,\nMatt from Trackstar' }) {
  const box = t => `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr><td style="background-color:${OFF};border-radius:8px;padding:16px 20px;font-size:16px;line-height:1.4;color:${INK};letter-spacing:-0.04em;font-family:${FONT};">${t}</td></tr></table>`
  const body = [
    greeting ? p(escapeHtml(greeting)) : '',
    ...paragraphs.map(t => p(t)),
    note ? box(escapeHtml(note).replace(/\n/g, '<br>')) : '',
    cta ? `<table cellpadding="0" cellspacing="0" style="margin:4px 0 28px;"><tr><td style="border:1.5px solid ${ACCENT};border-radius:5px;">
          <a href="${cta.url}" style="display:inline-block;padding:16px 32px;font-size:18px;font-weight:700;color:${ACCENT};text-decoration:none;letter-spacing:-0.04em;font-family:${FONT};">${escapeHtml(cta.label)}</a>
        </td></tr></table>` : '',
    callout ? box(callout) : '',
    ...after.map(t => `<p style="margin:0 0 8px;font-size:16px;line-height:1.4;color:${MUTED};letter-spacing:-0.04em;font-family:${FONT};">${t}</p>`),
    p(escapeHtml(signoff).replace(/\n/g, '<br>'), 'margin:8px 0 0;'),
  ].filter(Boolean).join('\n')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Trackstar</title></head>
<body style="margin:0;padding:0;background-color:#FFFFFF;font-family:${FONT};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr><td align="center" style="padding:32px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td style="padding:0 0 32px;">
          <img src="${LOGO}" alt="Trackstar" width="140" style="display:block;width:140px;height:auto;" />
        </td></tr>
        <tr><td style="padding:0 0 40px;">
${body}
        </td></tr>
        <tr><td style="background-color:${INK};border-radius:18px;padding:36px 32px 28px;">
          <img src="${LOGO_WHITE}" alt="Trackstar" width="150" style="display:block;width:150px;height:auto;margin:0 0 14px;" />
          <p style="margin:0 0 24px;font-size:20px;line-height:1.3;color:#E6E6E6;letter-spacing:-0.04em;font-family:${FONT};">Celebrating athletic achievement.</p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr><td style="background-color:#FFFFFF;border-radius:8px;">
            <a href="https://www.trackstar.art" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:${INK};text-decoration:none;letter-spacing:-0.04em;font-family:${FONT};">Find their race</a>
          </td></tr></table>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;"><tr>
            ${SOCIAL.map(([href, icon, alt]) => `<td style="padding:0 18px 0 0;"><a href="${href}"><img src="${ICON_BASE}${icon}" alt="${alt}" width="22" height="22" style="display:block;width:22px;height:22px;opacity:0.85;" /></a></td>`).join('')}
          </tr></table>
          <p style="margin:0;padding:18px 0 0;border-top:1px solid #3A3A3A;font-size:14px;line-height:1.4;color:#8A8A8A;letter-spacing:-0.04em;font-family:${FONT};">&copy; ${new Date().getFullYear()} Trackstar. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
