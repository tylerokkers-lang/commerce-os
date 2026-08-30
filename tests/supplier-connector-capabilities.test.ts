import { describe, expect, it } from 'vitest'
import { listConnectors } from '@/lib/suppliers/connectors/registry'

describe('Supplier connector capabilities (Phase 5)', () => {
  it('every connector, including every planned one, declares placeOrders and cancelOrders as false — no connector may spend money automatically', () => {
    const connectors = listConnectors()
    expect(connectors.length).toBeGreaterThan(0)
    for (const connector of connectors) {
      expect(connector.descriptor.capabilities.placeOrders).toBe(false)
      expect(connector.descriptor.capabilities.cancelOrders).toBe(false)
    }
  })

  it('the manual connector honestly declares discoverProducts, since a person really can capture a candidate by hand at any time', () => {
    const manual = listConnectors().find((c) => c.descriptor.key === 'manual')
    expect(manual?.descriptor.capabilities.discoverProducts).toBe(true)
  })

  it('the bespoke direct-supplier-API connector declares discoverProducts as false — genuinely unknown until a specific integration is written', () => {
    const direct = listConnectors().find((c) => c.descriptor.key === 'direct_api')
    expect(direct?.descriptor.capabilities.discoverProducts).toBe(false)
  })

  it('every connector except the real CJdropshipping one declares readProductMedia as false — no other connector, including a human pasting a URL, is a connector-discovered media source (Phase 7)', () => {
    const connectors = listConnectors()
    for (const connector of connectors) {
      if (connector.descriptor.key === 'cjdropshipping') continue
      expect(connector.descriptor.capabilities.readProductMedia).toBe(false)
    }
  })

  it('the real CJdropshipping connector genuinely declares readProductMedia (Phase 8) — its documented product-query response bundles image URLs', () => {
    const cj = listConnectors().find((c) => c.descriptor.key === 'cjdropshipping')
    expect(cj?.descriptor.capabilities.readProductMedia).toBe(true)
  })

  it('every connector, including the real CJdropshipping one, declares readOrders as false — no connector may place an order, so none has one of its own to read back (Phase 8)', () => {
    for (const connector of listConnectors()) {
      expect(connector.descriptor.capabilities.readOrders).toBe(false)
    }
  })
})
