/**
 * Where a customer or staff photo lives in the personalization-photos
 * bucket: "<YYYY-MM-DD>/<uuid>.<ext>", the shape every upload route makes
 * (api/_routes/public/photo-upload-url.js, api/_routes/orders/photo.js).
 *
 * A photo path also arrives from the shop's cart as the `_photo_path` line
 * item property, which a shopper can set to anything. Nothing outside this
 * shape is stored or signed: a path like "../production-files/..." could
 * otherwise resolve into another private bucket and come back signed.
 */
export const STORED_PHOTO_PATH = /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$/

/** A customer upload that photo-verify has checked: the same shape, the three types it accepts. */
export const VERIFIED_PATH = /^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/

export function isStoredPhotoPath(p) {
  return STORED_PHOTO_PATH.test(String(p || ''))
}
