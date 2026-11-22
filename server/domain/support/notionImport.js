/**
 * Turn the Notion support playbook (as the Notion MCP fetch returns it) into
 * Help articles: plain markdown, one article per section, Context toggle and
 * Scenario toggle. Used once by scripts/import-help-articles.js. Pure.
 */

/** Notion-flavored markdown to the plain markdown Help shows (HelpText). Pure. */
export function notionToMarkdown(text) {
  return String(text || '')
    .replace(/<video source="([^"]+)"\s*\/>/g, '[Watch the recording]($1)')
    .replace(/<mention[^>]*url="([^"]+)"[^>]*>([^<]*)<\/mention>/g, '[$2]($1)')
    .replace(/<\/?b>/g, '**').replace(/<\/?(i|em)>/g, '_').replace(/<\/?code>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/\*\*(\s*)\*\*/g, '$1')
    .replace(/\\([[\]$_.<>*#])/g, '$1')
    .replace(/^>\s*$/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The articles, in page order: { title, group, body, position }. Sections
 * are "## " headings; a section made of toggles (Context, Scenarios, What To
 * Do If Something Goes Wrong) gives one article per toggle, named by the
 * toggle's first line. "Who Handles What" joins "Purpose"; the "Inbox Setup"
 * toggle joins "Working the Inbox".
 */
export function splitNotionPlaybook(raw) {
  const m = String(raw).match(/<content>([\s\S]*?)<\/content>/)
  const content = (m ? m[1] : String(raw)).replace(/\r\n/g, '\n')
  const sections = []
  let cur = null
  for (const line of content.split('\n')) {
    const h = /^## (.+)$/.exec(line)
    if (h) { cur = { heading: h[1].trim(), lines: [] }; sections.push(cur); continue }
    if (!cur) { cur = { heading: 'Introduction', lines: [] }; sections.push(cur) }
    cur.lines.push(line)
  }
  const out = []
  let pos = 10
  const add = (title, group, body) => {
    const md = notionToMarkdown(body).replace(/^---\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
    if (md.length < 20) return
    out.push({ title: title.replace(/\s*\(Read This (First|Too)\)\s*$/i, '').replace(/\s*[—–]\s*/g, ', ').trim(), group, body: md, position: pos })
    pos += 10
  }
  const toggles = text => {
    const list = []
    const re = /<toggle[^>]*>\n([^\n]*)\n([\s\S]*?)<\/toggle>/g
    let t
    while ((t = re.exec(text))) list.push({ title: t[1].trim(), body: t[2] })
    return { list, rest: text.replace(re, '').trim() }
  }
  for (const s of sections) {
    const text = s.lines.join('\n')
    if (s.heading === 'Who Handles What') continue
    if (s.heading === 'Purpose') {
      const who = sections.find(x => x.heading === 'Who Handles What')
      add('Purpose and who handles what', 'Start here', `${text}\n\n### Who handles what\n${who ? who.lines.join('\n') : ''}`)
      continue
    }
    if (s.heading === 'Working the Inbox') {
      // The Inbox Setup toggle sits under this section: it becomes a heading in the article.
      const own = toggles(text)
      const extra = own.list.map(t => `### ${t.title}\n${t.body}`).join('\n\n')
      add('Working the Inbox', 'Start here', `${own.rest}${extra ? `\n\n${extra}` : ''}`)
      continue
    }
    const { list, rest } = toggles(text)
    if (list.length && /^(Context|Scenarios|What To Do If Something Goes Wrong)/.test(s.heading)) {
      const group = s.heading.startsWith('Scenarios') ? 'Scenarios' : s.heading.startsWith('Context') ? 'Context' : 'Reference'
      for (const t of list) add(t.title, group, t.body)
      if (rest.replace(/[>\s💬]/g, '').length > 40 && group === 'Reference') add('If you get stuck', 'Reference', rest)
      continue
    }
    const group = /^(Introduction|The Trackstar Way|Before vs|Work Session)/.test(s.heading) ? 'Start here' : 'Reference'
    add(s.heading, group, list.length ? `${rest}\n\n${list.map(t => `### ${t.title}\n${t.body}`).join('\n\n')}` : text)
  }
  return out
}

/**
 * The pinned article: every number that changes, in one place (Matt,
 * 2026-11-21). Read by every Ask answer and every draft, checked every 30
 * days. Gathered from the Notion playbook as of Nov 19, 2026.
 */
export const CURRENT_POLICIES = {
  title: 'Current policies and numbers',
  group: 'Pinned',
  pinned: true,
  reviewEveryDays: 30,
  position: 0,
  body: `The numbers we quote customers, in one place. When one changes, change it here first: Help answers and Claude's drafts read this page and trust it over anything older.

### Delivery and shipping
- **Delivery:** 10 to 12 days from the order date (since Nov 5, 2026). Don't promise 7 to 10.
- **Christmas:** the delivery cutoff we tell customers is Dec 13, 2026. Check the site banner before quoting it.
- **Shipping cost:** free on US orders over $100; $7 under $100. International is calculated at checkout.
- **Expedite:** $40 for next-day air. Still in the queue: about 12 hours to decide. Already printing: about an hour. Label already printed: check with Matt.

### Changing an order
- Every order waits **48 hours** before production. Expedited orders skip the wait.
- In those 48 hours the customer can change the name, frame, photo or address, or cancel, from **Manage your order** (the button in their confirmation email, and their own link in our auto-reply). A photo can still be replaced until production.
- Adding a photo after ordering: **$20**.

### Prices and products
- Sizes: 8x10, 12x18 (best seller), 16x24, 24x36.
- Standard prints start at **$60** (8x10 unframed).
- **Custom:** our normal prices ($60 to $190) plus a $150 design fee, so from $210. Design options (3 to 5) arrive within **2 weeks** of the order date.
- **No new race designs until 2027:** a race we don't carry is a custom order.

### Make-goods and limits
- **Personal codes:** 15% is standard; 10% when someone just asks or is stuck at checkout; 20% for a repeat customer or when we made them miss a date. Over 25% is Matt's call.
- **Damage or our mistake:** a free replacement, reported within 30 days of delivery with a photo. No return needed.
- **Refunds, invoices or gift cards over $250** go to Matt.

### Also stated in
Change these too when a number above changes: the auto-reply (Support > Settings > Auto-reply) and Claude's drafting playbook (Support > Settings > Drafting playbook).`,
}
