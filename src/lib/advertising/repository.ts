import 'server-only'

import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'
import { advertisingConnectorSummaries } from './connectors/registry'
import type { AdvertisingConnectorSummary } from './connectors/types'

/**
 * Connection status reads for `/advertising`'s connections section
 * (Milestone 15). Session-scoped (`createServerSupabase`, RLS-respecting —
 * the same client `/marketplaces`/`/settings` already read their own
 * org-scoped tables through), never the service role, since this is a
 * plain read no different from any other page's own data.
 */
export async function getAdvertisingConnectorSummaries(): Promise<readonly AdvertisingConnectorSummary[]> {
  const session = await requireSession()

  if (session.isDemo) return advertisingConnectorSummaries(new Map())

  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('advertising_connections')
    .select('provider, status, last_sync_at, last_success_at, last_failure_at, last_error, consecutive_failures, verification_status, verified_at, verification_detail')
    .eq('org_id', session.orgId)

  const connections = new Map(
    (data ?? []).map((row) => [
      row.provider,
      {
        status: row.status as AdvertisingConnectorSummary['status'],
        lastSyncAt: row.last_sync_at,
        lastSuccessAt: row.last_success_at,
        lastFailureAt: row.last_failure_at,
        lastError: row.last_error,
        consecutiveFailures: row.consecutive_failures,
        verificationStatus: row.verification_status as AdvertisingConnectorSummary['verificationStatus'],
        verifiedAt: row.verified_at,
        verificationDetail: row.verification_detail,
      },
    ]),
  )

  return advertisingConnectorSummaries(connections)
}
