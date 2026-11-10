/**
 * Single-key shortcuts (A approve and send, R reject, F complete, S/D move)
 * act on the page behind whatever is open. While a modal dialog is open (a
 * confirm, the comment box, the photo cropper) they are off, so a key meant
 * for the dialog, or pressed with focus on one of its buttons, never approves
 * or moves to another order behind it.
 */
export function shortcutsPaused(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(document.querySelector('[aria-modal="true"]'))
}

/** Whether this render's preview image has loaded, so A never approves a design nobody could see yet. */
export function previewShown(jobId: string): boolean {
  if (typeof document === 'undefined') return false
  const imgs = document.querySelectorAll<HTMLImageElement>(`img[data-render-preview="${CSS.escape(jobId)}"]`)
  return Array.from(imgs).some(img => img.complete && img.naturalWidth > 0)
}
