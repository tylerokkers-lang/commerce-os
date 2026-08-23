import { describe, expect, it } from 'vitest'
import { TERMINAL_STATUSES, canCancel, isTerminal, nextStatuses, planOrderTransition } from '@/lib/orders/lifecycle'
import type { OrderStatus } from '@/lib/orders/lifecycle'

const ALL_STATUSES: readonly OrderStatus[] = [
  'pending', 'paid', 'awaiting_fulfilment', 'partially_fulfilled', 'fulfilled',
  'delivered', 'cancelled', 'refunded', 'partially_refunded', 'failed',
]

describe('order status state machine', () => {
  it('walks the full happy path', () => {
    const path: OrderStatus[] = ['pending', 'paid', 'awaiting_fulfilment', 'fulfilled', 'delivered']
    for (let i = 0; i < path.length - 1; i += 1) {
      const result = planOrderTransition({ from: path[i], to: path[i + 1], reason: 'Progressed normally' })
      expect(result.ok, `${path[i]} -> ${path[i + 1]}`).toBe(true)
    }
  })

  it('rejects an invalid transition', () => {
    const result = planOrderTransition({ from: 'pending', to: 'delivered', reason: 'Skipping every step' })
    expect(result.ok).toBe(false)
  })

  it('rejects a transition with an insufficient reason', () => {
    expect(planOrderTransition({ from: 'pending', to: 'paid', reason: 'ok' }).ok).toBe(false)
  })

  it('treats cancelled, refunded and failed as terminal', () => {
    expect(TERMINAL_STATUSES).toEqual(['cancelled', 'refunded', 'failed'])
    for (const status of TERMINAL_STATUSES) {
      expect(isTerminal(status)).toBe(true)
      expect(nextStatuses(status)).toHaveLength(0)
    }
  })

  it('refuses to reopen a terminal order', () => {
    const result = planOrderTransition({ from: 'cancelled', to: 'paid', reason: 'Reviving the order' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/terminal/)
  })

  it('supports partial fulfilment as a first-class status', () => {
    expect(planOrderTransition({ from: 'awaiting_fulfilment', to: 'partially_fulfilled', reason: 'Only some items shipped' }).ok).toBe(true)
    expect(planOrderTransition({ from: 'partially_fulfilled', to: 'fulfilled', reason: 'Remaining items shipped' }).ok).toBe(true)
  })

  it('allows a partial refund without terminating the order, and a full refund from delivered', () => {
    expect(planOrderTransition({ from: 'delivered', to: 'partially_refunded', reason: 'Customer returned one item' }).ok).toBe(true)
    expect(planOrderTransition({ from: 'partially_refunded', to: 'refunded', reason: 'Remaining balance refunded' }).ok).toBe(true)
  })

  it('reports cancellation eligibility correctly across the lifecycle', () => {
    expect(canCancel('pending')).toBe(true)
    expect(canCancel('awaiting_fulfilment')).toBe(true)
    expect(canCancel('delivered')).toBe(false)
    expect(canCancel('cancelled')).toBe(false)
  })

  it('every declared next status is a real status', () => {
    for (const status of ALL_STATUSES) {
      for (const next of nextStatuses(status)) {
        expect(ALL_STATUSES, `${status} -> ${next}`).toContain(next)
      }
    }
  })
})
