import { evaluateOrderAutomation } from '../orderAutomation'
import type { AutomationStore, JobRecord } from '../store'
import type { JobHandlerResult } from '../worker'
import type { OrderPipelineInput } from '@/lib/orders/pipeline'

export interface OrderProcessingPayload {
  input: OrderPipelineInput
  supplierSpendAlreadyTodayMinor: number
}

function isOrderProcessingPayload(p: Record<string, unknown>): boolean {
  return typeof p.input === 'object' && p.input !== null && typeof p.supplierSpendAlreadyTodayMinor === 'number'
}

/**
 * ORDER_PROCESSING: threads directly into `orderAutomation.ts`
 * (Milestone 6), which itself threads into `runOrderPipeline` (Milestone 5)
 * — no order logic is duplicated here. This handler's only job is the
 * event-to-job-to-audit-to-notification plumbing around that existing call.
 */
export async function handleOrderProcessing(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isOrderProcessingPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for order_processing.', retryable: false }
  }
  const payload = job.payload as unknown as OrderProcessingPayload
  const settings = await store.getAutomationSettings(job.orgId)

  const result = evaluateOrderAutomation(payload.input, settings, payload.supplierSpendAlreadyTodayMinor)

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'submit_supplier_order',
    entityType: 'order',
    entityId: payload.input.orderId,
    reason: result.policy.reason,
    inputFacts: { ingestionOutcome: result.pipeline.ingestion.outcome },
    decision: { submissionOutcome: result.pipeline.submission.outcome, deliveryIssues: result.pipeline.deliveryIssues },
    policy: result.policy,
    automationLevel: payload.input.automationLevel,
    jobId: job.id,
  })
  if (created.alreadyExisted) return { succeeded: true }

  const notifyBase = { orgId: job.orgId, entityType: 'order', entityId: payload.input.orderId, dedupeKey: `action:${created.id}` }

  if (created.status === 'executing') {
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: 'order', entityId: payload.input.orderId })
    await store.notify({ ...notifyBase, severity: 'success', category: 'orders', title: `Order ${payload.input.orderId} submitted automatically`, body: result.policy.reason })
  } else if (created.status === 'requires_approval') {
    await store.proposeApproval({
      orgId: job.orgId, decisionType: 'submit_supplier_order', entityType: 'order', entityId: payload.input.orderId,
      title: `Fulfil order ${payload.input.orderId}`, detail: result.pipeline.submission.reason, reasoning: result.policy.reason,
      confidence: null, estimatedImpactMinor: payload.input.lineEconomics.supplierUnitCost.minor + payload.input.lineEconomics.supplierShipping.minor,
      automationLevelRequired: payload.input.automationLevel, riskLevel: result.policy.riskLevel, inputs: { orderId: payload.input.orderId },
      actionPayload: { actionType: 'submit_supplier_order', entityType: 'order', entityId: payload.input.orderId, reason: result.policy.reason, inputFacts: {} },
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })
    await store.notify({ ...notifyBase, severity: 'approval_required', category: 'orders', title: `Approval needed: order ${payload.input.orderId}`, body: result.policy.reason, actionUrl: '/approvals' })
  } else {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'orders', title: `Order ${payload.input.orderId} blocked`, body: result.policy.reason })
  }

  if (result.pipeline.deliveryIssues.length > 0) {
    await store.notify({ ...notifyBase, severity: 'warning', category: 'fulfilment', title: `Delivery issue for order ${payload.input.orderId}`, body: result.pipeline.deliveryIssues.map((i) => i.detail).join(' '), dedupeKey: `delivery:${payload.input.orderId}:${job.id}` })
  }

  return { succeeded: true }
}
