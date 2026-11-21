/**
 * How long after an order is placed the customer can still change it
 * themselves, and the earliest its print goes to production. One number, so
 * what the confirmation email promises and what the sender does cannot drift
 * apart: the link works until CHANGE_WINDOW_HOURS after the order, and
 * arteloSend.queueSend never sends before then (a person's Send now still can).
 */
import crypto from 'crypto'
import { appBaseUrl } from '../../lib/links.js'

// 48 since 2026-11-05 (Matt): the customer has two days to ask for a change before the print is made.
export const CHANGE_WINDOW_HOURS = 48
const HOUR = 3600_000

/**
 * When the customer placed the order: Shopify's created_at, Etsy's receipt
 * create_timestamp (seconds), else when we imported it. An Etsy order
 * imported late (six from Nov 8 came in on Nov 21) was otherwise held two
 * more days from the import.
 */
export function placedAt(order) {
  const etsy = Number(order?.etsyOrderData?.create_timestamp || order?.etsyOrderData?.created_timestamp) || 0
  const raw = order?.shopifyOrderData?.created_at || order?.shopifyOrderData?.processed_at || (etsy ? etsy * 1000 : null) || order?.createdAt
  const d = raw ? new Date(raw) : null
  return d && !Number.isNaN(d.getTime()) ? d : null
}

/** The moment the window closes for this order, or null when the order has no date. */
export function windowEndsAt(order) {
  const p = placedAt(order)
  return p ? new Date(p.getTime() + CHANGE_WINDOW_HOURS * HOUR) : null
}

/**
 * The link's signature: HMAC-SHA256 of the Shopify order id, hex, with
 * SELF_SERVE_LINK_SECRET. Shopify's notification templates make the same
 * value with `{{ order.id | hmac_sha256: '<secret>' }}`, so the confirmation
 * email builds the link itself and nobody can guess another order's.
 */
export function linkSignature(shopifyOrderId) {
  const secret = process.env.SELF_SERVE_LINK_SECRET
  if (!secret) return null
  return crypto.createHmac('sha256', secret).update(String(shopifyOrderId)).digest('hex')
}

export function linkIsValid(shopifyOrderId, signature) {
  const expected = linkSignature(shopifyOrderId)
  if (!expected || typeof signature !== 'string' || signature.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.toLowerCase()))
}

/**
 * The customer's Manage your order link for a Shopify order: the same one the
 * confirmation email builds (shopify/order-confirmation/top.liquid), so it
 * goes only where that email went. Null without the secret.
 */
export function manageUrl(shopifyOrderId) {
  const id = String(shopifyOrderId || '').trim()
  const sig = /^\d{6,20}$/.test(id) ? linkSignature(id) : null
  return sig ? `${appBaseUrl()}/order/${id}/${sig}` : null
}
