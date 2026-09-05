import { assessPriceChange, type PriceChangeRequest } from './priceAutomation'
import type { AutomationSettings } from './settingsTypes'
import type { PolicyResult } from './types'

/**
 * Generic dry-run capability (Milestone: automation control plane).
 *
 * Every write-capable action this codebase will ever add should be able to
 * answer "what would you do?" without doing it — no connector call, no
 * `automation_actions` row, no audit entry, nothing external or persisted.
 * A dry run is exactly the same domain + policy evaluation a real execution
 * already performs (`assessPriceChange`, `assembleShopifyPublicationPreview`
 * + `buildShopifyProductPayload`, etc.) with the write call itself simply
 * never reached — this module does not duplicate any of that decision
 * logic, it only shapes the result into one consistent, inspectable type.
 */

export interface DryRunResult<TPayload = unknown> {
  /** Whether this would proceed at all — automatically or via approval. `false` only when the policy outcome is `'block'`. */
  eligible: boolean
  /** Whether this would execute immediately, with no human in the loop, if this were a real call right now. */
  wouldExecuteAutomatically: boolean
  /** The exact payload that WOULD be sent to the external system. `null` when blocked before a payload could be meaningfully built. */
  payload: TPayload | null
  /** The full policy result — every requirement checked, satisfied or not, for full auditability of the dry run itself. */
  policy: PolicyResult
  /** Plain-English reasons this is blocked or held for approval — empty when `wouldExecuteAutomatically` is `true`. */
  blockingReasons: readonly string[]
  /** One human-readable sentence describing what happens next. */
  expectedResult: string
}

function describeExpectedResult(policy: PolicyResult): string {
  if (policy.outcome === 'allow_automatic') return 'Would execute immediately: submit, verify, and reconcile.'
  if (policy.outcome === 'require_approval') return 'Would be sent for owner approval before executing.'
  return 'Would not execute — blocked.'
}

function buildResult<TPayload>(policy: PolicyResult, payload: TPayload | null): DryRunResult<TPayload> {
  return {
    eligible: policy.outcome !== 'block',
    wouldExecuteAutomatically: policy.outcome === 'allow_automatic',
    payload: policy.outcome === 'block' ? null : payload,
    policy,
    blockingReasons: policy.requirements.filter((r) => !r.satisfied).map((r) => r.detail),
    expectedResult: describeExpectedResult(policy),
  }
}

export interface PriceChangeDryRunPayload {
  externalId?: string
  newPriceMinor: number
}

/**
 * Dry-runs a price change exactly as `executePriceChange`
 * (`priceExecution.ts`) would assess it, without creating an
 * `automation_actions` row, notifying anyone, or calling a connector.
 */
export function dryRunPriceChange(request: PriceChangeRequest, settings: AutomationSettings, externalId?: string): DryRunResult<PriceChangeDryRunPayload> {
  const assessment = assessPriceChange(request, settings)
  return buildResult(assessment.policy, { externalId, newPriceMinor: request.newSellingPrice.minor })
}

export { buildResult as buildDryRunResult, describeExpectedResult }
