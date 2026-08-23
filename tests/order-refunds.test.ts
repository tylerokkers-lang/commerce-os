import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { planRefund, type RefundRequest } from '@/lib/orders/refunds'

function request(over: Partial<RefundRequest> = {}): RefundRequest {
  return {
    orderId: 'ord-1',
    orderTotal: fromMajor(50),
    alreadyRefunded: fromMajor(0),
    requestedAmount: fromMajor(20),
    reason: 'faulty',
    ...over,
  }
}

describe('refund planning', () => {
  it('blocks a refund of zero or negative amount', () => {
    expect(planRefund(request({ requestedAmount: fromMajor(0) }), 5000, 'autonomous').outcome).toBe('blocked')
  })

  it('blocks a refund exceeding the remaining refundable balance', () => {
    const decision = planRefund(
      request({ orderTotal: fromMajor(50), alreadyRefunded: fromMajor(40), requestedAmount: fromMajor(20) }),
      5000, 'autonomous',
    )
    expect(decision.outcome).toBe('blocked')
  })

  it('computes the remaining refundable balance correctly', () => {
    const decision = planRefund(
      request({ orderTotal: fromMajor(50), alreadyRefunded: fromMajor(15), requestedAmount: fromMajor(10) }),
      5000, 'autonomous',
    )
    expect(decision.remainingRefundable.minor).toBe(3500)
  })

  it('identifies a full refund correctly', () => {
    const decision = planRefund(request({ requestedAmount: fromMajor(50) }), 100000, 'autonomous')
    expect(decision.isFullRefund).toBe(true)
  })

  it('always requires approval at "manual" and "assisted", regardless of amount', () => {
    for (const level of ['manual', 'assisted'] as const) {
      const decision = planRefund(request({ requestedAmount: fromMajor(1) }), 100000, level)
      expect(decision.outcome).toBe('pending_approval')
    }
  })

  it('approves automatically at "supervised" within the configured limit', () => {
    const decision = planRefund(request({ requestedAmount: fromMajor(20) }), 5000, 'supervised') // £50 limit
    expect(decision.outcome).toBe('approve_automatically')
    expect(decision.requiresOwnerApproval).toBe(false)
  })

  it('requires approval at "supervised" when the amount exceeds the automatic limit', () => {
    const decision = planRefund(request({ requestedAmount: fromMajor(20) }), 1000, 'supervised') // £10 limit
    expect(decision.outcome).toBe('pending_approval')
  })

  it('never approves a refund larger than the order allows, even at "autonomous"', () => {
    // The guardrail holds regardless of automation level: exceeding the
    // order's own remaining balance is blocked, not merely gated.
    const decision = planRefund(
      request({ orderTotal: fromMajor(50), alreadyRefunded: fromMajor(0), requestedAmount: fromMajor(60) }),
      1000000, 'autonomous',
    )
    expect(decision.outcome).toBe('blocked')
  })
})
