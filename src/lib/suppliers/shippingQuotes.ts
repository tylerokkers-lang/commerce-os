import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { createServerSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { getConnector } from './connectors/registry'
import { withSupplierConnectorGate } from './connectors/executionGate'
import { assessShippingSuitability, type ShippingPolicyResult } from './shippingPolicy'
import type { SupplierShippingQuote } from './connectors/types'

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

  // Milestone: execution reliability. Gated by the real circuit breaker
  // when a supplier row is known (the common case) — a repeatedly-failing
  // connector stops being hit rather than retried on every request. Falls
  // back to the direct call, unchanged from before this milestone, only
  // when no supplier is on file yet (nothing stable to track state against).
  const detailResult = input.supplierId
    ? await withSupplierConnectorGate(input.orgId, input.supplierId, connector, () => connector.readProductDetail(input.connectorProductRef, { destinationCountry: input.destinationCountry }))
    : await connector.readProductDetail(input.connectorProductRef, { destinationCountry: input.destinationCountry })
  if (!detailResult.ok) return detailResult

  const settings = await getAutomationSettingsForOrg(input.orgId)
  const fetchedAt = new Date().toISOString()
  const policy = assessShippingSuitability({
    destinationCountry: input.destinationCountry,
    quotes: detailResult.value.shippingQuotes,
    maxDeliveryDays: settings.maxDeliveryDays,
    quotedAt: detailResult.value.shippingQuotes.length > 0 ? fetchedAt : null,
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

/**
 * Reads back the most recent shipping assessment for a product — the
 * one function Phase 6's `assessShopifyEligibility` calls to make
 * shipping a real publication requirement (Milestone: shipping-aware
 * publication, Phase 9). Never re-runs the policy against stale
 * inputs: this reads the exact quotes from the single most recent fetch
 * batch (identified by their shared `quoted_at`) and re-assesses them
 * against the org's *current* `max_delivery_days` and the *current*
 * time — so a setting change or the passage of time can change the
 * verdict without a new fetch, exactly as `shippingPolicy.ts`'s own
 * freshness rule intends.
 *
 * A product with no CJ (or other connector) origin — every manually
 * captured candidate, and every product imported before this feature
 * existed — has no rows here at all, and correctly reads as
 * `review_required` ("no shipping quote has been fetched yet"), not a
 * silent pass. `HANDOVER.md` documents this as a deliberate tightening
 * of the Shopify publication gate, not an oversight.
 */
export async function getShippingSuitability(orgId: string, productId: string, destinationCountry: string): Promise<ShippingPolicyResult> {
  const supabase = await createServerSupabase()
  const { data: rows } = await supabase
    .from('supplier_shipping_quotes')
    .select('*')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('destination_country', destinationCountry)
    .order('quoted_at', { ascending: false })
    .limit(50)

  if (!rows || rows.length === 0) {
    return assessShippingSuitability({ destinationCountry, quotes: [], maxDeliveryDays: (await getAutomationSettingsForOrg(orgId)).maxDeliveryDays, quotedAt: null })
  }

  // The most recent fetch batch: every row sharing the newest `quoted_at`
  // among the rows just read (a single `fetchAndAssessShipping` call
  // inserts all of one destination's quotes together) — older batches
  // are superseded facts, kept for history, never re-evaluated.
  const latestQuotedAt = rows[0].quoted_at
  const latestBatch = rows.filter((r) => r.quoted_at === latestQuotedAt)

  const quotes: readonly SupplierShippingQuote[] = latestBatch.map((r) => ({
    destinationCountry: r.destination_country,
    method: r.method,
    carrierName: r.carrier_name,
    shippingCost: { minor: r.shipping_cost_minor, currency: r.currency as SupplierShippingQuote['shippingCost']['currency'] },
    processingDaysMin: r.processing_days_min,
    processingDaysMax: r.processing_days_max,
    transitDaysMin: r.transit_days_min,
    transitDaysMax: r.transit_days_max,
    totalDeliveryDaysMin: r.total_delivery_days_min,
    totalDeliveryDaysMax: r.total_delivery_days_max,
    providesTracking: r.provides_tracking === null ? 'unknown' : r.provides_tracking,
  }))

  const settings = await getAutomationSettingsForOrg(orgId)
  return assessShippingSuitability({ destinationCountry, quotes, maxDeliveryDays: settings.maxDeliveryDays, quotedAt: latestQuotedAt })
}

/**
 * "Check/refresh UK shipping" for an already-imported product (Milestone:
 * shipping-aware publication, Phase 9) — the admin action a product page
 * needs once a quote goes stale (`shippingPolicy.ts`'s freshness rule)
 * or never existed at all. Recovers the connector reference from the
 * product's own originating `product_research` row (Phase 5/8's capture
 * already stores `connectorKey`/`connectorProductRef` in its
 * `raw_signals`) rather than a new column — a product with no such row,
 * or one captured manually with no connector origin, honestly has
 * nothing to refresh from.
 */
export async function refreshShippingQuoteForProduct(
  orgId: string,
  productId: string,
  destinationCountry: string,
  actor: { userId: string; label: string | null },
): Promise<Result<FetchShippingQuotesResult, string>> {
  const supabase = await createServerSupabase()
  const { data: candidate } = await supabase
    .from('product_research')
    .select('supplier_id, raw_signals')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('status', 'promoted')
    .maybeSingle()

  const rawSignals = candidate?.raw_signals as { connectorKey?: string | null; connectorProductRef?: string | null } | null
  const connectorKey = rawSignals?.connectorKey
  const connectorProductRef = rawSignals?.connectorProductRef

  if (!connectorKey || !connectorProductRef) {
    return err('No connector-sourced reference is on file for this product — a shipping quote can only be fetched for products discovered through a connector such as CJdropshipping.')
  }

  return fetchAndAssessShipping({
    orgId,
    supplierId: candidate?.supplier_id ?? null,
    productId,
    connectorKey,
    connectorProductRef,
    destinationCountry,
    actorUserId: actor.userId,
    actorLabel: actor.label,
  })
}
