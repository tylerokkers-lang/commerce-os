import 'server-only'

import { err, type Result } from '@/lib/core/result'
import { createServiceSupabase } from '@/lib/supabase/server'
import { computeOutcomeUpdate } from '@/lib/automation/circuitBreaker'
import { createNotification } from '@/lib/notifications/create'
import { canConnectorRunNow, type ConnectorRuntimeState } from './registry'
import type { SupplierConnector } from './types'

/** Matches `deriveConnectorStatus`'s existing `consecutiveFailures >= 3` "failing" threshold — never a second, independently-tuned number. */
const CIRCUIT_OPEN_THRESHOLD = 3

/**
 * Real circuit-breaker enforcement for supplier connectors (Milestone:
 * execution reliability). `canConnectorRunNow` (`registry.ts`) already
 * existed, already tested, and is reused here UNCHANGED — this module adds
 * only what was missing: a real, persisted `ConnectorRuntimeState` (instead
 * of the hardcoded `{consecutiveFailures: 0, ...}` every caller used to
 * pass) and a place that actually calls the gate before a real connector
 * method runs, then records what happened afterward.
 *
 * FAIL CLOSED, precisely defined: `loadState` returns `null` only when the
 * database query itself could not be trusted (a thrown error) — never for
 * "no row exists yet." `supplier_connectors` has had zero rows in
 * production since Milestone 3 (nothing ever wrote to it), so treating an
 * absent row as "unknown, therefore blocked" would immediately stop the
 * real, working CJdropshipping connector calls this session's whole
 * discovery/backfill/verification work depends on — a regression, not a
 * safety improvement. An absent row is instead a real, distinct fact —
 * "this connector has never been tracked before" — and is treated as a
 * fresh, healthy state (`isEnabled: true`, zero failures): exactly the
 * behaviour every one of these calls already had before this module
 * existed, for a connector `isConfigured()` already reports as real. Only
 * a genuine query error (the database could not be asked at all) means
 * safety state is truly unknown, and that is the one case this refuses.
 */

const FRESH_STATE: ConnectorRuntimeState = {
  isEnabled: true,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
}

async function loadState(orgId: string, supplierId: string, connectorKey: string): Promise<ConnectorRuntimeState | null> {
  try {
    const supabase = createServiceSupabase()
    const { data, error } = await supabase
      .from('supplier_connectors')
      .select('is_enabled, last_success_at, last_failure_at, last_error, next_allowed_at, consecutive_failures')
      .eq('org_id', orgId)
      .eq('supplier_id', supplierId)
      .eq('connector_key', connectorKey)
      .maybeSingle()

    if (error) return null // Fail closed — the query itself could not be trusted.
    if (!data) return FRESH_STATE // Never tracked before — a real, distinct fact, not "unknown."

    return {
      isEnabled: data.is_enabled,
      lastSuccessAt: data.last_success_at,
      lastFailureAt: data.last_failure_at,
      lastError: data.last_error,
      nextAllowedAt: data.next_allowed_at,
      consecutiveFailures: data.consecutive_failures,
    }
  } catch {
    return null
  }
}

async function recordOutcome(
  orgId: string,
  supplierId: string,
  connector: SupplierConnector,
  priorConsecutiveFailures: number,
  succeeded: boolean,
  error: string | null,
): Promise<void> {
  const update = computeOutcomeUpdate(succeeded, new Date(), error, priorConsecutiveFailures)
  try {
    const supabase = createServiceSupabase() as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    }
    const { error: rpcError } = await supabase.rpc('record_supplier_connector_outcome', {
      p_org_id: orgId,
      p_supplier_id: supplierId,
      p_connector_key: connector.descriptor.key,
      p_label: connector.descriptor.label,
      p_source_type: connector.descriptor.sourceType,
      p_min_seconds_between_runs: connector.descriptor.rateLimit.minSecondsBetweenRuns,
      p_succeeded: succeeded,
      p_error: error,
      p_next_allowed_at: update.nextAllowedAt,
      p_consecutive_failures: update.consecutiveFailures,
    })
    if (rpcError) console.error('[circuit-breaker] failed to record supplier connector outcome', { connectorKey: connector.descriptor.key, error: rpcError.message })
  } catch (recordError) {
    // Never let bookkeeping failure mask the real call's own result — the
    // caller already has the real outcome; this is best-effort telemetry.
    console.error('[circuit-breaker] failed to record supplier connector outcome', { connectorKey: connector.descriptor.key, error: recordError })
  }

  // Milestone: autonomous decision & capability layer, Part 12. Notify
  // exactly once, at the moment the streak first crosses the threshold —
  // never on every subsequent failure while still open, and never on a
  // transient single failure below it.
  if (!succeeded && update.consecutiveFailures === CIRCUIT_OPEN_THRESHOLD) {
    await createNotification({
      orgId,
      severity: 'critical',
      category: 'supplier',
      title: `${connector.descriptor.label} is failing repeatedly`,
      body: `${update.consecutiveFailures} consecutive failures — calls are now paused until ${update.nextAllowedAt}. Last error: ${error ?? 'unknown'}.`,
      entityType: 'supplier_connector',
      entityId: `${supplierId}:${connector.descriptor.key}`,
      dedupeKey: `connector-circuit-open:${orgId}:${supplierId}:${connector.descriptor.key}`,
    })
  }
}

/**
 * Gates and records one real call to a supplier connector. `fn` is only
 * ever invoked when the circuit is closed; its own `Result` (`ok`/`err`) is
 * what determines whether this call counts as a success or a failure for
 * circuit-breaker purposes — the same discipline this codebase already
 * applies everywhere else ("a write's own accepted response is never
 * treated as proof," extended here to "a call that returns at all is not
 * itself proof of health — only an `ok` result is").
 */
export async function withSupplierConnectorGate<T>(
  orgId: string,
  supplierId: string,
  connector: SupplierConnector,
  fn: () => Promise<Result<T, string>>,
): Promise<Result<T, string>> {
  const state = await loadState(orgId, supplierId, connector.descriptor.key)
  if (state === null) {
    return err(`${connector.descriptor.label}: safety state could not be confirmed — refusing to call it until this is resolved (fail closed).`)
  }

  const gate = canConnectorRunNow(connector, state, new Date())
  if (!gate.ok) return err(gate.error)

  const result = await fn()
  await recordOutcome(orgId, supplierId, connector, state.consecutiveFailures, result.ok, result.ok ? null : result.error)
  return result
}
