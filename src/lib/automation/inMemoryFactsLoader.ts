import { factFrom, FRESHNESS_WINDOW_HOURS, type ChannelProductFacts, type FactsLoader, type ProductFacts, type SupplierFacts, type SupplierOperationalFacts } from './factsTypes'
import type { Money } from '@/lib/core/money'

/**
 * A real (not mocked) in-memory `FactsLoader`, used by tests to drive job
 * handlers that need live facts end to end without a database — the same
 * pattern as `inMemoryStore.ts` in Milestone 6. Freshness is computed by the
 * exact same `factFrom` function the production loader (`facts.ts`) uses, so
 * a test genuinely exercises the staleness logic, not a stand-in for it.
 */
export interface SeedProduct {
  title: string
  category: string | null
  stage: string
  updatedAt: string | null
}

export interface SeedSupplierOffer {
  unitCost: Money
  shippingCost: Money
  stockQty: number | null
  inStock: boolean
  lastVerifiedAt: string | null
}

export interface SeedSupplier {
  shopifyStatus: string
  amazonStatus: string
  lastAssessedAt: string | null
}

export interface SeedChannelProduct {
  status: string
  priceMinor: number | null
  fulfilmentSupplierId: string | null
  externalId: string | null
  lastSyncedAt: string | null
  updatedAt: string | null
}

export interface SeedSupplierOperations {
  dispatchDaysMin: number | null
  dispatchDaysMax: number | null
  cancellationRatePct: number | null
  fulfilmentSuccessRatePct: number | null
  observedDeliveryDays: number | null
  connectorStatus: string | null
  /** Shared as-of for every field above — mirrors `stock_checked_at`/`last_success_at` in the real store. */
  asOf: string | null
}

export function createInMemoryFactsLoader(seed?: {
  products?: Record<string, SeedProduct>
  suppliers?: Record<string, SeedSupplier>
  offers?: Record<string, SeedSupplierOffer> // key: `${supplierId}:${productId}`
  channelProducts?: Record<string, SeedChannelProduct>
  supplierOperations?: Record<string, SeedSupplierOperations> // key: supplierId
}): FactsLoader {
  const products = seed?.products ?? {}
  const suppliers = seed?.suppliers ?? {}
  const offers = seed?.offers ?? {}
  const channelProducts = seed?.channelProducts ?? {}
  const supplierOperations = seed?.supplierOperations ?? {}

  return {
    async loadProductFacts(_orgId: string, productId: string, now: Date = new Date()): Promise<ProductFacts> {
      const p = products[productId]
      return {
        productId,
        title: factFrom(p?.title, p?.updatedAt ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
        category: factFrom(p?.category ?? null, p?.updatedAt ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
        stage: factFrom(p?.stage, p?.updatedAt ?? null, FRESHNESS_WINDOW_HOURS.productCatalogue, now),
      }
    },

    async loadSupplierFactsForProduct(_orgId: string, supplierId: string, productId: string, now: Date = new Date()): Promise<SupplierFacts> {
      const supplier = suppliers[supplierId]
      const offer = offers[`${supplierId}:${productId}`]
      return {
        supplierId,
        unitCost: factFrom(offer?.unitCost, offer?.lastVerifiedAt ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        shippingCost: factFrom(offer?.shippingCost, offer?.lastVerifiedAt ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        stockQty: factFrom(offer?.stockQty, offer?.lastVerifiedAt ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        inStock: factFrom(offer?.inStock, offer?.lastVerifiedAt ?? null, FRESHNESS_WINDOW_HOURS.supplierPricing, now),
        shopifyStatus: factFrom(supplier?.shopifyStatus, supplier?.lastAssessedAt ?? null, FRESHNESS_WINDOW_HOURS.supplierCompliance, now),
        amazonStatus: factFrom(supplier?.amazonStatus, supplier?.lastAssessedAt ?? null, FRESHNESS_WINDOW_HOURS.supplierCompliance, now),
      }
    },

    async loadChannelProductFacts(_orgId: string, channelProductId: string, now: Date = new Date()): Promise<ChannelProductFacts> {
      const cp = channelProducts[channelProductId]
      const asOf = cp?.lastSyncedAt ?? null
      return {
        channelProductId,
        status: factFrom(cp?.status, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
        priceMinor: factFrom(cp?.priceMinor, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
        fulfilmentSupplierId: factFrom(cp?.fulfilmentSupplierId, asOf ?? cp?.updatedAt ?? null, FRESHNESS_WINDOW_HOURS.channelListing, now),
        externalId: factFrom(cp?.externalId, asOf, FRESHNESS_WINDOW_HOURS.channelListing, now),
      }
    },

    async loadSupplierOperationalFacts(_orgId: string, supplierId: string, now: Date = new Date()): Promise<SupplierOperationalFacts> {
      const ops = supplierOperations[supplierId]
      return {
        supplierId,
        dispatchDaysMin: factFrom(ops?.dispatchDaysMin ?? null, ops?.asOf ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        dispatchDaysMax: factFrom(ops?.dispatchDaysMax ?? null, ops?.asOf ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        cancellationRatePct: factFrom(ops?.cancellationRatePct ?? null, ops?.asOf ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        fulfilmentSuccessRatePct: factFrom(ops?.fulfilmentSuccessRatePct ?? null, ops?.asOf ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        observedDeliveryDays: factFrom(ops?.observedDeliveryDays ?? null, ops?.asOf ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations * 7, now),
        connectorStatus: factFrom(ops?.connectorStatus ?? null, ops?.asOf ?? null, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
      }
    },
  }
}
