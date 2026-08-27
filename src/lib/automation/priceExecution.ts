import { assessPriceChange, type PriceChangeRequest } from './priceAutomation'
import { decisionBlocksExecution, decisionBlockReason } from '@/lib/products/decisionGate'
import type { AutomationStore } from './store'
import type { AutomationSettings } from './settingsTypes'
import type { PolicyResult } from './types'
import type { MarketplaceConnector } from '@/lib/marketplaces/connectors/types'
import type { ProductDecision } from '@/lib/core/domain'

/**
 * The safe price-action pipeline (Milestone 7 brief §6):
 *
 *   PRODUCT DECISION (this milestone's addition, checked first — see
 *   `products/decisionGate.ts`) -> FACT CHANGE -> PROFITABILITY
 *   RECALCULATION (assessPriceChange, unchanged from Milestone 6) ->
 *   POLICY (same call) -> APPROVAL IF REQUIRED -> PRICE UPDATE (SUBMIT)
 *   -> VERIFY -> RECONCILE -> AUDIT
 *
 * Nothing here recalculates profitability or re-derives the policy verdict
 * — `assessPriceChange` already does both, exactly as it did in Milestone 6.
 * What is new is everything *after* the policy allows the change: actually
 * calling the marketplace connector, checking its own reported state
 * afterwards rather than trusting the write call's response, and only then
 * updating our own `channel_products` record. Also new: a product whose
 * operator decision is not "add"/"test" never reaches `assessPriceChange`
 * at all — blocked before profitability is even computed, since the
 * product decision is the outermost gate, not a replacement for the
 * profitability/policy gate that follows it.
 */

export interface PriceExecutionInput {
  orgId: string
  channelProductId: string
  externalId: string
  request: PriceChangeRequest
  connector: MarketplaceConnector
  /** The operator's Commerce-OS decision for this product — checked before any profitability/policy assessment. */
  productDecision: ProductDecision
  /** One execution per real-world price change intent — a retried job must reuse the same key. */
  idempotencyKey: string
  jobId?: string
  correlationId?: string
}

export interface PriceExecutionResult {
  actionId: string
  /** What the policy decided, before any external call was attempted. */
  policyOutcome: 'allow_automatic' | 'require_approval' | 'block'
  /** Whether the change was actually submitted, verified and reconciled. */
  executed: boolean
}

const BLOCKED_BY_DECISION_POLICY = (decision: ProductDecision): PolicyResult => ({
  outcome: 'block',
  requirements: [{ key: 'product_decision', label: 'Commerce-OS product decision', satisfied: false, detail: decisionBlockReason(decision) }],
  reason: decisionBlockReason(decision),
  riskLevel: 'low',
})

export async function executePriceChange(input: PriceExecutionInput, settings: AutomationSettings, store: AutomationStore): Promise<PriceExecutionResult> {
  const assessment = decisionBlocksExecution(input.productDecision)
    ? {
        before: { netMarginPct: null },
        after: { netMarginPct: null },
        pctChange: 0,
        policy: BLOCKED_BY_DECISION_POLICY(input.productDecision),
      }
    : assessPriceChange(input.request, settings)

  const created = await store.createAutomationAction({
    orgId: input.orgId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actionType: 'update_price',
    entityType: 'channel_product',
    entityId: input.channelProductId,
    reason: assessment.policy.reason,
    inputFacts: { oldPriceMinor: input.request.costInputsBefore.sellingPrice.minor, newPriceMinor: input.request.newSellingPrice.minor, pctChange: assessment.pctChange },
    decision: { netMarginBeforePct: assessment.before.netMarginPct, netMarginAfterPct: assessment.after.netMarginPct },
    policy: assessment.policy,
    automationLevel: input.request.automationLevel,
    jobId: input.jobId,
  })

  if (created.alreadyExisted) {
    return { actionId: created.id, policyOutcome: assessment.policy.outcome, executed: created.status === 'succeeded' }
  }

  const notifyBase = { orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId, dedupeKey: `action:${created.id}` }

  if (created.status === 'blocked') {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'pricing', title: `Price change blocked for ${input.channelProductId}`, body: assessment.policy.reason })
    return { actionId: created.id, policyOutcome: 'block', executed: false }
  }

  if (created.status === 'requires_approval') {
    await store.proposeApproval({
      orgId: input.orgId,
      decisionType: 'update_price',
      entityType: 'channel_product',
      entityId: input.channelProductId,
      title: `Price change for ${input.channelProductId}`,
      detail: `${input.request.productTitle}: net margin ${(assessment.before.netMarginPct ?? 0).toFixed(1)}% -> ${(assessment.after.netMarginPct ?? 0).toFixed(1)}%.`,
      reasoning: assessment.policy.reason,
      confidence: null,
      estimatedImpactMinor: Math.abs(input.request.newSellingPrice.minor - input.request.costInputsBefore.sellingPrice.minor),
      automationLevelRequired: input.request.automationLevel,
      riskLevel: assessment.policy.riskLevel,
      inputs: { oldPriceMinor: input.request.costInputsBefore.sellingPrice.minor, newPriceMinor: input.request.newSellingPrice.minor },
      actionPayload: {
        actionType: 'update_price',
        entityType: 'channel_product',
        entityId: input.channelProductId,
        reason: assessment.policy.reason,
        // `productTitle` (Milestone 16) is the structured value
        // `automation/handlers/priceApprovalExecutor.ts` needs at
        // execution time — this path's `entityType: 'channel_product'`
        // already resolves `channel`/`externalId` fresh from
        // `channel_products` itself, so neither is needed here.
        inputFacts: { externalId: input.externalId, newPriceMinor: input.request.newSellingPrice.minor, productTitle: input.request.productTitle },
      },
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    await store.notify({ ...notifyBase, severity: 'approval_required', category: 'pricing', title: `Approval needed: price change for ${input.channelProductId}`, body: assessment.policy.reason, actionUrl: '/approvals' })
    return { actionId: created.id, policyOutcome: 'require_approval', executed: false }
  }

  // Permitted automatically. SUBMIT -> VERIFY -> RECONCILE, extracted into
  // `submitPriceChangeAction` below so the approval-execution dispatcher
  // (Milestone 16) can call the identical tail for a price change that was
  // approved rather than auto-permitted, against an existing
  // `automationActionId`, without duplicating this logic.
  const result = await submitPriceChangeAction(
    {
      orgId: input.orgId,
      channelProductId: input.channelProductId,
      externalId: input.externalId,
      productTitle: input.request.productTitle,
      newPriceMinor: input.request.newSellingPrice.minor,
      pctChange: assessment.pctChange,
      connector: input.connector,
      automationActionId: created.id,
      idempotencyKey: input.idempotencyKey,
    },
    store,
  )

  return { actionId: created.id, policyOutcome: 'allow_automatic', executed: result.executed }
}

export interface PriceSubmitInput {
  orgId: string
  channelProductId: string
  externalId: string
  productTitle: string
  newPriceMinor: number
  /** For the success notification's wording only — computed once by the caller (`assessPriceChange`/`assessPriceChangePolicy`), never re-derived here. */
  pctChange: number
  connector: MarketplaceConnector
  automationActionId: string
  idempotencyKey: string
}

export interface PriceSubmitResult {
  executed: boolean
}

/**
 * SUBMIT -> VERIFY -> RECONCILE for one already-decided price change —
 * "already decided" meaning either `executePriceChange` above (policy just
 * returned `allow_automatic`) or the approval-execution dispatcher
 * (`automation/executionDispatch.ts`, Milestone 16) calling this against an
 * `automation_actions` row an owner has just approved. Identical mechanics
 * either way: this function does not know or care which caller it is.
 */
export async function submitPriceChangeAction(input: PriceSubmitInput, store: AutomationStore): Promise<PriceSubmitResult> {
  const notifyBase = { orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId, dedupeKey: `action:${input.automationActionId}` }

  if (!input.connector.descriptor.capabilities.writeListings) {
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: 'This connector does not support listing price writes.',
      orgId: input.orgId,
      entityType: 'channel_product',
      entityId: input.channelProductId,
      verificationStatus: 'not_applicable',
      reconciliationStatus: 'not_applicable',
    })
    await store.notify({ ...notifyBase, severity: 'critical', category: 'pricing', title: `Price change could not be submitted for ${input.channelProductId}`, body: 'The connector does not support this write.' })
    return { executed: false }
  }

  const writeResult = await input.connector.updateListingPrice({
    externalId: input.externalId,
    priceMinor: input.newPriceMinor,
    idempotencyKey: input.idempotencyKey,
  })

  if (!writeResult.ok) {
    await store.completeAutomationAction(input.automationActionId, {
      succeeded: false,
      error: `${writeResult.error.reason}: ${writeResult.error.detail}`,
      orgId: input.orgId,
      entityType: 'channel_product',
      entityId: input.channelProductId,
      verificationStatus: 'failed',
      reconciliationStatus: 'not_applicable',
    })
    await store.notify({ ...notifyBase, severity: 'warning', category: 'pricing', title: `Price update rejected for ${input.channelProductId}`, body: writeResult.error.detail })
    return { executed: false }
  }

  // VERIFY — never assume the write call's own "accepted" response is proof; read it back.
  let verified = false
  let verificationStatus: 'verified' | 'failed' | 'uncertain' = 'uncertain'
  if (input.connector.descriptor.capabilities.verifyWrites) {
    const verifyResult = await input.connector.verifyListingState(input.externalId)
    if (verifyResult.ok && verifyResult.value.priceMinor === input.newPriceMinor) {
      verified = true
      verificationStatus = 'verified'
    } else if (verifyResult.ok) {
      verificationStatus = 'failed' // The marketplace's own state disagrees with what we submitted.
    }
  }

  // RECONCILE — only ever applies a change we have actually confirmed.
  if (verified) {
    await store.reconcileChannelProduct({ orgId: input.orgId, channelProductId: input.channelProductId, priceMinor: input.newPriceMinor })
  }

  await store.completeAutomationAction(input.automationActionId, {
    succeeded: verified,
    error: verified ? null : 'The write was submitted, but the marketplace could not be confirmed to reflect it.',
    orgId: input.orgId,
    entityType: 'channel_product',
    entityId: input.channelProductId,
    externalRef: writeResult.value.externalRef,
    verificationStatus,
    reconciliationStatus: verified ? 'matched' : verificationStatus === 'failed' ? 'discrepancy' : 'pending',
  })

  await store.notify({
    ...notifyBase,
    severity: verified ? 'success' : 'warning',
    category: 'pricing',
    title: verified ? `Price updated for ${input.channelProductId}` : `Price update unverified for ${input.channelProductId}`,
    body: verified
      ? `${input.productTitle}: ${input.pctChange >= 0 ? '+' : ''}${input.pctChange.toFixed(1)}%.`
      : 'Submitted to the marketplace, but its own reported state could not be confirmed to match. Treated as unverified, not as failed or succeeded.',
  })

  return { executed: verified }
}
