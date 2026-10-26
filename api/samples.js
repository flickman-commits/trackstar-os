/**
 * /api/samples - Tools > Samples (admins, and roles given Samples).
 *   GET                               the store's race prints with sizes and frames
 *   GET ?view=spend                   sample spend by month
 *   POST { action: 'quote', items }   at-cost prices from Artelo
 *   POST { action: 'cost', items }    what the prints cost us
 *   POST { action: 'send', ... }      create the sample order in Shopify
 *   POST { action: 'gelato-upload', fileName }        a signed upload for the PDF (overseas, Gelato)
 *   POST { action: 'gelato-quote', ... }              Gelato's print price and shipping options
 *   POST { action: 'gelato-send', ... }               create the order in Gelato
 *   GET ?view=design-races                            races the tool can design a sample print for
 *   POST { action: 'design-find', raceName, year, runnerName, orderNumber? }   look up the result (server/domain/samples/sampleDesign.js)
 *   POST { action: 'design-state' | 'design-render' | 'design-use', orderNumber }
 *   POST { action: 'design-accept', orderNumber, match }                      take a near match as the result
 */
import { setCors } from './_lib/auth.js'
import { requireCapability, recordAudit } from './_lib/users.js'
import { sampleCatalog, quoteAtCost, sendSample } from '../server/domain/samples/samples.js'
import { estimateSampleCost, sampleSpend } from '../server/domain/samples/costs.js'
import { GELATO_PRODUCTS, gelatoUploadUrl, quoteGelatoSample, sendGelatoSample } from '../server/domain/samples/gelato.js'
import { designRaces, findSampleResult, acceptSampleMatch, renderSample, sampleDesignState, useSampleDesign } from '../server/domain/samples/sampleDesign.js'

export default async function handler(req, res) {
  if (setCors(req, res, { methods: 'GET, POST, OPTIONS' })) return
  // Samples send real orders and spend money: a capability an admin grants in Settings > Admin > Roles.
  const user = await requireCapability(req, res, 'tools.samples')
  if (!user) return
  try {
    if (req.method === 'GET') {
      if (req.query?.view === 'spend') return res.status(200).json(await sampleSpend())
      if (req.query?.view === 'design-races') return res.status(200).json(await designRaces())
      return res.status(200).json({ products: await sampleCatalog(), gelatoProducts: GELATO_PRODUCTS.map(({ uid, label, size, frame }) => ({ uid, label, size, frame })) })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    if (b.action === 'quote') return res.status(200).json(await quoteAtCost(b.items || [], b.address || null))
    // What these prints cost us (production, shipping, branding), free or not.
    if (b.action === 'cost') return res.status(200).json(await estimateSampleCost(b.items || [], b.address || null))
    if (b.action === 'send') {
      const out = await sendSample(b, user)
      await recordAudit({ action: 'samples.send', summary: `Sent sample ${out.name} to ${b.email} (${b.mode === 'cost' ? `at cost, $${out.total.toFixed(2)}` : 'free'})`, detail: { order: out.name, items: (b.items || []).length }, actor: user })
      return res.status(200).json(out)
    }
    // Overseas: straight to Gelato with a finished PDF (server/domain/samples/gelato.js).
    if (b.action === 'gelato-upload') return res.status(200).json(await gelatoUploadUrl(b.fileName))
    if (b.action === 'gelato-quote') return res.status(200).json(await quoteGelatoSample(b))
    if (b.action === 'gelato-send') {
      const out = await sendGelatoSample(b, user)
      await recordAudit({ action: 'samples.send_gelato', summary: `Sent Gelato sample ${out.reference} to ${b.email} (${out.country}, $${(out.costCents / 100).toFixed(2)})`, detail: { gelatoOrderId: out.id, reference: out.reference }, actor: user })
      return res.status(200).json(out)
    }
    // Overseas, designed by the tool: research and render on a hidden sample order.
    if (b.action === 'design-find') return res.status(200).json(await findSampleResult(b))
    if (b.action === 'design-accept') return res.status(200).json(await acceptSampleMatch(b))
    if (b.action === 'design-state') return res.status(200).json(await sampleDesignState(b.orderNumber))
    if (b.action === 'design-render') return res.status(200).json(await renderSample(b, user))
    if (b.action === 'design-use') return res.status(200).json(await useSampleDesign(b))
    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    if (error.status === 400 || error.status === 409 || error.expose) return res.status(error.status || 400).json({ error: error.message })
    console.error('[API /samples]', error)
    return res.status(500).json({ error: `Could not send the sample: ${String(error.message || error).slice(0, 300)}` })
  }
}
