import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { getAdvertisingIntelligenceForOrg } from '@/lib/analytics/repository'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { getSupabaseAutomationStore } from '@/lib/automation/supabaseStore'
import { proposeCampaignAction } from '@/lib/automation/advertisingExecution'
import { loadFreshCampaignFacts, loadConnectionStatus } from '@/lib/automation/handlers/advertisingApprovalExecutor'
import { recommendedActionForClassification } from './monitorPlan'
import { randomUUID } from 'node:crypto'
import type { AdvertisingPlatform } from '@/lib/analytics/advertisingAnalytics'

/**
 * Phases 5-7 — the automatic advertising monitor (Milestone 16).
 *
 *   OBSERVE (getAdvertisingIntelligenceForOrg — the real, unchanged
 *   classification engine) -> EVALUATE (monitorPlan.ts's pure mapping) ->
 *   RECOMMEND (proposeCampaignAction, which itself re-runs the full safety
 *   gate and the Phase-5-duplicate-pending check before ever creating an
 *   approval)
 *
 * Never OBSERVE -> CHANGE LIVE CAMPAIGN — this module never imports an
 * `AdvertisingProvider` connector and never calls `submitCampaignAction`.
 * Every recommendation it creates lands on `/approvals` exactly like a
 * chat-originated one; nothing here can execute, and duplicate-pending
 * protection (`proposeCampaignAction`'s own `findPendingCampaignAction`
 * check) means running this twice in a row never produces two pending
 * recommendations for the same campaign+action (Phase 6).
 *
 * Registered as job type `advertising_campaign_review`
 * (`automation/handlers/advertisingHandlers.ts`) — the same "reusable job
 * entry point, no new scheduler infrastructure" choice `advertising_sync`
 * already made. `/api/automation/run`'s existing scheduler claims and runs
 * it exactly like every other job type; nothing new is enqueuing these
 * jobs automatically yet (see `HANDOVER.md`'s Next step).
 */

export interface CampaignReviewResult {
  orgId: string
  campaignsEvaluated: number
  campaignsSkipped: number
  recommendationsCreated: number
  duplicatesAvoided: number
  blocked: number
  errors: string[]
}

/**
 * One org's review. `runCampaignReviewForConnectedOrgs` below is what
 * "identify organisations with valid advertising connections" (Phase 5,
 * step 1) actually iterates. Takes no `isDemo` — this function never
 * touches a connector or demo/live branching of any kind, only reads
 * already-classified campaigns and proposes; demo-mode handling belongs
 * entirely to `getAdvertisingIntelligenceForOrg`/`proposeCampaignAction`'s
 * own callers, not duplicated here.
 */
export async function runCampaignReview(orgId: string): Promise<CampaignReviewResult> {
  const result: CampaignReviewResult = {
    orgId, campaignsEvaluated: 0, campaignsSkipped: 0, recommendationsCreated: 0, duplicatesAvoided: 0, blocked: 0, errors: [],
  }

  let intelligence: Awaited<ReturnType<typeof getAdvertisingIntelligenceForOrg>>
  try {
    intelligence = await getAdvertisingIntelligenceForOrg(orgId)
  } catch (error) {
    result.errors.push(`Could not load advertising intelligence: ${error instanceof Error ? error.message : String(error)}`)
    return result
  }

  const settings = await getAutomationSettingsForOrg(orgId)
  const store = getSupabaseAutomationStore()
  const connectionStatusCache = new Map<string, Awaited<ReturnType<typeof loadConnectionStatus>>>()

  for (const { fact, classification } of intelligence.campaigns) {
    result.campaignsEvaluated++
    const actionType = recommendedActionForClassification(classification.classification)
    if (!actionType) {
      result.campaignsSkipped++
      continue
    }

    const { identity } = fact
    if (!identity.provider || !identity.externalAccountId) {
      // A real classification exists, but this campaign's rows never
      // carried `provider`/`external_account_id` (hand-entered/demo/
      // pre-Milestone-15 data) — cannot build a real recommendation
      // without knowing which platform to route it to. Skipped, not
      // guessed.
      result.campaignsSkipped++
      continue
    }

    try {
      let connectionStatus = connectionStatusCache.get(identity.provider)
      if (!connectionStatus) {
        connectionStatus = await loadConnectionStatus(orgId, identity.provider)
        connectionStatusCache.set(identity.provider, connectionStatus)
      }
      const freshFacts = await loadFreshCampaignFacts(orgId, identity.channel, identity.externalId)

      const proposal = await proposeCampaignAction(
        {
          orgId,
          channel: identity.channel,
          idempotencyKey: `monitor:${orgId}:${identity.channel}:${identity.externalId}:${actionType}:${new Date().toISOString().slice(0, 10)}`,
          correlationId: randomUUID(),
          request: {
            actionType,
            provider: identity.provider as AdvertisingPlatform,
            externalAccountId: identity.externalAccountId,
            externalCampaignId: identity.externalId,
            campaignName: identity.campaignName,
            classification: classification.classification,
            currentDailyBudgetMinor: freshFacts?.currentDailyBudgetMinor ?? identity.dailyBudgetMinor,
            proposedDailyBudgetMinor: null,
            isPaused: freshFacts?.isPaused ?? identity.isPaused,
            connectionStatus,
            dataAgeHours: freshFacts?.dataAgeHours ?? null,
            roas: null,
          },
        },
        settings,
        store,
      )

      if (proposal.wasDuplicate) result.duplicatesAvoided++
      else if (proposal.policyOutcome === 'block') result.blocked++
      else result.recommendationsCreated++
    } catch (error) {
      result.errors.push(`${identity.channel}:${identity.externalId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return result
}

export interface MultiOrgCampaignReviewResult {
  organisationsEvaluated: number
  providersChecked: number
  totals: CampaignReviewResult
  perOrg: readonly CampaignReviewResult[]
}

/**
 * Phase 5, step 1 — "identify organisations with valid advertising
 * connections." Reads distinct `(org_id, provider)` pairs from
 * `advertising_connections` where `is_connected`, then reviews each
 * organisation once (an org with two connected platforms is still one
 * review — `runCampaignReview` evaluates every one of its synced
 * campaigns regardless of platform in a single pass).
 */
export async function runCampaignReviewForConnectedOrgs(): Promise<MultiOrgCampaignReviewResult> {
  const supabase = createServiceSupabase()
  const { data } = await supabase.from('advertising_connections').select('org_id, provider').eq('is_connected', true)

  const orgIds = [...new Set((data ?? []).map((r) => r.org_id))]
  const providersChecked = new Set((data ?? []).map((r) => r.provider)).size

  const perOrg: CampaignReviewResult[] = []
  for (const orgId of orgIds) {
    perOrg.push(await runCampaignReview(orgId))
  }

  const totals = perOrg.reduce<CampaignReviewResult>(
    (acc, r) => ({
      orgId: 'all',
      campaignsEvaluated: acc.campaignsEvaluated + r.campaignsEvaluated,
      campaignsSkipped: acc.campaignsSkipped + r.campaignsSkipped,
      recommendationsCreated: acc.recommendationsCreated + r.recommendationsCreated,
      duplicatesAvoided: acc.duplicatesAvoided + r.duplicatesAvoided,
      blocked: acc.blocked + r.blocked,
      errors: [...acc.errors, ...r.errors],
    }),
    { orgId: 'all', campaignsEvaluated: 0, campaignsSkipped: 0, recommendationsCreated: 0, duplicatesAvoided: 0, blocked: 0, errors: [] },
  )

  return { organisationsEvaluated: orgIds.length, providersChecked, totals, perOrg }
}
