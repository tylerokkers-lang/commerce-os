import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { assessCampaignActionPolicy, type CampaignActionRequest } from '../advertisingAutomation'
import { submitCampaignAction } from '../advertisingExecution'
import { connectorForPlatform } from '@/lib/advertising/connectors/registry'
import type { DecisionExecutionOutcome } from '../executionDispatch'
import type { AutomationStore } from '../store'
import type { AutomationSettings } from '../settingsTypes'
import type { ChannelKey } from '@/lib/core/domain'
import type { AdvertisingPlatform, CampaignClassification } from '@/lib/analytics/advertisingAnalytics'

/**
 * Phase 4 — execution-time revalidation for an approved advertising
 * campaign action (Milestone 16). This is the one place "a human approved
 * this" and "the connector is actually called" meet, and the whole reason
 * this file exists rather than calling `submitCampaignAction` directly
 * from `approvalWorkflow.ts`: everything the original recommendation was
 * proposed on could be stale by the time the owner clicks approve — the
 * campaign might have been paused since, the connection might have
 * dropped, the data might no longer be fresh. This function re-derives
 * every safety-relevant fact fresh from the database and re-runs the full
 * `assessCampaignActionPolicy` gate before ever touching the connector —
 * never executes on the facts the recommendation was originally created
 * from.
 *
 * `server-only` (touches Supabase directly) — never imported by
 * `worker.ts`'s dependency graph, only by `approvalWorkflow.ts`.
 */
export interface ApprovedCampaignDecision {
  orgId: string
  isDemo: boolean
  automationActionId: string
  idempotencyKey: string
  actionType: 'pause_campaign' | 'increase_ad_budget' | 'decrease_ad_budget'
  channel: ChannelKey
  provider: AdvertisingPlatform
  externalAccountId: string
  externalCampaignId: string
  campaignName: string
  classification: CampaignClassification | null
  proposedDailyBudgetMinor: number | null
}

export interface FreshCampaignFacts {
  isPaused: boolean
  currentDailyBudgetMinor: number | null
  dataAgeHours: number | null
}

/**
 * Exported for reuse by `advertising/monitor.ts` (Milestone 16), which
 * needs the exact same "how old is this campaign's synced data"
 * computation the revalidation gate here uses — never a second
 * implementation of it.
 *
 * Filters on `provider`/`external_account_id` as well as `channel`/
 * `external_id`: the `advertising` table's own uniqueness constraint
 * (migration 0008: `unique(org_id, channel, external_id, period_date)`)
 * predates advertising connectors and does not include the account —
 * campaign ids are only guaranteed unique per platform in practice, not
 * enforced as such by this schema. Matching on all four keeps this
 * revalidation from ever reading a different advertising account's
 * same-numbered campaign as if it were the one just approved (the
 * provider/account/campaign identity distinction this milestone's
 * `CampaignActionRequest` was built to preserve).
 */
export async function loadFreshCampaignFacts(orgId: string, channel: ChannelKey, provider: string, externalAccountId: string, externalCampaignId: string): Promise<FreshCampaignFacts | null> {
  const supabase = createServiceSupabase()
  const { data } = await supabase
    .from('advertising')
    .select('is_paused, daily_budget_minor, synced_at')
    .eq('org_id', orgId)
    .eq('channel', channel)
    .eq('provider', provider)
    .eq('external_account_id', externalAccountId)
    .eq('external_id', externalCampaignId)
    .order('period_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const dataAgeHours = data.synced_at ? (Date.now() - new Date(data.synced_at).getTime()) / (60 * 60 * 1000) : null
  return { isPaused: data.is_paused, currentDailyBudgetMinor: data.daily_budget_minor, dataAgeHours }
}

/** Exported for reuse by `advertising/monitor.ts` (Milestone 16) — the same "provider connection validity" check, never a second implementation of it. */
export async function loadConnectionStatus(orgId: string, platform: string): Promise<'not_configured' | 'demo' | 'connected' | 'degraded' | 'error'> {
  const supabase = createServiceSupabase()
  const { data } = await supabase.from('advertising_connections').select('status').eq('org_id', orgId).eq('provider', platform).maybeSingle()
  return (data?.status as never) ?? 'not_configured'
}

export async function executeApprovedCampaignAction(decision: ApprovedCampaignDecision, settings: AutomationSettings, store: AutomationStore): Promise<DecisionExecutionOutcome> {
  const fresh = await loadFreshCampaignFacts(decision.orgId, decision.channel, decision.provider, decision.externalAccountId, decision.externalCampaignId)
  const connectionStatus = await loadConnectionStatus(decision.orgId, decision.provider)

  const request: CampaignActionRequest = {
    actionType: decision.actionType,
    provider: decision.provider,
    externalAccountId: decision.externalAccountId,
    externalCampaignId: decision.externalCampaignId,
    campaignName: decision.campaignName,
    classification: decision.classification,
    currentDailyBudgetMinor: fresh?.currentDailyBudgetMinor ?? null,
    proposedDailyBudgetMinor: decision.proposedDailyBudgetMinor,
    isPaused: fresh?.isPaused ?? false,
    connectionStatus,
    dataAgeHours: fresh?.dataAgeHours ?? null,
    roas: null,
  }

  const assessment = assessCampaignActionPolicy(request, settings)

  // Re-run the full safety gate against fresh facts. `assessCampaignActionPolicy`
  // never returns `allow_automatic` (see that module's comment) — an owner
  // approval is what makes `pending_approval` sufficient to proceed here,
  // exactly the same "policy says never auto, human approval is the missing
  // authorization" split `approvalWorkflow.ts` already applies for every
  // other decision type. Only a fresh `block` — a genuinely changed
  // fact — stops execution at this stage.
  if (assessment.policy.outcome === 'block') {
    await store.completeAutomationAction(decision.automationActionId, {
      succeeded: false,
      error: `Blocked on revalidation: ${assessment.policy.reason}`,
      orgId: decision.orgId,
      entityType: 'advertising_campaign',
      entityId: `${decision.channel}:${decision.externalCampaignId}`,
      verificationStatus: 'not_applicable',
      reconciliationStatus: 'not_applicable',
    })
    return { kind: 'revalidation_blocked', automationActionId: decision.automationActionId, reason: assessment.policy.reason }
  }

  const connector = connectorForPlatform(decision.provider, decision.isDemo)
  const result = await submitCampaignAction(
    {
      orgId: decision.orgId,
      channel: decision.channel,
      externalCampaignId: decision.externalCampaignId,
      actionType: decision.actionType,
      proposedDailyBudgetMinor: decision.proposedDailyBudgetMinor,
      connector,
      automationActionId: decision.automationActionId,
      idempotencyKey: decision.idempotencyKey,
    },
    store,
  )

  return { kind: 'executed', automationActionId: decision.automationActionId, succeeded: result.executed, error: result.executed ? null : 'See automation_actions.error for detail.' }
}
