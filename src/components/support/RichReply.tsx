import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { Link as LinkIcon } from 'lucide-react'
import ActionModal from '@/components/ActionModal'
import { fieldLabel, modalCancel, modalInput, modalPrimary } from '@/lib/ui'
import { editorToMarkup, lineToEditorHtml, markupToEditorHtml } from '@/lib/replyMarkup'

/**
 * The reply box: bold looks bold, italic looks italic, a link is a link,
 * the way the customer will see it. Underneath, the reply is still the
 * small markup the server sends (replyMarkup.ts says how), so `value` and
 * `onChange` carry that text and nothing else changes for the page.
 *
 * Content is set from `value` only when it changes from outside (the
 * starter, a macro, a draft); typing goes the other way, so the caret
 * stays where it is. Paste is plain text, except a web address pasted over
 * selected words, which links them; pasted or dropped files go to
 * `onFiles` (the attachments). In a DM (`plain`), formatting keys do nothing.
 */
export interface RichReplyHandle {
  focus(): void
  /** Put the caret at the start or end of line `i` (0-based). */
  focusLine(i: number, at: 'start' | 'end'): void
  /** The current line's text up to the caret, for the /macro search. */
  lineBeforeCaret(): string
  /** Insert markup at the caret (or where it last was), first removing `stripBefore` characters before it. */
  insert(markup: string, stripBefore?: number): void
  format(kind: 'bold' | 'italic' | 'link'): void
}

interface Props {
  value: string
  onChange: (markup: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onFiles?: (files: File[]) => void
  disabled?: boolean
  placeholder?: string
  plain?: boolean
  minHeight?: number
  /** No border of its own: it sits inside a box that has the toolbar. */
  bare?: boolean
}

const RichReply = forwardRef<RichReplyHandle, Props>(function RichReply({ value, onChange, onKeyDown, onFiles, disabled, placeholder, plain, minHeight = 160, bare = false }, ref) {
  const el = useRef<HTMLDivElement>(null)
  const shown = useRef<string | null>(null)
  const saved = useRef<Range | null>(null)
  // The link address is asked for in a modal (Arc blocks window.prompt); the selection is remembered meanwhile.
  const [link, setLink] = useState<{ picked: string; url: string } | null>(null)

  useLayoutEffect(() => {
    if (!el.current || value === shown.current) return
    el.current.innerHTML = markupToEditorHtml(value)
    shown.current = value
  }, [value])

  // Remember where the caret was, so a macro or an action inserts there after a click elsewhere.
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection()
      if (sel && sel.rangeCount && el.current && el.current.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange()
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  const emit = () => {
    if (!el.current) return
    const markup = editorToMarkup(el.current)
    shown.current = markup
    onChange(markup)
  }

  /** Focus with the caret back where it was, or at the end. */
  const restore = () => {
    const root = el.current
    if (!root) return
    const sel = document.getSelection()
    // A live selection inside the box wins; the remembered one is for when focus went elsewhere (a menu, the Actions panel).
    if (sel && sel.rangeCount && root.contains(sel.anchorNode) && document.activeElement === root) return
    root.focus()
    if (!sel) return
    if (saved.current && root.contains(saved.current.startContainer)) { sel.removeAllRanges(); sel.addRange(saved.current); return }
    const r = document.createRange(); r.selectNodeContents(root); r.collapse(false)
    sel.removeAllRanges(); sel.addRange(r)
  }

  const api: RichReplyHandle = {
    focus: restore,
    focusLine(i, at) {
      const root = el.current
      if (!root) return
      root.focus()
      const blocks = Array.from(root.children)
      const target = blocks[Math.max(0, Math.min(i, blocks.length - 1))] || root
      const r = document.createRange(); r.selectNodeContents(target); r.collapse(at === 'start')
      const sel = document.getSelection(); sel?.removeAllRanges(); sel?.addRange(r)
    },
    lineBeforeCaret() {
      const root = el.current
      const sel = document.getSelection()
      if (!root || !sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return ''
      const range = sel.getRangeAt(0)
      let block: Node | null = range.startContainer
      while (block && block.parentNode !== root && block !== root) block = block.parentNode
      const r = document.createRange()
      r.setStart(block && block !== root ? block : root, 0)
      r.setEnd(range.startContainer, range.startOffset)
      return r.toString().replace(/\u00a0/g, ' ')
    },
    insert(markup, stripBefore = 0) {
      restore()
      const sel = document.getSelection()
      for (let i = 0; i < stripBefore && sel; i++) sel.modify('extend', 'backward', 'character')
      const html = markup.split('\n').map(l => lineToEditorHtml(l)).join('<br>')
      document.execCommand('insertHTML', false, html)
      emit()
    },
    format(kind) {
      if (plain) return
      restore()
      if (kind === 'link') {
        const sel = document.getSelection()
        const picked = sel ? sel.toString() : ''
        setLink({ picked, url: /^https?:\/\//.test(picked) ? picked : 'https://' })
        return
      } else {
        document.execCommand(kind)
      }
      emit()
    },
  }
  useImperativeHandle(ref, () => api)

  const linkOk = !!link && /^https?:\/\/\S+$/.test(link.url.trim())
  const addLink = () => {
    if (!link || !linkOk) return
    const url = link.url.trim()
    setLink(null)
    restore()
    if (!link.picked) document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>&nbsp;`)
    else document.execCommand('createLink', false, url)
    emit()
  }

  return (
    <>
    {link && (
      <ActionModal icon={LinkIcon} title="Add a link" description={link.picked ? `On "${link.picked.slice(0, 80)}"` : undefined} onClose={() => { setLink(null); restore() }}
        footer={<>
          <button className={modalCancel} onClick={() => { setLink(null); restore() }}>Cancel</button>
          <button className={modalPrimary} onClick={addLink} disabled={!linkOk}>Add link</button>
        </>}>
        <label className="block"><span className={fieldLabel}>Link to</span>
          <input value={link.url} onChange={e => setLink({ ...link, url: e.target.value })} autoFocus onFocus={e => e.currentTarget.select()}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }} placeholder="https://" className={modalInput} />
        </label>
      </ActionModal>
    )}
    <div
      ref={el}
      role="textbox"
      aria-multiline="true"
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder || ''}
      onInput={emit}
      onKeyDown={e => {
        const mod = e.metaKey || e.ctrlKey
        if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
          e.preventDefault()
          if (!plain && e.key.toLowerCase() !== 'u') { document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic'); emit() }
          return
        }
        // ⌘K is the global search (CommandSearch), here too. A link is made by
        // selecting text and pasting the address over it (onPaste below).
        onKeyDown?.(e)
      }}
      onPaste={e => {
        const files = Array.from(e.clipboardData.files || [])
        if (files.length && onFiles) { e.preventDefault(); onFiles(files); return }
        // Plain text only: a paste from a web page or Word brings its fonts and colours otherwise.
        e.preventDefault()
        const pasted = e.clipboardData.getData('text/plain')
        // A web address pasted over selected words links them, no dialog.
        const sel = document.getSelection()
        const url = pasted.trim()
        if (!plain && /^https?:\/\/\S+$/.test(url) && sel && !sel.isCollapsed && sel.toString().trim() && el.current?.contains(sel.anchorNode)) {
          document.execCommand('createLink', false, url)
          emit()
          return
        }
        document.execCommand('insertText', false, pasted)
      }}
      onDragOver={e => { if (onFiles && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault() }}
      onDrop={e => {
        const files = Array.from(e.dataTransfer.files || [])
        if (files.length && onFiles) { e.preventDefault(); onFiles(files) }
      }}
      onClick={e => { const a = (e.target as HTMLElement).closest('a'); if (a && (e.metaKey || e.ctrlKey)) window.open(a.getAttribute('href') || '', '_blank', 'noopener') }}
      style={{ minHeight }}
      className={`w-full max-h-[45vh] overflow-y-auto px-3 py-2.5 text-sm bg-white ${bare ? 'rounded-b-md focus:outline-none' : 'border border-border-gray rounded-md focus:outline-none focus:ring-2 focus:ring-off-black/10 focus:border-off-black/30'} leading-relaxed whitespace-pre-wrap break-words
        [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2
        empty:before:content-[attr(data-placeholder)] empty:before:text-off-black/40
        ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
    />
    </>
  )
})

export default RichReply
