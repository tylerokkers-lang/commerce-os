import { describe, expect, it } from 'vitest'
import { validateOrder } from '@/lib/orders/validation'
import { planOrderIngestion } from '@/lib/orders/ingestion'
import type { MarketplaceOrderSnapshot } from '@/lib/marketplaces/connectors/types'

function validInput(over: Partial<Parameters<typeof validateOrder>[0]> = {}) {
  return {
    externalId: 'ext-1',
    totalMinor: 3000,
    currency: 'GBP',
    lineItemCount: 1,
    allLineItemsResolved: true,
    lineItemsTotalMinor: 3000,
    ...over,
  }
}

describe('order validation', () => {
  it('passes a well-formed order', () => {
    expect(validateOrder(validInput()).valid).toBe(true)
  })

  it('rejects a missing external id', () => {
    expect(validateOrder(validInput({ externalId: '' })).valid).toBe(false)
  })

  it('rejects a negative total', () => {
    expect(validateOrder(validInput({ totalMinor: -100 })).valid).toBe(false)
  })

  it('rejects an unrecognisable currency code', () => {
    expect(validateOrder(validInput({ currency: 'gbp' })).valid).toBe(false)
    expect(validateOrder(validInput({ currency: 'GB' })).valid).toBe(false)
  })

  it('rejects an order with no line items', () => {
    expect(validateOrder(validInput({ lineItemCount: 0 })).valid).toBe(false)
  })

  it('rejects when a line item could not be matched to our catalogue', () => {
    const result = validateOrder(validInput({ allLineItemsResolved: false }))
    expect(result.valid).toBe(false)
    expect(result.issues.some((i) => i.field === 'lineItems' && i.severity === 'fatal')).toBe(true)
  })

  it('warns, but does not fail, on a small total mismatch within tolerance', () => {
    const result = validateOrder(validInput({ totalMinor: 3002, lineItemsTotalMinor: 3000 }))
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  it('warns on a total mismatch beyond tolerance without making it fatal', () => {
    const result = validateOrder(validInput({ totalMinor: 3500, lineItemsTotalMinor: 3000 }))
    expect(result.valid).toBe(true) // still valid: this is a warning, not fatal
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true)
  })

  it('reports every fatal issue at once, not just the first', () => {
    const result = validateOrder(validInput({ externalId: '', totalMinor: -1, lineItemCount: 0 }))
    expect(result.issues.filter((i) => i.severity === 'fatal').length).toBeGreaterThanOrEqual(3)
  })
})

function snapshot(over: Partial<MarketplaceOrderSnapshot> = {}): MarketplaceOrderSnapshot {
  return {
    externalId: 'ext-1',
    placedAt: '2026-08-23T09:00:00Z',
    status: 'paid',
    totalMinor: 3000,
    currency: 'GBP',
    lineItems: [{ externalId: 'li-1', sku: 'SKU-A', quantity: 1, unitPriceMinor: 3000 }],
    raw: {},
    ...over,
  }
}

describe('order ingestion', () => {
  it('creates a new order that has never been seen', () => {
    const decision = planOrderIngestion({
      channel: 'shopify', snapshot: snapshot(), existing: null,
      allLineItemsResolved: true, lineItemsTotalMinor: 3000,
    })
    expect(decision.outcome).toBe('create')
  })

  it('rejects an order that fails validation before ever considering duplication', () => {
    const decision = planOrderIngestion({
      channel: 'shopify', snapshot: snapshot({ lineItems: [] }), existing: null,
      allLineItemsResolved: true, lineItemsTotalMinor: 0,
    })
    expect(decision.outcome).toBe('rejected')
  })

  it('the exact duplicate webhook / re-sync shape: re-ingesting an unchanged order is a no-op', () => {
    const decision = planOrderIngestion({
      channel: 'shopify', snapshot: snapshot({ status: 'paid' }),
      existing: { id: 'internal-1', status: 'paid' },
      allLineItemsResolved: true, lineItemsTotalMinor: 3000,
    })
    expect(decision.outcome).toBe('already_ingested')
  })

  it('detects a status change the marketplace made since our last sync', () => {
    const decision = planOrderIngestion({
      channel: 'shopify', snapshot: snapshot({ status: 'cancelled' }),
      existing: { id: 'internal-1', status: 'paid' },
      allLineItemsResolved: true, lineItemsTotalMinor: 3000,
    })
    expect(decision.outcome).toBe('status_changed')
    expect(decision.suggestedStatusChange).toEqual({ from: 'paid', to: 'cancelled' })
  })

  it('repeated ingestion of the exact same snapshot always produces the same decision (idempotent)', () => {
    const existing = { id: 'internal-1', status: 'paid' as const }
    const first = planOrderIngestion({
      channel: 'shopify', snapshot: snapshot(), existing, allLineItemsResolved: true, lineItemsTotalMinor: 3000,
    })
    const second = planOrderIngestion({
      channel: 'shopify', snapshot: snapshot(), existing, allLineItemsResolved: true, lineItemsTotalMinor: 3000,
    })
    expect(first.outcome).toBe(second.outcome)
    expect(first.outcome).toBe('already_ingested')
  })
})
