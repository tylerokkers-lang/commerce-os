import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import { requireSession } from '@/lib/security/session'

export interface DiscoveryCandidate {
  id: string
  candidateTitle: string
  category: string | null
  source: string
  sourceReference: string | null
  supplierId: string | null
  supplierName: string | null
  supplierSku: string | null
  unitCostMinor: number | null
  shippingCostMinor: number | null
  currency: string
  status: string
  statusReason: string | null
  productId: string | null
  collectedAt: string
  /** Milestone: shipping-aware publication (Phase 9). The supplier's own estimated delivery range, where a connector reported one at capture time — `null` means genuinely not reported, never assumed. */
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  /** Which connector this candidate came from, if any — `null` for a manually-typed entry. */
  connectorKey: string | null
}

/**
 * The discovery queue read — every candidate for the org, newest first.
 * Demo mode shows nothing rather than fabricated candidates, matching the
 * same "empty and honest" pattern channel decisions and product
 * intelligence already established once real data doesn't exist to
 * reason from.
 */
export async function getDiscoveryQueue(): Promise<readonly DiscoveryCandidate[]> {
  const session = await requireSession()
  if (session.isDemo) return []

  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('product_research')
    .select('id, candidate_title, category, source, source_reference, supplier_id, supplier_sku, estimated_unit_cost_minor, estimated_shipping_minor, currency, status, rejected_reason, product_id, collected_at, raw_signals, suppliers(name)')
    .eq('org_id', session.orgId)
    .order('collected_at', { ascending: false })
    .limit(200)

  return (data ?? []).map((row) => {
    const rawSignals = row.raw_signals as { deliveryDaysMin?: number | null; deliveryDaysMax?: number | null; connectorKey?: string | null } | null
    return {
      id: row.id,
      candidateTitle: row.candidate_title,
      category: row.category,
      source: row.source,
      sourceReference: row.source_reference,
      supplierId: row.supplier_id,
      supplierName: (row.suppliers as unknown as { name: string } | null)?.name ?? null,
      supplierSku: row.supplier_sku,
      unitCostMinor: row.estimated_unit_cost_minor,
      shippingCostMinor: row.estimated_shipping_minor,
      currency: row.currency,
      status: row.status,
      statusReason: row.rejected_reason,
      productId: row.product_id,
      collectedAt: row.collected_at,
      deliveryDaysMin: rawSignals?.deliveryDaysMin ?? null,
      deliveryDaysMax: rawSignals?.deliveryDaysMax ?? null,
      connectorKey: rawSignals?.connectorKey ?? null,
    }
  })
}

export interface SupplierOfferSummary {
  supplierId: string
  supplierName: string
  unitCostMinor: number
  shippingCostMinor: number
  currency: string
  deliveryDaysMax: number | null
  inStock: boolean | null
  providesTracking: boolean
  handlesReturns: boolean
  reliabilityScore: number | null
  /** Milestone: product-catalogue correction. The supplier's own SKU for this offer — already collected, previously not surfaced from this read. */
  supplierSku: string | null
  /** The supplier's own product-page URL, or an official supplier search route — `null` means genuinely unavailable, never a guessed link. */
  sourceUrl: string | null
  /** Whether `sourceUrl` is presented as the exact product page or an unverified search route — see `ProductSourceLink`'s own doc comment. `null` only when `sourceUrl` itself is `null`. */
  sourceUrlType: 'product' | 'search' | null
  /** Which connector produced this offer, if any — for traceability, never used to claim a live connection. */
  connectorKey: string | null
  /** The supplier's own product reference (e.g. CJ's `pid`) this offer was captured against — for manual verification alongside `sourceUrl`. */
  connectorProductRef: string | null
}

/**
 * Every real supplier offer on file for one product — the raw input to
 * `compareSupplierOffers`. `reliabilityScore` reuses `suppliers.current_score`
 * (Milestone 3, `0012_supplier_attributes.sql`) — already computed by
 * `scoreSupplier` whenever a supplier is saved — rather than recomputing
 * it here.
 */
export async function getSupplierOffersForProduct(orgId: string, productId: string): Promise<readonly SupplierOfferSummary[]> {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('supplier_products')
    .select('supplier_id, supplier_sku, unit_cost_minor, shipping_cost_minor, currency, lead_time_days, stock_qty, in_stock, source_url, source_url_type, connector_key, connector_product_ref, suppliers(name, provides_tracking, handles_returns, current_score)')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .is('variant_id', null)

  return (data ?? []).map((row) => {
    const supplier = row.suppliers as unknown as { name: string; provides_tracking: boolean; handles_returns: boolean; current_score: number | null } | null
    return {
      supplierId: row.supplier_id,
      supplierName: supplier?.name ?? 'Unknown supplier',
      unitCostMinor: row.unit_cost_minor,
      shippingCostMinor: row.shipping_cost_minor,
      currency: row.currency,
      deliveryDaysMax: row.lead_time_days,
      inStock: row.stock_qty === null ? null : row.in_stock,
      providesTracking: supplier?.provides_tracking ?? false,
      handlesReturns: supplier?.handles_returns ?? false,
      reliabilityScore: supplier?.current_score ?? null,
      supplierSku: row.supplier_sku,
      sourceUrl: row.source_url,
      sourceUrlType: row.source_url_type as 'product' | 'search' | null,
      connectorProductRef: row.connector_product_ref,
      connectorKey: row.connector_key,
    }
  })
}
