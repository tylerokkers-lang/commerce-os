import { reconcileInventory, reconcileListings, summariseDiscrepancies, type OurInventoryRecord, type OurListingRecord } from '@/lib/marketplaces/reconciliation'
import { assessDeliveryHealth, type ShipmentRecord } from '@/lib/fulfilment/tracking'
import type { AutomationStore, JobRecord } from '../store'
import type { FactsLoader } from '../factsTypes'
import type { JobHandlerResult, ConnectorLookup } from '../worker'

export interface MarketplaceListingSyncPayload {
  connectorKey: string
  ours: readonly OurListingRecord[]
}

function isListingSyncPayload(p: Record<string, unknown>): boolean {
  return typeof p.connectorKey === 'string' && Array.isArray(p.ours)
}

/**
 * MARKETPLACE_LISTING_SYNC: reads the marketplace's own state via the real
 * connector interface and compares it with our records using
 * `reconciliation.ts` (Milestone 4, unchanged) — never resolving a
 * discrepancy by picking a side. Our own listing snapshot (`ours`) is
 * supplied by the caller for now; a live query joining `channel_products`
 * per listing is the same honestly-scoped future work noted throughout
 * this file.
 */
export async function handleMarketplaceListingSync(job: JobRecord, store: AutomationStore, _facts: FactsLoader, connectors: ConnectorLookup): Promise<JobHandlerResult> {
  if (!isListingSyncPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for marketplace_listing_sync.', retryable: false }
  }
  const payload = job.payload as unknown as MarketplaceListingSyncPayload
  const connector = connectors(payload.connectorKey)
  if (!connector) return { succeeded: false, error: `No connector registered for "${payload.connectorKey}".`, retryable: false }

  const fetched = await connector.fetchListings({ limit: 250 })
  if (!fetched.ok) {
    return { succeeded: false, error: fetched.error, retryable: true } // A transient connector failure; safe to retry with backoff.
  }

  const discrepancies = reconcileListings(payload.ours, fetched.value.records)
  const summary = summariseDiscrepancies(discrepancies, payload.ours.length)

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'reconcile_marketplace',
    entityType: 'channel',
    entityId: payload.connectorKey,
    reason: discrepancies.length === 0 ? `${payload.ours.length} listings checked; all match.` : `${discrepancies.length} of ${payload.ours.length} listings disagree with the marketplace.`,
    inputFacts: { checkedCount: payload.ours.length },
    decision: { summary: summary as unknown as Record<string, unknown> },
    policy: { outcome: 'allow_automatic', requirements: [], reason: 'Reconciliation is read-only; nothing requires permission to check.', riskLevel: discrepancies.length > 0 ? 'medium' : 'low' },
    automationLevel: (await store.getAutomationSettings(job.orgId)).automationLevel,
    jobId: job.id,
  })
  if (!created.alreadyExisted) {
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: 'channel', entityId: payload.connectorKey, reconciliationStatus: discrepancies.length > 0 ? 'discrepancy' : 'matched' })
    if (discrepancies.length > 0) {
      await store.notify({ orgId: job.orgId, severity: 'warning', category: 'marketplace', title: `${discrepancies.length} listing discrepancies found`, body: `Channel "${payload.connectorKey}": ${discrepancies.map((d) => `${d.channelProductRef} ${d.field}`).join(', ')}`, dedupeKey: `action:${created.id}` })
    }
  }

  return { succeeded: true }
}

export interface FulfilmentUpdatePayload {
  connectorKey: string
  externalOrderId: string
  carrier: string
  trackingNumber: string
  entityId: string
}

function isFulfilmentUpdatePayload(p: Record<string, unknown>): boolean {
  return typeof p.connectorKey === 'string' && typeof p.externalOrderId === 'string' && typeof p.trackingNumber === 'string'
}

/** FULFILMENT_UPDATE: SUBMIT via the existing `submitFulfilmentUpdate` connector method (Milestone 5) — no new write path invented. */
export async function handleFulfilmentUpdate(job: JobRecord, store: AutomationStore, _facts: FactsLoader, connectors: ConnectorLookup): Promise<JobHandlerResult> {
  if (!isFulfilmentUpdatePayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for fulfilment_update.', retryable: false }
  }
  const payload = job.payload as unknown as FulfilmentUpdatePayload
  const connector = connectors(payload.connectorKey)
  if (!connector) return { succeeded: false, error: `No connector registered for "${payload.connectorKey}".`, retryable: false }

  const settings = await store.getAutomationSettings(job.orgId)
  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'update_fulfilment',
    entityType: 'order',
    entityId: payload.entityId,
    reason: `Submitting tracking ${payload.trackingNumber} (${payload.carrier}) for order ${payload.externalOrderId}.`,
    inputFacts: { externalOrderId: payload.externalOrderId, carrier: payload.carrier, trackingNumber: payload.trackingNumber },
    decision: {},
    policy: { outcome: 'allow_automatic', requirements: [], reason: 'Tracking submission does not carry a financial or listing risk requiring approval.', riskLevel: 'low' },
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (created.alreadyExisted) return { succeeded: true }

  const result = await connector.submitFulfilmentUpdate({ externalOrderId: payload.externalOrderId, carrier: payload.carrier, trackingNumber: payload.trackingNumber, idempotencyKey: `job:${job.id}` })

  if (!result.ok) {
    await store.completeAutomationAction(created.id, { succeeded: false, error: result.error, orgId: job.orgId, entityType: 'order', entityId: payload.entityId, verificationStatus: 'failed' })
    await store.notify({ orgId: job.orgId, severity: 'warning', category: 'fulfilment', title: `Tracking submission failed for order ${payload.externalOrderId}`, body: result.error, dedupeKey: `action:${created.id}` })
    return { succeeded: true } // The job ran to completion and correctly recorded a failed submission — not a job-engine failure.
  }

  await store.completeAutomationAction(created.id, {
    succeeded: result.value.accepted,
    error: result.value.accepted ? null : 'Marketplace did not accept the fulfilment update.',
    orgId: job.orgId,
    entityType: 'order',
    entityId: payload.entityId,
    externalRef: result.value.marketplaceReference,
    // No read-back call exists for a fulfilment record in any connector yet
    // (Milestone 5's `submitFulfilmentUpdate` has no counterpart "read this
    // fulfilment back" method) — its own "accepted" response is the best
    // available signal, honestly marked `uncertain` rather than `verified`.
    verificationStatus: result.value.accepted ? 'uncertain' : 'failed',
  })
  await store.notify({ orgId: job.orgId, severity: result.value.accepted ? 'success' : 'warning', category: 'fulfilment', title: `Tracking submitted for order ${payload.externalOrderId}`, body: `Reference: ${result.value.marketplaceReference ?? 'none'}.`, dedupeKey: `action:${created.id}` })

  return { succeeded: true }
}

export interface TrackingCheckPayload {
  entityId: string
  shipment: ShipmentRecord
}

function isTrackingCheckPayload(p: Record<string, unknown>): boolean {
  return typeof p.entityId === 'string' && typeof p.shipment === 'object' && p.shipment !== null
}

/** TRACKING_CHECK: composes `assessDeliveryHealth` (Milestone 5, unchanged). */
export async function handleTrackingCheck(job: JobRecord, store: AutomationStore): Promise<JobHandlerResult> {
  if (!isTrackingCheckPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for tracking_check.', retryable: false }
  }
  const payload = job.payload as unknown as TrackingCheckPayload
  const issues = assessDeliveryHealth(payload.shipment)

  if (issues.length > 0) {
    await store.notify({
      orgId: job.orgId,
      severity: 'warning',
      category: 'fulfilment',
      title: `Delivery issue for order ${payload.entityId}`,
      body: issues.map((i) => i.detail).join(' '),
      entityType: 'order',
      entityId: payload.entityId,
      dedupeKey: `tracking:${payload.entityId}:${job.id}`,
    })
  }

  return { succeeded: true }
}

export interface MarketplaceReconciliationPayload {
  connectorKey: string
  ourInventory: readonly OurInventoryRecord[]
}

function isReconciliationPayload(p: Record<string, unknown>): boolean {
  return typeof p.connectorKey === 'string' && Array.isArray(p.ourInventory)
}

/** MARKETPLACE_RECONCILIATION: stock-focused reconciliation sweep, composing `reconciliation.ts` exactly like the listing sync handler above. */
export async function handleMarketplaceReconciliation(job: JobRecord, store: AutomationStore, _facts: FactsLoader, connectors: ConnectorLookup): Promise<JobHandlerResult> {
  if (!isReconciliationPayload(job.payload)) {
    return { succeeded: false, error: 'Malformed payload for marketplace_reconciliation.', retryable: false }
  }
  const payload = job.payload as unknown as MarketplaceReconciliationPayload
  const connector = connectors(payload.connectorKey)
  if (!connector) return { succeeded: false, error: `No connector registered for "${payload.connectorKey}".`, retryable: false }

  const fetched = await connector.fetchInventory({ limit: 250 })
  if (!fetched.ok) return { succeeded: false, error: fetched.error, retryable: true }

  const discrepancies = reconcileInventory(payload.ourInventory, fetched.value.records)
  const settings = await store.getAutomationSettings(job.orgId)

  const created = await store.createAutomationAction({
    orgId: job.orgId,
    idempotencyKey: `job:${job.id}`,
    actionType: 'reconcile_marketplace',
    entityType: 'channel',
    entityId: payload.connectorKey,
    reason: discrepancies.length === 0 ? 'Stock matches the marketplace for every checked listing.' : `${discrepancies.length} stock discrepancies found.`,
    inputFacts: { checkedCount: payload.ourInventory.length },
    decision: { discrepancies },
    policy: { outcome: 'allow_automatic', requirements: [], reason: 'Reconciliation is read-only.', riskLevel: discrepancies.length > 0 ? 'medium' : 'low' },
    automationLevel: settings.automationLevel,
    jobId: job.id,
  })
  if (!created.alreadyExisted) {
    await store.completeAutomationAction(created.id, { succeeded: true, orgId: job.orgId, entityType: 'channel', entityId: payload.connectorKey, reconciliationStatus: discrepancies.length > 0 ? 'discrepancy' : 'matched' })
  }

  return { succeeded: true }
}
