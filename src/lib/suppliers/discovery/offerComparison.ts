/**
 * Supplier offer comparison (Milestone: supplier discovery, Phase 5).
 *
 * Operates on real `supplier_products` rows — the brief's own "PRODUCT
 * SOURCE HISTORY" (a product with offers from Supplier A/B/C) is already
 * fully supported by that table's existing
 * `unique (org_id, supplier_id, product_id, variant_id)` shape; nothing
 * new was added to represent it. This is the missing piece: a
 * deterministic, explainable comparison across those rows, so "the
 * cheapest supplier" is never assumed to be "the best supplier" — the
 * brief's own explicit instruction.
 */

export interface SupplierOffer {
  supplierId: string
  supplierName: string
  unitCostMinor: number
  shippingCostMinor: number
  currency: string
  deliveryDaysMax: number | null
  inStock: boolean | null
  providesTracking: boolean
  handlesReturns: boolean
  /** 0-100 from the supplier scoring engine (`@/lib/suppliers/scoring`), when known. */
  reliabilityScore: number | null
}

export interface RankedOffer {
  supplierId: string
  supplierName: string
  totalFulfilmentCostMinor: number
  /** 0-100, higher is better — a composite of cost, delivery, reliability and capability, never cost alone. */
  compositeScore: number
  excludedReason: string | null
}

export interface OfferComparisonResult {
  ranked: readonly RankedOffer[]
  preferredSupplierId: string | null
  reason: string
}

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v))
const inverseLinear = (v: number, best: number, worst: number) => clamp(((worst - v) / (worst - best)) * 100)

function scoreOffer(offer: SupplierOffer, cheapestMinor: number, fastestDays: number | null): number {
  const totalCost = offer.unitCostMinor + offer.shippingCostMinor
  // Cost scored relative to the cheapest offer in this comparison, not an
  // absolute scale — being 5% above the cheapest is a very different
  // situation from being 80% above it.
  const costRatio = cheapestMinor > 0 ? totalCost / cheapestMinor : 1
  const costScore = inverseLinear(costRatio, 1, 2)

  const deliveryScore =
    offer.deliveryDaysMax === null
      ? 40 // Unknown delivery is a real gap, scored below "known and slow" rather than assumed fine.
      : inverseLinear(offer.deliveryDaysMax, fastestDays ?? offer.deliveryDaysMax, 30)

  const reliabilityScore = offer.reliabilityScore ?? 50 // Unknown reliability: neutral, not assumed good.

  const capabilityBonus = (offer.providesTracking ? 5 : 0) + (offer.handlesReturns ? 5 : 0)

  const weighted = costScore * 0.35 + deliveryScore * 0.3 + reliabilityScore * 0.25 + capabilityBonus
  return Math.round(clamp(weighted))
}

export function compareSupplierOffers(offers: readonly SupplierOffer[]): OfferComparisonResult {
  if (offers.length === 0) {
    return { ranked: [], preferredSupplierId: null, reason: 'No supplier offers exist for this product yet.' }
  }

  const cheapestMinor = Math.min(...offers.map((o) => o.unitCostMinor + o.shippingCostMinor))
  const knownDeliveries = offers.map((o) => o.deliveryDaysMax).filter((d): d is number => d !== null)
  const fastestDays = knownDeliveries.length > 0 ? Math.min(...knownDeliveries) : null

  const ranked: RankedOffer[] = offers
    .map((offer) => ({
      supplierId: offer.supplierId,
      supplierName: offer.supplierName,
      totalFulfilmentCostMinor: offer.unitCostMinor + offer.shippingCostMinor,
      compositeScore: scoreOffer(offer, cheapestMinor, fastestDays),
      excludedReason: offer.inStock === false ? 'Currently reported out of stock.' : null,
    }))
    .sort((a, b) => {
      // Out-of-stock offers always rank last, regardless of score — an
      // unavailable supplier is never "preferred" no matter how cheap.
      if (Boolean(a.excludedReason) !== Boolean(b.excludedReason)) return a.excludedReason ? 1 : -1
      return b.compositeScore - a.compositeScore
    })

  const preferred = ranked.find((r) => !r.excludedReason) ?? null

  if (!preferred) {
    return { ranked, preferredSupplierId: null, reason: 'Every supplier offer for this product is currently out of stock.' }
  }

  const cheapest = [...offers].sort((a, b) => a.unitCostMinor + a.shippingCostMinor - (b.unitCostMinor + b.shippingCostMinor))[0]
  const preferredOffer = offers.find((o) => o.supplierId === preferred.supplierId)!

  let reason: string
  if (preferred.supplierId === cheapest.supplierId) {
    reason = `${preferred.supplierName} selected: the lowest total fulfilment cost (${(preferred.totalFulfilmentCostMinor / 100).toFixed(2)}) among the available offers.`
  } else {
    const costDeltaMinor = preferred.totalFulfilmentCostMinor - (cheapest.unitCostMinor + cheapest.shippingCostMinor)
    const deliveryDelta =
      preferredOffer.deliveryDaysMax !== null && cheapest.deliveryDaysMax !== null
        ? cheapest.deliveryDaysMax - preferredOffer.deliveryDaysMax
        : null
    const parts: string[] = [`total fulfilment cost is only ${(costDeltaMinor / 100).toFixed(2)} higher than the cheapest offer (${cheapest.supplierName})`]
    if (deliveryDelta !== null && deliveryDelta > 0) parts.push(`estimated delivery is ${deliveryDelta} day${deliveryDelta === 1 ? '' : 's'} faster`)
    if (preferredOffer.providesTracking && !cheapest.providesTracking) parts.push('tracking is available')
    if (preferredOffer.handlesReturns && !cheapest.handlesReturns) parts.push('the supplier handles returns')
    reason = `${preferred.supplierName} selected because ${parts.join(', and ')}.`
  }

  return { ranked, preferredSupplierId: preferred.supplierId, reason }
}
