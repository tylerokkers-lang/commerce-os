import { err, type Result } from '@/lib/core/result'
import { amazonAdsConnector } from './amazonAds'
import { demoAdvertisingConnector } from './demo'
import type {
  AdvertisingCapabilities,
  AdvertisingConnectionHealth,
  AdvertisingConnectorDescriptor,
  AdvertisingConnectorSummary,
  AdvertisingProvider,
  AdvertisingWriteFailure,
  AdvertisingWriteOutcome,
  CampaignWriteInput,
  FetchCampaignsOptions,
  FetchOutcome,
  NormalizedCampaignFact,
} from './types'
import type { AdvertisingPlatform } from '@/lib/analytics/advertisingAnalytics'

/**
 * The advertising connector registry (Milestone 15).
 *
 * Structurally identical to `suppliers/connectors/registry.ts` and
 * `marketplaces/connectors/registry.ts`: every platform the architecture is
 * designed to support is declared here, including the ones with no working
 * implementation yet, so the intended breadth is visible without any of it
 * pretending to be live before it is real.
 */

const UNAVAILABLE_CAPABILITIES: AdvertisingCapabilities = { readCampaigns: false, pauseCampaign: false, setBudget: false, verifyWrites: false }

/** A platform this architecture is designed for but not yet built or credentialled — fails on every call, never returns anything, so it can never be mistaken for a working connector. */
class UnavailableAdvertisingConnector implements AdvertisingProvider {
  constructor(
    readonly descriptor: AdvertisingConnectorDescriptor,
    private readonly reason: string,
  ) {}

  isConfigured(): boolean {
    return false
  }

  async getConnectionHealth(): Promise<Result<AdvertisingConnectionHealth, string>> {
    return { ok: true, value: { status: 'not_configured', checkedAt: new Date().toISOString(), detail: this.reason } }
  }

  async fetchCampaigns(options: FetchCampaignsOptions): Promise<Result<FetchOutcome<NormalizedCampaignFact>, string>> {
    return err(`${this.descriptor.label} is not available: ${this.reason} (requested up to ${options.limit} campaigns)`)
  }

  async pauseCampaign(input: CampaignWriteInput): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    return err({ reason: 'not_configured', detail: `${this.descriptor.label} is not available: ${this.reason} (campaign ${input.externalCampaignId}).` })
  }

  async setCampaignBudget(input: CampaignWriteInput & { dailyBudgetMinor: number }): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>> {
    return err({ reason: 'not_configured', detail: `${this.descriptor.label} is not available: ${this.reason} (campaign ${input.externalCampaignId}).` })
  }

  async verifyCampaignState(externalCampaignId: string): Promise<Result<NormalizedCampaignFact, string>> {
    return err(`${this.descriptor.label} is not available: ${this.reason} (campaign ${externalCampaignId}).`)
  }
}

/**
 * Planned platforms with no integration written yet. Each would need its
 * own real API credentials and its own written integration before it could
 * report anything other than `not_configured` — the same discipline
 * `suppliers/connectors/registry.ts`'s `PLANNED` array already follows.
 */
const PLANNED: readonly { descriptor: AdvertisingConnectorDescriptor; reason: string }[] = [
  {
    reason: 'No Meta Marketing API credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'meta_ads', label: 'Meta Ads', platform: 'meta_ads',
      capabilities: UNAVAILABLE_CAPABILITIES,
      requiredCredentials: ['META_ADS_ACCESS_TOKEN', 'META_ADS_AD_ACCOUNT_ID', 'META_ADS_APP_SECRET'],
      rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
    },
  },
  {
    reason: 'No Google Ads API credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'google_ads', label: 'Google Ads', platform: 'google_ads',
      capabilities: UNAVAILABLE_CAPABILITIES,
      requiredCredentials: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID'],
      rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
    },
  },
  {
    reason: 'No TikTok for Business API credentials are configured, and the integration is not yet written.',
    descriptor: {
      key: 'tiktok_ads', label: 'TikTok Ads', platform: 'tiktok_ads',
      capabilities: UNAVAILABLE_CAPABILITIES,
      requiredCredentials: ['TIKTOK_ADS_ACCESS_TOKEN', 'TIKTOK_ADS_ADVERTISER_ID'],
      rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 },
    },
  },
]

const CONNECTORS = new Map<string, AdvertisingProvider>([
  [amazonAdsConnector.descriptor.key, amazonAdsConnector],
  [demoAdvertisingConnector.descriptor.key, demoAdvertisingConnector],
  ...PLANNED.map(({ descriptor, reason }): [string, AdvertisingProvider] => [descriptor.key, new UnavailableAdvertisingConnector(descriptor, reason)]),
])

export function allAdvertisingConnectors(): readonly AdvertisingProvider[] {
  return [...CONNECTORS.values()]
}

export function advertisingConnectorByKey(key: string): AdvertisingProvider | null {
  return CONNECTORS.get(key) ?? null
}

/**
 * The one real connector for a given platform, live-or-demo depending on
 * session mode — the same `_demo` key-suffix convention
 * `marketplaces/connectors/registry.ts`'s `connectorForChannel` already
 * uses. In demo mode this always returns `demoAdvertisingConnector`
 * regardless of platform (there is only one demo dataset, matching every
 * other demo connector in this codebase being a single illustrative
 * dataset, not one per real-world provider); in live mode it returns the
 * real connector for that platform, or the planned/`UnavailableAdvertisingConnector`
 * stub if no real implementation exists yet.
 */
export function connectorForPlatform(platform: AdvertisingPlatform, isDemo: boolean): AdvertisingProvider {
  if (isDemo) return demoAdvertisingConnector
  return advertisingConnectorByKey(platform) ?? new UnavailableAdvertisingConnector(
    { key: platform, label: platform, platform, capabilities: UNAVAILABLE_CAPABILITIES, requiredCredentials: [], rateLimit: { requestsPerMinute: null, requestsPerDay: null, minSecondsBetweenRuns: 0 } },
    'No connector is registered for this platform.',
  )
}

function missingCredentials(descriptor: AdvertisingConnectorDescriptor): readonly string[] {
  return descriptor.requiredCredentials.filter((name) => {
    const value = process.env[name]
    return !value || value.trim().length === 0
  })
}

/** Runtime summary for every registered platform — what `/advertising`'s connections section renders, never a second source of "is this connected." */
export function advertisingConnectorSummaries(connections: ReadonlyMap<string, { status: AdvertisingConnectorSummary['status']; lastSyncAt: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null; consecutiveFailures: number }>): readonly AdvertisingConnectorSummary[] {
  return [amazonAdsConnector, ...PLANNED.map(({ descriptor, reason }) => new UnavailableAdvertisingConnector(descriptor, reason))].map((connector) => {
    const state = connections.get(connector.descriptor.platform)
    return {
      key: connector.descriptor.key,
      label: connector.descriptor.label,
      platform: connector.descriptor.platform,
      capabilities: connector.descriptor.capabilities,
      status: state?.status ?? (connector.isConfigured() ? 'connected' : 'not_configured'),
      isConfigured: connector.isConfigured(),
      missingCredentials: missingCredentials(connector.descriptor),
      rateLimit: connector.descriptor.rateLimit,
      lastSyncAt: state?.lastSyncAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      lastFailureAt: state?.lastFailureAt ?? null,
      lastError: state?.lastError ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
    }
  })
}
