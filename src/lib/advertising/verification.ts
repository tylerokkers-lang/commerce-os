import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import type { AdvertisingProvider } from './connectors/types'
import { verifyProviderReadOnly, type ProviderVerificationResult } from './verificationCheck'

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
 */
export async function runAndRecordProviderVerification(orgId: string, connector: AdvertisingProvider): Promise<ProviderVerificationResult> {
  const result = await verifyProviderReadOnly(connector)
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
