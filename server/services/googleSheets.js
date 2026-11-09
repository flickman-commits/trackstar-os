/**
 * Google Sheets service — reads Matt's Daily Financial Tracker
 * (https://docs.google.com/spreadsheets/d/1yKe9O8XAHXRxBPlOFKN4pMNlH-eYTsdsLNJsw6Tctwg)
 *
 * Auth: a Google Cloud service account. Two env vars are required:
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL — the service account's email
 *   - GOOGLE_SERVICE_ACCOUNT_KEY   — the private key (full PEM block, with newlines)
 *
 * The sheet itself must be shared with that service account email. Reading
 * needs Viewer; writeRanges (the Trybe tab, filled by finance/trybeSync.js)
 * needs Editor.
 * Used by the Marathon Monopoly board (monopolyBoard.js) and Finance.
 */
import { google } from '../lib/google.js'
import { requireConnection } from '../lib/connections.js'

// Hardcoded — the sheet ID isn't sensitive and only one tracker exists.
// If Matt ever creates a new tracker file, change this one constant.
const FINANCIAL_TRACKER_SHEET_ID = '1yKe9O8XAHXRxBPlOFKN4pMNlH-eYTsdsLNJsw6Tctwg'

let cachedClient = null
let cachedWriter = null

/**
 * Build (or reuse) an authenticated Sheets API client.
 * The JWT is cached for the lifetime of the lambda — Sheets tokens last 1h
 * by default and we re-auth on cold start, so we never need to refresh.
 */
function getSheetsClient({ write = false } = {}) {
  if (write ? cachedWriter : cachedClient) return write ? cachedWriter : cachedClient

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!email || !rawKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY')
  }

  // Vercel stores env vars as single-line strings — the PEM private key has
  // literal \n sequences that need to be turned back into actual newlines.
  const privateKey = rawKey.replace(/\\n/g, '\n')

  const jwt = new google.auth.JWT({
    email,
    key: privateKey,
    // Reads stay on the read-only scope; only writeRanges asks for more.
    scopes: [write ? 'https://www.googleapis.com/auth/spreadsheets' : 'https://www.googleapis.com/auth/spreadsheets.readonly'],
  })

  const client = google.sheets({ version: 'v4', auth: jwt })
  if (write) cachedWriter = client; else cachedClient = client
  return client
}

/**
 * Read a contiguous range from any spreadsheet the service account can see.
 *
 * @param {string} a1 - e.g. "'Daily Scoreboard NEW'!A1:Z50"
 * @param {object} [opts]
 * @param {string} [opts.spreadsheetId] - defaults to the financial tracker.
 * @returns {Promise<any[][]>} 2D array of cell values
 */
export async function readRange(a1, { spreadsheetId = FINANCIAL_TRACKER_SHEET_ID } = {}) {
  await requireConnection('google_drive')
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: a1,
    // FORMATTED_VALUE keeps "$1,234" as a string — easier for the prompt to
    // read than raw numbers. The cron passes strings directly into Claude's
    // context anyway.
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  })
  return res.data.values || []
}

/**
 * Read several ranges in one round trip.
 *
 * Sheets bills a batchGet as a single request, so pulling five tabs this way
 * costs one API call instead of five — which matters on a page that a lambda
 * serves cold.
 *
 * @param {string[]} a1List - ranges, in the order the results come back.
 * @param {object} [opts]
 * @param {string} [opts.spreadsheetId] - defaults to the financial tracker.
 * @returns {Promise<any[][][]>} one 2D array per requested range
 */
export async function listTabTitles(spreadsheetId) {
  await requireConnection('google_drive')
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties.title',
  })
  return (res.data.sheets || []).map((s) => s.properties?.title).filter(Boolean)
}

export async function readRanges(a1List, { spreadsheetId = FINANCIAL_TRACKER_SHEET_ID } = {}) {
  await requireConnection('google_drive')
  const sheets = getSheetsClient()
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: a1List,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  })
  // Sheets returns valueRanges in request order, but omits `values` entirely
  // for an empty range — normalize so callers can index without guarding.
  return a1List.map((_, i) => res.data.valueRanges?.[i]?.values || [])
}

/**
 * Write several ranges in one request: [{ range: "'Trybe'!B10:D10", values: [[1, 2, 3]] }].
 * Values go in as typed (RAW), so a number stays a number.
 */
export async function writeRanges(data, { spreadsheetId = FINANCIAL_TRACKER_SHEET_ID } = {}) {
  if (!data.length) return { updatedCells: 0 }
  await requireConnection('google_drive')
  const sheets = getSheetsClient({ write: true })
  const res = await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data } })
  return { updatedCells: res.data.totalUpdatedCells || 0 }
}
