import type { AdvertisingProvider } from './connectors/types'

/**
 * The pure decision logic behind Phase 9's staged, read-only verification
 * check — deliberately split out of `verification.ts` (which is
 * `server-only`, for the Supabase persistence half) so this half can be
 * unit-tested directly, the same reason `advertising/monitorPlan.ts` is its
 * own file rather than living inside `advertising/monitor.ts`.
 *
 * Never modifies a campaign, never changes a budget, never pauses
 * anything — the only connector methods this ever calls are
 * `isConfigured()`, `getConnectionHealth()` and `fetchCampaigns()` (a
 * read), matching Phase 13's "must default to read-only".
 *
 * The five real, honest states this can land on (never claims a state it
 * did not actually check):
 *
 *   not_tested               -> never run, or not configured
 *   authentication_verified  -> credentials present and getConnectionHealth() succeeded
 *   read_access_verified     -> fetchCampaigns() succeeded structurally (no error)
 *   data_retrieval_verified  -> fetchCampaigns() also returned at least one real record
 *   failed                   -> a check that was attempted did not pass
 *
 * `end_to_end_sync_verified` (the sixth value the DB column allows) is
 * intentionally never returned by this function — it would require
 * actually running a full sync into the `advertising` table, which
 * `advertising/sync.ts` already does for real, but this function does not
 * orchestrate that; see `HANDOVER.md` for that as a documented next step,
 * not a claim made without having run it.
 */

export type AdvertisingVerificationStatus = 'not_tested' | 'authentication_verified' | 'read_access_verified' | 'data_retrieval_verified' | 'end_to_end_sync_verified' | 'failed'

export interface ProviderVerificationResult {
  status: AdvertisingVerificationStatus
  detail: string
}

export async function verifyProviderReadOnly(connector: AdvertisingProvider): Promise<ProviderVerificationResult> {
  if (!connector.isConfigured()) {
    return { status: 'not_tested', detail: `${connector.descriptor.label} is not configured — nothing to verify yet.` }
  }

  const health = await connector.getConnectionHealth()
  if (!health.ok || health.value.status === 'error' || health.value.status === 'not_configured') {
    return { status: 'failed', detail: health.ok ? (health.value.detail ?? 'Connection health check failed.') : health.error }
  }

  const fetchResult = await connector.fetchCampaigns({ limit: 1 })
  if (!fetchResult.ok) {
    // Authentication genuinely succeeded (the health check above passed) —
    // this is a real, more specific state than "failed": credentials work,
    // but reading campaign data does not (yet).
    return { status: 'authentication_verified', detail: `Authenticated, but reading campaign data failed: ${fetchResult.error}` }
  }

  if (fetchResult.value.records.length === 0) {
    return { status: 'read_access_verified', detail: 'The read call succeeded, but returned no campaigns to confirm real data retrieval against.' }
  }

  return { status: 'data_retrieval_verified', detail: `Successfully retrieved ${fetchResult.value.records.length} real campaign record(s).` }
}
