import 'server-only'

import { listProviders, providerHealth } from './providers/registry'
import { requireSession } from '@/lib/security/session'
import type { ResearchProviderSummary } from '@/lib/core/domain'

/**
 * Research provider health.
 *
 * Reports what each provider is, what it needs, what it is permitted to do and
 * whether it has ever succeeded. A provider without credentials reports
 * `not_configured` and is never presented as available.
 */
export async function getResearchProviders(): Promise<readonly ResearchProviderSummary[]> {
  const session = await requireSession()

  return listProviders().map((provider) => {
    // In demo mode the simulated provider is the only one switched on. Run
    // history comes from `research_providers` once a live project exists.
    const isDemoProvider = provider.descriptor.key === 'demo'
    const health = providerHealth(provider, {
      isEnabled: session.isDemo ? isDemoProvider : false,
      lastSuccessAt: session.isDemo && isDemoProvider ? new Date().toISOString() : null,
      lastFailureAt: null,
      lastError: null,
      nextAllowedAt: null,
      consecutiveFailures: 0,
    })

    return {
      key: health.key,
      label: health.label,
      description: health.description,
      sourceType: health.sourceType,
      status: health.status,
      isEnabled: health.isEnabled,
      isConfigured: health.isConfigured,
      missingCredentials: health.missingCredentials,
      rateLimitPerMinute: health.rateLimit.requestsPerMinute,
      rateLimitPerDay: health.rateLimit.requestsPerDay,
      minSecondsBetweenRuns: health.rateLimit.minSecondsBetweenRuns,
      termsUrl: health.usagePolicy.termsUrl,
      permittedUseNote: health.usagePolicy.permittedUseNote,
      respectsRobots: health.usagePolicy.respectsRobots,
      authenticatedFirstParty: health.usagePolicy.authenticatedFirstParty,
      lastSuccessAt: health.lastSuccessAt,
      lastFailureAt: health.lastFailureAt,
      lastError: health.lastError,
      nextAllowedAt: health.nextAllowedAt,
      consecutiveFailures: health.consecutiveFailures,
    } satisfies ResearchProviderSummary
  })
}
