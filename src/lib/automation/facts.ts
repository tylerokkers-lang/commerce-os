import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { money } from '@/lib/core/money'
import type { Money } from '@/lib/core/money'
import {
  FRESHNESS_WINDOW_HOURS,
  factFrom,
  type ChannelProductFacts,
  type FactsLoader,
  type ProductFacts,
  type SupplierFacts,
  type SupplierOperationalFacts,
} from './factsTypes'

export type { Fact, Freshness, ProductFacts, SupplierFacts, ChannelProductFacts, SupplierOperationalFacts, FactsLoader } from './factsTypes'
export { allFactsFresh, describeFactState, FRESHNESS_WINDOW_HOURS } from './factsTypes'

/**
 * The production `FactsLoader`: real queries against `products`, `suppliers`,
 * `supplier_products` and `channel_products`. This module only *reads*. It
 * composes nothing new — the values it assembles feed straight into the
 * existing, unchanged engines (`calculateProfitability`, `assessCompliance`,
 * `evaluateSupplierRedundancy`, the automation modules), which is the whole
 * point: the engines do not change, only what feeds them becomes real
 * instead of a hand-built payload.
 */
export function getSupabaseFactsLoader(): FactsLoader {
  return {
    async loadProductFacts(orgId: string, productId: string, now: Date = new Date()): Promise<ProductFacts> {
      const supabase = createServiceSupabase()
      const { data } = await supabase.from('products').select('title, category, stage, updated_at').eq('org_id', orgId).eq('id', productId).maybeSingle()

      return {
        productId,
        title: factFrom(data?.title, data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
        category: factFrom(data?.category ?? null, data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
        stage: factFrom(data?.stage, data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
      }
    },

    /** The live facts a supplier decision (redundancy, price-change detection) needs for one product. */
    async loadSupplierFactsForProduct(orgId: string, supplierId: string, productId: string, now: Date = new Date()): Promise<SupplierFacts> {
      const supabase = createServiceSupabase()

      const [{ data: supplier }, { data: offer }] = await Promise.all([
        supabase.from('suppliers').select('shopify_status, amazon_status, last_assessed_at').eq('org_id', orgId).eq('id', supplierId).maybeSingle(),
        supabase
          .from('supplier_products')
          .select('unit_cost_minor, shipping_cost_minor, currency, stock_qty, in_stock, last_verified_at')
          .eq('org_id', orgId)
          .eq('supplier_id', supplierId)
          .eq('product_id', productId)
          .maybeSingle(),
      ])

      const currency = (offer?.currency ?? 'GBP') as Money['currency']

      return {
        supplierId,
        unitCost: factFrom(
          offer ? money(offer.unit_cost_minor, currency) : null,
          offer?.last_verified_at ?? null,
          FRESHNESS_WINDOW_HOURS.supplierPricing,
          now,
        ),
        shippingCost: factFrom(
          offer ? money(offer.shipping_cost_minor, currency) : null,
          offer?.last_verified_at ?? null,
          FRESHNESS_WINDOW_HOURS.supplierPricing,
          now,
        ),
        stockQty: factFrom(offer?.stock_qty ?? null, offer?.last_verified_at ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        inStock: factFrom(offer?.in_stock, offer?.last_verified_at ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        shopifyStatus: factFrom(supplier?.shopify_status, supplier?.last_assessed_at ?? null, FRESHNESS_WINDOW_HOURS.supplierCompliance, now),
        amazonStatus: factFrom(supplier?.amazon_status, supplier?.last_assessed_at ?? null, FRESHNESS_WINDOW_HOURS.supplierCompliance, now),
      }
    },

    async loadChannelProductFacts(orgId: string, channelProductId: string, now: Date = new Date()): Promise<ChannelProductFacts> {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('channel_products')
        .select('status, price_minor, fulfilment_supplier_id, external_id, last_synced_at, updated_at')
        .eq('org_id', orgId)
        .eq('id', channelProductId)
        .maybeSingle()

      // A listing's own price/status only means something as of the last
      // time it was actually synced with the marketplace — `updated_at`
      // reflects our own edits, not the marketplace's, so freshness is
      // judged by `last_synced_at`.
      const asOf = data?.last_synced_at ?? null

      return {
        channelProductId,
        status: factFrom(data?.status, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
        priceMinor: factFrom(data?.price_minor ?? null, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
        fulfilmentSupplierId: factFrom(data?.fulfilment_supplier_id ?? null, asOf ?? data?.updated_at ?? null, FRESHNESS_WINDOW_HOURS.channelListing, now),
        externalId: factFrom(data?.external_id ?? null, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
      }
    },

    /**
     * Dispatch/cancellation figures come from `supplier_products` (whichever
     * row the connector last synced — a supplier can offer several
     * products, so this picks the most recently checked one as
     * representative of the supplier's current operational state).
     * Delivery days are computed live from the supplier's most recent
     * delivered shipments — real outcomes, not a quote. Feed status comes
     * from `supplier_connectors`, one row per (supplier, connector).
     */
    async loadSupplierOperationalFacts(orgId: string, supplierId: string, now: Date = new Date()): Promise<SupplierOperationalFacts> {
      const supabase = createServiceSupabase()

      const [{ data: offers }, { data: connectors }, { data: fulfilments }] = await Promise.all([
        supabase
          .from('supplier_products')
          .select('dispatch_days_min, dispatch_days_max, cancellation_rate_pct, fulfilment_success_rate_pct, stock_checked_at')
          .eq('org_id', orgId).eq('supplier_id', supplierId)
          .not('stock_checked_at', 'is', null)
          .order('stock_checked_at', { ascending: false })
          .limit(1),
        supabase
          .from('supplier_connectors')
          .select('status, last_success_at, last_failure_at, consecutive_failures')
          .eq('org_id', orgId).eq('supplier_id', supplierId)
          .order('last_success_at', { ascending: false, nullsFirst: false })
          .limit(1),
        supabase.from('fulfilments').select('id').eq('org_id', orgId).eq('supplier_id', supplierId).limit(1), // Existence check only — see below.
      ])

      const offer = offers?.[0] ?? null
      const connector = connectors?.[0] ?? null

      // Real observed delivery time: the average shipped_at -> delivered_at
      // gap across this supplier's most recent completed shipments. Two
      // queries because `shipments` has no direct supplier_id — it is
      // reached through fulfilments, the same join every other fulfilment
      // query in this codebase uses.
      let observedDeliveryDaysValue: number | null = null
      let observedDeliveryDaysAsOf: string | null = null
      if ((fulfilments?.length ?? 0) > 0) {
        const { data: recentFulfilments } = await supabase
          .from('fulfilments').select('id').eq('org_id', orgId).eq('supplier_id', supplierId)
          .order('created_at', { ascending: false }).limit(50)
        const fulfilmentIds = (recentFulfilments ?? []).map((f) => f.id)
        if (fulfilmentIds.length > 0) {
          const { data: shipments } = await supabase
            .from('shipments').select('fulfilment_id, shipped_at, delivered_at')
            .in('fulfilment_id', fulfilmentIds).not('shipped_at', 'is', null).not('delivered_at', 'is', null)
            .order('delivered_at', { ascending: false }).limit(20)
          const durations = (shipments ?? []).map((s) => (new Date(s.delivered_at!).getTime() - new Date(s.shipped_at!).getTime()) / (1000 * 60 * 60 * 24))
          if (durations.length > 0) {
            observedDeliveryDaysValue = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
            observedDeliveryDaysAsOf = (shipments ?? [])[0]?.delivered_at ?? null
          }
        }
      }

      return {
        supplierId,
        dispatchDaysMin: factFrom(offer?.dispatch_days_min ?? null, offer?.stock_checked_at ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        dispatchDaysMax: factFrom(offer?.dispatch_days_max ?? null, offer?.stock_checked_at ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        cancellationRatePct: factFrom(offer?.cancellation_rate_pct ?? null, offer?.stock_checked_at ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        fulfilmentSuccessRatePct: factFrom(offer?.fulfilment_success_rate_pct ?? null, offer?.stock_checked_at ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        observedDeliveryDays: factFrom(observedDeliveryDaysValue, observedDeliveryDaysAsOf, FRESHNESS_WINDOW_HOURS.supplierOperations * 7, now), // Delivery outcomes change slowly; a wider window than a connector sync.
        connectorStatus: factFrom(connector?.status ?? null, connector?.last_success_at ?? connector?.last_failure_at ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
      }
    },
  }
}
