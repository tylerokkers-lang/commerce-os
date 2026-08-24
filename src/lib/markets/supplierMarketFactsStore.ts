import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { factFrom, FRESHNESS_WINDOW_HOURS } from '@/lib/automation/factsTypes'
import type { SupplierMarketCapabilityFacts, SupplierMarketFactsLoader } from './supplierMarketFacts'

/** The production `SupplierMarketFactsLoader`: real reads against `supplier_market_capabilities`. Read-only, like `automation/facts.ts` — this module never writes. */
export function getSupabaseSupplierMarketFactsLoader(): SupplierMarketFactsLoader {
  return {
    async loadSupplierMarketCapability(orgId: string, supplierId: string, countryCode: string, now: Date = new Date()): Promise<SupplierMarketCapabilityFacts> {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('supplier_market_capabilities')
        .select('can_ship, shipping_cost_minor, shipping_currency, delivery_days_min, delivery_days_max, cancellation_rate_pct, last_verified_at')
        .eq('org_id', orgId).eq('supplier_id', supplierId).eq('country_code', countryCode)
        .maybeSingle()

      const asOf = data?.last_verified_at ?? null
      return {
        supplierId, countryCode,
        canShip: factFrom(data?.can_ship, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        shippingCostMinor: factFrom(data?.shipping_cost_minor ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        shippingCurrency: factFrom(data?.shipping_currency ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        deliveryDaysMin: factFrom(data?.delivery_days_min ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        deliveryDaysMax: factFrom(data?.delivery_days_max ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
        cancellationRatePct: factFrom(data?.cancellation_rate_pct ?? null, asOf, FRESHNESS_WINDOW_HOURS.supplierOperations, now),
      }
    },
  }
}
