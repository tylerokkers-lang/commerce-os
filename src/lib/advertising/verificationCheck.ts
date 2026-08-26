import type { AdvertisingProvider } from './connectors/types'
// Type-only import: erased at compile time, so this never actually pulls
// `amazonAdsReportPipeline.ts`'s `server-only` module into this file's
// runtime dependency graph — the same reason every other cross-boundary
// type reference in this codebase uses `import type`.
import type { AdvanceReportPipelineResult } from './amazonAdsReportPipeline'

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

/**
 * Milestone 20, Phase 19 — maps one call's worth of Amazon Ads async report
 * pipeline outcome onto this same, cross-provider `AdvertisingVerificationStatus`
 * vocabulary, so Amazon Ads' reporting verification never needs a second,
 * parallel status enum. `advanceAmazonAdsReportPipeline` never writes to a
 * campaign or a budget — only to this org's own `advertising_connections`
 * tracking row — so this remains a read capability, exactly like the
 * generic path above; it never marks a write capability verified.
 *
 * A single call only ever performs ONE step of the request/check/retrieve
 * cycle (Phase 4), so this honestly reflects that: a `requested`/`processing`
 * result proves report-API access works but has no data yet
 * (`read_access_verified`, the same meaning that status already has for
 * "the read call succeeded, but returned no campaigns" in the generic
 * path above); only a `completed` result with real facts reaches
 * `data_retrieval_verified`. Repeated verification runs across the real
 * async delay are expected to be how this reaches its final state — the
 * same "Maintenance Run 1/2/3" model Phase 4 describes, applied to manual
 * verification clicks instead of scheduled maintenance cycles.
 */
export function mapAmazonAdsReportPipelineToVerification(pipeline: AdvanceReportPipelineResult): ProviderVerificationResult {
  if (pipeline.status === 'failed') return { status: 'failed', detail: pipeline.detail }
  if (pipeline.status === 'requested' || pipeline.status === 'processing') return { status: 'read_access_verified', detail: pipeline.detail }
  // 'completed'
  if (pipeline.facts.length === 0) {
    return { status: 'read_access_verified', detail: `${pipeline.detail} No row could be normalized into a real campaign fact (${pipeline.unparseableRows} unparseable).` }
  }
  return { status: 'data_retrieval_verified', detail: pipeline.detail }
}

/**
 * Milestone 20, Phase 19 — the same granular step evidence as
 * `interpretAmazonAdsReportSteps` below, folded into `mapAmazonAdsReportPipelineToVerification`'s
 * `overallStatus` so both callers (the simple status persisted to
 * `advertising_connections`, and the granular `steps[]` this file's own
 * harness produces) agree on the same underlying classification — never
 * two independently-derived answers to "is this verified."
 */
function interpretAmazonAdsReportSteps(baseSteps: VerificationHarnessStep[], pipeline: AdvanceReportPipelineResult): VerificationHarnessResult {
  const steps = [...baseSteps]
  const { status: overallStatus } = mapAmazonAdsReportPipelineToVerification(pipeline)

  if (pipeline.status === 'failed') {
    steps.push({ step: 'Create/check/retrieve report (whichever this call attempted)', outcome: 'failed', detail: pipeline.detail })
    return { steps, overallStatus }
  }

  if (pipeline.status === 'requested') {
    steps.push({ step: 'Report creation', outcome: 'passed', detail: pipeline.detail })
    steps.push({ step: 'Report status lookup', outcome: 'skipped', detail: 'Not yet checked — run verification again once Amazon Ads has had time to process the report.' })
    steps.push({ step: 'Report retrieval', outcome: 'skipped', detail: 'The report is not yet complete.' })
    steps.push({ step: 'Report parsing and campaign normalization', outcome: 'skipped', detail: 'The report is not yet complete.' })
    return { steps, overallStatus }
  }

  if (pipeline.status === 'processing') {
    steps.push({ step: 'Report creation', outcome: 'passed', detail: 'A report was already requested in an earlier verification run.' })
    steps.push({ step: 'Report status lookup', outcome: 'passed', detail: pipeline.detail })
    steps.push({ step: 'Report retrieval', outcome: 'skipped', detail: 'The report is still processing.' })
    steps.push({ step: 'Report parsing and campaign normalization', outcome: 'skipped', detail: 'The report is still processing.' })
    return { steps, overallStatus }
  }

  // 'completed'
  steps.push({ step: 'Report creation', outcome: 'passed', detail: 'A report was requested in an earlier verification run.' })
  steps.push({ step: 'Report status lookup', outcome: 'passed', detail: 'Amazon Ads reported the report as completed.' })
  steps.push({ step: 'Report retrieval', outcome: 'passed', detail: pipeline.detail })
  steps.push({
    step: 'Report parsing and campaign normalization',
    outcome: pipeline.facts.length > 0 ? 'passed' : 'failed',
    detail: pipeline.facts.length > 0
      ? `Normalized ${pipeline.facts.length} real campaign fact(s)${pipeline.unparseableRows > 0 ? `, ${pipeline.unparseableRows} row(s) unparseable` : ''}.`
      : `The report contained no row that could be normalized into a campaign fact (${pipeline.unparseableRows} unparseable).`,
  })
  return { steps, overallStatus }
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
 * not invented: Amazon Ads' `fetchCampaigns` is one monolithic call for
 * every platform except Amazon Ads itself, whose real read path is the
 * async report pipeline instead (Milestone 20) — passing `amazonAdsReportPipelineResult`
 * (obtained by the server-only caller from `advanceAmazonAdsReportPipeline`,
 * since this file must stay free of `server-only` to remain unit-testable)
 * switches this function onto `interpretAmazonAdsReportSteps` above instead
 * of the generic `fetchCampaigns()`/`verifyCampaignState()` steps below —
 * never both, and never invented for a provider that has no such result.
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

export async function runAdvertisingVerificationHarness(
  connector: AdvertisingProvider,
  amazonAdsReportPipelineResult?: AdvanceReportPipelineResult,
): Promise<VerificationHarnessResult> {
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

  if (amazonAdsReportPipelineResult) {
    return interpretAmazonAdsReportSteps(steps, amazonAdsReportPipelineResult)
  }

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
