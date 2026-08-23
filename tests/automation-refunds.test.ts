import { describe, expect, it } from 'vitest'
import { fromMajor } from '@/lib/core/money'
import { evaluateRefundAutomation } from '@/lib/automation/refundAutomation'
import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'

describe('refund automation', () => {
  it('approves automatically at autonomous, within every limit', () => {
    const result = evaluateRefundAutomation(
      { request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(0), requestedAmount: fromMajor(10), reason: 'customer_changed_mind' }, settings: DEMO_AUTOMATION_SETTINGS, refundsAlreadyIssuedTodayMinor: 0, refundsAlreadyIssuedOnOrder: 0 },
      'autonomous',
    )
    expect(result.policy.outcome).toBe('allow_automatic')
  })

  it('manual and assisted always require approval', () => {
    const result = evaluateRefundAutomation(
      { request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(0), requestedAmount: fromMajor(10), reason: 'customer_changed_mind' }, settings: DEMO_AUTOMATION_SETTINGS, refundsAlreadyIssuedTodayMinor: 0, refundsAlreadyIssuedOnOrder: 0 },
      'assisted',
    )
    expect(result.policy.outcome).toBe('require_approval')
  })

  it('blocks a refund that exceeds the order balance regardless of automation level', () => {
    const result = evaluateRefundAutomation(
      { request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(25), requestedAmount: fromMajor(10), reason: 'customer_changed_mind' }, settings: DEMO_AUTOMATION_SETTINGS, refundsAlreadyIssuedTodayMinor: 0, refundsAlreadyIssuedOnOrder: 0 },
      'autonomous',
    )
    expect(result.policy.outcome).toBe('block')
  })

  it('requires approval once the daily automatic refund total would be exceeded', () => {
    const result = evaluateRefundAutomation(
      { request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(0), requestedAmount: fromMajor(10), reason: 'customer_changed_mind' }, settings: DEMO_AUTOMATION_SETTINGS, refundsAlreadyIssuedTodayMinor: DEMO_AUTOMATION_SETTINGS.maxDailyAutoRefundMinor, refundsAlreadyIssuedOnOrder: 0 },
      'autonomous',
    )
    expect(result.policy.outcome).toBe('require_approval')
  })

  it('requires approval once the per-order refund count limit is reached', () => {
    const result = evaluateRefundAutomation(
      { request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(0), requestedAmount: fromMajor(5), reason: 'customer_changed_mind' }, settings: DEMO_AUTOMATION_SETTINGS, refundsAlreadyIssuedTodayMinor: 0, refundsAlreadyIssuedOnOrder: DEMO_AUTOMATION_SETTINGS.maxRefundsPerOrder },
      'autonomous',
    )
    expect(result.policy.outcome).toBe('require_approval')
  })

  it('the "refunds" category pause blocks an otherwise-automatic refund', () => {
    const paused = { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['refunds' as const] }
    const result = evaluateRefundAutomation(
      { request: { orderId: 'ord-1', orderTotal: fromMajor(30), alreadyRefunded: fromMajor(0), requestedAmount: fromMajor(10), reason: 'customer_changed_mind' }, settings: paused, refundsAlreadyIssuedTodayMinor: 0, refundsAlreadyIssuedOnOrder: 0 },
      'autonomous',
    )
    expect(result.policy.outcome).toBe('block')
  })
})
