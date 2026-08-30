import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { createServerSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { getConnector } from './connectors/registry'
import { assessShippingSuitability, type ShippingPolicyResult } from './shippingPolicy'

/**
 * Shipping-quote orchestrator (Milestone: real supplier connector,
 * Phase 8) — the one place `SupplierConnector.readProductDetail`'s
 * destination-aware quotes are fetched, assessed by the deterministic
 * `shippingPolicy.ts` gate, and persisted. Capability-gated exactly like
 * every other connector call in this codebase: `readShippingRates` is
 * checked before `readProductDetail` is ever called with a destination.
 *
 * Every quote is inserted through the service-role client, never
 * updated — a fresh fetch is a fresh historical fact
 * (`supplier_shipping_quotes` forbids UPDATE/DELETE at the database
 * level, 0043's own trigger), matching this milestone's own instruction
 * not to overwrite an important historical fact.
 */

export interface FetchShippingQuotesInput {
  orgId: string
  supplierId: string | null
  productId: string | null
  connectorKey: string
  connectorProductRef: string
  destinationCountry: string
  actorUserId: string
  actorLabel: string | null
}

export interface FetchShippingQuotesResult {
  policy: ShippingPolicyResult
  quoteCount: number
}

export async function fetchAndAssessShipping(input: FetchShippingQuotesInput): Promise<Result<FetchShippingQuotesResult, string>> {
  const connector = getConnector(input.connectorKey)
  if (!connector) return err(`Unknown connector "${input.connectorKey}".`)
  if (!connector.descriptor.capabilities.readShippingRates) {
    return err(`${connector.descriptor.label} does not declare shipping-rate reading as a supported capability.`)
  }
  if (!connector.isConfigured()) return err(`${connector.descriptor.label} is not configured.`)

  const detailResult = await connector.readProductDetail(input.connectorProductRef, { destinationCountry: input.destinationCountry })
  if (!detailResult.ok) return detailResult

  const settings = await getAutomationSettingsForOrg(input.orgId)
  const policy = assessShippingSuitability({
    destinationCountry: input.destinationCountry,
    quotes: detailResult.value.shippingQuotes,
    maxDeliveryDays: settings.maxDeliveryDays,
  })

  const supabase = await createServerSupabase()
  if (detailResult.value.shippingQuotes.length > 0) {
    const { error } = await supabase.from('supplier_shipping_quotes').insert(
      detailResult.value.shippingQuotes.map((q) => ({
        org_id: input.orgId,
        supplier_id: input.supplierId,
        product_id: input.productId,
        connector_key: input.connectorKey,
        connector_product_ref: input.connectorProductRef,
        destination_country: q.destinationCountry,
        method: q.method,
        carrier_name: q.carrierName,
        shipping_cost_minor: q.shippingCost.minor,
        currency: q.shippingCost.currency,
        processing_days_min: q.processingDaysMin,
        processing_days_max: q.processingDaysMax,
        transit_days_min: q.transitDaysMin,
        transit_days_max: q.transitDaysMax,
        total_delivery_days_min: q.totalDeliveryDaysMin,
        total_delivery_days_max: q.totalDeliveryDaysMax,
        provides_tracking: q.providesTracking === 'unknown' ? null : q.providesTracking,
        suitability_status: policy.status,
        suitability_reason: policy.reason,
      })),
    )
    if (error) return err(`Shipping quotes were fetched but could not be saved: ${error.message}`)
  }

  await recordAudit({
    orgId: input.orgId,
    action: 'SUPPLIER_SHIPPING_QUOTED',
    entityType: 'supplier_shipping_quote',
    entityId: input.productId ?? input.connectorProductRef,
    actorType: 'user',
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    newValue: { connectorKey: input.connectorKey, destinationCountry: input.destinationCountry, quoteCount: detailResult.value.shippingQuotes.length, status: policy.status },
    reason: policy.reason,
  })

  return ok({ policy, quoteCount: detailResult.value.shippingQuotes.length })
}
