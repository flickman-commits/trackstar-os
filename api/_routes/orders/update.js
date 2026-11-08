/**
 * POST /api/orders/update
 *
 * Update order override fields (manual corrections)
 */

import prisma from '../../_lib/prisma.js'
import { setCors, requireAdmin } from '../../_lib/auth.js'
import { withoutRawOrderData } from '../../_lib/money.js'
import { getCanonicalRaceName } from '../../../server/scrapers/index.js'
import { setRaceDate, noteWeatherChange } from '../../../server/domain/races/verification.js'
import { recordAudit } from '../../_lib/users.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'POST, OPTIONS' })) return
  // The person saving: race date and weather edits are logged under their name.
  const actor = (await requireAdmin(req, res))
  if (!actor) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { orderNumber, yearOverride, raceNameOverride, runnerNameOverride, raceId: rawRaceId, weatherTemp, weatherCondition, raceDate, raceAction, raceData,
      // Manual corrections to the result itself. Elí sometimes needs to use the
      // runner's own watch time rather than the official one we scraped.
      bibNumber, officialTime, officialPace,
      // Triathlon legs (time and distance each), entered by hand.
      swimTime, swimDistance, bikeTime, bikeDistance, runTime, runDistance,
      // Partner details. Partner rows have no columns of their own: the
      // organization lives in raceName and the contact in customerName /
      // customerEmail. Named separately here so a caller cannot reach a real
      // customer's email through this door by accident.
      partnerName, partnerContactName, partnerEmail,
      // A custom order's approval email: where the proof links go (the buyer
      // may want them sent to the runner, or used a typo'd address).
      approvalEmail,
      // The customer's email on a standard print, corrected by hand when the
      // one on the order bounces or has a typo. Support conversations and
      // "Email customer" use it; the Shopify order is not changed.
      customerEmail,
      // A custom order's details, filled in by hand when the order came in
      // empty and the customer sent them by email afterwards.
      customBib, customTime, creativeDirection } = req.body
    // Race ids are integers; a string here used to surface as a Prisma error.
    const raceId = rawRaceId == null || rawRaceId === '' ? rawRaceId : Number(rawRaceId)
    if (raceId != null && raceId !== '' && !Number.isInteger(raceId)) return res.status(400).json({ error: 'raceId must be a number' })

    // Race-specific operations (no orderNumber required)
    if (raceAction === 'update' && raceId) {
      const before = await prisma.race.findUnique({ where: { id: raceId } })
      if (!before) return res.status(404).json({ error: 'Race not found' })
      // A date is written only with its evidence, through the one path that
      // checks the print lock and flags renders (verification.js).
      if (raceData?.raceDate) {
        const same = before.raceDate && before.raceDate.toISOString().slice(0, 10) === String(raceData.raceDate).slice(0, 10)
        if (!same || raceData.sourceUrl) {
          try {
            await setRaceDate({ raceId, date: raceData.raceDate, source: 'manual', sourceUrl: raceData.sourceUrl, evidence: raceData.evidence, by: actor?.id || actor?.email || 'manual', reason: raceData.reason, actor })
          } catch (e) { return res.status(400).json({ error: e.message }) }
        }
      }
      const updateFields = {}
      if (raceData?.location !== undefined) updateFields.location = raceData.location || null
      if (raceData?.weatherCondition !== undefined) updateFields.weatherCondition = raceData.weatherCondition ? raceData.weatherCondition.toLowerCase() : null
      if (raceData?.weatherTemp !== undefined) updateFields.weatherTemp = raceData.weatherTemp || null
      const weatherTouched = updateFields.weatherCondition !== undefined || updateFields.weatherTemp !== undefined
      if (weatherTouched) {
        updateFields.weatherFetchedAt = new Date()
        updateFields.weatherDetails = JSON.stringify({ method: 'Entered by hand', by: actor?.email || 'manual', at: new Date().toISOString() })
        updateFields.weatherConfirmedAt = new Date(); updateFields.weatherConfirmedBy = actor?.email || 'manual'
        try {
          await noteWeatherChange({ raceId, before: { weatherTemp: before.weatherTemp, weatherCondition: before.weatherCondition }, after: { weatherTemp: updateFields.weatherTemp ?? before.weatherTemp, weatherCondition: updateFields.weatherCondition ?? before.weatherCondition }, by: actor?.email || 'manual', reason: raceData?.reason, actor })
        } catch (e) { return res.status(400).json({ error: e.message }) }
      }
      const updated = Object.keys(updateFields).length ? await prisma.race.update({ where: { id: raceId }, data: updateFields }) : await prisma.race.findUnique({ where: { id: raceId } })
      console.log(`[API /orders/update] Race ${raceId} updated:`, { ...updateFields, date: raceData?.raceDate })
      return res.status(200).json({ success: true, race: updated })
    }

    if (raceAction === 'create' && raceData) {
      if (!raceData.raceName || !raceData.year || !raceData.raceDate) {
        return res.status(400).json({ error: 'raceName, year, and raceDate are required for new races' })
      }
      const newRace = await prisma.race.create({
        data: {
          raceName: raceData.raceName,
          year: parseInt(raceData.year, 10),
          raceDate: new Date(raceData.raceDate),
          eventTypes: raceData.eventTypes || [],
          location: raceData.location || null,
          weatherCondition: raceData.weatherCondition ? raceData.weatherCondition.toLowerCase() : null,
          weatherTemp: raceData.weatherTemp || null,
        }
      })
      console.log(`[API /orders/update] New race created: ${newRace.raceName} ${newRace.year}`)
      return res.status(200).json({ success: true, race: newRace })
    }

    if (!orderNumber) {
      return res.status(400).json({ error: 'orderNumber is required' })
    }

    // Build update object - only include fields that were provided
    const updateData = {}

    // Allow setting to null (to clear override) or a new value
    if (yearOverride !== undefined) {
      updateData.yearOverride = yearOverride === null || yearOverride === '' ? null : parseInt(yearOverride, 10)
    }

    if (raceNameOverride !== undefined) {
      updateData.raceNameOverride = raceNameOverride === '' ? null : raceNameOverride
    }

    if (runnerNameOverride !== undefined) {
      updateData.runnerNameOverride = runnerNameOverride === '' ? null : runnerNameOverride
    }

    // If year was missing and we now have an override, update status
    const existingOrder = await prisma.order.findFirst({
      where: { orderNumber }
    })

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (customBib !== undefined || customTime !== undefined || creativeDirection !== undefined) {
      if (existingOrder.trackstarOrderType !== 'custom') {
        return res.status(400).json({ error: 'Bib, time and creative direction are edited this way on custom orders only' })
      }
      const clean = (v, max) => { const t = String(v ?? '').trim().slice(0, max); return t || null }
      if (customBib !== undefined) updateData.bibNumberCustomer = clean(customBib, 20)
      if (customTime !== undefined) updateData.timeCustomer = clean(customTime, 20)
      if (creativeDirection !== undefined) updateData.creativeDirection = clean(creativeDirection, 4000)
    }

    if (customerEmail !== undefined) {
      const email = String(customerEmail).trim().toLowerCase()
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That is not an email address' })
      if (existingOrder.trackstarOrderType === 'race_partner') return res.status(400).json({ error: 'Change a partner contact under Partner details' })
      updateData.customerEmail = email || null
      await recordAudit({ action: 'order.customer-email', summary: `Order ${existingOrder.orderNumber}: customer email is now ${email || 'blank'} (was ${existingOrder.customerEmail || 'none'})`, detail: { orderNumber: existingOrder.orderNumber, before: existingOrder.customerEmail, after: email }, actor })
    }
    if (approvalEmail !== undefined) {
      if (existingOrder.trackstarOrderType !== 'custom') {
        return res.status(400).json({ error: 'The approval email can only be changed on a custom order' })
      }
      const email = String(approvalEmail).trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'That does not look like a valid email address' })
      }
      updateData.customerEmail = email
      await recordAudit({ action: 'order.approval-email', summary: `Order ${existingOrder.orderNumber}: approval emails now go to ${email} (was ${existingOrder.customerEmail || 'none'})`, detail: { orderNumber: existingOrder.orderNumber, before: existingOrder.customerEmail, after: email }, actor })
    }

    // Partner details, and only ever on a partner row. The same three columns
    // on a standard order belong to a real shopper, and overwriting a
    // customer's email from a partner form is the kind of mistake that is
    // silent until something bounces.
    if (partnerName !== undefined || partnerContactName !== undefined || partnerEmail !== undefined) {
      if (existingOrder.trackstarOrderType !== 'race_partner') {
        return res.status(400).json({ error: 'Partner details can only be edited on a partner order' })
      }
      // The partner name is the heading on their approval portal, so an empty
      // one would leave that page addressed to nobody.
      if (partnerName !== undefined) {
        if (!String(partnerName).trim()) {
          return res.status(400).json({ error: 'Partner name cannot be empty' })
        }
        updateData.raceName = String(partnerName).trim()
      }
      if (partnerContactName !== undefined) {
        updateData.customerName = String(partnerContactName).trim() || null
      }
      if (partnerEmail !== undefined) {
        const email = String(partnerEmail).trim()
        // Approval links are emailed here, so a typo means the partner never
        // hears from us and nothing looks wrong on our end.
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return res.status(400).json({ error: 'That does not look like a valid email address' })
        }
        updateData.customerEmail = email || null
      }
    }

    // If order was missing_year and we're setting a year override, change status to pending
    if (existingOrder.status === 'missing_year' && updateData.yearOverride) {
      updateData.status = 'pending'
    }

    // A new race year (the year chip in the order view). The results, date
    // and weather all belong to a race year, so what was found for the old
    // year no longer describes this order: its research rows for other years
    // are removed (kept in the Activity Log), open designs made from them are
    // closed, and the order goes back to pending for research on the new year.
    const oldYear = existingOrder.yearOverride ?? existingOrder.raceYear
    const newYear = updateData.yearOverride === undefined ? undefined : (updateData.yearOverride ?? existingOrder.raceYear)
    if (newYear !== undefined && newYear !== oldYear && existingOrder.trackstarOrderType === 'custom') {
      const now = new Date().getFullYear()
      if (!Number.isInteger(newYear) || newYear < 1900 || newYear > now + 1) {
        return res.status(400).json({ error: `The year should be between 1900 and ${now + 1}` })
      }
    } else if (newYear !== undefined && newYear !== oldYear) {
      const now = new Date().getFullYear()
      if (!Number.isInteger(newYear) || newYear < 1970 || newYear > now + 1) {
        return res.status(400).json({ error: `The year should be between 1970 and ${now + 1}` })
      }
      if (existingOrder.status === 'completed') {
        return res.status(400).json({ error: 'This order is completed. A new year on a printed order is a reprint: ask Matt.' })
      }
      const sent = await prisma.renderJob.findFirst({ where: { orderId: existingOrder.id, arteloSentAt: { not: null } }, select: { id: true } })
      if (sent) return res.status(400).json({ error: 'A print of this order has gone to Artelo production already. A new year is a reprint: ask Matt.' })
      const stale = await prisma.runnerResearch.findMany({
        where: { orderId: existingOrder.id, race: { year: { not: newYear } } },
        select: { id: true, bibNumber: true, officialTime: true, officialPace: true, researchStatus: true, source: true, race: { select: { raceName: true, year: true } } },
      })
      if (stale.length) await prisma.runnerResearch.deleteMany({ where: { id: { in: stale.map(r => r.id) } } })
      const closed = await prisma.renderJob.updateMany({ where: { orderId: existingOrder.id, review: { in: ['pending', 'approved'] } }, data: { review: 'closed', reviewNote: `Race year changed to ${newYear}`, reviewedAt: new Date(), sendAfter: null } })
      if (['ready', 'flagged', 'missing_year'].includes(existingOrder.status)) updateData.status = 'pending'
      const person = actor?.id ? await prisma.user.findUnique({ where: { id: actor.id }, select: { firstName: true, lastName: true } }) : null
      const who = [person?.firstName, person?.lastName].filter(Boolean).join(' ') || actor?.email || 'Someone'
      await prisma.orderComment.create({ data: { orderId: existingOrder.id, text: `Race year changed from ${oldYear || 'none'} to ${newYear}. Research runs again for ${newYear}.`, authorId: actor?.id || null, authorName: who } })
      await recordAudit({ action: 'order.year', summary: `Order ${existingOrder.orderNumber}: race year ${oldYear || 'none'} to ${newYear}${stale.length ? `, ${stale.length} old result${stale.length === 1 ? '' : 's'} cleared` : ''}${closed.count ? `, ${closed.count} design${closed.count === 1 ? '' : 's'} closed` : ''}`, detail: { orderNumber: existingOrder.orderNumber, before: oldYear, after: newYear, clearedResearch: stale, closedRenders: closed.count }, actor })
    }

    // Update race-level data (weather, date) on the Race record if provided.
    // Edits made from inside the order detail panel write through to the Race
    // table so every order for that race picks up the corrected value.
    if (raceId && (weatherTemp !== undefined || weatherCondition !== undefined || raceDate !== undefined)) {
      const before = await prisma.race.findUnique({ where: { id: raceId } })
      if (raceDate) {
        const same = before?.raceDate && before.raceDate.toISOString().slice(0, 10) === String(raceDate).slice(0, 10)
        if (!same || req.body.raceDateSourceUrl) {
          try {
            await setRaceDate({ raceId, date: raceDate, source: 'manual', sourceUrl: req.body.raceDateSourceUrl, evidence: req.body.raceDateEvidence, by: actor?.id || actor?.email || 'manual', reason: req.body.reason, actor })
          } catch (e) { return res.status(400).json({ error: e.message }) }
        }
      }
      const raceUpdate = {}
      if (weatherTemp !== undefined) raceUpdate.weatherTemp = weatherTemp || null
      if (weatherCondition !== undefined) raceUpdate.weatherCondition = weatherCondition ? weatherCondition.toLowerCase() : null
      if (Object.keys(raceUpdate).length) {
        raceUpdate.weatherFetchedAt = new Date()
        raceUpdate.weatherDetails = JSON.stringify({ method: 'Entered by hand', by: actor?.email || 'manual', at: new Date().toISOString() })
        raceUpdate.weatherConfirmedAt = new Date(); raceUpdate.weatherConfirmedBy = actor?.email || 'manual'
        try {
          await noteWeatherChange({ raceId, before: { weatherTemp: before?.weatherTemp, weatherCondition: before?.weatherCondition }, after: { weatherTemp: raceUpdate.weatherTemp ?? before?.weatherTemp, weatherCondition: raceUpdate.weatherCondition ?? before?.weatherCondition }, by: actor?.email || 'manual', reason: req.body.reason, actor })
        } catch (e) { return res.status(400).json({ error: e.message }) }
        await prisma.race.update({ where: { id: raceId }, data: raceUpdate })
      }
      console.log(`[API /orders/update] Race ${raceId} updated:`, { ...raceUpdate, date: raceDate })
    }

    // Manual corrections to bib / time / pace. These live on RunnerResearch,
    // not the Order, so they get written through to the latest research row.
    // A hand-entered value is authoritative: we mark it found and record the
    // source as manual_entry so the provenance stays honest.
    const legs = { swimTime, swimDistance, bikeTime, bikeDistance, runTime, runDistance }
    const legEdited = Object.values(legs).some(v => v !== undefined)
    if (bibNumber !== undefined || officialTime !== undefined || officialPace !== undefined || legEdited) {
      const researchData = {}
      for (const [k, v] of Object.entries(legs)) if (v !== undefined) researchData[k] = v ? String(v).trim().slice(0, 20) : null
      if (bibNumber !== undefined) researchData.bibNumber = bibNumber || null
      if (officialTime !== undefined) researchData.officialTime = officialTime || null
      if (officialPace !== undefined) researchData.officialPace = officialPace || null

      const latest = await prisma.runnerResearch.findFirst({
        where: { orderId: existingOrder.id },
        orderBy: { id: 'desc' }
      })

      if (latest) {
        await prisma.runnerResearch.update({
          where: { id: latest.id },
          data: {
            ...researchData,
            researchStatus: 'found',
            source: 'manual_entry',
            researchNotes: 'Manually entered in the dashboard.',
            possibleMatches: null,
          }
        })
      } else {
        // No research row yet (never researched, or no scraper). Create one so
        // the hand-entered values have somewhere to live. The panel has no
        // raceId to send in that case, so find the order's race (the same
        // way research does) instead of dropping the edit.
        let rid = raceId
        if (!rid) {
          const name = existingOrder.raceNameOverride ?? existingOrder.raceName
          const year = existingOrder.yearOverride ?? existingOrder.raceYear
          const canonical = getCanonicalRaceName(name) || name
          const race = await prisma.race.findUnique({ where: { raceName_year: { raceName: name, year } } })
            || (canonical !== name && await prisma.race.findUnique({ where: { raceName_year: { raceName: canonical, year } } }))
            || await prisma.race.create({ data: { raceName: canonical, year, raceDate: null, eventTypes: ['Marathon'] } })
          rid = race.id
        }
        await prisma.runnerResearch.create({
          data: {
            orderId: existingOrder.id,
            raceId: rid,
            runnerName: updateData.runnerNameOverride || existingOrder.runnerNameOverride || existingOrder.runnerName,
            ...researchData,
            researchStatus: 'found',
            source: 'manual_entry',
            researchNotes: 'Manually entered in the dashboard.',
          }
        })
      }

      // A hand-entered result makes the order fulfillable.
      updateData.status = 'ready'
      updateData.researchedAt = new Date()
    }

    // Update the order
    if (existingOrder.trackstarOrderType === 'custom') {
      const LABEL = { runnerNameOverride: 'runner', raceNameOverride: 'race', yearOverride: 'year', bibNumberCustomer: 'bib', timeCustomer: 'time', creativeDirection: 'creative direction' }
      const changed = Object.keys(LABEL).filter(k => k in updateData && updateData[k] !== existingOrder[k])
      if (changed.length) await recordAudit({ action: 'order.custom-details', summary: `Order ${existingOrder.orderNumber}: ${changed.map(k => LABEL[k]).join(', ')} edited by hand`, detail: { orderNumber: existingOrder.orderNumber, before: Object.fromEntries(changed.map(k => [k, existingOrder[k]])), after: Object.fromEntries(changed.map(k => [k, updateData[k]])) }, actor })
    }

    const order = await prisma.order.update({
      where: { id: existingOrder.id },
      data: updateData
    })

    console.log(`[API /orders/update] Order ${orderNumber} updated with overrides:`, updateData)

    return res.status(200).json({
      success: true,
      order: withoutRawOrderData(order)
    })

  } catch (error) {
    console.error('[API /orders/update] Error:', error)

    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Order not found' })
    }

    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'A race with this name and year already exists' })
    }

    return res.status(500).json({
      error: 'Something went wrong. Try again, and tell Matt if it keeps happening.'
    })
  }
}
