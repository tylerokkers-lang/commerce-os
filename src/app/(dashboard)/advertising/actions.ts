'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/security/session'
import { advertisingConnectorByKey } from '@/lib/advertising/connectors/registry'
import { runAndRecordProviderVerification } from '@/lib/advertising/verification'

/**
 * Phase 9/11 — the one real trigger for the staged, read-only verification
 * check (`advertising/verification.ts`). Reachable by direct POST, not only
 * through the page's button, so write access is checked here regardless of
 * what the page rendered.
 *
 * Deliberately never touches a campaign: `runAndRecordProviderVerification`
 * only ever calls `isConfigured()`, `getConnectionHealth()` and
 * `fetchCampaigns()` on the connector — the same read-only guarantee
 * documented on that function.
 */
export async function verifyProviderConnection(formData: FormData): Promise<void> {
  const session = await requireWriteAccess()
  if (session.isDemo) return

  const connectorKey = String(formData.get('connectorKey') ?? '')
  const connector = advertisingConnectorByKey(connectorKey)
  if (!connector) return

  await runAndRecordProviderVerification(session.orgId, connector)
  revalidatePath('/advertising')
}
