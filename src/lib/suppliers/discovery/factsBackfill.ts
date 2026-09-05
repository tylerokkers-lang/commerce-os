import 'server-only'

import { createServerSupabase } from '@/lib/supabase/server'
import { getConnector } from '@/lib/suppliers/connectors/registry'
import { withSupplierConnectorGate } from '@/lib/suppliers/connectors/executionGate'
import { generateCleanProductName } from '@/lib/products/naming'

/**
 * Restores product/supplier facts that were genuinely captured at
 * discovery time (`product_research`) but never copied into
 * `products`/`supplier_products` on import — a persistence gap found live
 * (see `ingestion.ts`'s `importCandidate`, which now writes these for every
 * *new* import). This is the equivalent self-heal for a product imported
 * before that fix existed, matching the same convention
 * `establishChannelFulfilmentSupplier`'s call from
 * `recalculateProductIntelligence` already set: only ever fills a
 * currently-null field, never overwrites one already on file, and never
 * invents a value `product_research` doesn't actually have.
 *
 * Milestone: product-catalogue correction (supplier URL & clean naming)
 * extends this with three more facts a product imported before that
 * milestone is genuinely missing: the supplier's own product URL/
 * connector reference (now durable columns on `supplier_products`, not
 * only ever reachable via this same `raw_signals` blob), and the
 * product/supplier-title split itself (`products.supplier_title` null is
 * the actual, reliable signal that a product predates the split — once
 * set, a later re-run never touches `title` again, so naming is never
 * silently reapplied to a product an operator may since have retitled).
 */

interface CandidateFactsRow {
  candidate_title: string
  category: string | null
  notes: string | null
  supplier_id: string | null
  raw_signals: {
    weightGrams?: number | null
    lengthMm?: number | null
    widthMm?: number | null
    heightMm?: number | null
    stockQty?: number | null
    deliveryDaysMax?: number | null
    sourceUrl?: string | null
    sourceUrlType?: 'product' | 'search' | null
    connectorKey?: string | null
    connectorProductRef?: string | null
  } | null
}

export interface FactsBackfillResult {
  updatedProduct: boolean
  updatedSupplierOffer: boolean
  /** `true` only when a live connector refetch actually found a real product URL the discovery-time record did not have. */
  recoveredUrlLive: boolean
  /** `true` when a supplier search link was derived via the connector's `getProductSourceLink` — a weaker, honestly-labelled fallback, never presented as the exact product page. */
  resolvedSearchLink: boolean
}

export async function backfillProductFactsFromResearch(orgId: string, productId: string): Promise<FactsBackfillResult> {
  const supabase = await createServerSupabase()

  const { data: candidate } = await supabase
    .from('product_research')
    .select('candidate_title, category, notes, supplier_id, raw_signals')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('status', 'promoted')
    .maybeSingle<CandidateFactsRow>()

  if (!candidate) return { updatedProduct: false, updatedSupplierOffer: false, recoveredUrlLive: false, resolvedSearchLink: false }

  let updatedProduct = false
  const { data: product } = await supabase
    .from('products')
    .select('title, supplier_title, description, weight_grams, length_mm, width_mm, height_mm')
    .eq('org_id', orgId)
    .eq('id', productId)
    .maybeSingle()

  if (product) {
    const patch: Record<string, unknown> = {}
    if (product.description === null && candidate.notes) patch.description = candidate.notes
    if (product.weight_grams === null && candidate.raw_signals?.weightGrams != null) patch.weight_grams = candidate.raw_signals.weightGrams
    if (product.length_mm === null && candidate.raw_signals?.lengthMm != null) patch.length_mm = candidate.raw_signals.lengthMm
    if (product.width_mm === null && candidate.raw_signals?.widthMm != null) patch.width_mm = candidate.raw_signals.widthMm
    if (product.height_mm === null && candidate.raw_signals?.heightMm != null) patch.height_mm = candidate.raw_signals.heightMm

    // `supplier_title` being null is the real, reliable signal that this
    // product predates the name-split — never re-run once it's set, so a
    // title an operator has since edited (or a name already cleaned) is
    // never silently overwritten a second time.
    if (product.supplier_title === null) {
      patch.supplier_title = candidate.candidate_title
      const naming = generateCleanProductName({ supplierTitle: candidate.candidate_title, category: candidate.category })
      // Only replace `title` if it still matches the untouched supplier
      // text — an operator may already have retitled this product by hand
      // since it was imported, and that choice must never be clobbered.
      if (naming.confident && product.title === candidate.candidate_title) patch.title = naming.name
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from('products').update(patch as never).eq('org_id', orgId).eq('id', productId)
      updatedProduct = !error
    }
  }

  let updatedSupplierOffer = false
  let recoveredUrlLive = false
  let resolvedSearchLink = false
  if (candidate.supplier_id) {
    const { data: offer } = await supabase
      .from('supplier_products')
      .select('supplier_sku, lead_time_days, stock_qty, source_url, source_url_type, connector_key, connector_product_ref')
      .eq('org_id', orgId)
      .eq('supplier_id', candidate.supplier_id)
      .eq('product_id', productId)
      .maybeSingle()

    if (offer) {
      const patch: Record<string, unknown> = {}
      // Same convention as `importCandidate`: `lead_time_days` stands in
      // for the delivery-day range as its maximum, never an average.
      if (offer.lead_time_days === null && candidate.raw_signals?.deliveryDaysMax != null) patch.lead_time_days = candidate.raw_signals.deliveryDaysMax
      if (offer.stock_qty === null && candidate.raw_signals?.stockQty != null) patch.stock_qty = candidate.raw_signals.stockQty
      const connectorKey = offer.connector_key ?? candidate.raw_signals?.connectorKey ?? null
      const connectorProductRef = offer.connector_product_ref ?? candidate.raw_signals?.connectorProductRef ?? null
      if (offer.connector_key === null && candidate.raw_signals?.connectorKey) patch.connector_key = candidate.raw_signals.connectorKey
      if (offer.connector_product_ref === null && candidate.raw_signals?.connectorProductRef) patch.connector_product_ref = candidate.raw_signals.connectorProductRef

      let sourceUrl = offer.source_url ?? candidate.raw_signals?.sourceUrl ?? null
      let sourceUrlType: 'product' | 'search' | null = sourceUrl ? (candidate.raw_signals?.sourceUrlType ?? 'product') : null

      // Milestone: supplier product verification link. No URL on file at
      // all yet — try, in order: (1) a live, read-only refetch for a real
      // product-page URL, in case the connector genuinely returns one
      // today; (2) the connector's own official search-route fallback,
      // using whatever connector reference/SKU this offer already has
      // (recovered by the previous phase's backfill, so this can resolve
      // even without a live `product_research` row). Never fails the
      // whole backfill — a connector error just leaves `sourceUrl` at
      // whatever it already was (null, honestly).
      let verifiedNow = false
      if (!sourceUrl && connectorKey && connectorProductRef) {
        try {
          const connector = getConnector(connectorKey)
          if (connector?.isConfigured()) {
            // Milestone: execution reliability — real circuit-breaker
            // enforcement, gated on the supplier this candidate belongs to
            // (`candidate.supplier_id`, always present inside this block).
            const detail = await withSupplierConnectorGate(orgId, candidate.supplier_id!, connector, () => connector.readProductDetail(connectorProductRef))
            // Milestone: autonomous decision & capability layer, Part 6. A
            // successful `readProductDetail` is a genuine, live confirmation
            // against the real supplier — regardless of whether it happened
            // to include a product-page URL — so it is what actually
            // updates `last_verified_at`, not the URL-recovery outcome.
            if (detail.ok) verifiedNow = true
            if (detail.ok && detail.value.productUrl) {
              sourceUrl = detail.value.productUrl
              sourceUrlType = 'product'
              recoveredUrlLive = true
            } else if (connector.descriptor.capabilities.resolvesProductSourceLink) {
              const link = await withSupplierConnectorGate(orgId, candidate.supplier_id!, connector, () => connector.getProductSourceLink({ productRef: connectorProductRef, supplierSku: offer.supplier_sku }))
              if (link.ok) {
                sourceUrl = link.value.url
                sourceUrlType = link.value.type
                resolvedSearchLink = true
              }
            }
          }
        } catch (error) {
          console.error('[suppliers] source-link resolution attempt failed during facts backfill', { productId, error })
        }
      }

      if (offer.source_url === null && sourceUrl) {
        patch.source_url = sourceUrl
        patch.source_url_type = sourceUrlType
      }
      if (verifiedNow) patch.last_verified_at = new Date().toISOString()

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase
          .from('supplier_products')
          .update(patch as never)
          .eq('org_id', orgId)
          .eq('supplier_id', candidate.supplier_id)
          .eq('product_id', productId)
        updatedSupplierOffer = !error
      }
    }
  }

  return { updatedProduct, updatedSupplierOffer, recoveredUrlLive, resolvedSearchLink }
}
