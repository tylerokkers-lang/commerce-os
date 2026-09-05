import { supplierMonitor } from './monitors/supplierMonitor'
import { supplierOperationsMonitor } from './monitors/supplierOperationsMonitor'
import { marketplaceListingMonitor } from './monitors/marketplaceMonitor'
import { complianceMonitor } from './monitors/complianceMonitor'
import { profitabilityMonitor } from './monitors/profitabilityMonitor'
import { performanceMonitor } from './monitors/performanceMonitor'
import { fxMonitor } from './monitors/fxMonitor'
import { marketMonitor } from './monitors/marketMonitor'
import { candidateIntelligenceMonitor } from './monitors/candidateIntelligenceMonitor'
import type { Monitor, MonitorContext, MonitorRunOutcome } from './eventTypes'

/**
 * The monitor registry (brief's "extensible monitor interface"). Every
 * monitor is registered once, by its own `descriptor.key`, and the runner
 * (`runner.ts`) only ever dispatches through this map — the same
 * closed-registry discipline `automation/worker.ts`'s `HANDLERS` map uses,
 * for the same reason: a fixed, reviewable set of monitors, never anything
 * resembling evaluating configuration as code.
 */
export const MONITORS: Record<string, Monitor<never>> = {
  [supplierMonitor.descriptor.key]: supplierMonitor as Monitor<never>,
  [supplierOperationsMonitor.descriptor.key]: supplierOperationsMonitor as Monitor<never>,
  [marketplaceListingMonitor.descriptor.key]: marketplaceListingMonitor as Monitor<never>,
  [complianceMonitor.descriptor.key]: complianceMonitor as Monitor<never>,
  [profitabilityMonitor.descriptor.key]: profitabilityMonitor as Monitor<never>,
  [performanceMonitor.descriptor.key]: performanceMonitor as Monitor<never>,
  [fxMonitor.descriptor.key]: fxMonitor as Monitor<never>,
  [marketMonitor.descriptor.key]: marketMonitor as Monitor<never>,
  [candidateIntelligenceMonitor.descriptor.key]: candidateIntelligenceMonitor as Monitor<never>,
}

export async function runMonitor(key: string, ctx: MonitorContext, subjects: readonly unknown[]): Promise<MonitorRunOutcome> {
  const monitor = MONITORS[key]
  if (!monitor) throw new Error(`No monitor registered for "${key}".`)
  return monitor.run(ctx, subjects as never)
}

/**
 * The explicit event -> automation-job-type mapping (brief: "must be
 * inspectable and auditable... do not hide it inside random conditional
 * statements"). This is the single source of truth for which job type an
 * event of a given type should lead to; `tests/monitoring-registry.test.ts`
 * asserts every monitor's own `enqueueJob` calls agree with it. `null`
 * means "no safe automation action exists yet — an event and a
 * notification only," exactly the brief's instruction not to guess.
 */
export const EVENT_TO_JOB_MAPPING: Record<string, string | null> = {
  SUPPLIER_OUT_OF_STOCK: 'supplier_availability_check',
  SUPPLIER_BACK_IN_STOCK: null,
  SUPPLIER_PRICE_INCREASED: 'supplier_price_change',
  SUPPLIER_PRICE_DECREASED: 'supplier_price_change',
  SUPPLIER_DELIVERY_DELAYED: null,
  SUPPLIER_DISPATCH_DELAYED: null,
  SUPPLIER_CANCELLATION_RATE_INCREASED: null,
  SUPPLIER_FULFILMENT_RELIABILITY_DETERIORATED: null,
  SUPPLIER_FULFILMENT_RELIABILITY_RECOVERED: null,
  SUPPLIER_FEED_FAILED: null,
  SUPPLIER_FEED_STALE: null,
  SUPPLIER_FEED_RECOVERED: null,
  SUPPLIER_PRODUCT_UNAVAILABLE: 'supplier_availability_check',
  PRODUCT_MARGIN_DROPPED: 'product_profitability_recheck',
  PRODUCT_MARGIN_RECOVERED: null,
  PRODUCT_NO_LONGER_PROFITABLE: 'product_price_review',
  PRODUCT_BECAME_PROFITABLE: null,
  PRODUCT_PRICE_REVIEW_REQUIRED: 'product_profitability_recheck',
  COMPLIANCE_RECHECK_REQUIRED: 'product_compliance_recheck',
  COMPLIANCE_ASSESSMENT_STALE: 'product_compliance_recheck',
  COMPLIANCE_STATUS_CHANGED: 'channel_eligibility_recheck',
  LISTING_COMPLIANCE_RISK_DETECTED: 'product_compliance_recheck',
  LISTING_OUT_OF_SYNC: 'marketplace_reconciliation',
  LISTING_UNAVAILABLE: 'marketplace_listing_sync',
  LISTING_ERROR: 'marketplace_listing_sync',
  LISTING_PRICE_CHANGED_EXTERNALLY: 'marketplace_reconciliation',
  LISTING_STATUS_CHANGED_EXTERNALLY: 'marketplace_reconciliation',
  LISTING_MISSING: 'marketplace_listing_sync',
  INVENTORY_MISMATCH: 'marketplace_reconciliation',
  EXTERNAL_ACTION_UNVERIFIED: null,
  EXTERNAL_ACTION_FAILED: null,
  PRODUCT_SALES_SURGING: null,
  PRODUCT_SALES_DECLINING: 'product_profitability_recheck',
  PRODUCT_UNDERPERFORMING: null,
  PRODUCT_SALES_RECOVERED: null,
  PRODUCT_RETURN_RATE_INCREASED: null,
  PRODUCT_REFUND_RATE_INCREASED: null,
  REVENUE_DECLINED: null,
  AD_SPEND_EXCEEDED: null,
  // Milestone 9 — global market intelligence & international expansion.
  FX_RATE_UNAVAILABLE: null,
  FX_RATE_STALE: null,
  FX_RATE_RECOVERED: null,
  FX_RATE_SIGNIFICANT_MOVEMENT: 'fx_recheck',
  MARKET_PROFITABILITY_DETERIORATED: 'market_recheck',
  MARKET_PROFITABILITY_RECOVERED: null,
  MARKET_COMPLIANCE_RECHECK_REQUIRED: 'market_recheck',
  MARKET_SUPPLIER_CAPABILITY_CHANGED: 'market_recheck',
  MARKET_BECAME_VIABLE: 'market_recheck',
  // Milestone: autonomous decision & capability layer.
  CANDIDATE_LIFECYCLE_REVIEW_DUE: 'candidate_lifecycle_review',
}
