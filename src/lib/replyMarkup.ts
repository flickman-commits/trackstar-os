/**
 * The reply composer edits formatted text, but a reply is stored and sent
 * as the same small markup it always was (server/domain/support/format.js):
 *
 *   **bold**   _italic_   [text](https://...)   bare https://... links
 *
 * These two functions are the bridge: markup to the editor's HTML when a
 * reply is set from outside (the starter, a macro, a draft), and the
 * editor's HTML back to markup on every keystroke. One <div> per line.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MD_LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g
const BARE_URL = /\b(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,!?:;])/g
const BOLD = /\*\*(?=\S)([^*\n]*?\S)\*\*/g
const ITALIC = /(^|[\s(["'])_(?=\S)([^_\n]*?\S)_(?=$|[\s).,!?:;"'])/g

/** One line of markup as editor HTML. Links are held aside so their text is never read as marks. */
export function lineToEditorHtml(line: string): string {
  const held: string[] = []
  const hold = (html: string) => `\uE000${held.push(html) - 1}\uE000`
  let s = line
  s = s.replace(MD_LINK, (_, text: string, url: string) => hold(`<a href="${esc(url)}">${esc(text)}</a>`))
  s = s.replace(BARE_URL, (url: string) => hold(`<a href="${esc(url)}">${esc(url)}</a>`))
  s = esc(s)
  s = s.replace(BOLD, (_, t: string) => `<b>${t}</b>`)
  s = s.replace(ITALIC, (_, pre: string, t: string) => `${pre}<i>${t}</i>`)
  return s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => held[Number(i)])
}

/** Markup as plain text, the way a DM goes out (format.js replyToPlain): marks dropped, links written out. */
export function markupToPlain(text: string): string {
  return String(text || '')
    .replace(MD_LINK, (_, t: string, url: string) => (t.trim() === url ? url : `${t}: ${url}`))
    .replace(BOLD, (_, t: string) => t)
    .replace(ITALIC, (_, pre: string, t: string) => `${pre}${t}`)
}

/** Markup as the editor's HTML: a div per line, an empty line as <div><br></div>. */
export function markupToEditorHtml(text: string): string {
  if (!text) return ''
  return text.split('\n').map(l => `<div>${lineToEditorHtml(l) || '<br>'}</div>`).join('')
}

/** Marks hug the words: "**bold **" would not read as bold, so spaces go outside. */
function wrap(inner: string, mark: string): string {
  return inner.split('\n').map(seg => {
    const m = seg.match(/^(\s*)([\s\S]*?)(\s*)$/)
    return m && m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : seg
  }).join('\n')
}

const BLOCK = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE'])

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName
  if (tag === 'BR') return '\n'
  const inner = Array.from(el.childNodes).map(inline).join('')
  if (BLOCK.has(tag)) return `\n${blockText(el)}`
  if (tag === 'B' || tag === 'STRONG' || /^(bold|[6-9]00)$/.test(el.style.fontWeight)) return wrap(inner, '**')
  if (tag === 'I' || tag === 'EM' || el.style.fontStyle === 'italic') return wrap(inner, '_')
  if (tag === 'A') {
    const href = el.getAttribute('href') || ''
    if (!/^(https?:|mailto:)/i.test(href)) return inner
    const t = inner.trim()
    return !t || t === href ? href : `[${t}](${href})`
  }
  return inner
}

/** A block's text; the <br> that holds an empty or trailing line open is not a line of its own. */
function blockText(el: HTMLElement): string {
  const text = Array.from(el.childNodes).map(inline).join('')
  const last = el.lastChild
  return last && last.nodeName === 'BR' && text.endsWith('\n') ? text.slice(0, -1) : text
}

/** The editor's HTML back to markup. */
export function editorToMarkup(root: HTMLElement): string {
  const lines: string[] = []
  let loose = ''
  let sawBlock = false
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has((child as HTMLElement).tagName)) {
      if (loose) { lines.push(loose); loose = '' }
      lines.push(blockText(child as HTMLElement))
      sawBlock = true
    } else {
      loose += inline(child)
    }
  }
  if (loose) lines.push(sawBlock && loose.endsWith('\n') ? loose.slice(0, -1) : loose)
  return lines.join('\n')
}
