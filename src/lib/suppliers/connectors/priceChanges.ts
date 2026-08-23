import { subtract, type Money } from '@/lib/core/money'
import type { SupplierProductStatus } from './types'

/**
 * Price change detection.
 *
 * A connector reports the current cost and, where it knows one, the previous
 * cost. This turns that pair into a structured event with a signed
 * percentage, so "detect a supplier price increase" (the flagship automation
 * example for a later milestone) is a query over recorded events rather than
 * a live comparison that forgets itself the moment the sync finishes.
 */

export interface PriceChangeEvent {
  supplierRef: string
  productRef: string
  previousUnitCost: Money
  newUnitCost: Money
  delta: Money
  changePct: number
  direction: 'increase' | 'decrease'
  /** True once the change is large enough to be worth acting on. */
  significant: boolean
  detectedAt: string
}

/** Below this, a price movement is noise — rounding, currency drift, nothing worth an approval request. */
export const DEFAULT_SIGNIFICANCE_THRESHOLD_PCT = 3

/**
 * Extracts a price change event from a connector status, or null when there
 * is nothing to compare against or nothing changed.
 */
export function detectPriceChange(
  status: SupplierProductStatus,
  significanceThresholdPct: number = DEFAULT_SIGNIFICANCE_THRESHOLD_PCT,
  now: Date = new Date(),
): PriceChangeEvent | null {
  if (!status.previousUnitCost || !status.priceChangedSincePrevious) return null
  if (status.previousUnitCost.minor === status.unitCost.minor) return null

  const delta = subtract(status.unitCost, status.previousUnitCost)
  const changePct =
    status.previousUnitCost.minor === 0
      ? 0
      : Math.round((delta.minor / status.previousUnitCost.minor) * 10000) / 100

  return {
    supplierRef: status.supplierRef,
    productRef: status.productRef,
    previousUnitCost: status.previousUnitCost,
    newUnitCost: status.unitCost,
    delta,
    changePct,
    direction: delta.minor >= 0 ? 'increase' : 'decrease',
    significant: Math.abs(changePct) >= significanceThresholdPct,
    detectedAt: now.toISOString(),
  }
}

/** Extracts every price change across a batch of statuses in one pass. */
export function detectPriceChanges(
  statuses: readonly SupplierProductStatus[],
  significanceThresholdPct: number = DEFAULT_SIGNIFICANCE_THRESHOLD_PCT,
  now: Date = new Date(),
): readonly PriceChangeEvent[] {
  return statuses
    .map((status) => detectPriceChange(status, significanceThresholdPct, now))
    .filter((event): event is PriceChangeEvent => event !== null)
}
