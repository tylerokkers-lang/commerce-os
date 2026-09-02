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

  return runWorkerBatch(getSupabaseAutomationStore(), getSupabaseFactsLoader(), getMarketplaceConnector, randomUUID(), maxJobs, marketDeps, advertisingDeps)
}
