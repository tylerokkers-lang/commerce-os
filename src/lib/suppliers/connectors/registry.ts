import { err, type Result } from '@/lib/core/result'
import { manualSupplierConnector } from './manual'
import type {
  ConnectorDescriptor,
  ConnectorHealth,
  ConnectorStatus,
  FetchStatusOptions,
  FetchStatusOutcome,
  SupplierConnector,
} from './types'

/**
 * The connector registry (Milestone 3).
 *
 * Structurally identical to `src/lib/research/providers/registry.ts` on
 * purpose: the same discipline applies. Every connector category the system
 * is designed to support is declared here, including the ones with no
 * working implementation yet, so the owner can see the intended breadth of
 * the architecture without any of it pretending to be live before it is.
 */

/**
 * A connector category that is designed for but not yet built or
 * credentialled. Fails on every call rather than returning anything, so a
 * planned connector can never be mistaken for a working one.
 */
class UnavailableConnector implements SupplierConnector {
  constructor(
    readonly descriptor: ConnectorDescriptor,
    private readonly reason: string,
  ) {}

  isConfigured(): boolean {
    return false
  }

  async fetchStatus(options: FetchStatusOptions): Promise<Result<FetchStatusOutcome, string>> {
    return err(
      `${this.descriptor.label} is not available: ${this.reason} (requested up to ${options.limit} statuses)`,
    )
  }
}

/**
 * Planned connector categories.
 *
 * Named after the sourcing ecosystems Milestone 3 was scoped against —
 * "-compatible" and "-type" throughout because none of these is an official
 * partnership. Each would need its own real API credentials and its own
 * written integration before it could report anything other than
 * `not_configured`.
 */
const PLANNED: readonly { descriptor: ConnectorDescriptor; reason: string }[] = [
  {
    reason: 'No DSers-compatible API credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'dsers_compatible',
      label: 'DSers-compatible sourcing',
      description:
        'Order routing and product sourcing through a DSers-compatible supplier aggregation API.',
      sourceType: 'api',
      requiredCredentials: ['DSERS_API_KEY', 'DSERS_STORE_ID'],
      rateLimit: { requestsPerMinute: 30, requestsPerDay: 5000, minSecondsBetweenRuns: 300 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote:
          'To be used only under whatever developer agreement the owner holds with the provider once connected. No requests are made without it.',
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'No Syncee-type network credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'syncee_type',
      label: 'Syncee-type supplier network',
      description: 'A supplier and dropship network exposing a product feed and stock/price sync.',
      sourceType: 'feed',
      requiredCredentials: ['SYNCEE_API_TOKEN'],
      rateLimit: { requestsPerMinute: 20, requestsPerDay: 2000, minSecondsBetweenRuns: 900 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote: 'To be used strictly within the provider’s own feed licence once connected.',
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'No EPROLO-type fulfilment API credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'eprolo_type',
      label: 'EPROLO-type fulfilment',
      description: 'Print-on-demand and warehousing fulfilment through an EPROLO-type provider API.',
      sourceType: 'api',
      requiredCredentials: ['EPROLO_API_KEY'],
      rateLimit: { requestsPerMinute: 30, requestsPerDay: 3000, minSecondsBetweenRuns: 300 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote: 'Our own account credentials only, once connected.',
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'No CJ-type sourcing API credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'cj_type',
      label: 'CJ-type sourcing',
      description: 'Product sourcing and fulfilment through a CJ-type dropshipping platform API.',
      sourceType: 'api',
      requiredCredentials: ['CJ_API_KEY', 'CJ_ACCESS_TOKEN'],
      rateLimit: { requestsPerMinute: 30, requestsPerDay: 3000, minSecondsBetweenRuns: 300 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote: 'Our own account credentials only, once connected.',
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'No AutoDS-type aggregator credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'autods_type',
      label: 'AutoDS-type supplier aggregation',
      description: 'Multi-supplier price and stock aggregation through an AutoDS-type platform API.',
      sourceType: 'api',
      requiredCredentials: ['AUTODS_API_KEY'],
      rateLimit: { requestsPerMinute: 20, requestsPerDay: 2000, minSecondsBetweenRuns: 600 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote: 'Our own account credentials only, once connected.',
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'No direct supplier API has been configured for any supplier yet.',
    descriptor: {
      key: 'direct_api',
      label: 'Direct supplier API',
      description:
        'A bespoke integration against one supplier’s own API, where the supplier offers one directly.',
      sourceType: 'api',
      requiredCredentials: ['DIRECT_SUPPLIER_API_URL', 'DIRECT_SUPPLIER_API_KEY'],
      rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 300 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote:
          'Only under a direct agreement with that specific supplier. Every direct integration is written and reviewed individually rather than assumed generic.',
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'No feed URL has been configured for a CSV/feed supplier yet.',
    descriptor: {
      key: 'csv_feed',
      label: 'CSV / scheduled feed',
      description: 'A supplier-provided CSV or XML feed fetched on a schedule from a URL they publish.',
      sourceType: 'feed',
      requiredCredentials: ['SUPPLIER_FEED_URL'],
      rateLimit: { requestsPerMinute: 10, requestsPerDay: 96, minSecondsBetweenRuns: 900 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote: 'Provided directly by the supplier for this purpose.',
        authenticatedFirstParty: true,
      },
    },
  },
]

const CONNECTORS = new Map<string, SupplierConnector>()
CONNECTORS.set(manualSupplierConnector.descriptor.key, manualSupplierConnector)
for (const planned of PLANNED) {
  CONNECTORS.set(planned.descriptor.key, new UnavailableConnector(planned.descriptor, planned.reason))
}

export const listConnectors = (): readonly SupplierConnector[] => [...CONNECTORS.values()]
export const getConnector = (key: string): SupplierConnector | undefined => CONNECTORS.get(key)

export interface ConnectorRuntimeState {
  isEnabled: boolean
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  nextAllowedAt: string | null
  consecutiveFailures: number
}

const DEFAULT_STATE: ConnectorRuntimeState = {
  isEnabled: false,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
}

/** Derives status from observable facts only — never asserted directly. */
export function deriveConnectorStatus(
  connector: SupplierConnector,
  state: ConnectorRuntimeState,
  now: Date = new Date(),
): ConnectorStatus {
  if (!connector.isConfigured()) return 'not_configured'
  if (!state.isEnabled) return 'disabled'
  if (state.nextAllowedAt && new Date(state.nextAllowedAt) > now) return 'rate_limited'
  if (state.consecutiveFailures >= 3) return 'failing'
  if (state.consecutiveFailures > 0) return 'degraded'
  if (state.lastSuccessAt) return 'healthy'
  return 'ready'
}

function missingCredentials(descriptor: ConnectorDescriptor): readonly string[] {
  return descriptor.requiredCredentials.filter((name) => {
    const value = process.env[name]
    return !value || value.trim().length === 0
  })
}

export function connectorHealth(
  connector: SupplierConnector,
  state: ConnectorRuntimeState = DEFAULT_STATE,
  now: Date = new Date(),
): ConnectorHealth {
  const { descriptor } = connector
  return {
    key: descriptor.key,
    label: descriptor.label,
    description: descriptor.description,
    sourceType: descriptor.sourceType,
    status: deriveConnectorStatus(connector, state, now),
    isEnabled: state.isEnabled,
    isConfigured: connector.isConfigured(),
    missingCredentials: missingCredentials(descriptor),
    rateLimit: descriptor.rateLimit,
    usagePolicy: descriptor.usagePolicy,
    lastSuccessAt: state.lastSuccessAt,
    lastFailureAt: state.lastFailureAt,
    lastError: state.lastError,
    nextAllowedAt: state.nextAllowedAt,
    consecutiveFailures: state.consecutiveFailures,
  }
}

/** Whether a connector may run now, honouring its own declared minimum gap. */
export function canConnectorRunNow(
  connector: SupplierConnector,
  state: ConnectorRuntimeState,
  now: Date = new Date(),
): Result<true, string> {
  if (!connector.isConfigured()) {
    const missing = missingCredentials(connector.descriptor)
    return err(
      missing.length > 0
        ? `${connector.descriptor.label} is missing ${missing.join(', ')}.`
        : `${connector.descriptor.label} is not available yet.`,
    )
  }
  if (!state.isEnabled) return err(`${connector.descriptor.label} is switched off.`)
  if (state.nextAllowedAt && new Date(state.nextAllowedAt) > now) {
    return err(
      `${connector.descriptor.label} is rate limited until ${new Date(state.nextAllowedAt).toISOString()}.`,
    )
  }
  if (state.lastSuccessAt) {
    const elapsedSeconds = (now.getTime() - new Date(state.lastSuccessAt).getTime()) / 1000
    const minimum = connector.descriptor.rateLimit.minSecondsBetweenRuns
    if (elapsedSeconds < minimum) {
      return err(
        `${connector.descriptor.label} last ran ${Math.round(elapsedSeconds)}s ago and requires ${minimum}s between runs.`,
      )
    }
  }
  return { ok: true, value: true }
}
