import { describe, expect, it } from 'vitest'
import {
  TERMINAL_STATES,
  isTerminal,
  nextStates,
  planListingTransition,
} from '@/lib/marketplaces/listingLifecycle'
import type { ListingState } from '@/lib/marketplaces/listingLifecycle'

const ALL_STATES: readonly ListingState[] = [
  'discovered', 'evaluating', 'approved', 'ready_to_list',
  'pending_approval', 'published', 'paused', 'ended', 'blocked',
]

describe('marketplace listing state machine', () => {
  it('walks the whole documented happy path', () => {
    const path: ListingState[] = [
      'discovered', 'evaluating', 'approved', 'ready_to_list', 'pending_approval', 'published',
    ]
    for (let i = 0; i < path.length - 1; i += 1) {
      const result = planListingTransition({
        from: path[i], to: path[i + 1], reason: 'Cleared the next stage requirement',
      })
      expect(result.ok, `${path[i]} -> ${path[i + 1]}`).toBe(true)
    }
  })

  it('rejects invalid transitions', () => {
    const result = planListingTransition({
      from: 'discovered', to: 'published', reason: 'Skipping straight to live',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Permitted next states/)
  })

  it('rejects a transition with no meaningful reason', () => {
    const result = planListingTransition({ from: 'discovered', to: 'evaluating', reason: 'x' })
    expect(result.ok).toBe(false)
  })

  it('rejects moving to the same state', () => {
    const result = planListingTransition({ from: 'published', to: 'published', reason: 'No real change here' })
    expect(result.ok).toBe(false)
  })

  it('treats "ended" as the only terminal state', () => {
    expect(TERMINAL_STATES).toEqual(['ended'])
    expect(isTerminal('ended')).toBe(true)
    expect(isTerminal('blocked')).toBe(false)
    expect(nextStates('ended')).toHaveLength(0)
  })

  it('refuses to revive an ended listing', () => {
    const result = planListingTransition({ from: 'ended', to: 'published', reason: 'Bringing it back' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/terminal/)
  })

  it('allows a paused listing to resume or end, but not to skip back to draft', () => {
    expect(planListingTransition({ from: 'paused', to: 'published', reason: 'Resuming after review' }).ok).toBe(true)
    expect(planListingTransition({ from: 'paused', to: 'ended', reason: 'Discontinuing the product' }).ok).toBe(true)
    expect(planListingTransition({ from: 'paused', to: 'discovered', reason: 'Starting fresh apparently' }).ok).toBe(false)
  })

  it('requires blocked to return through evaluating deliberately, not silently resume', () => {
    expect(nextStates('blocked')).toEqual(['evaluating'])
    expect(planListingTransition({ from: 'blocked', to: 'published', reason: 'Just publish it anyway' }).ok).toBe(false)
  })

  it('allows blocking from every non-terminal state', () => {
    for (const state of ALL_STATES) {
      if (state === 'ended' || state === 'blocked') continue
      const result = planListingTransition({ from: state, to: 'blocked', reason: 'A compliance issue was found' })
      expect(result.ok, state).toBe(true)
    }
  })

  it('every declared next state is itself a real state', () => {
    for (const state of ALL_STATES) {
      for (const next of nextStates(state)) {
        expect(ALL_STATES, `${state} -> ${next}`).toContain(next)
      }
    }
  })
})
