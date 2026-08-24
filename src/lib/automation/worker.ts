import { handleSupplierAvailabilityCheck, handleSupplierPriceChange, handleSupplierStockChange, handleSupplierSwitch } from './handlers/supplierHandlers'
import {
  handleProductProfitabilityRecheck,
  handleProductComplianceRecheck,
  handleChannelEligibilityRecheck,
  handleProductPause,
  handleProductPriceReview,
} from './handlers/productHandlers'
import {
  handleMarketplaceListingSync,
  handleFulfilmentUpdate,
  handleTrackingCheck,
  handleMarketplaceReconciliation,
} from './handlers/marketplaceHandlers'
import { handleOrderProcessing } from './handlers/orderHandlers'
import { handleMarketRecheck, handleFxRecheck, type MarketHandlerDeps } from './handlers/marketHandlers'
import type { AutomationStore, JobRecord } from './store'
import type { FactsLoader } from './factsTypes'
import type { MarketplaceConnector } from '@/lib/marketplaces/connectors/types'

/** Resolves a connector by its descriptor key — injected so handlers never import the registry directly. */
export type ConnectorLookup = (key: string) => MarketplaceConnector | undefined

/**
 * The job worker (brief §5, §30's "automation works without Claude Code
 * running").
 *
 * `/api/automation/run` calls `runWorkerBatch` on every invocation. Nothing
 * about this loop depends on who or what calls the route — a Vercel Cron
 * entry, a hosted worker, a serverless scheduled function, or a plain `curl`
 * on a timer all produce an identical claim/execute/complete cycle.
 *
 * Handlers are registered by `job_type` in a closed map rather than by
 * evaluating anything from the payload as code — the brief is explicit that
 * automation must never allow arbitrary code execution, and a fixed,
 * reviewable set of handlers is how that is enforced structurally, not just
 * by convention.
 *
 * `runWorkerBatch` takes an `AutomationStore` and a `FactsLoader` rather than
 * reaching for Supabase directly, so the exact same orchestration code —
 * claim, dispatch, complete — runs in production (`supabaseStore.ts` +
 * `facts.ts`) and in tests (`inMemoryStore.ts` + `inMemoryFactsLoader.ts`).
 * Tests drive this function directly, the same way the real HTTP route
 * does, rather than calling a business decision function on its own.
 */

export interface JobHandlerResult {
  succeeded: boolean
  error?: string
  retryable?: boolean
}

/**
 * `marketDeps` (Milestone 9) is the 5th, optional parameter every existing
 * handler simply never declares — a function with fewer parameters is
 * assignable to a type expecting more, so none of the 14 existing handlers
 * needed to change. Only `handleMarketRecheck`/`handleFxRecheck` read it.
 */
export type JobHandler = (job: JobRecord, store: AutomationStore, facts: FactsLoader, connectors: ConnectorLookup, marketDeps?: MarketHandlerDeps) => Promise<JobHandlerResult>

/**
 * The job-handler registry (Milestone 7 brief §2). Every handler orchestrates
 * existing engines — `supplierSwitching.ts`, `priceAutomation.ts`,
 * `inventoryAutomation.ts`, `publicationAutomation.ts`, `orderAutomation.ts`,
 * `monitoring.ts`, the marketplace connectors, `reconciliation.ts` — and
 * none duplicates their logic. Depth of live-data wiring genuinely differs
 * per handler; `docs/MILESTONES.md` states exactly which are backed by live
 * `FactsLoader` queries versus payload-supplied facts, and which have a
 * dedicated end-to-end test versus wiring-level confidence only. An
 * unregistered job type fails immediately and non-retryably, with that
 * exact reason — never silently "succeeding" having done nothing.
 */
export const HANDLERS: Record<string, JobHandler> = {
  supplier_availability_check: handleSupplierAvailabilityCheck,
  supplier_price_change: handleSupplierPriceChange,
  supplier_stock_change: handleSupplierStockChange,
  supplier_switch: handleSupplierSwitch,
  product_profitability_recheck: handleProductProfitabilityRecheck,
  product_compliance_recheck: handleProductComplianceRecheck,
  channel_eligibility_recheck: handleChannelEligibilityRecheck,
  product_pause: handleProductPause,
  product_price_review: handleProductPriceReview,
  marketplace_listing_sync: handleMarketplaceListingSync,
  order_processing: handleOrderProcessing,
  fulfilment_update: handleFulfilmentUpdate,
  tracking_check: handleTrackingCheck,
  marketplace_reconciliation: handleMarketplaceReconciliation,
  market_recheck: handleMarketRecheck,
  fx_recheck: handleFxRecheck,
}

export interface WorkerBatchResult {
  claimed: number
  succeeded: number
  failed: number
  deadLettered: number
}

export async function runWorkerBatch(
  store: AutomationStore,
  facts: FactsLoader,
  connectors: ConnectorLookup,
  workerId: string,
  maxJobs = 10,
  marketDeps?: MarketHandlerDeps,
): Promise<WorkerBatchResult> {
  const result: WorkerBatchResult = { claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 }

  for (let i = 0; i < maxJobs; i++) {
    const job = await store.claimNextJob(workerId)
    if (!job) break
    result.claimed++

    const handler = HANDLERS[job.jobType]
    const outcome: JobHandlerResult = handler
      ? await handler(job, store, facts, connectors, marketDeps).catch((error) => ({
          succeeded: false,
          error: error instanceof Error ? error.message : String(error),
          retryable: true,
        }))
      : { succeeded: false, error: `No handler registered for job type "${job.jobType}".`, retryable: false }

    await store.completeJob(job, outcome)

    if (outcome.succeeded) result.succeeded++
    else if (job.attempts >= job.maxAttempts || outcome.retryable === false) result.deadLettered++
    else result.failed++
  }

  return result
}
