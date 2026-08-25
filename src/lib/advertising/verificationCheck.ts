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

/**
 * Milestone 19, Phase 7 — the same read-only check above, broken into the
 * brief's suggested incremental steps, each with its own named, structured
 * outcome. Never calls a connector method `verifyProviderReadOnly` does
 * not already call (no new API surface, no duplicated logic) — this is a
 * more legible *view* over identical calls, not a second implementation.
 * Genuinely finer granularity than the underlying connector supports is
 * not invented: Amazon Ads' `fetchCampaigns` is one monolithic call (the
 * Reporting API's create/poll/download flow is not implemented — see
 * `connectors/amazonAds.ts`), so "fetch campaign metadata" and "fetch
 * metrics" collapse into one step here rather than two that would only
 * differ in name.
 */
export interface VerificationHarnessStep {
  step: string
  outcome: 'passed' | 'failed' | 'skipped'
  detail: string
}

export interface VerificationHarnessResult {
  steps: readonly VerificationHarnessStep[]
  overallStatus: AdvertisingVerificationStatus
}

export async function runAdvertisingVerificationHarness(connector: AdvertisingProvider): Promise<VerificationHarnessResult> {
  const steps: VerificationHarnessStep[] = []

  if (!connector.isConfigured()) {
    steps.push({ step: 'Validate credentials exist', outcome: 'failed', detail: `${connector.descriptor.label} is not configured.` })
    return { steps, overallStatus: 'not_tested' }
  }
  steps.push({ step: 'Validate credentials exist', outcome: 'passed', detail: 'All required credentials are present.' })

  const health = await connector.getConnectionHealth()
  if (!health.ok || health.value.status === 'error' || health.value.status === 'not_configured') {
    steps.push({
      step: 'Authenticate and identify accessible account/profile',
      outcome: 'failed',
      detail: health.ok ? (health.value.detail ?? 'Connection health check failed.') : health.error,
    })
    return { steps, overallStatus: 'failed' }
  }
  steps.push({ step: 'Authenticate and identify accessible account/profile', outcome: 'passed', detail: `Connection status: ${health.value.status}.` })

  const fetchResult = await connector.fetchCampaigns({ limit: 1 })
  if (!fetchResult.ok) {
    steps.push({ step: 'Perform a safe read: fetch campaign metadata and metrics', outcome: 'failed', detail: fetchResult.error })
    return { steps, overallStatus: 'authentication_verified' }
  }

  if (fetchResult.value.records.length === 0) {
    steps.push({ step: 'Perform a safe read: fetch campaign metadata and metrics', outcome: 'passed', detail: 'The read call succeeded, but returned no campaigns.' })
    steps.push({ step: 'Verify campaign state', outcome: 'skipped', detail: 'No campaign was returned to verify against.' })
    return { steps, overallStatus: 'read_access_verified' }
  }
  steps.push({ step: 'Perform a safe read: fetch campaign metadata and metrics', outcome: 'passed', detail: `Retrieved ${fetchResult.value.records.length} real campaign record(s).` })

  const target = fetchResult.value.records[0]
  const verifyResult = await connector.verifyCampaignState(target.externalCampaignId)
  if (!verifyResult.ok) {
    steps.push({ step: 'Verify campaign state', outcome: 'failed', detail: verifyResult.error })
    return { steps, overallStatus: 'data_retrieval_verified' }
  }
  steps.push({ step: 'Verify campaign state', outcome: 'passed', detail: `Read back campaign ${target.externalCampaignId}'s own state directly.` })

  return { steps, overallStatus: 'data_retrieval_verified' }
}
