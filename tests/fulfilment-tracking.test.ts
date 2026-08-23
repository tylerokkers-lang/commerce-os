import { describe, expect, it } from 'vitest'
import { assessDeliveryHealth, isHealthy, type ShipmentRecord } from '@/lib/fulfilment/tracking'

const NOW = new Date('2026-08-23T09:00:00Z')

function shipment(over: Partial<ShipmentRecord> = {}): ShipmentRecord {
  return { shippedAt: null, deliveredAt: null, trackingNumber: null, promisedBy: null, lastStatusAt: null, ...over }
}

describe('delivery monitoring', () => {
  it('a delivered shipment has no outstanding issues, whatever else is missing', () => {
    expect(assessDeliveryHealth(shipment({ deliveredAt: '2026-08-20T00:00:00Z' }), NOW)).toHaveLength(0)
  })

  it('flags missing tracking: shipped but no tracking number', () => {
    const issues = assessDeliveryHealth(shipment({ shippedAt: '2026-08-22T00:00:00Z' }), NOW)
    expect(issues.some((i) => i.key === 'missing_tracking')).toBe(true)
  })

  it('does not flag missing tracking when a tracking number is present', () => {
    const issues = assessDeliveryHealth(
      shipment({ shippedAt: '2026-08-22T00:00:00Z', trackingNumber: 'TRACK123', lastStatusAt: '2026-08-22T12:00:00Z' }),
      NOW,
    )
    expect(issues.some((i) => i.key === 'missing_tracking')).toBe(false)
  })

  it('flags a stale status update beyond the freshness window', () => {
    const issues = assessDeliveryHealth(
      shipment({ shippedAt: '2026-08-10T00:00:00Z', trackingNumber: 'TRACK123', lastStatusAt: '2026-08-10T00:00:00Z' }),
      NOW,
    )
    expect(issues.some((i) => i.key === 'stale_status')).toBe(true)
  })

  it('does not flag a recent status update', () => {
    const issues = assessDeliveryHealth(
      shipment({ shippedAt: '2026-08-22T00:00:00Z', trackingNumber: 'TRACK123', lastStatusAt: '2026-08-22T12:00:00Z' }),
      NOW,
    )
    expect(issues.some((i) => i.key === 'stale_status')).toBe(false)
  })

  it('flags a shipment with no status ever received', () => {
    const issues = assessDeliveryHealth(shipment({ shippedAt: '2026-08-22T00:00:00Z', trackingNumber: 'TRACK123' }), NOW)
    expect(issues.some((i) => i.key === 'stale_status')).toBe(true)
  })

  it('flags an overdue delivery promise', () => {
    const issues = assessDeliveryHealth(
      shipment({ shippedAt: '2026-08-15T00:00:00Z', trackingNumber: 'T1', lastStatusAt: '2026-08-22T00:00:00Z', promisedBy: '2026-08-20' }),
      NOW,
    )
    expect(issues.some((i) => i.key === 'overdue')).toBe(true)
  })

  it('can report multiple simultaneous issues', () => {
    const issues = assessDeliveryHealth(shipment({ shippedAt: '2026-08-01T00:00:00Z', promisedBy: '2026-08-05' }), NOW)
    expect(issues.length).toBeGreaterThanOrEqual(2)
  })

  it('isHealthy is true exactly when there are no issues', () => {
    expect(isHealthy(shipment({ deliveredAt: '2026-08-20T00:00:00Z' }), NOW)).toBe(true)
    expect(isHealthy(shipment({ shippedAt: '2026-08-22T00:00:00Z' }), NOW)).toBe(false)
  })

  it('a shipment with nothing recorded at all is not flagged as unhealthy (never shipped yet)', () => {
    expect(assessDeliveryHealth(shipment(), NOW)).toHaveLength(0)
  })
})
