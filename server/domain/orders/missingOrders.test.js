import '../../services/mcp/testOffline.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expectedInTool } from './missingOrders.js'

const order = extra => ({ source_name: 'web', financial_status: 'paid', cancelled_at: null, line_items: [{ title: 'Chicago Marathon Print', requires_shipping: true, gift_card: false }], ...extra })

test('a paid online-store order with a print to ship is expected here', () => {
  assert.equal(expectedInTool(order()), true)
  assert.equal(expectedInTool(order({ financial_status: 'partially_refunded' })), true)
})

test('cancelled, unpaid, draft (bulk) and gift-card-only orders are not', () => {
  assert.equal(expectedInTool(order({ cancelled_at: '2026-11-09T10:00:00Z' })), false)
  assert.equal(expectedInTool(order({ financial_status: 'pending' })), false)
  assert.equal(expectedInTool(order({ source_name: 'shopify_draft_order' })), false)
  assert.equal(expectedInTool(order({ line_items: [{ title: 'Gift card', requires_shipping: false, gift_card: true }] })), false)
})
