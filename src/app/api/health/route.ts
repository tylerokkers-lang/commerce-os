import { integrationStatus, isDemoMode } from '@/lib/core/env'

/**
 * Liveness and configuration check. Reports which integrations are configured
 * but never the credential values themselves.
 */
export async function GET() {
  return Response.json({
    status: 'ok',
    mode: isDemoMode() ? 'demo' : 'live',
    checkedAt: new Date().toISOString(),
    integrations: integrationStatus().map((i) => ({
      key: i.key,
      configured: i.configured,
      missingCount: i.missing.length,
    })),
  })
}
