/**
 * One carrier per tracking number, so the label and the link agree.
 *
 * Artelo's fulfillments often disagree with themselves: a USPS label with a
 * dhl.com link (DHL eCommerce hands the parcel to USPS for delivery), a USPS
 * number with an Amazon link, a carrier name that does not match the number.
 * The number is the one thing that cannot be wrong, so the carrier is read
 * from it and the link built for that carrier. A number we cannot place keeps
 * whatever came with it.
 */

const LINKS = {
  UPS: n => `https://www.ups.com/track?tracknum=${n}`,
  USPS: n => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  FedEx: n => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  'Amazon Logistics': n => `https://track.amazon.com/tracking/${n}`,
  DHL: n => `https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=${n}`,
}

/** The carrier a tracking number belongs to, and the number that carrier's site takes. */
export function carrierOf(raw) {
  const n = String(raw || '').replace(/\s+/g, '').toUpperCase()
  if (!n) return null
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return { company: 'UPS', number: n }
  if (/^TBA\d{9,}$/.test(n)) return { company: 'Amazon Logistics', number: n }
  // USPS IMpb with the 420 + ZIP routing prefix (what DHL eCommerce hands over): USPS takes the part after it.
  const routed = n.match(/^420(?:\d{5}|\d{9})(9[1-5]\d{18,24})$/)
  if (routed) return { company: 'USPS', number: routed[1] }
  if (/^9[1-5]\d{18,24}$/.test(n)) return { company: 'USPS', number: n }
  if (/^(EA|EC|CP|LZ|RA|RE)\d{9}US$/.test(n)) return { company: 'USPS', number: n }
  if (/^(\d{12}|\d{15}|\d{20}|96\d{20})$/.test(n)) return { company: 'FedEx', number: n }
  return null
}

/** A tracking entry with its carrier and link made to agree with the number. */
export function alignTracking(t) {
  if (!t?.number) return t
  const c = carrierOf(t.number)
  if (!c) return t
  return { ...t, company: c.company, url: LINKS[c.company](c.number) }
}
