/**
 * An approved render goes where a designer's finished file goes: the Drive
 * Orders folder. Uploaded from the server through the same Google connection
 * the custom gallery uses (a person's Drive, else the service account), so
 * it does not matter which Mac rendered it or whether any is on. The name
 * is the print's filename; a name already in the folder gets " (2)".
 */
import { Readable } from 'node:stream'
import { google } from '../../lib/google.js'
import prisma from '../../db.js'
import { driveClientForAnyone } from '../sales/gmail.js'
import { signedFiles } from './jobs.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import { requireConnection } from '../../lib/connections.js'

export const ORDERS_FOLDER_ID = () => process.env.RENDER_ORDERS_FOLDER_ID || '1hvHh3F9Wdo8cpLPziSbIC1SUHe6Tq1OI'

function serviceDrive() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!email || !rawKey) return null
  return google.drive({ version: 'v3', auth: new google.auth.JWT({ email, key: rawKey.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/drive'] }) })
}

/**
 * Every Drive client worth trying, in order: a person's connection (whoever
 * connected Gmail with Drive access), then the service account. A person's
 * token can expire or be revoked (Google answers "invalid_grant"), and that
 * must not stop prints reaching the folder when the service account can.
 */
export async function driveClients() {
  await requireConnection('google_drive')
  const out = []
  const personal = await driveClientForAnyone().catch(() => null)
  if (personal) out.push({ name: 'the connected Google account', client: personal })
  const svc = serviceDrive()
  if (svc) out.push({ name: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, client: svc })
  if (!out.length) throw new Error('No Google connection with Drive access')
  return out
}

const escapeQ = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Upload the job's PDF to the Orders folder. Records the link on the job, or the error. */
export async function deliverApproved(job) {
  if (job.deliveredAt) return job
  // Only the newest approved version of an order goes to the folder. An older
  // approved version that was re-rendered and approved again is superseded.
  const newer = await prisma.renderJob.findFirst({ where: { orderId: job.orderId, review: 'approved', version: { gt: job.version } }, select: { version: true } })
  if (newer) return prisma.renderJob.update({ where: { id: job.id }, data: { deliveryError: `Superseded by v${newer.version}` } })
  try {
    const { pdfUrl } = await signedFiles(job)
    if (!pdfUrl) throw new Error('No PDF on this render')
    const res = await fetchWithTimeout(pdfUrl, {}, 60_000)
    if (!res.ok) throw new Error(`Could not read the PDF (${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())

    const folder = ORDERS_FOLDER_ID()
    const base = String(job.spec?.file || job.orderId)
    let created = null
    const errors = []
    for (const { name: who, client: d } of await driveClients()) {
      try {
        let name = `${base}.pdf`
        const { data } = await d.files.list({ q: `'${folder}' in parents and name contains '${escapeQ(base)}' and trashed = false`, fields: 'files(name)', pageSize: 100, supportsAllDrives: true, includeItemsFromAllDrives: true })
        const taken = new Set((data.files || []).map(f => f.name))
        for (let n = 2; taken.has(name); n++) name = `${base} (${n}).pdf`
        created = await d.files.create({
          requestBody: { name, parents: [folder] },
          media: { mimeType: 'application/pdf', body: Readable.from(buf) },
          fields: 'id, webViewLink, name',
          supportsAllDrives: true,
        })
        break
      } catch (e) {
        errors.push(`${who}: ${/not found/i.test(e.message) ? 'cannot see the Orders folder (share it as Editor)' : /invalid_grant/i.test(e.message) ? 'its Google connection has expired (reconnect Gmail in Sales)' : /storage quota/i.test(e.message) ? 'a service account cannot own files in a My Drive folder' : e.message}`)
      }
    }
    // Every account's reason, the person's first: the service account's quota
    // error alone hid an expired personal connection for three days.
    if (!created) throw new Error(errors.join(' · '))
    const link = created.data.webViewLink || `https://drive.google.com/file/d/${created.data.id}/view`
    console.log(`[render.deliver] Saved ${created.data.name} to the Orders folder (${created.data.id})`)
    return prisma.renderJob.update({ where: { id: job.id }, data: { deliveredAt: new Date(), deliveredPath: link, deliveryError: null } })
  } catch (error) {
    const msg = error.message
    console.error('[render.deliver]', msg)
    return prisma.renderJob.update({ where: { id: job.id }, data: { deliveryError: String(msg).slice(0, 500) } })
  }
}

/** Approved renders that have not reached Drive yet, retried on every auto-import. */
export async function deliverPending({ limit = 20 } = {}) {
  const jobs = await prisma.renderJob.findMany({ where: { status: 'done', review: 'approved', deliveredAt: null }, orderBy: { reviewedAt: 'asc' }, take: limit })
  let delivered = 0, failed = 0
  for (const job of jobs) { const out = await deliverApproved(job); if (out.deliveredAt) delivered++; else failed++ }
  return { delivered, failed }
}
