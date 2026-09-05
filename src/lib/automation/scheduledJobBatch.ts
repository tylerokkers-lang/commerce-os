import 'server-only'

import { randomUUID } from 'node:crypto'
import { runWorkerBatch, type WorkerBatchResult } from './worker'
import { getSupabaseAutomationStore } from './supabaseStore'
import { getSupabaseFactsLoader } from './facts'
import { getMarketplaceConnector } from '@/lib/marketplaces/connectors/registry'
import { getSupabaseFxStore } from '@/lib/fx/fxStore'
import { getSupabaseSupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFactsStore'
import { getSupabaseMarketRepository } from '@/lib/markets/supabaseMarketRepository'
import { runAdvertisingSync } from '@/lib/advertising/sync'
import { advertisingConnectorByKey } from '@/lib/advertising/connectors/registry'
import { runCampaignReview } from '@/lib/advertising/monitor'
import type { AdvertisingHandlerDeps } from './handlers/advertisingHandlers'
import type { LifecycleHandlerDeps } from './handlers/productHandlers'
import { refreshCandidateLifecycleFacts } from '@/lib/products/lifecycleFactRefresh'
import { computeProductIntelligence } from '@/lib/products/intelligence/assemble'
import { createServiceSupabase } from '@/lib/supabase/server'
import type { ChannelKey } from '@/lib/core/domain'

/**
 * The one, self-contained job-queue batch runner (Phase 15). Builds the
 * exact same dependencies `/api/automation/run` always has, so that route
 * and `runMaintenance` (`maintenance.ts`) call this single implementation
 * rather than each assembling `runWorkerBatch`'s wiring independently —
 * the same "one orchestration, never duplicated" discipline
 * `maintenance.ts`'s own module comment already establishes for its other
 * subsystems.
 *
 * `maxJobs` defaults to 25 rather than the route's previous hardcoded 10:
 * folding this into a 15-minute maintenance cycle (Phase 15) means each
 * invocation should clear a reasonably sized backlog rather than assume a
 * separate, more frequent trigger will follow shortly — still bounded,
 * never unbounded, so one run cannot itself become a stuck, indefinitely
 * long request.
 */
export async function runScheduledJobBatch(maxJobs = 25): Promise<WorkerBatchResult> {
  const marketDeps = { supplierMarketFacts: getSupabaseSupplierMarketFactsLoader(), fxStore: getSupabaseFxStore(), marketRepository: getSupabaseMarketRepository() }
  const advertisingDeps: AdvertisingHandlerDeps = {
    async runSync(orgId, connectorKey, limit) {
      const connector = advertisingConnectorByKey(connectorKey)
      if (!connector) return { succeeded: false, error: `No advertising connector registered for key "${connectorKey}".` }
      const result = await runAdvertisingSync(orgId, false, connector, limit ?? 500)
      return { succeeded: !result.blocked && !result.fetchError, error: result.blocked ?? result.fetchError }
    },
    async runCampaignReview(orgId) {
      const result = await runCampaignReview(orgId)
      return {
        succeeded: result.errors.length === 0,
        error: result.errors.length > 0 ? result.errors.join(' ') : null,
        campaignsEvaluated: result.campaignsEvaluated,
        recommendationsCreated: result.recommendationsCreated,
        duplicatesAvoided: result.duplicatesAvoided,
        blocked: result.blocked,
        blockedByFreshness: result.blockedByFreshness,
      }
    },
  }

  // Milestone: continuous candidate lifecycle. Injected for the same
  // reason as `advertisingDeps` above — `refreshCandidateLifecycleFacts` is
  // `server-only`, so the handler that needs it takes it as a dependency
  // rather than importing it and dragging Supabase into every test that
  // imports the worker.
  const lifecycleDeps: LifecycleHandlerDeps = {
    async refreshLifecycleFacts(orgId, productId, channel) {
      const result = await refreshCandidateLifecycleFacts(orgId, productId, channel as ChannelKey)
      return result.ok ? { ok: true } : { ok: false, error: result.error }
    },
    async refreshProductIntelligence(orgId, productId) {
      // The service-role client: this runs from a cron request with no
      // signed-in user, and every read inside the engine is explicitly
      // org-scoped. `null` means the product itself could not be read —
      // reported as a failure so the job retries, never as a success that
      // would imply a score now exists.
      const result = await computeProductIntelligence(orgId, productId, 'automated_recheck', { type: 'system', label: 'Candidate lifecycle monitor' }, createServiceSupabase())
      return result ? { ok: true } : { ok: false, error: `Product ${productId} could not be scored — no product record was readable.` }
    },
  }

  return runWorkerBatch(getSupabaseAutomationStore(), getSupabaseFactsLoader(), getMarketplaceConnector, randomUUID(), maxJobs, marketDeps, advertisingDeps, lifecycleDeps)
}
