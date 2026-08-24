import { calculatedMetric, factMetric, unknownMetric, type Metric } from './types'

/**
 * Fulfilment analytics (Milestone 10 §8) — pure aggregation over already
 * fetched `fulfilments`/`shipments` rows, the same "pure arithmetic, live
 * loader assembles the facts" split `salesAggregation.ts` established. A
 * shipment marked `shipped` with no `delivered_at` and no tracking number
 * is never assumed delivered — it is `unknown`, exactly the brief's
 * explicit instruction.
 */

export interface FulfilmentRecordFact {
  status: string
  submittedAt: string | null
  shippedAt: string | null
  deliveredAt: string | null
  /** A date (not a timestamp) — the delivery promise, per `shipments.promised_by`. */
  promisedBy: string | null
  trackingNumber: string | null
}

export interface FulfilmentAnalytics {
  totalFulfilments: Metric<number>
  awaitingFulfilment: Metric<number>
  delivered: Metric<number>
  failed: Metric<number>
  cancelled: Metric<number>
  cancellationRatePct: Metric<number>
  missingTracking: Metric<number>
  averageDispatchDays: Metric<number>
  onTimeDeliveryRatePct: Metric<number>
  lateDeliveries: Metric<number>
  /** Shipped, with no delivery confirmation and no tracking to check it against — a real, honest gap, never presented as "delivered." */
  unknownDeliveryOutcome: Metric<number>
}

const AWAITING_STATUSES = new Set(['pending', 'awaiting_supplier', 'submitted', 'accepted'])
const SHIPPED_OR_LATER_STATUSES = new Set(['shipped', 'delivered'])

export function buildFulfilmentAnalytics(records: readonly FulfilmentRecordFact[]): FulfilmentAnalytics {
  if (records.length === 0) {
    return {
      totalFulfilments: factMetric(0, 'no fulfilments recorded in this window'),
      awaitingFulfilment: factMetric(0, 'fulfilments.status'),
      delivered: factMetric(0, 'fulfilments.status'),
      failed: factMetric(0, 'fulfilments.status'),
      cancelled: factMetric(0, 'fulfilments.status'),
      cancellationRatePct: unknownMetric('no fulfilments to compute a rate from'),
      missingTracking: factMetric(0, 'shipments.tracking_number'),
      averageDispatchDays: unknownMetric('no dispatched fulfilments to average'),
      onTimeDeliveryRatePct: unknownMetric('no delivered fulfilments to compute a rate from'),
      lateDeliveries: factMetric(0, 'fulfilments.status'),
      unknownDeliveryOutcome: factMetric(0, 'fulfilments.status'),
    }
  }

  const awaiting = records.filter((r) => AWAITING_STATUSES.has(r.status)).length
  const delivered = records.filter((r) => r.status === 'delivered').length
  const failed = records.filter((r) => r.status === 'failed').length
  const cancelled = records.filter((r) => r.status === 'cancelled').length

  const shippedOrLater = records.filter((r) => SHIPPED_OR_LATER_STATUSES.has(r.status))
  const missingTracking = shippedOrLater.filter((r) => !r.trackingNumber).length

  const dispatched = records.filter((r) => r.submittedAt && r.shippedAt)
  const avgDispatchDays = dispatched.length === 0 ? null : dispatched.reduce((sum, r) => {
    const days = (new Date(r.shippedAt as string).getTime() - new Date(r.submittedAt as string).getTime()) / (1000 * 60 * 60 * 24)
    return sum + days
  }, 0) / dispatched.length

  const withPromise = shippedOrLater.filter((r) => r.promisedBy)
  const deliveredWithPromise = withPromise.filter((r) => r.deliveredAt)
  const onTime = deliveredWithPromise.filter((r) => new Date(r.deliveredAt as string).getTime() <= new Date(r.promisedBy as string).getTime()).length
  const late = deliveredWithPromise.length - onTime

  // Shipped, no delivery confirmation, and nothing (tracking) to even check against.
  const unknownOutcome = shippedOrLater.filter((r) => r.status === 'shipped' && !r.deliveredAt && !r.trackingNumber).length

  return {
    totalFulfilments: factMetric(records.length, 'fulfilments rows in this window'),
    awaitingFulfilment: factMetric(awaiting, 'fulfilments.status in (pending, awaiting_supplier, submitted, accepted)'),
    delivered: factMetric(delivered, 'fulfilments.status = delivered'),
    failed: factMetric(failed, 'fulfilments.status = failed'),
    cancelled: factMetric(cancelled, 'fulfilments.status = cancelled'),
    cancellationRatePct: calculatedMetric(Math.round((cancelled / records.length) * 10000) / 100, 'cancelled / total fulfilments'),
    missingTracking: factMetric(missingTracking, 'shipped or delivered fulfilments with no shipments.tracking_number'),
    averageDispatchDays: avgDispatchDays === null
      ? unknownMetric('no fulfilment has both a submitted_at and a shipped_at yet')
      : calculatedMetric(Math.round(avgDispatchDays * 100) / 100, 'average of shipped_at - submitted_at, in days'),
    onTimeDeliveryRatePct: deliveredWithPromise.length === 0
      ? unknownMetric('no delivered fulfilment carries both a delivered_at and a promised_by to compare')
      : calculatedMetric(Math.round((onTime / deliveredWithPromise.length) * 10000) / 100, 'delivered_at <= promised_by, among fulfilments with both dates'),
    lateDeliveries: factMetric(late, 'delivered after promised_by, among fulfilments with both dates'),
    unknownDeliveryOutcome: factMetric(unknownOutcome, 'shipped with no delivered_at and no tracking number to check against'),
  }
}
