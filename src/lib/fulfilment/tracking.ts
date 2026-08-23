/**
 * Delivery monitoring (Milestone 5).
 *
 * "Missing tracking" as a first-class case: a shipment that has been marked
 * shipped but never received a tracking number, or one whose last known
 * status is old enough that something has likely gone wrong, needs to be
 * surfaced rather than sitting silently in "shipped" forever. Both checks are
 * pure functions over a shipment's own recorded fields — no network call, no
 * assumption about what the carrier is doing right now, only what we can
 * actually tell from what we have on file.
 */

export interface ShipmentRecord {
  shippedAt: string | null
  deliveredAt: string | null
  trackingNumber: string | null
  promisedBy: string | null
  lastStatusAt: string | null
}

export interface DeliveryHealthIssue {
  key: 'missing_tracking' | 'stale_status' | 'overdue'
  detail: string
}

/** A shipment with no status update in this long is worth a look. */
const STALE_STATUS_DAYS = 5

const daysBetween = (a: Date, b: Date): number => Math.abs(a.getTime() - b.getTime()) / 86_400_000

export function assessDeliveryHealth(shipment: ShipmentRecord, now: Date = new Date()): readonly DeliveryHealthIssue[] {
  const issues: DeliveryHealthIssue[] = []

  if (shipment.deliveredAt) return issues // Already resolved; nothing to monitor.

  if (shipment.shippedAt && !shipment.trackingNumber) {
    issues.push({
      key: 'missing_tracking',
      detail: `Marked shipped on ${shipment.shippedAt} but no tracking number has been recorded.`,
    })
  }

  if (shipment.lastStatusAt) {
    const staleDays = daysBetween(now, new Date(shipment.lastStatusAt))
    if (staleDays > STALE_STATUS_DAYS) {
      issues.push({
        key: 'stale_status',
        detail: `Last tracking update was ${Math.floor(staleDays)} days ago, beyond the ${STALE_STATUS_DAYS}-day freshness window.`,
      })
    }
  } else if (shipment.shippedAt) {
    issues.push({
      key: 'stale_status',
      detail: 'Marked shipped, but no tracking status has ever been received.',
    })
  }

  if (shipment.promisedBy) {
    const promised = new Date(shipment.promisedBy)
    if (now > promised) {
      issues.push({
        key: 'overdue',
        detail: `Delivery was promised by ${shipment.promisedBy}, which has passed.`,
      })
    }
  }

  return issues
}

export const isHealthy = (shipment: ShipmentRecord, now: Date = new Date()): boolean =>
  assessDeliveryHealth(shipment, now).length === 0
