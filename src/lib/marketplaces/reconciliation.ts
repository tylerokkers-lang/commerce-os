import type {
  MarketplaceInventorySnapshot,
  MarketplaceListingSnapshot,
  MarketplaceOrderSnapshot,
} from './connectors/types'

/**
 * Reconciliation: comparing what Commerce OS believes against what the
 * marketplace itself reports.
 *
 * The rule this exists to enforce is in the milestone brief verbatim:
 * "The system should detect the discrepancy and record it rather than
 * silently assuming one source is correct." Every function here returns a
 * record with both values and lets the caller — a person, or a later
 * automation rule with its own policy — decide which one to trust and how.
 * Nothing here overwrites our own data with the marketplace's, or vice versa.
 */

export type DiscrepancyField = 'stock' | 'price' | 'listing_status' | 'order_status' | 'fulfilment_status' | 'tracking'

export interface Discrepancy {
  field: DiscrepancyField
  channelProductRef: string
  ourValue: string
  marketplaceValue: string
  ourRecordedAt: string
  marketplaceReportedAt: string
}

export interface OurInventoryRecord {
  channelProductRef: string
  stockQty: number
  recordedAt: string
}

export interface OurListingRecord {
  channelProductRef: string
  priceMinor: number
  status: string
  recordedAt: string
}

export interface OurOrderRecord {
  externalId: string
  status: string
  recordedAt: string
}

/**
 * Compares our inventory records against a marketplace's inventory snapshot.
 *
 * Matches on `channelProductRef` (our SKU), not on the marketplace's own
 * listing id, because that is the identifier we actually control and can
 * always look a record up by.
 */
export function reconcileInventory(
  ours: readonly OurInventoryRecord[],
  marketplace: readonly MarketplaceInventorySnapshot[],
): readonly Discrepancy[] {
  const byRef = new Map(ours.map((record) => [record.channelProductRef, record]))
  const discrepancies: Discrepancy[] = []

  for (const snapshot of marketplace) {
    const our = byRef.get(snapshot.channelProductRef)
    if (!our) continue // We don't hold this SKU; nothing to reconcile yet.
    if (our.stockQty === snapshot.stockQty) continue

    discrepancies.push({
      field: 'stock',
      channelProductRef: snapshot.channelProductRef,
      ourValue: String(our.stockQty),
      marketplaceValue: String(snapshot.stockQty),
      ourRecordedAt: our.recordedAt,
      marketplaceReportedAt: snapshot.reportedAt,
    })
  }

  return discrepancies
}

/** Same shape as inventory reconciliation, but for price and listing status together. */
export function reconcileListings(
  ours: readonly OurListingRecord[],
  marketplace: readonly MarketplaceListingSnapshot[],
): readonly Discrepancy[] {
  const byRef = new Map(ours.map((record) => [record.channelProductRef, record]))
  const discrepancies: Discrepancy[] = []

  for (const snapshot of marketplace) {
    const our = byRef.get(snapshot.channelProductRef)
    if (!our) continue

    if (our.priceMinor !== snapshot.priceMinor) {
      discrepancies.push({
        field: 'price',
        channelProductRef: snapshot.channelProductRef,
        ourValue: String(our.priceMinor),
        marketplaceValue: String(snapshot.priceMinor),
        ourRecordedAt: our.recordedAt,
        marketplaceReportedAt: snapshot.reportedAt,
      })
    }

    // A listing status is only comparable in the coarse sense — "does the
    // marketplace still think this is live" — because our own status carries
    // finer distinctions (review_required, testing) the marketplace has no
    // concept of.
    const marketplaceIsLive = snapshot.status === 'active'
    const weThinkItsLive = our.status === 'live'
    if (marketplaceIsLive !== weThinkItsLive) {
      discrepancies.push({
        field: 'listing_status',
        channelProductRef: snapshot.channelProductRef,
        ourValue: our.status,
        marketplaceValue: snapshot.status,
        ourRecordedAt: our.recordedAt,
        marketplaceReportedAt: snapshot.reportedAt,
      })
    }
  }

  return discrepancies
}

/** Order status reconciliation, matched on the marketplace's own order id. */
export function reconcileOrders(
  ours: readonly OurOrderRecord[],
  marketplace: readonly MarketplaceOrderSnapshot[],
): readonly Discrepancy[] {
  const byExternalId = new Map(ours.map((record) => [record.externalId, record]))
  const discrepancies: Discrepancy[] = []

  for (const snapshot of marketplace) {
    const our = byExternalId.get(snapshot.externalId)
    if (!our) continue
    if (our.status === snapshot.status) continue

    discrepancies.push({
      field: 'order_status',
      channelProductRef: snapshot.externalId,
      ourValue: our.status,
      marketplaceValue: snapshot.status,
      ourRecordedAt: our.recordedAt,
      marketplaceReportedAt: snapshot.placedAt,
    })
  }

  return discrepancies
}

export interface ReconciliationSummary {
  discrepancies: readonly Discrepancy[]
  checkedCount: number
  discrepancyCount: number
  byField: Readonly<Record<DiscrepancyField, number>>
}

/** Rolls up discrepancies from any of the reconcile* functions into one summary for a run record. */
export function summariseDiscrepancies(
  discrepancies: readonly Discrepancy[],
  checkedCount: number,
): ReconciliationSummary {
  const byField: Record<DiscrepancyField, number> = {
    stock: 0,
    price: 0,
    listing_status: 0,
    order_status: 0,
    fulfilment_status: 0,
    tracking: 0,
  }
  for (const d of discrepancies) byField[d.field] += 1

  return {
    discrepancies,
    checkedCount,
    discrepancyCount: discrepancies.length,
    byField,
  }
}
