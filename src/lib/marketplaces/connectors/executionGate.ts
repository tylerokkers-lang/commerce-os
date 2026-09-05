import 'server-only'

import { err, type Result } from '@/lib/core/result'
import { createServiceSupabase } from '@/lib/supabase/server'
import { canRunNow, computeOutcomeUpdate, type CircuitBreakerState } from '@/lib/automation/circuitBreaker'
import type { MarketplaceConnector } from './types'

/**
 * Real circuit-breaker enforcement for marketplace connectors (Milestone:
 * execution reliability). No equivalent to the supplier registry's
 * `canConnectorRunNow` existed for marketplaces at all before this —
 * `channels` (migrations 0005/0015) already had every column needed
 * (`is_enabled`, `last_success_at`, `last_failure_at`, `last_error`,
 * `next_retry_at`, `consecutive_failures`), just never written to.
 *
 * Same fail-closed rule as the supplier gate (`suppliers/connectors/executionGate.ts`):
 * `null` means the query itself could not be trusted; a genuinely missing
 * row is a fresh, healthy default, not "unknown" — real organisations
 * already have a `channels` row per configured channel (seeded at
 * onboarding, never created by application code), so this case is a
 * defensive fallback, not the expected path.
 */

const POLICY = { minSecondsBetweenRuns: 5, failureThreshold: 3 } as const

const FRESH_STATE: CircuitBreakerState = {
  isEnabled: true,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
}

async function loadState(orgId: string, channelKey: string): Promise<CircuitBreakerState | null> {
  try {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase
      .from('channels')
      .select('is_enabled, last_success_at, last_failure_at, last_error, next_retry_at, consecutive_failures')
      .eq('org_id', orgId)
      .eq('key', channelKey as never)
      .maybeSingle()

    if (error) return null
    if (!data) return FRESH_STATE

    return {
      isEnabled: data.is_enabled,
      lastSuccessAt: data.last_success_at,
      lastFailureAt: data.last_failure_at,
      lastError: data.last_error,
      nextAllowedAt: data.next_retry_at,
      consecutiveFailures: data.consecutive_failures,
    }
  } catch {
    return null
  }
}

async function recordOutcome(orgId: string, channelKey: string, priorConsecutiveFailures: number, succeeded: boolean, error: string | null): Promise<void> {
  const update = computeOutcomeUpdate(succeeded, new Date(), error, priorConsecutiveFailures)
  try {
    const supabase = createServiceSupabase() as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    }
    const { error: rpcError } = await supabase.rpc('record_marketplace_connector_outcome', {
      p_org_id: orgId,
      p_channel_key: channelKey,
      p_succeeded: succeeded,
      p_error: error,
      p_next_allowed_at: update.nextAllowedAt,
      p_consecutive_failures: update.consecutiveFailures,
    })
    if (rpcError) console.error('[circuit-breaker] failed to record marketplace connector outcome', { channelKey, error: rpcError.message })
  } catch (recordError) {
    console.error('[circuit-breaker] failed to record marketplace connector outcome', { channelKey, error: recordError })
  }
}

/**
 * Gates and records one real call to a marketplace connector. Demo
 * connectors (key ending `_demo`) never reach a real external system —
 * gating them would only add a database round-trip with no safety benefit
 * — so this passes `fn` straight through for those, unchanged from today's
 * behaviour.
 */
export async function withMarketplaceConnectorGate<T, E>(
  orgId: string,
  connector: MarketplaceConnector,
  fn: () => Promise<Result<T, E>>,
): Promise<Result<T, E | string>> {
  if (connector.descriptor.key.endsWith('_demo')) return fn()

  const channelKey = connector.descriptor.channel
  const state = await loadState(orgId, channelKey)
  if (state === null) {
    return err(`${connector.descriptor.label}: safety state could not be confirmed — refusing to call it until this is resolved (fail closed).`)
  }

  const gate = canRunNow(connector.isConfigured(), state, POLICY, new Date())
  if (!gate.ok) return err(gate.error)

  const result = await fn()
  await recordOutcome(orgId, channelKey, state.consecutiveFailures, result.ok, result.ok ? null : String((result as { error: E }).error))
  return result
}
