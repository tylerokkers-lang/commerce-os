import { describe, expect, it } from 'vitest'
import { shopifyConnector } from '@/lib/marketplaces/connectors/shopify'
import { amazonConnector } from '@/lib/marketplaces/connectors/amazon'
import { shopifyDemoConnector } from '@/lib/marketplaces/connectors/shopifyDemo'
import { amazonDemoConnector } from '@/lib/marketplaces/connectors/amazonDemo'
import type { FulfilmentUpdateInput } from '@/lib/marketplaces/connectors/types'

function update(over: Partial<FulfilmentUpdateInput> = {}): FulfilmentUpdateInput {
  return { externalOrderId: 'ord-1', carrier: 'Royal Mail', trackingNumber: 'TRACK123', idempotencyKey: 'idem-1', ...over }
}

describe('marketplace update: fulfilment/tracking push-back', () => {
  it('the real Shopify connector refuses an update unconditionally this phase (Milestone Shopify-Read-Only) — never merely because it is unconfigured', async () => {
    const result = await shopifyConnector.submitFulfilmentUpdate(update())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('disabled')
  })

  it('the real Amazon connector refuses an update when not configured', async () => {
    const result = await amazonConnector.submitFulfilmentUpdate(update())
    expect(result.ok).toBe(false)
  })

  it('the demo Shopify connector genuinely accepts a well-formed update', async () => {
    const result = await shopifyDemoConnector.submitFulfilmentUpdate(update())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.accepted).toBe(true)
      expect(result.value.marketplaceReference).toContain('idem-1')
    }
  })

  it('the demo Amazon connector genuinely accepts a well-formed update', async () => {
    const result = await amazonDemoConnector.submitFulfilmentUpdate(update())
    expect(result.ok).toBe(true)
  })

  it('marketplace update failure: the demo connector genuinely rejects an incomplete update, not a hardcoded success', async () => {
    const shopifyResult = await shopifyDemoConnector.submitFulfilmentUpdate(update({ trackingNumber: '' }))
    expect(shopifyResult.ok).toBe(false)

    const amazonResult = await amazonDemoConnector.submitFulfilmentUpdate(update({ carrier: '' }))
    expect(amazonResult.ok).toBe(false)
  })

  it('both channels declare the capability honestly', () => {
    // Milestone Shopify-Read-Only: the real Shopify connector's write-side
    // fulfilment (tracking push) is deliberately disabled this phase —
    // genuinely distinct from Amazon's and both demo connectors', which
    // still declare it (unchanged by this milestone).
    expect(shopifyConnector.descriptor.capabilities.updateFulfilment).toBe(false)
    expect(amazonConnector.descriptor.capabilities.updateFulfilment).toBe(true)
    expect(shopifyDemoConnector.descriptor.capabilities.updateFulfilment).toBe(true)
    expect(amazonDemoConnector.descriptor.capabilities.updateFulfilment).toBe(true)
  })

  it('the same idempotency key produces the same accepted outcome on repeated calls (idempotent)', async () => {
    const first = await shopifyDemoConnector.submitFulfilmentUpdate(update({ idempotencyKey: 'idem-repeat' }))
    const second = await shopifyDemoConnector.submitFulfilmentUpdate(update({ idempotencyKey: 'idem-repeat' }))
    expect(first).toEqual(second)
  })
})
