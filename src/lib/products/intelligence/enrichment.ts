/**
 * Product enrichment / normalisation (Milestone: product intelligence,
 * Phase 4).
 *
 * `products`/`supplier_products` already store their numeric fields in
 * canonical form (weight in grams, dimensions in millimetres, cost as
 * integer minor units) — nothing in this phase's actual data path (real
 * `products` rows plus the Shopify Storefront API, which itself returns
 * structured numeric prices, not free text) ever hands this code a raw
 * string like "0.5 kg" to normalise. `parseWeightToGrams` below exists
 * anyway, deliberately, as the seam a future raw supplier feed (DSers or
 * otherwise — see the "SOURCE SOURCE / NORMALISED PRODUCT" pipeline this
 * milestone is asked to prepare for) will need on day one, kept beside a
 * real test proving it handles the exact "0.5 kg / 500g / 500 g" case the
 * brief gives as its own example — never wired to a fabricated caller in
 * the meantime.
 */

import type { CurrencyCode } from '@/lib/core/money'

export type SourcedValue<T> = { value: T; source: 'known' } | { value: null; source: 'unknown' }

export function known<T>(value: T | null | undefined): SourcedValue<T> {
  return value === null || value === undefined ? { value: null, source: 'unknown' } : { value, source: 'known' }
}

/**
 * Accepts "0.5kg", "0.5 kg", "500g", "500 g", "500" (grams assumed),
 * returns grams. The original source string is never discarded by a
 * caller that wants it — this function only returns the normalised
 * number, never mutating or losing the input.
 */
export function parseWeightToGrams(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase()
  const match = trimmed.match(/^([\d.]+)\s*(kg|g)?$/)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const unit = match[2] ?? 'g'
  return unit === 'kg' ? Math.round(amount * 1000) : Math.round(amount)
}

export interface NormalizedProductFacts {
  title: SourcedValue<string>
  description: SourcedValue<string>
  vendor: SourcedValue<string>
  category: SourcedValue<string>
  tags: SourcedValue<readonly string[]>
  imageCount: SourcedValue<number>
  variantCount: SourcedValue<number>
  hasMeaningfulVariants: SourcedValue<boolean>
  weightGrams: SourcedValue<number>
  dimensionsMm: SourcedValue<{ length: number; width: number; height: number }>
  supplierCostMinor: SourcedValue<number>
  supplierShippingMinor: SourcedValue<number>
  supplierLeadTimeDays: SourcedValue<number>
  supplierStockQty: SourcedValue<number>
  supplierInStock: SourcedValue<boolean>
}

export interface ProductRow {
  title: string
  description: string | null
  category: string | null
  weight_grams: number | null
  length_mm: number | null
  width_mm: number | null
  height_mm: number | null
}

export interface StorefrontFacts {
  description: string
  imageCount: number
  variantCount: number
  hasMeaningfulVariants: boolean
  tags: readonly string[]
  vendor: string | null
}

export interface SupplierOfferFacts {
  unitCostMinor: number
  shippingCostMinor: number
  /** The supplier's own currency (e.g. CJdropshipping quotes in USD) — never assumed to match the channel's currency. Found live, not by inspection: this was previously dropped here and every caller silently treated the raw minor units as if they were already in the channel currency. */
  currency: CurrencyCode
  leadTimeDays: number | null
  stockQty: number | null
  inStock: boolean
}

/**
 * Assembles one structured, honestly-gapped view of a product from
 * whatever real sources are actually available. Nothing here invents a
 * value: a field only ever has `source: 'known'` when a real row supplied
 * it.
 */
export function normalizeProduct(
  product: ProductRow,
  storefront: StorefrontFacts | null,
  supplierOffer: SupplierOfferFacts | null,
): NormalizedProductFacts {
  const dimensions =
    product.length_mm !== null && product.width_mm !== null && product.height_mm !== null
      ? { length: product.length_mm, width: product.width_mm, height: product.height_mm }
      : null

  return {
    title: known(product.title),
    description: known(storefront?.description ?? product.description ?? null),
    vendor: known(storefront?.vendor ?? null),
    category: known(product.category),
    tags: known(storefront?.tags ?? null),
    imageCount: known(storefront?.imageCount ?? null),
    variantCount: known(storefront?.variantCount ?? null),
    hasMeaningfulVariants: known(storefront?.hasMeaningfulVariants ?? null),
    weightGrams: known(product.weight_grams),
    dimensionsMm: known(dimensions),
    supplierCostMinor: known(supplierOffer?.unitCostMinor ?? null),
    supplierShippingMinor: known(supplierOffer?.shippingCostMinor ?? null),
    supplierLeadTimeDays: known(supplierOffer?.leadTimeDays ?? null),
    supplierStockQty: known(supplierOffer?.stockQty ?? null),
    supplierInStock: known(supplierOffer ? supplierOffer.inStock : null),
  }
}
