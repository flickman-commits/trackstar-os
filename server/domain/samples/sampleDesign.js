/**
 * The print for an overseas (Gelato) sample, made by the tool instead of by
 * hand. A Gelato sample is not a Shopify order, so nothing imports, researches
 * or renders it. Here a sample gets a hidden Order row of type "sample"
 * (SAMPLE-0001), the way bulk runners do, so the scrapers, the race date and
 * weather, and the render workers all work on it unchanged.
 *
 * The row is created completed and typed "sample", which keeps it out of the
 * order lists, the nightly sweep, auto-research and auto-render. Nothing here
 * approves the render: approval would send it to the Drive Orders folder, the
 * Artelo library and Artelo production. Using the design copies its PDF to the
 * public bucket Gelato reads, and that URL is the sample's file.
 */
import prisma from '../../db.js'
import { storage } from '../../lib/storage.js'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout.js'
import { researchService } from '../../services/ResearchService.js'
import { hasScraperForRace, getCoveredYears } from '../../scrapers/index.js'
import { ensureOverridesLoaded } from '../../scrapers/scraperOverrides.js'
import { acceptMatch } from '../research/acceptMatch.js'
import { checkOrder, createJob, latestJob, signedFiles, availableTemplates, onlineWorkers } from '../render/jobs.js'
import { formatTime, formatPace } from '../../lib/printFormat.js'
import { GelatoError } from '../../services/gelato.js'

const PUBLIC_BUCKET = 'order-proofs'
// Gelato's prints are 12x18 (gelato.js GELATO_PRODUCTS). The frame is picked at
// send time and does not change the design, so the design's order keeps black.
const SIZE = '12x18'
const FRAME = 'Black Premium Oak'

/** Races the tool can design: a render template some worker has, and a scraper to find the result. */
export async function designRaces() {
  await ensureOverridesLoaded()
  const [keys, workers] = await Promise.all([availableTemplates(), onlineWorkers()])
  const names = [...new Set(keys.map(k => k.split(' / ')[0]))].filter(n => hasScraperForRace(n)).sort()
  return {
    races: names.map(raceName => ({ raceName, years: getCoveredYears(raceName) })),
    workersOnline: workers.length,
  }
}

async function nextNumber() {
  const last = await prisma.order.findFirst({ where: { trackstarOrderType: 'sample' }, orderBy: { createdAt: 'desc' }, select: { parentOrderNumber: true } })
  const n = last ? parseInt(String(last.parentOrderNumber).replace(/\D/g, ''), 10) || 0 : 0
  return `SAMPLE-${String(n + 1).padStart(4, '0')}`
}

async function sampleOrder(orderNumber) {
  const o = await prisma.order.findFirst({ where: { orderNumber: String(orderNumber || ''), trackstarOrderType: 'sample' } })
  if (!o) throw new GelatoError('That sample design was not found. Start again.', 400)
  return o
}

/**
 * Look up the runner's result. The first lookup makes the sample's order; a
 * later one (a fixed name or year) updates it and searches again.
 */
export async function findSampleResult({ orderNumber, raceName, year, runnerName }) {
  const race = String(raceName || '').trim(), name = String(runnerName || '').trim().replace(/\s+/g, ' ')
  const y = parseInt(year, 10)
  if (!race || !name) throw new GelatoError('Pick the race and type the runner\'s name', 400)
  if (!(y >= 2020 && y <= new Date().getFullYear())) throw new GelatoError('Give a race year from 2020 on', 400)
  await ensureOverridesLoaded()
  if (!hasScraperForRace(race)) throw new GelatoError(`There is no results lookup for ${race}`, 400)

  const fields = { raceName: race, raceYear: y, runnerName: name, raceNameOverride: null, yearOverride: null, runnerNameOverride: null }
  let order = orderNumber ? await sampleOrder(orderNumber) : null
  if (order) {
    order = await prisma.order.update({ where: { id: order.id }, data: fields })
  } else {
    const number = await nextNumber()
    order = await prisma.order.create({
      data: {
        ...fields, orderNumber: number, parentOrderNumber: number, lineItemIndex: 0,
        source: 'sample', trackstarOrderType: 'sample', status: 'completed',
        arteloOrderData: {}, productSize: SIZE, frameType: FRAME, customerName: name.split(' ')[0],
      },
    })
  }
  await researchService.researchOrder(order.orderNumber, { force: true })
  return sampleDesignState(order.orderNumber)
}

/** Take one of the near matches research found as the runner's result. */
export async function acceptSampleMatch({ orderNumber, match }) {
  await sampleOrder(orderNumber)
  await acceptMatch({ orderNumber, match })
  return sampleDesignState(orderNumber)
}

/** Queue the render. Refused, with the reasons, while anything the print needs is missing. */
export async function renderSample({ orderNumber }, actor) {
  const order = await sampleOrder(orderNumber)
  try {
    await createJob({ orderId: order.id, requestedBy: 'admin', requestedById: actor?.id || null })
  } catch (err) {
    throw new GelatoError(err.message, 400)
  }
  return sampleDesignState(orderNumber)
}

/** Where the sample's design stands: the result, what the render still needs, and the render itself. */
export async function sampleDesignState(orderNumber) {
  const order = await sampleOrder(orderNumber)
  const [research, check, job] = await Promise.all([
    prisma.runnerResearch.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' }, include: { race: { select: { raceDate: true, weatherCondition: true, weatherTemp: true } } } }),
    checkOrder(order.id).catch(err => ({ ok: false, reasons: [err.message] })),
    latestJob(order.id),
  ])
  const files = job ? await signedFiles(job, 1800) : { previewUrl: null }
  return {
    orderNumber: order.orderNumber,
    raceName: order.raceName, raceYear: order.raceYear, runnerName: order.runnerName,
    result: research ? {
      status: research.researchStatus,
      bib: research.bibNumber || null,
      time: formatTime(research.officialTime) || null,
      pace: formatPace(research.officialPace) || null,
      eventType: research.eventType || null,
      notes: research.researchNotes || null,
      matches: Array.isArray(research.possibleMatches) ? research.possibleMatches.slice(0, 8) : [],
    } : null,
    ready: Boolean(check.ok),
    reasons: check.reasons || [],
    render: job ? { version: job.version, status: job.status, error: job.error || null, notes: job.notes || null, previewUrl: files.previewUrl || null, file: job.spec?.file || null } : null,
    fileUrl: order.productionFileUrl || null,
  }
}

/** Use the finished render as the sample's file: copied to the public bucket Gelato fetches from. */
export async function useSampleDesign({ orderNumber }) {
  const order = await sampleOrder(orderNumber)
  const job = await latestJob(order.id)
  if (!job || job.status !== 'done') throw new GelatoError('The design is not finished yet', 400)
  const { pdfUrl } = await signedFiles(job, 600)
  if (!pdfUrl) throw new GelatoError('The render has no PDF', 400)
  const res = await fetchWithTimeout(pdfUrl, {}, 60_000)
  if (!res.ok) throw new Error(`Could not read the PDF (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const name = `${job.spec?.file || order.orderNumber}-v${job.version}.pdf`
  const path = `samples/gelato/${name}`
  const sb = storage()
  const up = await sb.storage.from(PUBLIC_BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw new Error(`Could not publish the print: ${up.error.message}`)
  const url = sb.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl
  await prisma.order.update({ where: { id: order.id }, data: { productionFileUrl: url } })
  return { name, url }
}
