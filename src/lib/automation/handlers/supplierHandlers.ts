import { evaluateSupplierSwitchAutomation } from '../supplierSwitching'
import { executeSupplierSwitch, type SupplierSwitchExecutionInput } from '../supplierSwitchExecution'
import { assessStockLevel, decideStockShortfallAction } from '../inventoryAutomation'
import type { AutomationStore, JobRecord } from '../store'
import type { JobHandlerResult } from '../worker'
import type { RedundancyRequest } from '@/lib/suppliers/redundancy'

/**
 * The payload a `supplier_availability_check` job carries — everything the
 * handler needs is passed in at enqueue time (the "facts loaded" step of
 * the brief's §1 pipeline). Assembling this payload from *live* product,
 * supplier and channel rows is the data-plumbing task Milestone 6 left
 * honestly undone; a caller (a future live event handler, or the
 * demo/e2e-test harness) that already has this shape can use this job type
 * today.
 */
export interface SupplierAvailabilityCheckPayload {
  entityType: string
  entityId: string
  request: RedundancyRequest
  previousUnitCostPlusShippingMinor: number
}

function isSupplierAvailabilityCheckPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.entityId === 'string' && typeof payload.entityType === 'string' && typeof payload.request === 'object' && payload.request !== null
}

/**
 * EVENT -> JOB CREATED -> WORKER PICKS UP JOB -> FACTS LOADED (from the job
 * payload) -> PROFITABILITY CHECK + COMPLIANCE CHECK (inside
 * `evaluateSupplierRedundancy`, which this composes via
 * `evaluateSupplierSwitchAutomation`) -> AUTOMATION POLICY
 * (`policyEngine.ts`, inside the same call) -> ACTION EXECUTION -> RESULT
 * VERIFICATION -> AUDIT EVENT -> NOTIFICATION.
 *
 * This is a *check*, not an execution: it records what the engine would do,
 * for visibility, without touching `channel_products`. `handleSupplierSwitch`
 * below is the execution counterpart.
 */
export async function handleSupplierAvailabilityCheck(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isSupplierAvailabilityCheckPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for supplier_availability_check.', retryable: false }
  }
  const payload = job.payload as unknown as SupplierAvailabilityCheckPayload
  const settings = await store.getAutomationSettings(job.orgId)

  const result = evaluateSupplierSwitchAutomation({
    request: payload.request,
    previousUnitCostPlusShippingMinor: payload.previousUnitCostPlusShippingMinor,
    settings,
  })

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    correlationId: job.correlationId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'switch_supplier',
    entityType: payload.entityType,
    entityId: payload.entityId,
    reason: result.policy.reason,
    inputFacts: { request: payload.request as unknown as Record<string, unknown>, previousUnitCostPlusShippingMinor: payload.previousUnitCostPlusShippingMinor },
    decision: { redundancy: result.redundancy as unknown as Record<string, unknown> },
    policy: result.policy,
    automationLevel: payload.request.automationLevel,
    actorType: 'system',
    jobId: job.id,
  })

  if (created.alreadyExisted) return { succeeded: true }

  const notifyBase = { orgId: job.orgId, entityType: payload.entityType, entityId: payload.entityId, dedupeKey: `action:${created.id}` }

  if (created.status === 'executing') {
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: payload.entityType, entityId: payload.entityId })
    await store.notify({ ...notifyBase, severity: 'success', category: 'supplier', title: `Supplier switch permitted for ${payload.entityId}`, body: result.redundancy.reason })
  } else if (created.status === 'requires_approval') {
    await store.proposeApproval({
      orgId: job.orgId,
      decisionType: 'switch_supplier',
      entityType: payload.entityType,
      entityId: payload.entityId,
      title: `Switch supplier for ${payload.entityId}`,
      detail: result.redundancy.recommended ? `Recommend switching to ${result.redundancy.recommended.candidate.name}.` : 'No recommended alternative could be selected automatically.',
      reasoning: result.policy.reason,
      confidence: null,
      estimatedImpactMinor: result.redundancy.recommended ? result.redundancy.recommended.candidate.signals.unitCost.minor + result.redundancy.recommended.candidate.signals.shippingCost.minor : null,
      automationLevelRequired: payload.request.automationLevel,
      riskLevel: result.policy.riskLevel,
      inputs: { request: payload.request as unknown as Record<string, unknown>, previousUnitCostPlusShippingMinor: payload.previousUnitCostPlusShippingMinor },
      actionPayload: { actionType: 'switch_supplier', entityType: payload.entityType, entityId: payload.entityId, reason: result.redundancy.reason, inputFacts: { request: payload.request as unknown as Record<string, unknown> } },
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    await store.notify({ ...notifyBase, severity: 'approval_required', category: 'supplier', title: `Approval needed: supplier switch for ${payload.entityId}`, body: result.policy.reason, actionUrl: '/approvals' })
  } else {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'supplier', title: `Supplier switch blocked for ${payload.entityId}`, body: result.policy.reason })
  }

  return { succeeded: true }
}

export interface SupplierSwitchJobPayload {
  channelProductId: string
  request: RedundancyRequest
  previousUnitCostPlusShippingMinor: number
}

function isSupplierSwitchJobPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.channelProductId === 'string' && typeof payload.request === 'object' && payload.request !== null
}

/** The execution counterpart to the check above — actually writes the switch to `channel_products` when permitted (brief §4). */
export async function handleSupplierSwitch(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isSupplierSwitchJobPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for supplier_switch.', retryable: false }
  }
  const payload = job.payload as unknown as SupplierSwitchJobPayload
  const settings = await store.getAutomationSettings(job.orgId)

  const input: SupplierSwitchExecutionInput = {
    orgId: job.orgId,
    channelProductId: payload.channelProductId,
    request: payload.request,
    previousUnitCostPlusShippingMinor: payload.previousUnitCostPlusShippingMinor,
    idempotencyKey: `job:${job.id}`,
    jobId: job.id,
    correlationId: job.correlationId,
  }
  await executeSupplierSwitch(input, settings, store)
  return { succeeded: true }
}

export interface SupplierPriceChangeJobPayload {
  productId: string
  supplierId: string
  channelProductId: string
  previousUnitCostMinor: number
  newUnitCostMinor: number
  /** The job to raise for a human/engine to actually re-check profitability with this new cost. */
  followUpJobType?: string
}

function isSupplierPriceChangeJobPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.productId === 'string' && typeof payload.supplierId === 'string' && typeof payload.channelProductId === 'string' && typeof payload.newUnitCostMinor === 'number'
}

/**
 * SUPPLIER_PRICE_CHANGE: an event handler, not a decision engine — its job
 * is to notice a cost change happened and chain into the engine that
 * actually knows what to do about it (`product_profitability_recheck`),
 * per the brief's "handlers orchestrate existing engines" rule. It never
 * recalculates profitability itself.
 */
export async function handleSupplierPriceChange(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isSupplierPriceChangeJobPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for supplier_price_change.', retryable: false }
  }
  const payload = job.payload as unknown as SupplierPriceChangeJobPayload
  const changePct = payload.previousUnitCostMinor > 0 ? ((payload.newUnitCostMinor - payload.previousUnitCostMinor) / payload.previousUnitCostMinor) * 100 : 0

  await store.recordAudit({
    orgId: job.orgId,
    action: 'AUTOMATION_ACTION_CREATED',
    entityType: 'supplier_product',
    entityId: `${payload.supplierId}:${payload.productId}`,
    actorType: 'system',
    reason: `Supplier cost changed ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% (£${(payload.previousUnitCostMinor / 100).toFixed(2)} -> £${(payload.newUnitCostMinor / 100).toFixed(2)}); queued a profitability re-check.`,
  })

  await store.enqueueJob({
    orgId: job.orgId,
    jobType: 'product_profitability_recheck',
    payload: { productId: payload.productId, supplierId: payload.supplierId, channelProductId: payload.channelProductId, triggeredBy: 'supplier_price_change' },
    idempotencyKey: `price-recheck:${payload.productId}:${payload.supplierId}:${job.id}`,
    correlationId: job.correlationId,
  })

  return { succeeded: true }
}

export interface SupplierStockChangeJobPayload {
  channelProductId: string
  entityId: string
  productTitle: string
  availableUnits: number
  lowStockThreshold: number
  hasCompliantAlternativeSupplier: boolean
}

function isSupplierStockChangeJobPayload(payload: Record<string, unknown>): boolean {
  return typeof payload.channelProductId === 'string' && typeof payload.availableUnits === 'number'
}

/**
 * SUPPLIER_STOCK_CHANGE: composes `inventoryAutomation.ts` (unchanged) to
 * decide warn / evaluate-alternative / pause, and chains into
 * `product_pause` or `supplier_switch` where the decision calls for it —
 * never pausing or switching directly itself.
 */
export async function handleSupplierStockChange(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isSupplierStockChangeJobPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for supplier_stock_change.', retryable: false }
  }
  const payload = job.payload as unknown as SupplierStockChangeJobPayload
  const settings = await store.getAutomationSettings(job.orgId)
  const alertLevel = assessStockLevel(payload.availableUnits, payload.lowStockThreshold)

  const decision = decideStockShortfallAction({
    productTitle: payload.productTitle,
    alertLevel,
    hasCompliantAlternativeSupplier: payload.hasCompliantAlternativeSupplier,
    automationLevel: settings.automationLevel,
    settings,
  })

  if (decision.action === 'none' || decision.action === 'warn') {
    if (decision.action === 'warn') {
      await store.notify({ orgId: job.orgId, severity: 'warning', category: 'inventory', title: `Low stock: ${payload.productTitle}`, body: decision.reason, entityType: 'channel_product', entityId: payload.channelProductId })
    }
    return { succeeded: true }
  }

  if (decision.action === 'evaluate_alternative_supplier') {
    await store.recordAudit({ orgId: job.orgId, action: 'AUTOMATION_ACTION_CREATED', entityType: 'channel_product', entityId: payload.channelProductId, actorType: 'system', reason: decision.reason })
    return { succeeded: true } // A compliant alternative exists; a supplier_switch job is expected to be raised by the caller that knows the alternative's details.
  }

  // pause_listing
  await store.enqueueJob({
    orgId: job.orgId,
    jobType: 'product_pause',
    payload: { channelProductId: payload.channelProductId, entityId: payload.entityId, productTitle: payload.productTitle, reason: decision.policy.reason },
    idempotencyKey: `pause:${payload.channelProductId}:${job.id}`,
    correlationId: job.correlationId,
  })
  return { succeeded: true }
}
