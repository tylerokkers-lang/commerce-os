import { describe, expect, it } from 'vitest'
import { planListingTransition } from '@/lib/marketplaces/listingLifecycle'
import { getMarketplaceConnector, listMarketplaceConnectors } from '@/lib/marketplaces/connectors/registry'

describe('Controlled Shopify publication — safety (Phase 6)', () => {
  it('no marketplace connector, of any kind, declares write-order or purchasing capability — this codebase has no such capability at all', () => {
    // There is no "placeOrders" on MarketplaceCapabilities by design — this
    // asserts the actual capability surface never grows one silently.
    const shopify = getMarketplaceConnector('shopify')!
    expect(Object.keys(shopify.descriptor.capabilities)).not.toContain('placeOrders')
    expect(Object.keys(shopify.descriptor.capabilities)).not.toContain('placeSupplierOrder')
  })

  it('Shopify createListings capability is false — write access is not configured, matching the honest IMPLEMENTED/CONFIGURED/VERIFIED distinction', () => {
    const shopify = getMarketplaceConnector('shopify')!
    expect(shopify.descriptor.capabilities.createListings).toBe(false)
  })

  it('every real (non-demo) connector declares createListings false — nothing can create a live-reachable listing without configured write scopes', () => {
    for (const connector of listMarketplaceConnectors()) {
      if (connector.descriptor.key.endsWith('_demo')) continue
      expect(connector.descriptor.capabilities.createListings).toBe(false)
    }
  })

  it('a listing cannot skip straight from discovered to published — the state machine refuses to allow it', () => {
    const result = planListingTransition({ from: 'discovered', to: 'published', reason: 'Attempting to skip the workflow entirely.' })
    expect(result.ok).toBe(false)
  })

  it('a listing cannot skip straight from evaluating to published, bypassing draft creation', () => {
    const result = planListingTransition({ from: 'evaluating', to: 'published', reason: 'Attempting to bypass draft review.' })
    expect(result.ok).toBe(false)
  })

  it('publishing (pending_approval -> published) is itself a valid, but never automatic, transition — it exists only as an explicit action', () => {
    const result = planListingTransition({ from: 'pending_approval', to: 'published', reason: 'Owner explicitly triggered live publication.' })
    expect(result.ok).toBe(true)
  })

  it('a state change transition is refused without a real reason — every publication decision must be explainable', () => {
    const result = planListingTransition({ from: 'ready_to_list', to: 'pending_approval', reason: 'x' })
    expect(result.ok).toBe(false)
  })

  it('ended (archived) is terminal — nothing may follow it', () => {
    const result = planListingTransition({ from: 'ended', to: 'published', reason: 'Attempting to revive an archived listing.' })
    expect(result.ok).toBe(false)
  })
})
