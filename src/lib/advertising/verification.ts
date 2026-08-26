import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { advanceAmazonAdsReportPipeline } from './amazonAdsReportPipeline'
import type { AmazonAdsConnector } from './connectors/amazonAds'
import type { AdvertisingProvider } from './connectors/types'
import { verifyProviderReadOnly, mapAmazonAdsReportPipelineToVerification, type ProviderVerificationResult } from './verificationCheck'

export type { AdvertisingVerificationStatus, ProviderVerificationResult } from './verificationCheck'
export { verifyProviderReadOnly } from './verificationCheck'

/**
 * Phases 8-10 — staged, read-only provider verification (Milestone 16).
 *
 * A genuinely different question from "is this connector configured right
 * now" (`getConnectionHealth()`, re-derived on every sync attempt):
 * verification only ever advances when this deliberately-triggered check
 * has actually run and actually passed. The decision logic itself
 * (`verifyProviderReadOnly`, re-exported above) lives in the sibling
 * `verificationCheck.ts` — a plain module with no `server-only` import —
 * so it can be unit-tested directly; this file is only the persistence
 * half, and needs `server-only` because it writes through the service role.
 */

/**
 * Runs the check above for one org+platform and persists the result to
 * `advertising_connections` (migration `0028`), auditing the attempt —
 * never silently updates state without a record of when and why.
 *
 * Milestone 20, Phase 19 — Amazon Ads' real read path is the async report
 * pipeline (Milestone 20), not the generic, synchronous `fetchCampaigns()`
 * every other provider still uses, so its verification must drive that
 * pipeline instead of the generic check — the same `platform === 'amazon_ads'`
 * special-case `advertising/sync.ts`'s `runAdvertisingSync` already applies
 * to the actual maintenance-cycle sync, applied here to a manually-triggered
 * verification click instead. `advanceAmazonAdsReportPipeline` is the exact
 * same, already-idempotent function the maintenance job calls — clicking
 * "verify" repeatedly never spams new Amazon Ads reports (Phase 5), it just
 * re-checks whatever is already in flight, exactly as a real maintenance
 * cycle would.
 */
export async function runAndRecordProviderVerification(orgId: string, connector: AdvertisingProvider): Promise<ProviderVerificationResult> {
  const result = !connector.isConfigured()
    ? { status: 'not_tested' as const, detail: `${connector.descriptor.label} is not configured — nothing to verify yet.` }
    : connector.descriptor.platform === 'amazon_ads'
      ? mapAmazonAdsReportPipelineToVerification(await advanceAmazonAdsReportPipeline(orgId, connector as AmazonAdsConnector))
      : await verifyProviderReadOnly(connector)
  const nowIso = new Date().toISOString()
  const supabase = createServiceSupabase()

  await supabase.from('advertising_connections').upsert(
    {
      org_id: orgId,
      provider: connector.descriptor.platform,
      verification_status: result.status,
      verified_at: nowIso,
      verification_detail: result.detail,
    } as never,
    { onConflict: 'org_id,provider' },
  )

  await recordAudit({
    orgId,
    action: 'ADVERTISING_PROVIDER_VERIFIED',
    entityType: 'advertising_connection',
    entityId: connector.descriptor.platform,
    actorType: 'user',
    result: result.status === 'failed' || result.status === 'not_tested' ? 'failure' : 'success',
    reason: result.detail,
    metadata: { status: result.status },
  })

  return result
}
