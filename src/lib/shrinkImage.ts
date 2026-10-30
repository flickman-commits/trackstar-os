/**
 * Make a photo small enough to send in a JSON body. Vercel turns away request
 * bodies over 4.5 MB, and a phone photo, base64-encoded, is often past that.
 * Anything larger than `maxBytes` or `maxSide` is redrawn as a JPEG at most
 * `maxSide` on its long edge. A file the browser cannot draw (HEIC in Chrome)
 * comes back as it was.
 */
export async function shrinkImage(file: File, { maxSide = 2400, maxBytes = 1_500_000, quality = 0.85 } = {}): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { return file }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= maxBytes) { bitmap.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) { bitmap.close(); return file }
  // White under any transparency, since JPEG has none.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob || blob.size >= file.size) return file
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
}
