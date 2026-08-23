import 'server-only'

import { connectorHealth, listConnectors } from './registry'
import { requireSession } from '@/lib/security/session'
import type { SupplierConnectorSummary } from '@/lib/core/domain'

/**
 * Connector health, for the UI.
 *
 * Structurally identical to `getResearchProviders`: reports what each
 * connector is, what it needs, what it is permitted to do, and whether it has
 * ever actually succeeded. A connector without credentials always reports
 * `not_configured`, never "connected."
 */
export async function getSupplierConnectors(): Promise<readonly SupplierConnectorSummary[]> {
  const session = await requireSession()

  return listConnectors().map((connector) => {
    // In demo mode only the manual connector is switched on — it is the one
    // genuinely running, computing real statuses from the demo supplier data.
    const isManual = connector.descriptor.key === 'manual'
    const health = connectorHealth(connector, {
      isEnabled: session.isDemo ? isManual : false,
      lastSuccessAt: session.isDemo && isManual ? new Date().toISOString() : null,
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
      authenticatedFirstParty: health.usagePolicy.authenticatedFirstParty,
      lastSuccessAt: health.lastSuccessAt,
      lastFailureAt: health.lastFailureAt,
      lastError: health.lastError,
      nextAllowedAt: health.nextAllowedAt,
      consecutiveFailures: health.consecutiveFailures,
    } satisfies SupplierConnectorSummary
  })
}

export interface PriceAlertSummary {
  supplierRef: string
  supplierName: string
  productRef: string
  changePct: number
  direction: 'increase' | 'decrease'
  previousUnitCostMinor: number
  newUnitCostMinor: number
  detectedAt: string
}

/** Price changes the manual connector has detected in demo data, for the UI. */
export async function getPriceAlerts(): Promise<readonly PriceAlertSummary[]> {
  const session = await requireSession()
  if (!session.isDemo) return []

  const { manualSupplierConnector } = await import('./manual')
  const { detectPriceChanges } = await import('./priceChanges')
  const { findDemoSupplier } = await import('@/lib/demo/suppliers')

  const result = await manualSupplierConnector.fetchStatus({ limit: 100 })
  if (!result.ok) return []

  const changes = detectPriceChanges(result.value.statuses)
  return changes.map((change) => ({
    supplierRef: change.supplierRef,
    supplierName: findDemoSupplier(change.supplierRef)?.name ?? change.supplierRef,
    productRef: change.productRef,
    changePct: change.changePct,
    direction: change.direction,
    previousUnitCostMinor: change.previousUnitCost.minor,
    newUnitCostMinor: change.newUnitCost.minor,
    detectedAt: change.detectedAt,
  }))
}
