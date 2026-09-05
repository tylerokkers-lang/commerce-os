import { describe, expect, it } from 'vitest'
import { canRunNow, computeOutcomeUpdate, deriveCircuitStatus, type CircuitBreakerPolicy, type CircuitBreakerState } from '@/lib/automation/circuitBreaker'

/**
 * Milestone: execution reliability & unified write path. The shared,
 * pure circuit-breaker core — reused, unchanged, by both
 * `suppliers/connectors/executionGate.ts` and
 * `marketplaces/connectors/executionGate.ts`, so testing it once here
 * covers the gating algorithm for both connector families; each gate
 * module's own tests only need to cover how it loads/persists state.
 */

const CLOCK = new Date('2026-09-05T12:00:00Z')
const POLICY: CircuitBreakerPolicy = { minSecondsBetweenRuns: 60, failureThreshold: 3 }

function state(overrides: Partial<CircuitBreakerState> = {}): CircuitBreakerState {
  return {
    isEnabled: true,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    nextAllowedAt: null,
    consecutiveFailures: 0,
    ...overrides,
  }
}

describe('canRunNow', () => {
  it('a healthy, never-run connector may run', () => {
    const result = canRunNow(true, state(), POLICY, CLOCK)
    expect(result.ok).toBe(true)
  })

  it('refuses a not-configured connector', () => {
    const result = canRunNow(false, state(), POLICY, CLOCK)
    expect(result.ok).toBe(false)
  })

  it('refuses a disabled connector even if otherwise healthy', () => {
    const result = canRunNow(true, state({ isEnabled: false }), POLICY, CLOCK)
    expect(result.ok).toBe(false)
  })

  it('FAIL CLOSED: refuses when state is unknown (null), never treated as healthy', () => {
    const result = canRunNow(true, null, POLICY, CLOCK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/could not be confirmed/i)
  })

  it('blocks calls while the circuit is open (nextAllowedAt in the future)', () => {
    const future = new Date(CLOCK.getTime() + 600_000).toISOString()
    const result = canRunNow(true, state({ nextAllowedAt: future, consecutiveFailures: 5 }), POLICY, CLOCK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/circuit open/i)
  })

  it('describes a below-threshold cooldown differently from a fully open circuit', () => {
    const future = new Date(CLOCK.getTime() + 60_000).toISOString()
    const result = canRunNow(true, state({ nextAllowedAt: future, consecutiveFailures: 1 }), POLICY, CLOCK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/cooling down/i)
  })

  it('allows a call once the cooldown/open window has passed', () => {
    const past = new Date(CLOCK.getTime() - 1000).toISOString()
    const result = canRunNow(true, state({ nextAllowedAt: past, consecutiveFailures: 5 }), POLICY, CLOCK)
    expect(result.ok).toBe(true)
  })

  it('rate limit interaction: refuses a call sooner than minSecondsBetweenRuns after the last success, even with zero failures', () => {
    const recent = new Date(CLOCK.getTime() - 10_000).toISOString() // 10s ago, policy requires 60s
    const result = canRunNow(true, state({ lastSuccessAt: recent }), POLICY, CLOCK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/rate limited/i)
  })

  it('allows a call once minSecondsBetweenRuns has elapsed since the last success', () => {
    const longAgo = new Date(CLOCK.getTime() - 120_000).toISOString()
    const result = canRunNow(true, state({ lastSuccessAt: longAgo }), POLICY, CLOCK)
    expect(result.ok).toBe(true)
  })

  it('concurrent calls: two callers evaluating the identical state both see the same verdict (no hidden mutable shared state)', () => {
    const s = state({ nextAllowedAt: new Date(CLOCK.getTime() + 5000).toISOString(), consecutiveFailures: 4 })
    const a = canRunNow(true, s, POLICY, CLOCK)
    const b = canRunNow(true, s, POLICY, CLOCK)
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
  })
})

describe('deriveCircuitStatus', () => {
  it('not_configured when the connector itself is not configured', () => {
    expect(deriveCircuitStatus(false, state(), POLICY, CLOCK)).toBe('not_configured')
  })

  it('unknown when state could not be loaded (fail closed, distinct from every other status)', () => {
    expect(deriveCircuitStatus(true, null, POLICY, CLOCK)).toBe('unknown')
  })

  it('disabled when configured but switched off', () => {
    expect(deriveCircuitStatus(true, state({ isEnabled: false }), POLICY, CLOCK)).toBe('disabled')
  })

  it('ready for a fresh, never-run connector', () => {
    expect(deriveCircuitStatus(true, state(), POLICY, CLOCK)).toBe('ready')
  })

  it('healthy after at least one success with no failures', () => {
    expect(deriveCircuitStatus(true, state({ lastSuccessAt: CLOCK.toISOString() }), POLICY, CLOCK)).toBe('healthy')
  })

  it('degraded with some failures below the threshold', () => {
    expect(deriveCircuitStatus(true, state({ consecutiveFailures: 1 }), POLICY, CLOCK)).toBe('degraded')
  })

  it('failing at or above the threshold once the cooldown has already elapsed', () => {
    const past = new Date(CLOCK.getTime() - 1000).toISOString()
    expect(deriveCircuitStatus(true, state({ consecutiveFailures: 3, nextAllowedAt: past }), POLICY, CLOCK)).toBe('failing')
  })

  it('open while still cooling down at or above the threshold', () => {
    const future = new Date(CLOCK.getTime() + 1000).toISOString()
    expect(deriveCircuitStatus(true, state({ consecutiveFailures: 3, nextAllowedAt: future }), POLICY, CLOCK)).toBe('open')
  })
})

describe('computeOutcomeUpdate', () => {
  it('a success fully resets the failure streak and clears nextAllowedAt', () => {
    const update = computeOutcomeUpdate(true, CLOCK, null, 5)
    expect(update.consecutiveFailures).toBe(0)
    expect(update.nextAllowedAt).toBeNull()
    expect(update.lastSuccessAt).toBe(CLOCK.toISOString())
  })

  it('a success never overwrites failure history — the patch omits lastFailureAt/lastError entirely', () => {
    const update = computeOutcomeUpdate(true, CLOCK, null, 5)
    expect(update).not.toHaveProperty('lastFailureAt')
    expect(update).not.toHaveProperty('lastError')
  })

  it('a failure increments the streak and computes a real cooldown window', () => {
    const update = computeOutcomeUpdate(false, CLOCK, 'timeout', 0)
    expect(update.consecutiveFailures).toBe(1)
    expect(update.lastError).toBe('timeout')
    expect(update.lastFailureAt).toBe(CLOCK.toISOString())
    expect(new Date(update.nextAllowedAt!).getTime()).toBeGreaterThan(CLOCK.getTime())
  })

  it('recovery: after opening on repeated failures, the very next success clears the open state entirely', () => {
    const failed = computeOutcomeUpdate(false, CLOCK, 'error', 4)
    expect(failed.consecutiveFailures).toBe(5)
    expect(failed.nextAllowedAt).not.toBeNull()

    const recovered = computeOutcomeUpdate(true, new Date(CLOCK.getTime() + 3600_000), null, failed.consecutiveFailures)
    expect(recovered.consecutiveFailures).toBe(0)
    expect(recovered.nextAllowedAt).toBeNull()
  })

  it('the cooldown grows with consecutive failures (exponential, matching the shared job-retry backoff curve)', () => {
    const first = computeOutcomeUpdate(false, CLOCK, 'e', 0)
    const second = computeOutcomeUpdate(false, CLOCK, 'e', 1)
    const firstDelay = new Date(first.nextAllowedAt!).getTime() - CLOCK.getTime()
    const secondDelay = new Date(second.nextAllowedAt!).getTime() - CLOCK.getTime()
    expect(secondDelay).toBeGreaterThan(firstDelay)
  })
})
