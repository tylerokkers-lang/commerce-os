import { randomUUID } from 'node:crypto'
import { automationCronSecret, isSupabaseConfigured } from '@/lib/core/env'
import { secretsMatch } from '@/lib/core/schedulerAuth'
import { runWorkerBatch } from '@/lib/automation/worker'
import { getSupabaseAutomationStore } from '@/lib/automation/supabaseStore'
import { getSupabaseFactsLoader } from '@/lib/automation/facts'
import { getMarketplaceConnector } from '@/lib/marketplaces/connectors/registry'
import { getSupabaseFxStore } from '@/lib/fx/fxStore'
import { getSupabaseSupplierMarketFactsLoader } from '@/lib/markets/supplierMarketFactsStore'
import { getSupabaseMarketRepository } from '@/lib/markets/supabaseMarketRepository'
import { runAdvertisingSync } from '@/lib/advertising/sync'
import { advertisingConnectorByKey } from '@/lib/advertising/connectors/registry'
import { runCampaignReview } from '@/lib/advertising/monitor'
import type { AdvertisingHandlerDeps } from '@/lib/automation/handlers/advertisingHandlers'

/**
 * The scheduled-automation entry point (brief §5, §30).
 *
 * This is a plain, stateless HTTP route with no session, no cookies and no
 * dependency on any AI coding tool being open. Point any external scheduler
 * at it — a Vercel Cron entry, a hosted worker's timer, a serverless
 * scheduled function, or a `curl` line in a crontab — and it claims and
 * executes whatever automation jobs are due, exactly the same way regardless
 * of what called it.
 *
 * Authenticated by a shared secret (`AUTOMATION_CRON_SECRET`), not a user
 * session, because a scheduler is not a logged-in owner. Once Supabase is
 * configured the secret is required — an unconfigured or missing secret
 * refuses every request rather than running unauthenticated against a real
 * database.
 */
export async function POST(request: Request) {
  if (isSupabaseConfigured()) {
    const expected = automationCronSecret()
    if (!expected) {
      return Response.json({ error: 'AUTOMATION_CRON_SECRET is not configured; refusing to run against a live database.' }, { status: 503 })
    }
    const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!provided || !secretsMatch(provided, expected)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    return Response.json({
      status: 'skipped',
      reason: 'Demo mode has no database and no job queue to process.',
    })
  }

  const marketDeps = { supplierMarketFacts: getSupabaseSupplierMarketFactsLoader(), fxStore: getSupabaseFxStore(), marketRepository: getSupabaseMarketRepository() }
  // This route only ever reaches here once `isSupabaseConfigured()` is true
  // (demo mode returns 'skipped' above), so every sync it runs is genuinely live.
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
  const result = await runWorkerBatch(getSupabaseAutomationStore(), getSupabaseFactsLoader(), getMarketplaceConnector, randomUUID(), 10, marketDeps, advertisingDeps)
  return Response.json({ status: 'ok', checkedAt: new Date().toISOString(), ...result })
}

/** A GET is a convenience for manual/browser checks; the scheduled call should use POST. */
export async function GET(request: Request) {
  return POST(request)
}
