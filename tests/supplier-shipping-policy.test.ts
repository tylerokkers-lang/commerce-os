import { describe, expect, it } from 'vitest'
import { assessShippingSuitability } from '@/lib/suppliers/shippingPolicy'
import { money } from '@/lib/core/money'
import type { SupplierShippingQuote } from '@/lib/suppliers/connectors/types'

function quote(over: Partial<SupplierShippingQuote> = {}): SupplierShippingQuote {
  return {
    destinationCountry: 'GB',
    method: 'Standard',
    carrierName: 'Standard',
    shippingCost: money(450, 'USD'),
    processingDaysMin: null,
    processingDaysMax: null,
    transitDaysMin: 7,
    transitDaysMax: 10,
    totalDeliveryDaysMin: 7,
    totalDeliveryDaysMax: 10,
    providesTracking: true,
    ...over,
  }
}

describe('Deterministic shipping suitability (Phase 8)', () => {
  it('no quote at all is review_required — never a guessed rejection', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [], maxDeliveryDays: 7 })
    expect(result.status).toBe('review_required')
    expect(result.bestQuote).toBeNull()
  })

  it('a quote within the configured limit is approved', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 10 })], maxDeliveryDays: 14 })
    expect(result.status).toBe('approved')
    expect(result.bestQuote?.totalDeliveryDaysMax).toBe(10)
  })

  it('a quote exceeding the configured limit is rejected', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 20 })], maxDeliveryDays: 7 })
    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('exceeds')
  })

  it('exactly meeting the limit is approved, not rejected', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 7 })], maxDeliveryDays: 7 })
    expect(result.status).toBe('approved')
  })

  it('picks the fastest of several quotes to judge suitability', () => {
    const result = assessShippingSuitability({
      destinationCountry: 'GB',
      maxDeliveryDays: 7,
      quotes: [quote({ method: 'Slow Boat', totalDeliveryDaysMax: 20 }), quote({ method: 'DHL Express', totalDeliveryDaysMax: 5 })],
    })
    expect(result.status).toBe('approved')
    expect(result.bestQuote?.method).toBe('DHL Express')
  })

  it('quotes with no known delivery estimate are review_required, never assumed fast enough', () => {
    const result = assessShippingSuitability({
      destinationCountry: 'GB',
      maxDeliveryDays: 7,
      quotes: [quote({ totalDeliveryDaysMax: null, totalDeliveryDaysMin: null })],
    })
    expect(result.status).toBe('review_required')
  })

  it('a mix of known and unknown estimates judges suitability from the known ones only', () => {
    const result = assessShippingSuitability({
      destinationCountry: 'GB',
      maxDeliveryDays: 7,
      quotes: [quote({ method: 'Unknown ETA', totalDeliveryDaysMax: null, totalDeliveryDaysMin: null }), quote({ method: 'DHL Express', totalDeliveryDaysMax: 5 })],
    })
    expect(result.status).toBe('approved')
    expect(result.bestQuote?.method).toBe('DHL Express')
  })
})
