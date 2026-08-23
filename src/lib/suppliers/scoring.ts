import { toMajor, type Money } from '@/lib/core/money'
import type { ApprovalStatus } from '@/lib/core/domain'

/**
 * Supplier scoring (§13).
 *
 * The rule this exists to enforce: never simply pick the cheapest supplier.
 * A supplier costing a pound more per unit but delivering reliably in two days
 * is worth substantially more than one costing less and taking three weeks,
 * because the difference shows up as cancellations, refunds, poor reviews and
 * marketplace metrics rather than as a line on the purchase order.
 *
 * Cost therefore carries less weight than delivery and reliability combined.
 */

export const SUPPLIER_WEIGHTS_VERSION = 'supplier-weights@1'

/** Weights sum to 100. */
export const SUPPLIER_WEIGHTS: Readonly<Record<string, number>> = {
  cost: 18,
  delivery: 20,
  reliability: 18,
  quality: 15,
  returns: 10,
  tracking: 7,
  compliance: 12,
}

export interface SupplierSignals {
  /** Unit cost offered by this supplier. */
  unitCost: Money
  /** Shipping charged on top. */
  shippingCost: Money
  /**
   * The best unit cost available for the same product from any supplier.
   * Cost is scored relatively: being 5% above the cheapest is very different
   * from being 80% above it.
   */
  bestAvailableUnitCost?: Money
  /**
   * Alternative to `bestAvailableUnitCost` when there is no single product in
   * context: this supplier's landed cost divided by the best available,
   * averaged across the products where it competes. 1 means consistently
   * cheapest.
   */
  costPremiumRatio?: number

  deliveryDaysMin?: number
  deliveryDaysMax?: number

  /** Observed history. Undefined means no orders placed yet. */
  ordersPlaced?: number
  ordersLate?: number
  ordersDefective?: number

  /** 1-5 stars, our own assessment. */
  qualityRating?: number
  communicationRating?: number

  handlesReturns: boolean
  returnsWindowDays?: number
  acceptsFaultyReturns: boolean

  providesTracking: boolean

  /** Capability flags that decide Amazon eligibility. */
  supportsBlindShipping: boolean
  supportsCustomInvoice: boolean
  supportsCustomPackaging: boolean
  supportsOwnBranding: boolean

  /** Compliance paperwork actually on file. */
  documentCount?: number
}

export interface SupplierComponent {
  key: string
  label: string
  score: number | null
  weight: number
  contribution: number
  basis: string
}

export interface SupplierScore {
  total: number
  band: 'preferred' | 'acceptable' | 'marginal' | 'unsuitable'
  bandLabel: string
  components: readonly SupplierComponent[]
  strengths: readonly string[]
  weaknesses: readonly string[]
  /** 0-1, driven by how much observed history exists rather than claims. */
  confidence: number
  weightsVersion: string
  scoredAt: string
}

const clamp = (v: number, min = 0, max = 100) => Math.max(min, Math.min(max, v))
const inverseLinear = (value: number, best: number, worst: number): number =>
  clamp(((worst - value) / (worst - best)) * 100)

export function scoreSupplier(signals: SupplierSignals, now: Date = new Date()): SupplierScore {
  const components: SupplierComponent[] = []

  const push = (key: string, label: string, score: number | null, basis: string) => {
    components.push({ key, label, score, weight: SUPPLIER_WEIGHTS[key], contribution: 0, basis })
  }

  // --- Cost, scored relative to the best offer we have -----------------------
  const landed = signals.unitCost.minor + signals.shippingCost.minor
  if (
    (signals.bestAvailableUnitCost && signals.bestAvailableUnitCost.minor > 0) ||
    signals.costPremiumRatio !== undefined
  ) {
    const premium =
      signals.costPremiumRatio ??
      landed / (signals.bestAvailableUnitCost as Money).minor
    push(
      'cost',
      'Cost',
      // At parity with the cheapest this scores 100; at double it scores 0.
      inverseLinear(premium, 1, 2),
      `£${toMajor({ minor: landed, currency: signals.unitCost.currency }).toFixed(2)} landed, ${premium <= 1.001 ? 'the best price available' : `${((premium - 1) * 100).toFixed(0)}% above the best available price`}.`,
    )
  } else {
    push(
      'cost',
      'Cost',
      null,
      'No competing quote on file, so cost cannot be scored relatively. Add a second supplier for this product to make the comparison meaningful.',
    )
  }

  // --- Delivery --------------------------------------------------------------
  if (signals.deliveryDaysMax !== undefined) {
    push(
      'delivery',
      'Delivery speed',
      inverseLinear(signals.deliveryDaysMax, 2, 21),
      signals.deliveryDaysMin !== undefined
        ? `Quotes ${signals.deliveryDaysMin} to ${signals.deliveryDaysMax} days.`
        : `Quotes up to ${signals.deliveryDaysMax} days.`,
    )
  } else {
    push('delivery', 'Delivery speed', null, 'No delivery estimate on file.')
  }

  // --- Reliability, from observed history only -------------------------------
  const placed = signals.ordersPlaced ?? 0
  if (placed >= 5) {
    const late = signals.ordersLate ?? 0
    const onTimePct = ((placed - late) / placed) * 100
    push(
      'reliability',
      'Reliability',
      // 85% on time is poor for ecommerce; 99% is what a good supplier holds.
      clamp(((onTimePct - 80) / 19) * 100),
      `${onTimePct.toFixed(1)}% of ${placed} orders arrived on time.`,
    )
  } else if (placed > 0) {
    push(
      'reliability',
      'Reliability',
      null,
      `Only ${placed} order${placed === 1 ? '' : 's'} placed so far. Too little history to score reliability, which is treated as unknown rather than good.`,
    )
  } else {
    push(
      'reliability',
      'Reliability',
      null,
      'No orders placed yet, so there is no observed reliability. A new supplier is unproven, not reliable.',
    )
  }

  // --- Quality ---------------------------------------------------------------
  if (signals.qualityRating !== undefined) {
    const defectPenalty =
      placed > 0 && signals.ordersDefective !== undefined
        ? (signals.ordersDefective / placed) * 100
        : 0
    push(
      'quality',
      'Quality',
      clamp(((signals.qualityRating - 1) / 4) * 100 - defectPenalty * 2),
      defectPenalty > 0
        ? `Rated ${signals.qualityRating.toFixed(1)} out of 5, with ${signals.ordersDefective} defective of ${placed} orders.`
        : `Rated ${signals.qualityRating.toFixed(1)} out of 5.`,
    )
  } else {
    push('quality', 'Quality', null, 'No quality assessment recorded yet.')
  }

  // --- Returns ---------------------------------------------------------------
  {
    let score = 0
    const parts: string[] = []
    if (signals.handlesReturns) {
      score += 60
      parts.push('handles returns')
    } else {
      parts.push('does not handle returns')
    }
    if (signals.acceptsFaultyReturns) {
      score += 25
      parts.push('accepts faulty goods back')
    }
    if (signals.returnsWindowDays !== undefined && signals.returnsWindowDays >= 30) {
      score += 15
      parts.push(`${signals.returnsWindowDays} day window`)
    } else if (signals.returnsWindowDays !== undefined) {
      parts.push(`only a ${signals.returnsWindowDays} day window`)
    }
    push('returns', 'Returns', clamp(score), `Supplier ${parts.join(', ')}.`)
  }

  // --- Tracking --------------------------------------------------------------
  push(
    'tracking',
    'Tracking',
    signals.providesTracking ? 100 : 0,
    signals.providesTracking
      ? 'Provides tracking numbers, which both channels require to confirm dispatch.'
      : 'Provides no tracking. Amazon requires valid tracking, and its absence damages delivery metrics on both channels.',
  )

  // --- Compliance capability -------------------------------------------------
  {
    let score = 0
    const missing: string[] = []
    if (signals.supportsCustomInvoice) score += 35
    else missing.push('cannot issue documentation in our name')
    if (signals.supportsBlindShipping) score += 30
    else missing.push('does not ship blind')
    if (signals.supportsCustomPackaging) score += 15
    else missing.push('no custom packaging')
    if (signals.supportsOwnBranding) score += 10
    if ((signals.documentCount ?? 0) > 0) score += 10
    else missing.push('no compliance documents on file')

    push(
      'compliance',
      'Compliance capability',
      clamp(score),
      missing.length === 0
        ? 'Meets every capability the channels require, with documentation on file.'
        : `Gaps: ${missing.join('; ')}.`,
    )
  }

  // --- Weighted total, renormalised across what is known ---------------------
  const available = components.filter((c) => c.score !== null)
  const availableWeight = available.reduce((sum, c) => sum + c.weight, 0)
  const totalWeight = Object.values(SUPPLIER_WEIGHTS).reduce((a, b) => a + b, 0)

  for (const component of components) {
    component.contribution =
      component.score === null || availableWeight === 0
        ? 0
        : component.score * (component.weight / availableWeight)
  }

  const total = Math.round(clamp(components.reduce((sum, c) => sum + c.contribution, 0)))

  const band =
    total >= 80 ? 'preferred' : total >= 60 ? 'acceptable' : total >= 40 ? 'marginal' : 'unsuitable'
  const bandLabel = { preferred: 'Preferred', acceptable: 'Acceptable', marginal: 'Marginal', unsuitable: 'Unsuitable' }[band]

  const strengths = available
    .filter((c) => (c.score ?? 0) >= 70)
    .sort((a, b) => b.contribution - a.contribution)
    .map((c) => `${c.label}: ${c.basis}`)

  const weaknesses = available
    .filter((c) => (c.score ?? 100) < 50)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .map((c) => `${c.label}: ${c.basis}`)

  const unknown = components.filter((c) => c.score === null)
  for (const component of unknown) {
    weaknesses.push(`${component.label}: ${component.basis}`)
  }

  // Confidence rests on observed history, not on what the supplier claims.
  const historyConfidence = placed === 0 ? 0.2 : placed < 5 ? 0.45 : placed < 20 ? 0.7 : 0.9
  const coverage = totalWeight === 0 ? 0 : availableWeight / totalWeight
  const confidence = Math.round(coverage * historyConfidence * 100) / 100

  return {
    total,
    band,
    bandLabel,
    components,
    strengths,
    weaknesses,
    confidence,
    weightsVersion: SUPPLIER_WEIGHTS_VERSION,
    scoredAt: now.toISOString(),
  }
}

/**
 * Ranks suppliers for a product.
 *
 * Deliberately sorts on the composite score, not on price. The cheapest
 * supplier appears first only when it also delivers, tracks and handles
 * returns well enough to earn the position.
 */
export interface RankedSupplier<T> {
  supplier: T
  score: SupplierScore
  /** Set when this supplier is cheapest but is not the recommendation. */
  cheaperButNotRecommended: boolean
}

export function rankSuppliers<T>(
  entries: readonly { supplier: T; signals: SupplierSignals }[],
  now: Date = new Date(),
): readonly RankedSupplier<T>[] {
  const scored = entries.map((entry) => ({
    supplier: entry.supplier,
    signals: entry.signals,
    score: scoreSupplier(entry.signals, now),
  }))

  const cheapestLanded = Math.min(
    ...scored.map((s) => s.signals.unitCost.minor + s.signals.shippingCost.minor),
  )

  const ranked = [...scored].sort((a, b) => b.score.total - a.score.total)

  return ranked.map((entry, index) => ({
    supplier: entry.supplier,
    score: entry.score,
    cheaperButNotRecommended:
      index > 0 && entry.signals.unitCost.minor + entry.signals.shippingCost.minor === cheapestLanded,
  }))
}

/**
 * Whether a supplier's capabilities satisfy a channel's requirements.
 *
 * This is capability only. It answers "could this supplier fulfil for this
 * channel", not "is this product compliant", which the compliance engine
 * decides separately and which can still fail for product-specific reasons.
 */
export interface ChannelCapability {
  status: ApprovalStatus
  reasons: readonly string[]
}

export function assessShopifyCapability(signals: SupplierSignals): ChannelCapability {
  const blockers: string[] = []
  const cautions: string[] = []

  if (!signals.providesTracking) {
    cautions.push('No tracking, which drives customer contact and chargebacks.')
  }
  if (!signals.handlesReturns) {
    cautions.push('Does not handle returns, so we absorb the cost and the handling.')
  }
  if ((signals.deliveryDaysMax ?? 99) > 14) {
    cautions.push(
      `Delivery of up to ${signals.deliveryDaysMax} days needs to be stated plainly at checkout to avoid disputes.`,
    )
  }
  if ((signals.deliveryDaysMax ?? 99) > 30) {
    blockers.push('Delivery beyond 30 days is not a reasonable customer promise.')
  }

  if (blockers.length > 0) return { status: 'blocked', reasons: blockers }
  if (cautions.length > 0) return { status: 'review_required', reasons: cautions }
  return { status: 'approved', reasons: ['Meets the delivery, tracking and returns expectations for a direct-to-customer store.'] }
}

/**
 * Amazon's requirements are materially stricter than Shopify's (§15).
 *
 * The seller of record obligation is the one that blocks most dropship
 * suppliers: if the parcel or its paperwork identifies another retailer, the
 * arrangement is not permitted regardless of how good the supplier otherwise is.
 */
export function assessAmazonCapability(signals: SupplierSignals): ChannelCapability {
  const blockers: string[] = []
  const cautions: string[] = []

  if (!signals.supportsCustomInvoice) {
    blockers.push(
      'Cannot issue invoices and packing slips in our name, so we could not remain the seller of record.',
    )
  }
  if (!signals.supportsBlindShipping) {
    blockers.push(
      'Does not ship blind, so the parcel would identify another retailer to the customer.',
    )
  }
  if (!signals.handlesReturns) {
    blockers.push(
      'Will not handle returns, and responsibility for returns cannot be passed to the customer or the supplier.',
    )
  }
  if (!signals.providesTracking) {
    blockers.push('Provides no tracking, which is required to confirm dispatch.')
  }
  if ((signals.deliveryDaysMax ?? 99) > 14) {
    blockers.push(
      `Delivery of up to ${signals.deliveryDaysMax} days will not meet the delivery promise.`,
    )
  } else if ((signals.deliveryDaysMax ?? 99) > 7) {
    cautions.push(
      `Delivery of up to ${signals.deliveryDaysMax} days leaves little margin against the promised date.`,
    )
  }
  if ((signals.documentCount ?? 0) === 0) {
    cautions.push('No compliance documentation on file for this supplier.')
  }

  if (blockers.length > 0) return { status: 'blocked', reasons: blockers }
  if (cautions.length > 0) return { status: 'review_required', reasons: cautions }
  return {
    status: 'approved',
    reasons: [
      'Ships blind, issues documentation in our name, provides tracking, handles returns, and meets the delivery expectation.',
    ],
  }
}
