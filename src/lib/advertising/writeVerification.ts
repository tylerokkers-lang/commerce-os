import 'server-only'

import { randomUUID } from 'node:crypto'
import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { checkWriteVerificationGates } from './writeVerificationGates'
import type { AdvertisingProvider } from './connectors/types'

/**
 * Milestone 19, Phases 7/8 — the write-verification harness. Genuinely
 * different from `verificationCheck.ts`'s read-only checks: this is the
 * *only* function in this codebase that can cause a real write-capability
 * verification to touch a live provider, and it is deliberately never
 * wired to any HTTP route, scheduled job, or UI control — the only way to
 * invoke it is a direct function call from trusted server code, which is
 * itself part of the safety design (no accidental or remote trigger path
 * exists at all, not merely an authorization check on one that does).
 *
 * Phase 8's four gates, each enforced literally and in order, any one of
 * which failing stops this function before it ever calls the connector:
 *
 *   1. environment explicitly configured for controlled verification —
 *      `ADVERTISING_WRITE_VERIFICATION_ENABLED=true`, unset by default and
 *      never set by anything in this codebase itself;
 *   2. the target is explicitly designated as safe — `targetExternalCampaignId`
 *      has no default and is never inferred from a live sync or a
 *      recommendation; the caller must know and state exactly which
 *      real-world campaign this is allowed to touch;
 *   3. the action is explicitly requested — `action` has no default;
 *   4. the existing safety model still applies — the connector must
 *      genuinely declare the requested capability as implemented, and
 *      `orgId` scopes the persisted result exactly like every other
 *      org-scoped write in this codebase, never a cross-org side effect.
 *
 * Never automatically invoked to "determine whether the connector works" —
 * `verificationCheck.ts`'s read-only harness is what answers that question
 * safely. This function exists only for the day real credentials and a
 * genuine test/sandbox campaign exist and an operator deliberately chooses
 * to run it — which has not happened in this environment, and this
 * function has therefore never executed against a live provider.
 */

export type WriteVerificationAction = 'pause_campaign' | 'set_budget'

export interface RunWriteVerificationInput {
  orgId: string
  connector: AdvertisingProvider
  /** No default. The caller must explicitly designate a campaign known to be safe to mutate for this purpose. */
  targetExternalCampaignId: string
  action: WriteVerificationAction
  /** Required, and only meaningful, for `action: 'set_budget'`. */
  dailyBudgetMinor?: number
}

export interface WriteVerificationResult {
  status: 'verified' | 'failed'
  detail: string
}

export async function runWriteVerification(input: RunWriteVerificationInput): Promise<WriteVerificationResult> {
  const capabilityFlag = input.action === 'pause_campaign' ? input.connector.descriptor.capabilities.pauseCampaign : input.connector.descriptor.capabilities.setBudget
  const gate = checkWriteVerificationGates({
    targetExternalCampaignId: input.targetExternalCampaignId,
    isConfigured: input.connector.isConfigured(),
    connectorLabel: input.connector.descriptor.label,
    action: input.action,
    capabilityImplemented: capabilityFlag,
    dailyBudgetMinor: input.dailyBudgetMinor,
  })
  if (!gate.ok) {
    return { status: 'failed', detail: gate.reason }
  }

  const idempotencyKey = `write-verification:${randomUUID()}`
  const writeResult = input.action === 'pause_campaign'
    ? await input.connector.pauseCampaign({ externalCampaignId: input.targetExternalCampaignId, idempotencyKey })
    : await input.connector.setCampaignBudget({ externalCampaignId: input.targetExternalCampaignId, idempotencyKey, dailyBudgetMinor: input.dailyBudgetMinor! })

  let result: WriteVerificationResult
  if (!writeResult.ok) {
    result = { status: 'failed', detail: `${writeResult.error.reason}: ${writeResult.error.detail}` }
  } else if (!input.connector.descriptor.capabilities.verifyWrites) {
    // The write itself was accepted, but this connector cannot read it
    // back — never claim "verified" from an unconfirmed write, the same
    // SUBMIT -> VERIFY discipline the real execution pipeline follows.
    result = { status: 'failed', detail: 'The write was accepted, but this connector cannot verify writes (capabilities.verifyWrites is false) — an accepted write is not the same as a confirmed one.' }
  } else {
    const verifyResult = await input.connector.verifyCampaignState(input.targetExternalCampaignId)
    if (!verifyResult.ok) {
      result = { status: 'failed', detail: `The write was accepted, but reading it back failed: ${verifyResult.error}` }
    } else {
      const matches = input.action === 'pause_campaign'
        ? verifyResult.value.status === 'paused'
        : verifyResult.value.dailyBudgetMinor === input.dailyBudgetMinor
      result = matches
        ? { status: 'verified', detail: `Verified: the provider's own state now reflects the "${input.action}" write.` }
        : { status: 'failed', detail: 'The write was accepted, but the provider\'s own state does not reflect it.' }
    }
  }

  const supabase = createServiceSupabase()
  await supabase.from('advertising_connections').upsert(
    {
      org_id: input.orgId,
      provider: input.connector.descriptor.platform,
      write_verification_status: result.status,
      write_verified_at: new Date().toISOString(),
      write_verification_detail: result.detail,
    } as never,
    { onConflict: 'org_id,provider' },
  )

  await recordAudit({
    orgId: input.orgId,
    action: 'ADVERTISING_WRITE_VERIFICATION_RUN',
    entityType: 'advertising_connection',
    entityId: input.connector.descriptor.platform,
    actorType: 'user',
    result: result.status === 'verified' ? 'success' : 'failure',
    reason: result.detail,
    metadata: { action: input.action, status: result.status },
  })

  return result
}
