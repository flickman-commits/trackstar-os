import type { ReactNode } from 'react'

/**
 * Help articles and Ask answers as text: the bit of markdown they use
 * (headings, - and 1. lists, > quotes, **bold**, _italic_, [links](https://)
 * and bare https links), built as React elements, never as raw HTML.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(?<![\w])_([^_]+)_(?![\w])/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1]) out.push(<strong key={k}>{m[1]}</strong>)
    else if (m[2]) out.push(<a key={k} href={m[3]} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{m[2]}</a>)
    else if (m[4]) out.push(<a key={k} href={m[4]} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{m[4]}</a>)
    else if (m[5]) out.push(<em key={k}>{m[5]}</em>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function HelpText({ text, className = '' }: { text: string; className?: string }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: ReactNode[] } | null = null
  const flush = () => {
    if (!list) return
    const k = `l${blocks.length}`
    blocks.push(list.ordered
      ? <ol key={k} className="list-decimal pl-5 space-y-1">{list.items}</ol>
      : <ul key={k} className="list-disc pl-5 space-y-1">{list.items}</ul>)
    list = null
  }
  let table: string[][] | null = null
  const flushTable = () => {
    if (!table) return
    const [head, ...rows] = table
    blocks.push(
      <div key={`t${blocks.length}`} className="overflow-x-auto">
        <table className="w-full text-xs border border-border-gray">
          <thead><tr className="bg-subtle-gray">{head.map((c, i) => <th key={i} className="text-left font-semibold px-2 py-1 border-b border-border-gray">{inline(c, `th${blocks.length}-${i}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b border-border-gray last:border-0">{r.map((c, ci) => <td key={ci} className="px-2 py-1 align-top">{inline(c, `td${blocks.length}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
        </table>
      </div>,
    )
    table = null
  }
  lines.forEach((raw, n) => {
    const line = raw.trimEnd()
    const k = `b${n}`
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush()
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim())
      if (cells.every(c => /^:?-{3,}:?$/.test(c))) return
      ;(table ||= []).push(cells)
      return
    }
    flushTable()
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push(<li key={k}>{inline((bullet || numbered)![1], k)}</li>)
      return
    }
    flush()
    if (!line.trim()) return
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      const cls = h[1].length <= 2 ? 'text-sm font-semibold text-off-black pt-2' : 'text-[13px] font-semibold text-off-black pt-1'
      blocks.push(<div key={k} className={cls}>{inline(h[2], k)}</div>)
      return
    }
    const q = /^>\s?(.*)$/.exec(line)
    if (q) { blocks.push(<div key={k} className="border-l-2 border-border-gray pl-3 text-off-black/70">{inline(q[1], k)}</div>); return }
    if (/^-{3,}$/.test(line.trim())) { blocks.push(<hr key={k} className="border-border-gray" />); return }
    blocks.push(<p key={k}>{inline(line, k)}</p>)
  })
  flush()
  flushTable()
  return <div className={`space-y-2 text-[13px] leading-relaxed text-off-black ${className}`}>{blocks}</div>
}
