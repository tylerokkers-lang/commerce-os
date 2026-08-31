import { describe, expect, it } from 'vitest'
import { assessShippingSuitability, SHIPPING_QUOTE_MAX_AGE_DAYS } from '@/lib/suppliers/shippingPolicy'
import { money } from '@/lib/core/money'
import type { SupplierShippingQuote } from '@/lib/suppliers/connectors/types'

const NOW = new Date('2026-08-31T12:00:00.000Z')
const FRESH_QUOTE_AT = new Date(NOW.getTime() - 1000 * 60 * 60).toISOString() // 1 hour ago

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

describe('Deterministic shipping suitability (Phase 8/9)', () => {
  it('no quote at all is review_required — never a guessed rejection', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [], maxDeliveryDays: 7, quotedAt: null, now: NOW })
    expect(result.status).toBe('review_required')
    expect(result.bestQuote).toBeNull()
  })

  it('a quote within the configured limit is approved', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 10 })], maxDeliveryDays: 14, quotedAt: FRESH_QUOTE_AT, now: NOW })
    expect(result.status).toBe('approved')
    expect(result.bestQuote?.totalDeliveryDaysMax).toBe(10)
  })

  it('a quote exceeding the configured limit is rejected', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 20 })], maxDeliveryDays: 7, quotedAt: FRESH_QUOTE_AT, now: NOW })
    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('exceeds')
  })

  it('exactly meeting the limit is approved, not rejected', () => {
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 7 })], maxDeliveryDays: 7, quotedAt: FRESH_QUOTE_AT, now: NOW })
    expect(result.status).toBe('approved')
  })

  it('picks the fastest of several quotes to judge suitability', () => {
    const result = assessShippingSuitability({
      destinationCountry: 'GB',
      maxDeliveryDays: 7,
      quotedAt: FRESH_QUOTE_AT,
      now: NOW,
      quotes: [quote({ method: 'Slow Boat', totalDeliveryDaysMax: 20 }), quote({ method: 'DHL Express', totalDeliveryDaysMax: 5 })],
    })
    expect(result.status).toBe('approved')
    expect(result.bestQuote?.method).toBe('DHL Express')
  })

  it('quotes with no known delivery estimate are review_required, never assumed fast enough', () => {
    const result = assessShippingSuitability({
      destinationCountry: 'GB',
      maxDeliveryDays: 7,
      quotedAt: FRESH_QUOTE_AT,
      now: NOW,
      quotes: [quote({ totalDeliveryDaysMax: null, totalDeliveryDaysMin: null })],
    })
    expect(result.status).toBe('review_required')
  })

  it('a mix of known and unknown estimates judges suitability from the known ones only', () => {
    const result = assessShippingSuitability({
      destinationCountry: 'GB',
      maxDeliveryDays: 7,
      quotedAt: FRESH_QUOTE_AT,
      now: NOW,
      quotes: [quote({ method: 'Unknown ETA', totalDeliveryDaysMax: null, totalDeliveryDaysMin: null }), quote({ method: 'DHL Express', totalDeliveryDaysMax: 5 })],
    })
    expect(result.status).toBe('approved')
    expect(result.bestQuote?.method).toBe('DHL Express')
  })

  it('an unsupported destination (no quotes returned) is review_required, never guessed rejected', () => {
    const result = assessShippingSuitability({ destinationCountry: 'FR', quotes: [], maxDeliveryDays: 7, quotedAt: null, now: NOW })
    expect(result.status).toBe('review_required')
    expect(result.reason).toContain('FR')
  })
})

describe('Shipping quote freshness (Phase 9)', () => {
  it('a quote fetched within the freshness window is judged normally', () => {
    const quotedAt = new Date(NOW.getTime() - (SHIPPING_QUOTE_MAX_AGE_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString()
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 5 })], maxDeliveryDays: 7, quotedAt, now: NOW })
    expect(result.status).toBe('approved')
  })

  it('a quote older than the freshness window is review_required, even though it would otherwise approve', () => {
    const staleAt = new Date(NOW.getTime() - (SHIPPING_QUOTE_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString()
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 5 })], maxDeliveryDays: 7, quotedAt: staleAt, now: NOW })
    expect(result.status).toBe('review_required')
    expect(result.reason).toContain('freshness')
  })

  it('a stale quote that would otherwise be rejected is still review_required, not silently kept as rejected', () => {
    const staleAt = new Date(NOW.getTime() - (SHIPPING_QUOTE_MAX_AGE_DAYS + 5) * 24 * 60 * 60 * 1000).toISOString()
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 30 })], maxDeliveryDays: 7, quotedAt: staleAt, now: NOW })
    expect(result.status).toBe('review_required')
  })

  it('exactly at the freshness boundary is still trusted (only strictly older is stale)', () => {
    const boundaryAt = new Date(NOW.getTime() - SHIPPING_QUOTE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const result = assessShippingSuitability({ destinationCountry: 'GB', quotes: [quote({ totalDeliveryDaysMax: 5 })], maxDeliveryDays: 7, quotedAt: boundaryAt, now: NOW })
    expect(result.status).toBe('approved')
  })
})
