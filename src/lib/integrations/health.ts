import 'server-only'

import { integrationStatus, isDemoMode } from '@/lib/core/env'
import type { IntegrationHealth } from '@/lib/core/domain'

/**
 * Integration health (§57).
 *
 * An integration is only ever reported as connected when its credentials are
 * genuinely present. Anything else reads as demo or not configured; the system
 * never implies a live connection it does not have (§56).
 */
export async function getIntegrationHealth(): Promise<readonly IntegrationHealth[]> {
  const demo = isDemoMode()

  return integrationStatus().map((integration) => ({
    key: integration.key,
    label: integration.label,
    status: integration.configured ? (demo ? 'demo' : 'connected') : 'not_configured',
    missingCredentials: integration.missing,
    // Sync history is recorded on the `channels` table once a real connection
    // exists; there is nothing truthful to show before the first sync runs.
    lastSuccessAt: null,
    lastFailureAt: null,
    lastError: null,
    nextRetryAt: null,
  }))
}
