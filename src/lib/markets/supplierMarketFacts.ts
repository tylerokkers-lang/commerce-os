import { factFrom, FRESHNESS_WINDOW_HOURS, type Fact } from '@/lib/automation/factsTypes'

/**
 * Supplier destination-shipping facts (Milestone 9 §6.2) — a small,
 * dedicated loader for `supplier_market_capabilities`, kept separate from
 * `automation/factsTypes.ts`'s `FactsLoader` (which answers questions
 * about one product/supplier pairing, not one supplier/country pairing)
 * rather than overloading that interface with a concept it was not built
 * for. Same "define the interface, satisfy it twice" pattern throughout
 * this codebase: `getSupabaseSupplierMarketFactsLoader` (production) and
 * `createInMemorySupplierMarketFactsLoader` (tests) both satisfy
 * `SupplierMarketFactsLoader`.
 */

export interface SupplierMarketCapabilityFacts {
  supplierId: string
  countryCode: string
  canShip: Fact<boolean>
  shippingCostMinor: Fact<number>
  shippingCurrency: Fact<string>
  deliveryDaysMin: Fact<number | null>
  deliveryDaysMax: Fact<number | null>
  cancellationRatePct: Fact<number | null>
}

export interface SupplierMarketFactsLoader {
  loadSupplierMarketCapability(orgId: string, supplierId: string, countryCode: string, now?: Date): Promise<SupplierMarketCapabilityFacts>
}

export interface SeedSupplierMarketCapability {
  canShip: boolean
  shippingCostMinor: number | null
  shippingCurrency: string | null
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  cancellationRatePct: number | null
  lastVerifiedAt: string | null
}

export function createInMemorySupplierMarketFactsLoader(seed?: Record<string, SeedSupplierMarketCapability>): SupplierMarketFactsLoader {
  const capabilities = seed ?? {}

  return {
    async loadSupplierMarketCapability(_orgId: string, supplierId: string, countryCode: string, now: Date = new Date()): Promise<SupplierMarketCapabilityFacts> {
      const cap = capabilities[`${supplierId}:${countryCode}`]
      const asOf = cap?.lastVerifiedAt ?? null
      return {
        supplierId, countryCode,
        canShip: factFrom(cap?.canShip, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        shippingCostMinor: factFrom(cap?.shippingCostMinor ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        shippingCurrency: factFrom(cap?.shippingCurrency ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        deliveryDaysMin: factFrom(cap?.deliveryDaysMin ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        deliveryDaysMax: factFrom(cap?.deliveryDaysMax ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        cancellationRatePct: factFrom(cap?.cancellationRatePct ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
      }
    },
  }
}
