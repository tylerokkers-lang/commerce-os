import { evaluateSupplierSwitchAutomation, type SupplierSwitchAutomationInput } from './supplierSwitching'
import type { AutomationStore } from './store'
import type { AutomationSettings } from './settingsTypes'

/**
 * Completes the supplier redundancy flow (Milestone 7 brief §4): Milestone 3
 * built the evaluator, Milestone 6 built the automation-policy layer around
 * it (`supplierSwitching.ts`, unchanged here), and this is the missing
 * "then execute the change" step.
 *
 * "Executing" a supplier switch is, honestly, an internal action: there is
 * no external "switch my supplier" API — the real-world effect of this
 * decision is which supplier the *next* purchase order goes to, and that is
 * governed entirely by our own `channel_products.fulfilment_supplier_id`.
 * So the execution here is a real, verified write to our own database
 * (`store.reconcileChannelProduct`), not a marketplace call — attempting to
 * dress this up as an external write would be exactly the kind of fake
 * integration this project's principles forbid.
 */

export interface SupplierSwitchExecutionInput {
  orgId: string
  channelProductId: string
  request: SupplierSwitchAutomationInput['request']
  previousUnitCostPlusShippingMinor: number
  idempotencyKey: string
  jobId?: string
  correlationId?: string
}

export interface SupplierSwitchExecutionResult {
  actionId: string
  policyOutcome: 'allow_automatic' | 'require_approval' | 'block'
  executed: boolean
}

export async function executeSupplierSwitch(
  input: SupplierSwitchExecutionInput,
  settings: AutomationSettings,
  store: AutomationStore,
): Promise<SupplierSwitchExecutionResult> {
  const result = evaluateSupplierSwitchAutomation({
    request: input.request,
    previousUnitCostPlusShippingMinor: input.previousUnitCostPlusShippingMinor,
    settings,
  })

  const created = await store.createAutomationAction({
    orgId: input.orgId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    actionType: 'switch_supplier',
    entityType: 'channel_product',
    entityId: input.channelProductId,
    reason: result.policy.reason,
    inputFacts: { reason: input.request.reason, previousUnitCostPlusShippingMinor: input.previousUnitCostPlusShippingMinor },
    decision: { redundancyOutcome: result.redundancy.outcome, recommendedSupplierId: result.redundancy.recommended?.candidate.id ?? null },
    policy: result.policy,
    automationLevel: input.request.automationLevel,
    jobId: input.jobId,
  })

  if (created.alreadyExisted) {
    return { actionId: created.id, policyOutcome: result.policy.outcome, executed: created.status === 'succeeded' }
  }

  const notifyBase = { orgId: input.orgId, entityType: 'channel_product', entityId: input.channelProductId, dedupeKey: `action:${created.id}` }

  if (created.status === 'blocked') {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'supplier', title: `Supplier switch blocked for ${input.channelProductId}`, body: result.policy.reason })
    return { actionId: created.id, policyOutcome: 'block', executed: false }
  }

  if (created.status === 'requires_approval') {
    await store.proposeApproval({
      orgId: input.orgId,
      decisionType: 'switch_supplier',
      entityType: 'channel_product',
      entityId: input.channelProductId,
      title: `Switch supplier for ${input.channelProductId}`,
      detail: result.redundancy.recommended ? `Recommend switching to ${result.redundancy.recommended.candidate.name}.` : 'No recommended alternative could be selected automatically.',
      reasoning: result.policy.reason,
      confidence: null,
      estimatedImpactMinor: result.redundancy.recommended
        ? result.redundancy.recommended.candidate.signals.unitCost.minor + result.redundancy.recommended.candidate.signals.shippingCost.minor
        : null,
      automationLevelRequired: input.request.automationLevel,
      riskLevel: result.policy.riskLevel,
      inputs: { previousUnitCostPlusShippingMinor: input.previousUnitCostPlusShippingMinor },
      actionPayload: {
        actionType: 'switch_supplier',
        entityType: 'channel_product',
        entityId: input.channelProductId,
        reason: result.redundancy.reason,
        inputFacts: { recommendedSupplierId: result.redundancy.recommended?.candidate.id ?? null },
      },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    await store.notify({ ...notifyBase, severity: 'approval_required', category: 'supplier', title: `Approval needed: supplier switch for ${input.channelProductId}`, body: result.policy.reason, actionUrl: '/approvals' })
    return { actionId: created.id, policyOutcome: 'require_approval', executed: false }
  }

  // Permitted automatically. Execute: our own record is the only "external" state here.
  const chosenSupplierId = result.redundancy.recommended?.candidate.id
  if (!chosenSupplierId) {
    await store.completeAutomationAction(created.id, {
      succeeded: false,
      error: 'Policy permitted an automatic switch, but no recommended alternative was present to switch to.',
      orgId: input.orgId,
      entityType: 'channel_product',
      entityId: input.channelProductId,
    })
    return { actionId: created.id, policyOutcome: 'allow_automatic', executed: false }
  }

  await store.reconcileChannelProduct({ orgId: input.orgId, channelProductId: input.channelProductId, fulfilmentSupplierId: chosenSupplierId })
  await store.completeAutomationAction(created.id, {
    succeeded: true,
    orgId: input.orgId,
    entityType: 'channel_product',
    entityId: input.channelProductId,
    verificationStatus: 'not_applicable', // No external write was made to verify — see the module comment above.
    reconciliationStatus: 'matched',
  })
  await store.notify({ ...notifyBase, severity: 'success', category: 'supplier', title: `Supplier switched for ${input.channelProductId}`, body: result.redundancy.reason })

  return { actionId: created.id, policyOutcome: 'allow_automatic', executed: true }
}
