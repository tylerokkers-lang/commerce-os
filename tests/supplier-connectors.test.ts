import { describe, expect, it } from 'vitest'
import { manualSupplierConnector } from '@/lib/suppliers/connectors/manual'
import {
  canConnectorRunNow,
  deriveConnectorStatus,
  getConnector,
  listConnectors,
} from '@/lib/suppliers/connectors/registry'
import { detectPriceChange, detectPriceChanges } from '@/lib/suppliers/connectors/priceChanges'
import type { SupplierProductStatus } from '@/lib/suppliers/connectors/types'
import { fromMajor } from '@/lib/core/money'

const CLOCK = new Date('2026-08-23T09:00:00Z')

describe('manual supplier connector', () => {
  it('is always configured, because it needs no credentials', () => {
    expect(manualSupplierConnector.isConfigured()).toBe(true)
    expect(manualSupplierConnector.descriptor.requiredCredentials).toHaveLength(0)
  })

  it('is declared as a manual source, never anything stronger', () => {
    expect(manualSupplierConnector.descriptor.sourceType).toBe('manual')
  })

  it('makes no network requests', async () => {
    const result = await manualSupplierConnector.fetchStatus({ limit: 50 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.requestsMade).toBe(0)
  })

  it('reports real computed statuses, not placeholders', async () => {
    const result = await manualSupplierConnector.fetchStatus({ limit: 50 })
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.statuses.length).toBeGreaterThan(0)
    for (const status of result.value.statuses) {
      expect(status.unitCost.minor).toBeGreaterThan(0)
      expect(status.stockCheckedAt).toBeTruthy()
    }
  })

  it('honours the requested limit', async () => {
    const result = await manualSupplierConnector.fetchStatus({ limit: 1 })
    if (!result.ok) throw new Error('expected ok')
    expect(result.value.statuses).toHaveLength(1)
  })

  it('skips known refs', async () => {
    const first = await manualSupplierConnector.fetchStatus({ limit: 50 })
    if (!first.ok) throw new Error('expected ok')
    const known = new Set(first.value.statuses.map((s) => `${s.supplierRef}:${s.productRef}`))
    const second = await manualSupplierConnector.fetchStatus({ limit: 50, knownRefs: known })
    if (!second.ok) throw new Error('expected ok')
    expect(second.value.statuses).toHaveLength(0)
  })

  it('flags the one seeded price change and nothing else', async () => {
    const result = await manualSupplierConnector.fetchStatus({ limit: 50 })
    if (!result.ok) throw new Error('expected ok')
    const changed = result.value.statuses.filter((s) => s.priceChangedSincePrevious)
    expect(changed).toHaveLength(1)
    expect(changed[0].supplierRef).toBe('sup-2')
  })
})

describe('connector registry', () => {
  it('registers the manual connector and every planned category', () => {
    const keys = listConnectors().map((c) => c.descriptor.key)
    expect(keys).toContain('manual')
    expect(keys).toContain('dsers_compatible')
    expect(keys).toContain('syncee_type')
    expect(keys).toContain('eprolo_type')
    expect(keys).toContain('cj_type')
    expect(keys).toContain('autods_type')
    expect(keys).toContain('direct_api')
    expect(keys).toContain('csv_feed')
  })

  it('reports every planned connector as not configured even in principle', () => {
    for (const key of ['dsers_compatible', 'syncee_type', 'eprolo_type', 'cj_type', 'autods_type']) {
      const connector = getConnector(key)!
      expect(connector.isConfigured()).toBe(false)
    }
  })

  it('refuses to fetch from an unavailable connector', async () => {
    const connector = getConnector('dsers_compatible')!
    const result = await connector.fetchStatus({ limit: 10 })
    expect(result.ok).toBe(false)
  })

  it('never reports a connector as ready without its credentials', () => {
    for (const connector of listConnectors()) {
      if (connector.descriptor.key === 'manual') continue
      const health = deriveConnectorStatus(
        connector,
        { isEnabled: true, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 },
        CLOCK,
      )
      expect(health).toBe('not_configured')
    }
  })

  it('derives status from observed state, not an asserted flag', () => {
    const manual = getConnector('manual')!
    expect(deriveConnectorStatus(manual, { isEnabled: false, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 }, CLOCK)).toBe('disabled')
    expect(deriveConnectorStatus(manual, { isEnabled: true, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 }, CLOCK)).toBe('ready')
    expect(deriveConnectorStatus(manual, { isEnabled: true, lastSuccessAt: CLOCK.toISOString(), lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 }, CLOCK)).toBe('healthy')
    expect(deriveConnectorStatus(manual, { isEnabled: true, lastSuccessAt: CLOCK.toISOString(), lastFailureAt: CLOCK.toISOString(), lastError: 'x', nextAllowedAt: null, consecutiveFailures: 3 }, CLOCK)).toBe('failing')
  })

  it('refuses a disabled connector even if it is configured', () => {
    const manual = getConnector('manual')!
    const result = canConnectorRunNow(manual, { isEnabled: false, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: null, consecutiveFailures: 0 }, CLOCK)
    expect(result.ok).toBe(false)
  })

  it('refuses to run before a declared rate limit window has passed', () => {
    const connector = getConnector('syncee_type')!
    const future = new Date(CLOCK.getTime() + 600_000).toISOString()
    const result = canConnectorRunNow(connector, { isEnabled: true, lastSuccessAt: null, lastFailureAt: null, lastError: null, nextAllowedAt: future, consecutiveFailures: 0 }, CLOCK)
    expect(result.ok).toBe(false)
  })

  it('declares usage terms for every connector, even unavailable ones', () => {
    for (const connector of listConnectors()) {
      expect(connector.descriptor.usagePolicy.permittedUseNote.length).toBeGreaterThan(10)
    }
  })

  it('names every planned connector after its category, not an official product, using -compatible/-type suffixes', () => {
    for (const key of ['dsers_compatible', 'syncee_type', 'eprolo_type', 'cj_type', 'autods_type']) {
      const label = getConnector(key)!.descriptor.label
      expect(label).toMatch(/-compatible|-type/)
    }
  })
})

function status(over: Partial<SupplierProductStatus> = {}): SupplierProductStatus {
  return {
    supplierRef: 'sup-x',
    productRef: 'prod-x',
    unitCost: fromMajor(10),
    shippingCost: fromMajor(2),
    priceChangedSincePrevious: false,
    inStock: true,
    stockCheckedAt: CLOCK.toISOString(),
    documentationOnFile: [],
    raw: {},
    ...over,
  }
}

describe('price change detection', () => {
  it('returns null when there is no previous cost to compare against', () => {
    expect(detectPriceChange(status())).toBeNull()
  })

  it('returns null when the flag says nothing changed even if costs differ', () => {
    // Guards against a stale previousUnitCost being misread as a live change.
    expect(
      detectPriceChange(status({ previousUnitCost: fromMajor(8), priceChangedSincePrevious: false })),
    ).toBeNull()
  })

  it('computes a signed percentage for an increase', () => {
    const event = detectPriceChange(
      status({ unitCost: fromMajor(11), previousUnitCost: fromMajor(10), priceChangedSincePrevious: true }),
      3,
      CLOCK,
    )
    expect(event).not.toBeNull()
    expect(event!.direction).toBe('increase')
    expect(event!.changePct).toBe(10)
    expect(event!.significant).toBe(true)
  })

  it('computes a signed percentage for a decrease', () => {
    const event = detectPriceChange(
      status({ unitCost: fromMajor(9), previousUnitCost: fromMajor(10), priceChangedSincePrevious: true }),
      3,
      CLOCK,
    )
    expect(event!.direction).toBe('decrease')
    expect(event!.changePct).toBe(-10)
  })

  it('treats a small movement as not significant', () => {
    const event = detectPriceChange(
      status({ unitCost: fromMajor(10.1), previousUnitCost: fromMajor(10), priceChangedSincePrevious: true }),
      3,
      CLOCK,
    )
    expect(event!.significant).toBe(false)
  })

  it('respects a configurable significance threshold', () => {
    const event = detectPriceChange(
      status({ unitCost: fromMajor(10.5), previousUnitCost: fromMajor(10), priceChangedSincePrevious: true }),
      10,
      CLOCK,
    )
    expect(event!.significant).toBe(false)
  })

  it('extracts every change from a batch, skipping the unchanged', () => {
    const events = detectPriceChanges(
      [
        status({ unitCost: fromMajor(11), previousUnitCost: fromMajor(10), priceChangedSincePrevious: true }),
        status({ productRef: 'prod-y' }),
      ],
      3,
      CLOCK,
    )
    expect(events).toHaveLength(1)
  })

  it('stamps a detection time', () => {
    const event = detectPriceChange(
      status({ unitCost: fromMajor(11), previousUnitCost: fromMajor(10), priceChangedSincePrevious: true }),
      3,
      CLOCK,
    )
    expect(event!.detectedAt).toBe(CLOCK.toISOString())
  })
})
