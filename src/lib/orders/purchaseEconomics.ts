/**
 * Actual-vs-estimated purchase economics.
 *
 * The `orders`/`fulfilments` schema comment already states the intent this
 * file implements: fulfilment cost fields are "populated as real costs
 * land, not estimated at order time." `estimatedCostMinor` is the number
 * `supplierResolution.ts` had available at the moment a supplier was
 * resolved (from `supplier_products.unit_cost_minor` + shipping);
 * `actualCostMinor` only exists once `manualPurchase.ts`'s
 * `recordSupplierPurchase` has actually been called. Never invents either
 * figure — `estimated` is `null` when no supplier was resolved at all
 * (`hadAnyOffers: false`), matching `supplierResolution.ts`'s own honesty.
 */

export interface PurchaseVarianceInput {
  estimatedCostMinor: number | null
  actualCostMinor: number
}

export interface PurchaseVarianceResult {
  estimatedCostMinor: number | null
  actualCostMinor: number
  varianceMinor: number | null
  variancePct: number | null
}

export function calculatePurchaseVariance(input: PurchaseVarianceInput): PurchaseVarianceResult {
  if (input.estimatedCostMinor === null) {
    return { estimatedCostMinor: null, actualCostMinor: input.actualCostMinor, varianceMinor: null, variancePct: null }
  }

  const varianceMinor = input.actualCostMinor - input.estimatedCostMinor
  const variancePct = input.estimatedCostMinor === 0 ? null : Math.round((varianceMinor / input.estimatedCostMinor) * 10000) / 100

  return { estimatedCostMinor: input.estimatedCostMinor, actualCostMinor: input.actualCostMinor, varianceMinor, variancePct }
}
