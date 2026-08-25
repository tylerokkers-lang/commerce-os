import 'server-only'

import { recordAudit, type AuditAction } from '@/lib/audit'
import { createNotification } from '@/lib/notifications/create'
import { enqueueJob, claimNextJob, completeJob, cancelJob } from './jobs'
import { createAutomationAction, completeAutomationAction, countRecentActionsForEntity, reconcileAdvertisingCampaign, reconcileChannelProduct } from './actions'
import { getAutomationSettingsForOrg } from './settings'
import { proposeApproval, findPendingCampaignAction } from './proposeApproval'
import type { AutomationStore } from './store'

/**
 * The production `AutomationStore`: every method is a thin pass-through to
 * the real, Supabase-backed functions in `jobs.ts`, `actions.ts`,
 * `settings.ts`, `@/lib/audit` and `@/lib/notifications/create`. This is the
 * store `/api/automation/run` uses. `inMemoryStore.ts` implements the exact
 * same interface for `tests/automation-engine-e2e.test.ts`.
 */
export function getSupabaseAutomationStore(): AutomationStore {
  return {
    enqueueJob,
    claimNextJob,
    completeJob,
    cancelJob,
    createAutomationAction,
    completeAutomationAction,
    countRecentActionsForEntity,
    proposeApproval,
    findPendingCampaignAction,
    reconcileChannelProduct,
    reconcileAdvertisingCampaign,
    getAutomationSettings: getAutomationSettingsForOrg,
    async recordAudit(entry) {
      await recordAudit({
        orgId: entry.orgId,
        action: entry.action as AuditAction,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorType: entry.actorType,
        actorLabel: entry.actorLabel,
        reason: entry.reason,
        ruleKey: entry.ruleKey,
        aiDecisionId: entry.aiDecisionId,
        result: entry.result,
        error: entry.error,
        metadata: entry.metadata,
      })
    },
    async notify(entry) {
      await createNotification(entry)
    },
  }
}
