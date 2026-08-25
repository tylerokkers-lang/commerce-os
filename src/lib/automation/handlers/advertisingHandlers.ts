import { proposeCampaignAction, type CampaignActionInput } from '../advertisingExecution'
import type { CampaignActionType } from '../advertisingAutomation'
import type { AutomationStore, JobRecord } from '../store'
import type { JobHandlerResult } from '../worker'
import type { ChannelKey } from '@/lib/core/domain'
import type { AdvertisingPlatform, CampaignClassification } from '@/lib/analytics/advertisingAnalytics'

/**
 * Job handlers for the advertising sync + controlled-automation pipeline
 * (Milestone 15). Same shape as every other handler in this directory:
 * orchestrates existing engines, duplicates none of their logic, and never
 * evaluates anything from the payload as code.
 *
 * `runSync` is injected rather than imported — `advertising/sync.ts` is
 * `server-only` (it touches Supabase directly), and `worker.ts` (which
 * imports every handler file, including this one) must stay importable
 * into Vitest with no `server-only` module anywhere in its dependency
 * graph, the same reason `FactsLoader`/`ConnectorLookup` are injected
 * interfaces here rather than direct imports of `facts.ts`/the connector
 * registries. The real `runSync` implementation is constructed only in
 * `/api/automation/run/route.ts`, which — like every Route Handler in this
 * codebase — is allowed to import server-only modules directly.
 */
export interface CampaignReviewJobResult {
  succeeded: boolean
  error: string | null
  campaignsEvaluated: number
  recommendationsCreated: number
  duplicatesAvoided: number
  blocked: number
}

export interface AdvertisingHandlerDeps {
  runSync: (orgId: string, connectorKey: string, limit?: number) => Promise<{ succeeded: boolean; error: string | null }>
  /** Milestone 16 — same injection reasoning as `runSync`: `advertising/monitor.ts` is `server-only`. */
  runCampaignReview?: (orgId: string) => Promise<CampaignReviewJobResult>
}

function isAdvertisingSyncPayload(p: Record<string, unknown>): p is { connectorKey: string; limit?: number } {
  return typeof p.connectorKey === 'string'
}

export async function handleAdvertisingSync(job: JobRecord, _store: AutomationStore, _facts: unknown, _connectors: unknown, _marketDeps?: unknown, advertisingDeps?: AdvertisingHandlerDeps): Promise<JobHandlerResult> {
  if (!isAdvertisingSyncPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for advertising_sync — requires connectorKey.', retryable: false }
  }
  if (!advertisingDeps) {
    return { succeeded: false, error: 'advertising_sync requires advertisingDeps (runSync), which was not provided.', retryable: false }
  }

  const result = await advertisingDeps.runSync(job.orgId, job.payload.connectorKey, job.payload.limit)
  if (!result.succeeded) return { succeeded: false, error: result.error ?? 'Advertising sync failed.', retryable: true }
  return { succeeded: true }
}

function isCampaignActionPayload(p: Record<string, unknown>): p is {
  channel: ChannelKey; provider: AdvertisingPlatform; externalAccountId: string; externalCampaignId: string; actionType: CampaignActionType
  campaignName: string; classification: CampaignClassification | null; currentDailyBudgetMinor: number | null; proposedDailyBudgetMinor: number | null
  isPaused: boolean; connectionStatus: 'not_configured' | 'demo' | 'connected' | 'degraded' | 'error'
  dataAgeHours: number | null; roas: number | null; idempotencyKey: string
} {
  return typeof p.channel === 'string' && typeof p.provider === 'string' && typeof p.externalAccountId === 'string' && typeof p.externalCampaignId === 'string' && typeof p.actionType === 'string'
    && typeof p.campaignName === 'string' && (p.classification === null || typeof p.classification === 'string') && typeof p.isPaused === 'boolean' && typeof p.connectionStatus === 'string'
    && typeof p.idempotencyKey === 'string'
}

/**
 * Proposes a campaign action (pause/increase/decrease budget) from an
 * already-detected fact — e.g. a real campaign classification the caller
 * enqueuing this job already computed via `advertisingAnalytics.ts`'s
 * `classifyCampaign`. Never executes anything itself: `proposeCampaignAction`
 * can only end in `blocked` or `require_approval` (see that module's
 * comment for why `executing` is unreachable this milestone).
 */
export async function handleAdvertisingCampaignAction(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isCampaignActionPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for advertising_campaign_action.', retryable: false }
  }
  const p = job.payload
  const settings = await store.getAutomationSettings(job.orgId)

  const input: CampaignActionInput = {
    orgId: job.orgId,
    channel: p.channel,
    idempotencyKey: p.idempotencyKey,
    jobId: job.id,
    correlationId: job.correlationId,
    request: {
      actionType: p.actionType,
      provider: p.provider,
      externalAccountId: p.externalAccountId,
      externalCampaignId: p.externalCampaignId,
      campaignName: p.campaignName,
      classification: p.classification,
      currentDailyBudgetMinor: p.currentDailyBudgetMinor,
      proposedDailyBudgetMinor: p.proposedDailyBudgetMinor,
      isPaused: p.isPaused,
      connectionStatus: p.connectionStatus,
      dataAgeHours: p.dataAgeHours,
      roas: p.roas,
    },
  }

  const result = await proposeCampaignAction(input, settings, store)
  return { succeeded: result.policyOutcome !== 'block' }
}

/**
 * Phases 5-7 — one org's automatic campaign review
 * (`advertising/monitor.ts`'s `runCampaignReview`). Observes real,
 * already-classified campaigns and proposes where appropriate; never
 * executes. Structured observability (Phase 7) is threaded straight
 * through into the job outcome via `error`, which carries a human-readable
 * summary even on "success" so a run with zero recommendations is never
 * indistinguishable from one that quietly found nothing to check.
 */
export async function handleAdvertisingCampaignReview(job: JobRecord, _store: AutomationStore, _facts: unknown, _connectors: unknown, _marketDeps?: unknown, advertisingDeps?: AdvertisingHandlerDeps): Promise<JobHandlerResult> {
  if (!advertisingDeps?.runCampaignReview) {
    return { succeeded: false, error: 'advertising_campaign_review requires advertisingDeps (runCampaignReview), which was not provided.', retryable: false }
  }

  const result = await advertisingDeps.runCampaignReview(job.orgId)
  if (!result.succeeded) return { succeeded: false, error: result.error ?? 'Advertising campaign review failed.', retryable: true }
  return { succeeded: true }
}
