import { advertisingWriteVerificationEnabled } from '@/lib/core/env'
import type { WriteVerificationAction } from './writeVerification'

/**
 * The pure gate-checking half of Phase 8's four safety requirements,
 * split out of `writeVerification.ts` (which is `server-only`, for the
 * connector-call and persistence half) so these checks — the actual
 * safety-critical logic — are directly unit-testable. Every one of the
 * four gates the brief lists is checked here, in order, any one failing
 * short-circuits the rest.
 */

export interface WriteVerificationGateInput {
  isEnabled: boolean
  targetExternalCampaignId: string
  isConfigured: boolean
  connectorLabel: string
  action: WriteVerificationAction
  capabilityImplemented: boolean
  dailyBudgetMinor?: number
}

export type WriteVerificationGateResult = { ok: true } | { ok: false; reason: string }

export function checkWriteVerificationGatesPure(input: WriteVerificationGateInput): WriteVerificationGateResult {
  if (!input.isEnabled) {
    return { ok: false, reason: 'Write verification is disabled (ADVERTISING_WRITE_VERIFICATION_ENABLED is not "true"). It is never enabled by default.' }
  }
  if (!input.targetExternalCampaignId || input.targetExternalCampaignId.trim().length === 0) {
    return { ok: false, reason: 'No target campaign was explicitly designated — write verification never infers or guesses a target.' }
  }
  if (!input.isConfigured) {
    return { ok: false, reason: `${input.connectorLabel} is not configured — cannot verify a write against a connector with no real credentials.` }
  }
  if (!input.capabilityImplemented) {
    return { ok: false, reason: `${input.connectorLabel} does not declare "${input.action}" as implemented.` }
  }
  if (input.action === 'set_budget' && (input.dailyBudgetMinor === undefined || input.dailyBudgetMinor <= 0)) {
    return { ok: false, reason: 'A positive dailyBudgetMinor must be explicitly provided to verify a budget write.' }
  }
  return { ok: true }
}

/** Thin wrapper reading the live env flag — what `writeVerification.ts` actually calls. */
export function checkWriteVerificationGates(input: Omit<WriteVerificationGateInput, 'isEnabled'>): WriteVerificationGateResult {
  return checkWriteVerificationGatesPure({ ...input, isEnabled: advertisingWriteVerificationEnabled() })
}
