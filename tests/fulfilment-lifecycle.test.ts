import { describe, expect, it } from 'vitest'
import {
  TERMINAL_STATUSES,
  allFulfilmentsComplete,
  isPartiallyFulfilled,
  isTerminal,
  nextStatuses,
  planFulfilmentTransition,
} from '@/lib/fulfilment/lifecycle'
import type { FulfilmentStatus } from '@/lib/fulfilment/lifecycle'

const ALL_STATUSES: readonly FulfilmentStatus[] = [
  'pending', 'awaiting_supplier', 'submitted', 'accepted', 'shipped', 'delivered', 'failed', 'cancelled',
]

describe('fulfilment status state machine', () => {
  it('walks the full happy path', () => {
    const path: FulfilmentStatus[] = ['pending', 'awaiting_supplier', 'submitted', 'accepted', 'shipped', 'delivered']
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(planFulfilmentTransition({ from: path[i], to: path[i + 1], reason: 'Progressed normally' }).ok).toBe(true)
    }
  })

  it('treats delivered and cancelled as terminal, but not failed', () => {
    expect(TERMINAL_STATUSES).toEqual(['delivered', 'cancelled'])
    expect(isTerminal('failed')).toBe(false)
  })

  it('supplier rejection (failed) can be retried against a different supplier', () => {
    const result = planFulfilmentTransition({ from: 'submitted', to: 'failed', reason: 'Supplier rejected the order' })
    expect(result.ok).toBe(true)

    const retry = planFulfilmentTransition({ from: 'failed', to: 'awaiting_supplier', reason: 'Switched to an alternative supplier' })
    expect(retry.ok).toBe(true)
  })

  it('refuses to progress a terminal fulfilment', () => {
    expect(planFulfilmentTransition({ from: 'delivered', to: 'shipped', reason: 'Going backwards' }).ok).toBe(false)
    expect(planFulfilmentTransition({ from: 'cancelled', to: 'submitted', reason: 'Reviving it' }).ok).toBe(false)
  })

  it('every declared next status is real', () => {
    for (const status of ALL_STATUSES) {
      for (const next of nextStatuses(status)) {
        expect(ALL_STATUSES, `${status} -> ${next}`).toContain(next)
      }
    }
  })
})

describe('partial fulfilment aggregation', () => {
  it('reports complete only when every fulfilment has shipped or delivered', () => {
    expect(allFulfilmentsComplete(['delivered', 'shipped'])).toBe(true)
    expect(allFulfilmentsComplete(['delivered', 'accepted'])).toBe(false)
    expect(allFulfilmentsComplete([])).toBe(false)
  })

  it('reports partial when some but not all fulfilments have progressed', () => {
    expect(isPartiallyFulfilled(['shipped', 'accepted'])).toBe(true)
    expect(isPartiallyFulfilled(['shipped', 'delivered'])).toBe(false) // all complete, not partial
    expect(isPartiallyFulfilled(['pending', 'accepted'])).toBe(false) // none complete yet
  })
})
