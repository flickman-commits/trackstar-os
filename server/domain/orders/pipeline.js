/**
 * One status per standard order, worked out from everything the tool knows:
 * the research record, the race row, the newest render, the photo. The table
 * shows it and filters by it; the order view explains it. Nothing else should
 * invent a status vocabulary.
 *
 * Five stages, in the order a person cares about them:
 *   review          a design is waiting for a yes or no
 *   attach          approved: on its way to Artelo production (arteloSend.js), held, or approved
 *                   without sending, for a person to send or attach by hand. One Artelo would
 *                   not take is under action, with Artelo's reason.
 *   action          the script is stuck and a person has to do something (reason says what)
 *   needs_research  no result yet and nothing stops the lookup (brief; the import does it)
 *   waiting         nothing to do until something outside happens (race day, results, a worker, a payment)
 *   done            completed
 *
 * `reason` is one short line for the table; `fix` is the sentence for the
 * order view, what to actually do. `kind` groups the actions: data (fix the
 * order's numbers), setup (scraper, production file, race data), render.
 */
import { printBlockers } from '../races/verification.js'
import { isTriathlon, triathlonMissing } from './triathlon.js'
import { resolveTemplate, SIZES } from '../render/spec.js'
import { sendStateOf } from '../render/sendState.js'

const RESULT_STATES = new Set(['found'])
// The oldest race year anyone builds a scraper for (Matt, 2026-10-21).
export const SCRAPER_MIN_YEAR = 2020

function raceRun(race, year) {
  if (!race?.raceDate) return year ? year < new Date().getUTCFullYear() : false
  return race.raceDate.getTime() <= Date.now()
}

/**
 * @param {object} p
 * @param {object} p.order           the Order row (status, raceName/raceYear + overrides, hadNoTime, photoPath, photoPlacedAt)
 * @param {object|null} p.research   newest RunnerResearch row
 * @param {object|null} p.race       the Race row for the order's race and year
 * @param {object|null} p.render     newest RenderJob (status, review, error, reviewNote)
 * @param {boolean} p.hasScraper
 * @param {Set<string>} p.templates  template keys that are enabled and checked ok
 * @param {Set<string>} p.noTimeGaps "template|size" pairs that cannot print a no-time order
 * @param {boolean} p.photoUnpaid
 * @param {boolean} p.workerOnline
 */
/** An approved print: where it is on the way to production (server/domain/render/sendState.js). */
function approvedStage(render, stage) {
  const s = sendStateOf({ ...render, review: 'approved' })
  if (s?.state === 'held') return stage('attach', 'Held', { fix: `Approved, and held from production${s.by ? ` by ${s.by}` : ''}. Send it to production when it is ready, or attach it in Artelo by hand.` })
  if (s?.state === 'waiting') return stage('attach', 'Uploaded, waiting on other prints', { fix: 'Attached to its item in Artelo. The Artelo order goes to production once every print on it has its design. Mark it complete if the rest is handled in Artelo.' })
  if (s?.state === 'manual') return stage('action', 'Expedited shipping', { kind: 'artelo', fix: 'Manually attach and add expedited shipping to this order in Artelo, then mark it complete.' })
  if (s?.state === 'blocked') return stage('action', 'Artelo would not take it', { kind: 'artelo', fix: `${s.reason.replace(/\.$/, '')}. ${s.next ? 'The tool tries again on its own.' : 'Sort it out in Artelo, then Send to production.'}` })
  if (s?.state === 'queued') return stage('attach', 'Sending to production', { fix: 'Approved. It is attached in Artelo and sent to production in a few minutes, unless someone holds it.' })
  return stage('attach', 'Attach in Artelo', { fix: 'The print is approved and in the Artelo library (Orders folder), but was not sent. Send it to production, or attach it in Artelo by hand and mark the order done.' })
}

export function pipelineFor({ order, research, race, render, hasScraper, templates, noTimeGaps, photoUnpaid, workerOnline }) {
  const raceName = order.raceNameOverride ?? order.raceName
  const year = order.yearOverride ?? order.raceYear
  const stage = (s, reason, extra = {}) => ({ stage: s, reason, ...extra })

  if (order.status === 'completed') return stage('done', 'Completed')
  if (order.status === 'flagged') return stage('action', 'Flagged', { kind: 'data', fix: order.flagReason || 'This order was flagged. Resolve the flag.' })
  // Artelo is holding it (server/domain/orders/arteloMismatch.js): nothing
  // prints until someone acts there, whatever the tool thinks of the design.
  if (order.arteloHold === 'Missing Designs') return stage('action', 'Not sent in Artelo', { kind: 'artelo', fix: 'This was marked complete, but Artelo still has the order as Missing Designs. Attach the design in Artelo (or Send to production if it was approved here), then complete it.' })
  if (order.arteloHold) return stage('action', `Artelo: ${order.arteloHold}`, { kind: 'artelo', fix: /address/i.test(order.arteloHold) ? 'Artelo could not verify the shipping address and will not print until it is reviewed. Open the order in Artelo, fix or confirm the address, then send it to production.' : `Artelo is holding this order (${order.arteloHold}). Sort it out in Artelo; nothing prints until then.` })

  // A design waiting for review comes first: it is the one thing the tool wants from a person.
  if (render?.status === 'done' && render.review === 'pending') return stage('review', 'Ready for review')
  if (render?.status === 'queued' || render?.status === 'rendering') return stage('waiting', workerOnline ? 'Rendering' : 'Waiting for the renderer', { fix: workerOnline ? 'Illustrator is making the print.' : 'No render worker is online. The print renders when one checks in.' })
  // A design with no photo window cannot take the customer's photo: that is a hand job, not a failure to retry.
  if (render?.status === 'failed' && /no photo window/i.test(render.error || '')) return stage('action', 'Make by hand', { kind: 'setup', fix: 'This design has no photo window, and the order has a customer photo. Make this design by hand.' })
  if (render?.status === 'failed') return stage('action', 'Render failed', { kind: 'render', fix: `The render failed: ${render.error || 'unknown error'}. Fix the cause; it renders again on its own once the order's data changes, or use Re-render.` })
  if (render?.status === 'done' && render.review === 'approved') return approvedStage(render, stage)
  if (render?.status === 'done' && render.review === 'rejected') return stage('action', 'Design rejected', { kind: 'data', fix: `The design was rejected: ${render.reviewNote || 'no note'}. Fix the data; a new design renders on the next import.` })

  // Race and setup problems: things only a person (or a developer) can change.
  if (!raceName) return stage('action', 'Unknown race', { kind: 'setup', fix: 'The tool could not tell which race this is. Set the race on the order.' })
  if (!year || order.status === 'missing_year') return stage('action', 'Year missing', { kind: 'data', fix: 'The order does not say which year. Ask the customer or read it off the order, then set it.' })

  // Triathlons: one design for all of them, no scrapers. A person enters the
  // result; until every field is there it is manual research, never "needs a scraper".
  if (isTriathlon(order)) {
    // Order of work: a known future race waits; otherwise the result comes
    // first (entering it puts the race on file, which Race > Edit needs), then
    // the race date, then the weather.
    if (race?.raceDate && !raceRun(race, year)) return stage('waiting', 'Race not run yet', { fix: `${raceName} ${year} has not happened yet.` })
    const missing = triathlonMissing(research)
    if (missing.length) return stage('action', 'Needs manual research', { kind: 'data', fix: `Triathlons are researched by hand. Find the athlete on the race's results site and enter the ${missing.join(', ')} under Runner > Edit.` })
    if (!race?.raceDate) return stage('action', 'Needs race date', { kind: 'data', fix: `${raceName} ${year} has no race date. Add it with a source under Race > Edit; the weather follows from it.` })
    const blockers = printBlockers(race)
    if (blockers.length === 1 && /not confirmed/.test(blockers[0])) return stage('action', 'Confirm weather', { kind: 'data', fix: 'The weather for this race year is calculated but nobody has checked it. Open the breakdown (source), then Confirm.' })
    if (blockers.length) return stage('action', 'Needs race data', { kind: 'data', fix: `${blockers.join('. ')}.` })
    return stage('action', 'Make by hand', { kind: 'setup', fix: 'Everything for this triathlon print is here. Make it from the triathlon design, then mark it complete.' })
  }
  if (!raceRun(race, year)) return stage('waiting', 'Race not run yet', { fix: `${raceName} ${year} has not happened yet. Results are looked up two days after race day.` })

  const rs = research?.researchStatus || null
  if (!hasScraper || rs === 'no_scraper') return stage('action', 'Needs a scraper', { kind: 'setup', fix: `There is no scraper for ${raceName}. A developer adds one, or research the runner by hand.` })
  // The results site itself has no such year (Boston before 2010): nothing to
  // wire up, so this is research by hand or a question for the customer.
  if (rs === 'year_not_configured' && /not available on the results site/.test(research?.researchNotes || '')) return stage('action', 'Results not online', { kind: 'data', fix: `${raceName} ${year} results are not on the timing site. Check the year with the customer, or enter the result by hand from their bib, certificate or another source.` })
  // Scrapers are never built for years before 2020: too few orders to justify
  // one. Those runners are researched by hand.
  if (rs === 'year_not_configured' && year < SCRAPER_MIN_YEAR) return stage('action', 'Research by hand', { kind: 'data', fix: `Scrapers only cover ${SCRAPER_MIN_YEAR} and later, so ${raceName} ${year} is researched by hand. Find the runner on the results site or ask the customer for their bib and time, then enter them under Runner > Edit.` })
  if (rs === 'year_not_configured') return stage('action', 'Needs a scraper', { kind: 'setup', fix: `The ${raceName} scraper is not wired up for ${year}. A developer adds this year's event id, or research the runner by hand.` })

  // The runner's result.
  if (!research) return stage('needs_research', 'Needs research', { fix: 'No lookup has run for this order yet. It runs on the next import, or run it now.' })
  // A site that refuses our server (not down) is looked up through the render worker on the Mac.
  if (rs === 'upstream_error' && /blocks lookups from our server/.test(research.researchNotes || '')) return stage('action', 'Lookup blocked', { kind: 'setup', fix: 'This timing site blocks our server, so its lookups go through the render worker on the Mac. Start the worker, then run research again.' })
  if (rs === 'upstream_error') return stage('action', 'Timing site down', { kind: 'data', fix: 'The timing site was down when the lookup ran. Run research again.' })
  if (rs === 'ambiguous') return stage('action', 'Pick a match', { kind: 'data', fix: 'More than one finisher matches. Confirm which one on the results site, then accept the match.' })
  if (rs === 'time_unavailable') return stage('action', 'Enter the time', { kind: 'data', fix: 'The runner was found but the timing site hides the finish time. Open their result and enter the time by hand.' })
  if (rs === 'not_found') return stage('action', 'Runner not found', { kind: 'data', fix: 'The runner was not in the results. Check the name and year, research again, or look it up by hand.' })
  if (!RESULT_STATES.has(rs)) return stage('needs_research', 'Needs research', { fix: 'The lookup has not finished.' })
  if (!research.bibNumber) return stage('action', 'No bib', { kind: 'data', fix: 'The result has no bib number. Add it by hand.' })
  if (!order.hadNoTime && (!research.officialTime || !research.officialPace)) return stage('action', 'No time', { kind: 'data', fix: 'The result has no finish time or pace. Add them, or mark the order as no time.' })

  // Everything a design needs is here. What stops the render?
  const template = resolveTemplate(order, raceName, research.eventType, k => templates.has(k))
  if (!templates.has(template)) return stage('action', 'Needs a production file', { kind: 'setup', fix: `There is no checked production file for ${template}. Add it under Settings > Designs, or make the design by hand.` })
  if (!SIZES.includes(order.productSize)) return stage('action', 'Make by hand', { kind: 'setup', fix: `${order.productSize} is not a size the script renders. Make this design by hand.` })
  if (order.photoPath && noTimeGaps.has(`photo|${template}|${order.productSize}`)) return stage('action', 'Make by hand', { kind: 'setup', fix: `The ${template} ${order.productSize} design has no photo window, and this order has a customer photo. Make this design by hand.` })
  if (order.hadNoTime && noTimeGaps.has(`${template}|${order.productSize}`)) return stage('action', 'Needs NO TIME layer', { kind: 'setup', fix: `The ${template} ${order.productSize} design needs a NO TIME layer before a no-time print can render. Ask the designer, or make it by hand.` })
  const blockers = printBlockers(race)
  if (blockers.length && blockers.every(b => /not verified/.test(b) || /not confirmed/.test(b)) && race?.raceDate && (race.raceDateSourceUrl || race.raceDateEvidence) && blockers.some(b => /not verified/.test(b))) return stage('action', 'Confirm race date', { kind: 'data', fix: 'The race date was read off a results page. Check it against the sources beside the date, then Confirm. It confirms every order of this race year.' })
  if (blockers.length === 1 && /not confirmed/.test(blockers[0])) return stage('action', 'Confirm weather', { kind: 'data', fix: 'The weather for this race year is calculated but nobody has checked it. Open the breakdown (source), then Confirm. It confirms every order of this race year.' })
  if (blockers.length) return stage('action', 'Needs race data', { kind: 'setup', fix: `${blockers.join('. ')}. Fix it in the Race Database.` })
  if (photoUnpaid) return stage('waiting', 'Photo not paid', { fix: 'The customer has not paid for the photo add-on yet. The print renders once Shopify reads paid.' })
  if (!render) return stage('waiting', workerOnline ? 'Render queued' : 'Waiting for the renderer', { fix: workerOnline ? 'The print is queued for the next render run.' : 'No render worker is online. The print renders when one checks in.' })
  if (render.status === 'done' && render.review === 'closed') return stage('waiting', 'Render queued', { fix: 'The last design was closed. A new one renders on the next run.' })
  return stage('waiting', 'In progress')
}
