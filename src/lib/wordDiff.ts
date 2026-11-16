/**
 * A word-level diff of two texts, for showing what a proposed edit changes:
 * the parts that stay, the parts removed and the parts added, in order.
 * Plain longest-common-subsequence over words and the spaces between them;
 * fine for a paragraph or two.
 */
export type DiffPart = { kind: 'same' | 'del' | 'add'; text: string }

const tokens = (s: string) => s.match(/\s+|[\w'$%.,]+|[^\s\w]/g) || []

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before), b = tokens(after)
  const n = a.length, m = b.length
  // lcs[i][j]: the common length of a[i..] and b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => { const last = out[out.length - 1]; if (last?.kind === kind) last.text += text; else out.push({ kind, text }) }
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('same', a[i]); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('del', a[i++])
    else push('add', b[j++])
  }
  while (i < n) push('del', a[i++])
  while (j < m) push('add', b[j++])
  return out
}
