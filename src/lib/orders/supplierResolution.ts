import { money, type CurrencyCode, type Money } from '@/lib/core/money'
import { chooseFulfilmentSupplier, type FulfilmentSupplierCandidate, type FulfilmentSupplierChoice } from '@/lib/fulfilment/selection'

/**
 * Supplier resolution wired to real data — assembles the candidates
 * `chooseFulfilmentSupplier` (`fulfilment/selection.ts`, unchanged) needs,
 * from real `supplier_products`/`suppliers` rows the caller already queried.
 * Never re-implements ranking; this file's only job is turning real rows
 * into the shape that function already expects.
 */

export interface SupplierProductOffer {
  supplierId: string
  supplierName: string
  unitCostMinor: number
  shippingCostMinor: number
  currency: CurrencyCode
  /** `suppliers.shopify_status`/`amazon_status` for the relevant channel — the real, existing per-channel approval signal. */
  channelApprovalStatus: 'approved' | 'blocked' | 'review_required' | 'not_assessed'
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  providesTracking: boolean
  /** `suppliers.handles_returns` — also used as the `acceptsFaultyReturns` signal, since no separate column exists for that distinction. */
  handlesReturns: boolean
  /** `suppliers.supports_blind_shipping`/`supports_custom_invoice`/`supports_custom_packaging`. */
  supportsBlindShipping: boolean
  supportsCustomInvoice: boolean
  supportsCustomPackaging: boolean
  /**
   * No dedicated `suppliers` column for "own branding" exists —
   * `supports_custom_invoice` (documented in the schema as "our name as
   * seller of record") is the closest real signal for the same underlying
   * concept, reused here rather than a separate invented flag.
   */
}

function toCandidate(offer: SupplierProductOffer, bestAvailableUnitCost: Money): FulfilmentSupplierCandidate {
  return {
    id: offer.supplierId,
    name: offer.supplierName,
    isApprovedForListing: offer.channelApprovalStatus === 'approved',
    signals: {
      unitCost: money(offer.unitCostMinor, offer.currency),
      shippingCost: money(offer.shippingCostMinor, offer.currency),
      bestAvailableUnitCost,
      deliveryDaysMin: offer.deliveryDaysMin ?? undefined,
      deliveryDaysMax: offer.deliveryDaysMax ?? undefined,
      handlesReturns: offer.handlesReturns,
      acceptsFaultyReturns: offer.handlesReturns,
      providesTracking: offer.providesTracking,
      supportsBlindShipping: offer.supportsBlindShipping,
      supportsCustomInvoice: offer.supportsCustomInvoice,
      supportsCustomPackaging: offer.supportsCustomPackaging,
      supportsOwnBranding: offer.supportsCustomInvoice,
    },
  }
}

export interface SupplierResolutionResult {
  choice: FulfilmentSupplierChoice
  /** True only when at least one real supplier_products row exists for this product at all. */
  hadAnyOffers: boolean
}

/**
 * Every `SupplierProductOffer` the caller passes in is already scoped to
 * one product; per-channel approval is read from `channelApprovalStatus`,
 * which the caller resolves against the right column
 * (`shopify_status`/`amazon_status`) for this order's channel before ever
 * calling this function — there is nothing left for this function itself
 * to filter by channel.
 */
export function resolveSupplierForProduct(offers: readonly SupplierProductOffer[]): SupplierResolutionResult {
  if (offers.length === 0) {
    return { choice: chooseFulfilmentSupplier([]), hadAnyOffers: false }
  }

  const cheapestMinor = Math.min(...offers.map((o) => o.unitCostMinor))
  const bestAvailableUnitCost = money(cheapestMinor, offers[0].currency)

  const candidates = offers.map((offer) => toCandidate(offer, bestAvailableUnitCost))
  return { choice: chooseFulfilmentSupplier(candidates), hadAnyOffers: true }
}
