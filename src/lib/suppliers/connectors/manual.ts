import { ok, type Result } from '@/lib/core/result'
import { DEMO_SUPPLIERS } from '@/lib/demo/suppliers'
import type {
  ConnectorDescriptor,
  FetchStatusOptions,
  FetchStatusOutcome,
  SupplierConnector,
  SupplierProductStatus,
} from './types'

/**
 * The manual/CSV connector.
 *
 * The one connector type that genuinely needs no credentials: a manually
 * maintained catalogue, typed in or uploaded as a spreadsheet, is a
 * legitimate sourcing method and the natural starting point for any supplier
 * relationship before an API or feed exists. This implementation is real, not
 * a placeholder — it computes actual `SupplierProductStatus` values from the
 * supplier records already in the system, which is exactly what a manual
 * connector does for a live business: it reflects whatever was last typed in.
 *
 * A short, fixed set of price-change events is included so the "detect a
 * supplier price increase" scenario (the flagship automation example for a
 * later milestone) has something real to detect today, rather than only
 * becoming testable once a live feed exists.
 */

const DESCRIPTOR: ConnectorDescriptor = {
  key: 'manual',
  label: 'Manual / CSV catalogue',
  description:
    'Supplier cost, stock and delivery data maintained by hand or imported from a spreadsheet. No credentials required, and no network request is ever made.',
  sourceType: 'manual',
  requiredCredentials: [],
  rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
  capabilities: {
    // A person can capture a new candidate by hand at any time (the
    // supplier discovery UI's manual entry form) — genuinely true, unlike
    // an automated "find new products" call.
    discoverProducts: true,
    readProducts: true,
    readStock: true,
    readShipping: true,
    placeOrders: false,
    cancelOrders: false,
    trackingUpdates: false, readProductMedia: false,
  },
  usagePolicy: {
    termsUrl: null,
    permittedUseNote:
      'Data entered directly by the business or its supplier. No third-party terms apply.',
    authenticatedFirstParty: false,
  },
}

/**
 * Deliberately awkward, like the research demo data: one supplier whose price
 * just rose enough to matter, and the rest unchanged, so the price-change
 * detection path in `fetchStatus` has one real positive to find.
 */
const PRICE_EVENTS: ReadonlyMap<string, { previousUnitCostMinor: number }> = new Map([
  // Northwind's desk lamp: was £9.10, now £9.80 — an 7.7% increase.
  ['sup-2:demo-usb-desk-lamp', { previousUnitCostMinor: 910 }],
])

const STOCK_CHECKED_AT = '2026-08-23T08:00:00.000Z'

export class ManualSupplierConnector implements SupplierConnector {
  readonly descriptor = DESCRIPTOR

  /** Needs nothing, so it is always available. */
  isConfigured(): boolean {
    return true
  }

  async fetchStatus(options: FetchStatusOptions): Promise<Result<FetchStatusOutcome, string>> {
    const known = options.knownRefs ?? new Set<string>()
    const statuses: SupplierProductStatus[] = []

    for (const supplier of DEMO_SUPPLIERS) {
      for (const productRef of supplier.supplies) {
        const key = `${supplier.id}:${productRef}`
        if (known.has(key)) continue
        if (statuses.length >= options.limit) break

        const priceEvent = PRICE_EVENTS.get(key)
        const currentMinor = supplier.signals.unitCost.minor
        const previousMinor = priceEvent?.previousUnitCostMinor

        statuses.push({
          supplierRef: supplier.id,
          productRef,
          unitCost: supplier.signals.unitCost,
          shippingCost: supplier.signals.shippingCost,
          previousUnitCost:
            previousMinor === undefined
              ? undefined
              : { minor: previousMinor, currency: supplier.signals.unitCost.currency },
          priceChangedSincePrevious: previousMinor !== undefined && previousMinor !== currentMinor,
          warehouseCountry: supplier.country,
          inStock: true,
          stockCheckedAt: STOCK_CHECKED_AT,
          dispatchDaysMin: supplier.signals.deliveryDaysMin,
          dispatchDaysMax: supplier.signals.deliveryDaysMax,
          deliveryDaysMin: supplier.signals.deliveryDaysMin,
          deliveryDaysMax: supplier.signals.deliveryDaysMax,
          providesTracking: supplier.signals.providesTracking,
          cancellationRatePct:
            supplier.signals.ordersPlaced && supplier.signals.ordersPlaced > 0
              ? Math.round(
                  ((supplier.signals.ordersLate ?? 0) / supplier.signals.ordersPlaced) * 1000,
                ) / 10
              : undefined,
          fulfilmentSuccessRatePct:
            supplier.signals.ordersPlaced && supplier.signals.ordersPlaced > 0
              ? Math.round(
                  ((supplier.signals.ordersPlaced - (supplier.signals.ordersDefective ?? 0)) /
                    supplier.signals.ordersPlaced) *
                    1000,
                ) / 10
              : undefined,
          documentationOnFile:
            supplier.documentCount > 0 ? Array(supplier.documentCount).fill('on_file') : [],
          raw: { note: 'From the manually maintained supplier catalogue.' },
        })
      }
    }

    return ok({
      statuses,
      requestsMade: 0,
      warnings: [],
    })
  }
}

export const manualSupplierConnector = new ManualSupplierConnector()
