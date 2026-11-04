/**
 * The one layout for an email to a customer about their order: the proofs
 * email, a designer's question, a delay notice. Built to the brand guide's
 * email rules: it should read like a person wrote it. White background, the
 * black wordmark, Helvetica (email clients drop webfonts), -0.04em tracking,
 * 14px minimum, sentence case, one outline button as a bordered table cell
 * (Outlook drops borders on links), no dark header, no purple fills.
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
const INK = '#1A1A1A', MUTED = '#666666', FAINT = '#999999', LINE = '#E0E0E0', ACCENT = '#4600D6', OFF = '#F6F5F2'
const LOGO = 'https://www.trackstar.art/cdn/shop/files/Trackstar_Logo_Cropped.png'

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const p = (html, extra = '') => `<p style="margin:0 0 16px;font-size:16px;line-height:1.45;color:${INK};letter-spacing:-0.04em;font-family:${FONT};${extra}">${html}</p>`

export function renderCustomerEmail({ greeting, paragraphs = [], note, cta, after = [], signoff = 'Trackstar' }) {
  const body = [
    greeting ? p(escapeHtml(greeting)) : '',
    ...paragraphs.map(t => p(t)),
    note ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tr><td style="background-color:${OFF};border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.45;color:${INK};letter-spacing:-0.04em;font-family:${FONT};">${escapeHtml(note).replace(/\n/g, '<br>')}</td></tr></table>` : '',
    cta ? `<table cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="border:1.5px solid ${ACCENT};border-radius:5px;">
          <a href="${cta.url}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:${ACCENT};text-decoration:none;letter-spacing:-0.04em;font-family:${FONT};">${escapeHtml(cta.label)}</a>
        </td></tr></table>` : '',
    ...after.map(t => `<p style="margin:0 0 8px;font-size:14px;line-height:1.4;color:${MUTED};letter-spacing:-0.04em;font-family:${FONT};">${t}</p>`),
    p(escapeHtml(signoff), 'margin:20px 0 0;'),
  ].filter(Boolean).join('\n')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Trackstar</title></head>
<body style="margin:0;padding:0;background-color:#FFFFFF;font-family:${FONT};">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFFFFF;">
    <tr><td align="center" style="padding:32px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
        <tr><td style="padding:0 0 28px;">
          <img src="${LOGO}" alt="Trackstar" width="140" style="display:block;width:140px;height:auto;" />
        </td></tr>
        <tr><td>
${body}
        </td></tr>
        <tr><td style="padding:28px 0 0;border-top:1px solid ${LINE};margin-top:28px;">
          <p style="margin:24px 0 0;font-size:14px;line-height:1.4;color:${FAINT};letter-spacing:-0.04em;font-family:${FONT};">Celebrating athletic achievement. Printed and framed in Kentucky, shipped to your doorstep.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
