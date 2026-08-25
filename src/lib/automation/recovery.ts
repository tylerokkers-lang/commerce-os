import 'server-only'

import { recordAudit } from '@/lib/audit'
import { classifyStuckExecution, EXECUTION_RECOVERY_THRESHOLD_MINUTES } from './executionRecovery'
import { resolveChannelProduct } from './handlers/priceApprovalExecutor'
import { connectorForChannel } from '@/lib/marketplaces/connectors/registry'
import { connectorForPlatform } from '@/lib/advertising/connectors/registry'
import type { AutomationStore, ActionRecord } from './store'
import type { ChannelKey } from '@/lib/core/domain'
import type { AdvertisingPlatform } from '@/lib/analytics/advertisingAnalytics'

/**
 * The execution reaper (Milestone 17, Phases 1-4).
 *
 * `automation_actions.status = 'executing'` is only ever supposed to be a
 * momentary state — set by `createAutomationAction` right before
 * `submitPriceChangeAction`/`submitCampaignAction` calls the provider, and
 * cleared by `completeAutomationAction` once that call (and its VERIFY
 * step) finishes. If the process handling that runs dies in between — a
 * server restart, an OOM kill, a deploy landing mid-request — the row is
 * left `executing` forever, and Commerce-OS genuinely does not know
 * whether the provider applied the change. Assuming either answer is a
 * guess; guessing wrong is dangerous in both directions (assuming success
 * hides a real problem, assuming failure and retrying risks a second real
 * write). This module never retries a write. It only ever reads the
 * provider's own current state, through the exact same `verifyWrites`
 * capability the normal SUBMIT -> VERIFY step already uses, and records
 * one of three honest outcomes (`executionRecovery.ts`'s
 * `classifyStuckExecution`):
 *
 *   succeeded — verified match with the intended target -> reconcile, mark succeeded.
 *   failed    — verified match with the known pre-change value -> mark failed, no retry.
 *   unknown   — anything else -> `retry_pending` (reserved since migration
 *               0019, never previously set), a human must review it.
 *
 * Scoped to `update_price`/`pause_campaign`/`increase_ad_budget`/
 * `decrease_ad_budget` only — the action types with a real provider write
 * and a real verify capability wired up. A row of any other type stuck
 * `executing` belongs to a different subsystem and is out of scope here.
 */

const RECOVERABLE_ACTION_TYPES = ['update_price', 'pause_campaign', 'increase_ad_budget', 'decrease_ad_budget'] as const

export interface ExecutionRecoveryResult {
  candidatesFound: number
  succeeded: number
  failed: number
  unknown: number
  /** Already resolved by a concurrent recovery pass before this one's compare-and-swap landed — not double-counted above. */
  alreadyResolved: number
  errors: string[]
}

async function recoverPriceAction(action: ActionRecord, store: AutomationStore): Promise<{ status: 'succeeded' | 'failed' | 'retry_pending'; error: string }> {
  const inputFacts = action.inputFacts as Record<string, unknown>
  const newPriceMinor = typeof inputFacts.newPriceMinor === 'number' ? inputFacts.newPriceMinor : null
  const oldPriceMinor = typeof inputFacts.oldPriceMinor === 'number' ? inputFacts.oldPriceMinor : null
  const channelHint = typeof inputFacts.channel === 'string' ? (inputFacts.channel as ChannelKey) : null

  if (newPriceMinor === null) {
    return { status: 'retry_pending', error: 'Recovery: this action has no recorded target price to verify against — cannot classify.' }
  }

  const resolved = await resolveChannelProduct(action.orgId, { entityType: action.entityType, entityId: action.entityId ?? '', channelHint })
  if (!resolved || !resolved.externalId) {
    return { status: 'retry_pending', error: 'Recovery: the listing this action targeted could not be resolved — cannot verify the provider\'s real state.' }
  }

  // Every `automation_actions` row a live database can ever hold comes
  // from a non-demo session — `approveDecision`/`executePriceChange`
  // return before creating one whenever `session.isDemo` is true, so
  // `isDemo` is never threaded onto this row at all. Recovery always
  // resolves the live connector accordingly.
  const connector = connectorForChannel(resolved.channel, false)

  if (!connector.descriptor.capabilities.verifyWrites) {
    const classification = classifyStuckExecution({ connectorSupportsVerification: false, verifyCallSucceeded: false, currentStateMatchesTarget: false, currentStateMatchesOriginal: null })
    return { status: classification.outcome === 'succeeded' ? 'succeeded' : classification.outcome === 'failed' ? 'failed' : 'retry_pending', error: classification.reason }
  }

  const verifyResult = await connector.verifyListingState(resolved.externalId)
  const classification = classifyStuckExecution({
    connectorSupportsVerification: true,
    verifyCallSucceeded: verifyResult.ok,
    currentStateMatchesTarget: verifyResult.ok && verifyResult.value.priceMinor === newPriceMinor,
    currentStateMatchesOriginal: verifyResult.ok && oldPriceMinor !== null ? verifyResult.value.priceMinor === oldPriceMinor : null,
  })

  if (classification.outcome === 'succeeded') {
    await store.reconcileChannelProduct({ orgId: action.orgId, channelProductId: resolved.channelProductId, priceMinor: newPriceMinor })
  }

  return { status: classification.outcome === 'succeeded' ? 'succeeded' : classification.outcome === 'failed' ? 'failed' : 'retry_pending', error: classification.reason }
}

async function recoverCampaignAction(action: ActionRecord, store: AutomationStore): Promise<{ status: 'succeeded' | 'failed' | 'retry_pending'; error: string }> {
  const inputFacts = action.inputFacts as Record<string, unknown>
  const provider = typeof inputFacts.provider === 'string' ? (inputFacts.provider as AdvertisingPlatform) : null
  const externalCampaignId = typeof inputFacts.externalCampaignId === 'string' ? inputFacts.externalCampaignId : null
  const channel = typeof inputFacts.channel === 'string' ? (inputFacts.channel as ChannelKey) : null
  const isPaused = typeof inputFacts.isPaused === 'boolean' ? inputFacts.isPaused : null
  const currentDailyBudgetMinor = typeof inputFacts.currentDailyBudgetMinor === 'number' ? inputFacts.currentDailyBudgetMinor : null
  const proposedDailyBudgetMinor = typeof inputFacts.proposedDailyBudgetMinor === 'number' ? inputFacts.proposedDailyBudgetMinor : null

  if (!provider || !externalCampaignId || !channel) {
    return { status: 'retry_pending', error: 'Recovery: this action is missing recorded campaign identity — cannot verify the provider\'s real state.' }
  }

  // Same reasoning as the price path: only a live (non-demo) session ever
  // creates a real `automation_actions` row.
  const connector = connectorForPlatform(provider, false)

  if (!connector.descriptor.capabilities.verifyWrites) {
    const classification = classifyStuckExecution({ connectorSupportsVerification: false, verifyCallSucceeded: false, currentStateMatchesTarget: false, currentStateMatchesOriginal: null })
    return { status: classification.outcome === 'succeeded' ? 'succeeded' : classification.outcome === 'failed' ? 'failed' : 'retry_pending', error: classification.reason }
  }

  const verifyResult = await connector.verifyCampaignState(externalCampaignId)

  let matchesTarget = false
  let matchesOriginal: boolean | null = null
  if (verifyResult.ok) {
    if (action.actionType === 'pause_campaign') {
      const verifiedIsPaused = verifyResult.value.status === 'paused'
      matchesTarget = verifiedIsPaused === true
      matchesOriginal = isPaused === null ? null : verifiedIsPaused === isPaused
    } else {
      matchesTarget = proposedDailyBudgetMinor !== null && verifyResult.value.dailyBudgetMinor === proposedDailyBudgetMinor
      matchesOriginal = currentDailyBudgetMinor === null ? null : verifyResult.value.dailyBudgetMinor === currentDailyBudgetMinor
    }
  }

  const classification = classifyStuckExecution({
    connectorSupportsVerification: true,
    verifyCallSucceeded: verifyResult.ok,
    currentStateMatchesTarget: matchesTarget,
    currentStateMatchesOriginal: matchesOriginal,
  })

  if (classification.outcome === 'succeeded') {
    await store.reconcileAdvertisingCampaign({
      orgId: action.orgId,
      channel,
      externalId: externalCampaignId,
      ...(action.actionType === 'pause_campaign' ? { isPaused: true } : { dailyBudgetMinor: proposedDailyBudgetMinor ?? undefined }),
    })
  }

  return { status: classification.outcome === 'succeeded' ? 'succeeded' : classification.outcome === 'failed' ? 'failed' : 'retry_pending', error: classification.reason }
}

/**
 * Runs one recovery pass across every organisation's stuck `executing`
 * actions. Safe to run repeatedly and safe to run concurrently with itself
 * — every terminal write goes through `recordRecoveryOutcome`'s
 * compare-and-swap, so a row already resolved by an overlapping pass is
 * counted in `alreadyResolved`, never reconciled or audited twice.
 */
export async function runExecutionRecovery(store: AutomationStore, thresholdMinutes = EXECUTION_RECOVERY_THRESHOLD_MINUTES): Promise<ExecutionRecoveryResult> {
  const result: ExecutionRecoveryResult = { candidatesFound: 0, succeeded: 0, failed: 0, unknown: 0, alreadyResolved: 0, errors: [] }
  const olderThanIso = new Date(Date.now() - thresholdMinutes * 60_000).toISOString()

  const stuck = await store.findStuckExecutingActions(olderThanIso, RECOVERABLE_ACTION_TYPES)
  result.candidatesFound = stuck.length

  for (const action of stuck) {
    try {
      await recordAudit({
        orgId: action.orgId,
        action: 'EXECUTION_RECOVERY_ATTEMPTED',
        entityType: action.entityType,
        entityId: action.entityId,
        actorType: 'system',
        reason: `Recovery: "${action.actionType}" (${action.id}) has been "executing" since ${action.createdAt}, past the ${thresholdMinutes}-minute recovery threshold. Attempting a read-only verify to determine the real outcome.`,
        metadata: { automationActionId: action.id, actionType: action.actionType, createdAt: action.createdAt },
      })

      const outcome = action.actionType === 'update_price'
        ? await recoverPriceAction(action, store)
        : await recoverCampaignAction(action, store)

      const recorded = await store.recordRecoveryOutcome(action.id, {
        status: outcome.status,
        error: outcome.error,
        orgId: action.orgId,
        entityType: action.entityType,
        entityId: action.entityId,
        verificationStatus: outcome.status === 'succeeded' ? 'verified' : outcome.status === 'failed' ? 'failed' : 'uncertain',
        reconciliationStatus: outcome.status === 'succeeded' ? 'matched' : 'not_applicable',
      })

      if (!recorded.applied) {
        result.alreadyResolved++
        continue
      }

      if (outcome.status === 'succeeded') result.succeeded++
      else if (outcome.status === 'failed') result.failed++
      else {
        result.unknown++
        await recordAudit({
          orgId: action.orgId,
          action: 'EXECUTION_RESULT_UNKNOWN',
          entityType: action.entityType,
          entityId: action.entityId,
          actorType: 'system',
          result: 'blocked',
          reason: outcome.error,
          metadata: { automationActionId: action.id, actionType: action.actionType },
        })
      }
    } catch (error) {
      result.errors.push(`${action.actionType}:${action.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return result
}
