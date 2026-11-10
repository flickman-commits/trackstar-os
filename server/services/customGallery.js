/**
 * Custom gallery: every custom design a customer approves gets copied into one
 * Google Drive folder, so the team can browse everything we have made.
 *
 * Auth: the person's own Google connection (the Sales tool's Gmail connect,
 * which now asks for Drive too), so the file lands in their My Drive and
 * counts against their storage. A service account cannot do that: it has no
 * storage, and Google refuses its uploads into a My Drive folder. The service
 * account is only the fallback, which works if the folder ever moves to a
 * shared drive.
 *
 * Folder: CUSTOM_GALLERY_FOLDER_ID, defaulting to the one Matt set up.
 * Best effort: a failure is logged and never blocks the customer's approval.
 */
import { google } from '../lib/google.js'
import { Readable } from 'node:stream'
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js'
import { driveClientForAnyone } from '../domain/sales/gmail.js'
import { requireConnection } from '../lib/connections.js'

const DEFAULT_FOLDER_ID = '1fypaQ9e7OderffveNyydacDcCZoY2d7S'

let cachedDrive = null
async function getDrive() {
  await requireConnection('google_drive')
  const personal = await driveClientForAnyone().catch(() => null)
  if (personal) return personal
  if (cachedDrive) return cachedDrive
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!email || !rawKey) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY')
  const jwt = new google.auth.JWT({
    email,
    key: rawKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  cachedDrive = google.drive({ version: 'v3', auth: jwt })
  return cachedDrive
}

const clean = s => String(s || '').replace(/[\\/:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim()

/**
 * Copy an approved proof into the gallery folder.
 * @param {{ order: object, proof: { imageUrl: string, version: number, fileName?: string } }} args
 * @returns {Promise<string|null>} the Drive file id, or null on failure
 */
/**
 * Only our own storage is fetched. A proof's imageUrl can be typed in by
 * staff, and the server fetching whatever address it holds would let it read
 * internal addresses and copy what it finds into Drive.
 */
function ourStorageUrl(u) {
  try {
    const url = new URL(String(u))
    const base = new URL(String(process.env.SUPABASE_URL || ''))
    return url.protocol === 'https:' && url.host === base.host && url.pathname.startsWith('/storage/v1/object/')
  } catch { return false }
}

export async function saveApprovedMockup({ order, proof }) {
  try {
    if (!ourStorageUrl(proof.imageUrl)) throw new Error('the proof image is not in our storage, so it is not fetched')
    const res = await fetchWithTimeout(proof.imageUrl, {}, 20000)
    if (!res.ok) throw new Error(`image download ${res.status}`)
    const mimeType = res.headers.get('content-type') || 'image/jpeg'
    const ext = (proof.fileName?.match(/\.(\w+)$/)?.[1]) || (mimeType.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
    const buf = Buffer.from(await res.arrayBuffer())

    const num = order.shopifyOrderData?.name ? String(order.shopifyOrderData.name).replace('#', '') : order.parentOrderNumber
    const name = clean([
      num,
      order.runnerName || order.customerName,
      [order.raceName, order.raceYear].filter(Boolean).join(' '),
      `Option ${proof.version}`,
    ].filter(Boolean).join(' - ')) + `.${ext}`

    const drive = await getDrive()
    const { data } = await drive.files.create({
      requestBody: { name, parents: [process.env.CUSTOM_GALLERY_FOLDER_ID || DEFAULT_FOLDER_ID] },
      media: { mimeType, body: Readable.from(buf) },
      fields: 'id',
      supportsAllDrives: true,
    })
    console.log(`[customGallery] Saved ${name} (${data.id})`)
    return data.id
  } catch (error) {
    console.error('[customGallery] Could not save approved mockup:', error.message)
    return null
  }
}
