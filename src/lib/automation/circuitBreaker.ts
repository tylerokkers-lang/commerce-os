import { err, ok, type Result } from '@/lib/core/result'
import { computeBackoffSeconds } from './backoff'

/**
 * The shared circuit-breaker core (Milestone: execution reliability).
 *
 * `src/lib/suppliers/connectors/registry.ts` already had a complete-looking
 * vocabulary for this — `ConnectorRuntimeState`, `deriveConnectorStatus`,
 * `canConnectorRunNow` — but it was never wired to anything real:
 * `canConnectorRunNow` was called nowhere outside its own tests, and every
 * caller of the health-display functions passed a hardcoded
 * `{consecutiveFailures: 0, ...}` rather than genuine persisted history.
 * Marketplace connectors had no equivalent gate at all.
 *
 * Both `supplier_connectors` (migration 0013) and `channels` (0005/0015)
 * already have the exact columns this needs
 * (`is_enabled`/`last_success_at`/`last_failure_at`/`last_error`/
 * `next_allowed_at` or `next_retry_at`/`consecutive_failures`) — no new
 * table was required. This module is the ONE place the gating algorithm and
 * the failure/recovery bookkeeping are computed, so
 * `suppliers/connectors/executionGate.ts` and
 * `marketplaces/connectors/executionGate.ts` share identical logic instead
 * of each reimplementing it against their own table's column names.
 *
 * Fail-closed rule: `state === null` means the caller could not confirm
 * this connector's safety state (a genuine read failure, not "never run
 * before" — see each gate module's own doc comment for how the two are
 * told apart) and is refused, never treated as "assume healthy."
 */

export interface CircuitBreakerState {
  isEnabled: boolean
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  nextAllowedAt: string | null
  consecutiveFailures: number
}

export interface CircuitBreakerPolicy {
  /** Minimum time between successful runs, honoured even when the circuit is closed. */
  minSecondsBetweenRuns: number
  /** Consecutive failures before the circuit is considered fully OPEN (as opposed to merely "degraded"). */
  failureThreshold: number
}

export type CircuitStatus = 'not_configured' | 'unknown' | 'disabled' | 'open' | 'failing' | 'degraded' | 'healthy' | 'ready'

/** Derives status from observable facts only — never asserted. `state: null` is the fail-closed "unknown" case. */
export function deriveCircuitStatus(configured: boolean, state: CircuitBreakerState | null, policy: CircuitBreakerPolicy, now: Date = new Date()): CircuitStatus {
  if (!configured) return 'not_configured'
  if (state === null) return 'unknown'
  if (!state.isEnabled) return 'disabled'
  if (state.nextAllowedAt && new Date(state.nextAllowedAt) > now) {
    return state.consecutiveFailures >= policy.failureThreshold ? 'open' : 'degraded'
  }
  if (state.consecutiveFailures >= policy.failureThreshold) return 'failing'
  if (state.consecutiveFailures > 0) return 'degraded'
  if (state.lastSuccessAt) return 'healthy'
  return 'ready'
}

/**
 * Whether a real call may be attempted right now. Every real check in this
 * codebase re-reads state fresh immediately before calling this — no
 * caller caches a prior verdict — so two concurrent workers each racing to
 * call the same connector both evaluate against genuinely current state;
 * see each gate module for how the *recording* half stays race-safe too
 * (an atomic, single-statement database update, not a read-modify-write).
 */
export function canRunNow(configured: boolean, state: CircuitBreakerState | null, policy: CircuitBreakerPolicy, now: Date = new Date()): Result<true, string> {
  if (!configured) return err('Not configured.')
  if (state === null) return err('Connector safety state could not be confirmed — refusing to call it until this is resolved (fail closed).')
  if (!state.isEnabled) return err('Disabled.')
  if (state.nextAllowedAt && new Date(state.nextAllowedAt) > now) {
    const openness = state.consecutiveFailures >= policy.failureThreshold ? 'circuit open' : 'cooling down'
    return err(`${openness} until ${state.nextAllowedAt} (${state.consecutiveFailures} consecutive failure${state.consecutiveFailures === 1 ? '' : 's'}${state.lastError ? `; last error: ${state.lastError}` : ''}).`)
  }
  if (state.lastSuccessAt) {
    const elapsedSeconds = (now.getTime() - new Date(state.lastSuccessAt).getTime()) / 1000
    if (elapsedSeconds < policy.minSecondsBetweenRuns) {
      return err(`Rate limited — last ran ${Math.round(elapsedSeconds)}s ago, requires ${policy.minSecondsBetweenRuns}s between runs.`)
    }
  }
  return ok(true)
}

export interface CircuitBreakerOutcomeUpdate {
  lastSuccessAt?: string
  lastFailureAt?: string
  lastError?: string | null
  nextAllowedAt: string | null
  consecutiveFailures: number
}

/**
 * A verified successful call resets the circuit — full recovery, not a
 * gradual half-open trickle, matching this codebase's existing job-retry
 * convention (`jobs.ts`'s `completeJob` also resets `attempts` bookkeeping
 * fully on success rather than decaying it). A failure increments the
 * streak and reuses the exact same exponential-backoff curve
 * (`computeBackoffSeconds`, 30s * 2^(n-1) capped at 1h) `automation_jobs`
 * retries already use, rather than a second, independently-tuned curve.
 *
 * `lastFailureAt`/`lastError` are historical facts ("has this connector
 * ever failed, and with what error") — a later success clears the streak
 * that blocks new calls but never erases that history, so only the failure
 * branch sets them; the success branch omits them from the returned patch
 * entirely rather than nulling out real history the caller should keep.
 */
export function computeOutcomeUpdate(succeeded: boolean, now: Date, error?: string | null, priorConsecutiveFailures = 0): CircuitBreakerOutcomeUpdate {
  if (succeeded) {
    return { lastSuccessAt: now.toISOString(), nextAllowedAt: null, consecutiveFailures: 0 }
  }
  const consecutiveFailures = priorConsecutiveFailures + 1
  const backoffSeconds = computeBackoffSeconds(consecutiveFailures)
  return {
    lastFailureAt: now.toISOString(),
    lastError: error ?? null,
    nextAllowedAt: new Date(now.getTime() + backoffSeconds * 1000).toISOString(),
    consecutiveFailures,
  }
}
