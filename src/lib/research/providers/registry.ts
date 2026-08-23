import { err, type Result } from '@/lib/core/result'
import { demoResearchProvider } from './demo'
import type {
  FetchOptions,
  FetchOutcome,
  ProviderDescriptor,
  ProviderHealth,
  ProviderStatus,
  ResearchProvider,
} from './types'

/**
 * The provider registry (§7).
 *
 * Every source the system is designed to draw on is declared here, including
 * the ones that are not connected. Declaring them serves two purposes: the
 * owner can see what the architecture supports, and each entry records the
 * terms under which that source may be used before anyone writes the
 * integration.
 *
 * A declared provider is not a working one. Anything without credentials
 * reports `not_configured` and refuses to run. There are no placeholder
 * implementations that quietly return invented data.
 */

/**
 * A provider that is designed for but not yet built or credentialled.
 *
 * It deliberately fails rather than returning anything, so it is impossible to
 * mistake a planned integration for a live one.
 */
class UnavailableProvider implements ResearchProvider {
  constructor(
    readonly descriptor: ProviderDescriptor,
    private readonly reason: string,
  ) {}

  isConfigured(): boolean {
    // Credentials alone would not make this work, because the integration
    // itself is not written yet. Reporting configured would be a lie.
    return false
  }

  async fetch(options: FetchOptions): Promise<Result<FetchOutcome, string>> {
    return err(
      `${this.descriptor.label} is not available: ${this.reason} (requested ${options.limit} candidates)`,
    )
  }
}

const PLANNED: readonly { descriptor: ProviderDescriptor; reason: string }[] = [
  {
    reason:
      'The Amazon Selling Partner API integration lands in Milestone 4, and it requires seller credentials.',
    descriptor: {
      key: 'amazon_sp_api',
      label: 'Amazon Selling Partner API',
      description:
        'First-party Amazon data for catalogue, competitive pricing and category information, using our own seller credentials.',
      sourceType: 'official_api',
      requiredCredentials: [
        'AMAZON_SP_CLIENT_ID',
        'AMAZON_SP_CLIENT_SECRET',
        'AMAZON_SP_REFRESH_TOKEN',
        'AMAZON_SP_MARKETPLACE_ID',
      ],
      rateLimit: { requestsPerMinute: 10, requestsPerDay: 7200, minSecondsBetweenRuns: 300 },
      usagePolicy: {
        termsUrl: 'https://developer.amazonservices.com/',
        permittedUseNote:
          'Used only with our own seller credentials, within the documented rate limits, for data relating to our own selling account and the public catalogue endpoints the API exposes.',
        respectsRobots: true,
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'The Shopify Admin API integration lands in Milestone 3, and it requires store credentials.',
    descriptor: {
      key: 'shopify_admin',
      label: 'Shopify Admin API',
      description:
        'Our own store’s catalogue and performance data, used to find adjacent products to ones already selling well.',
      sourceType: 'official_api',
      requiredCredentials: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_ACCESS_TOKEN', 'SHOPIFY_API_VERSION'],
      rateLimit: { requestsPerMinute: 40, requestsPerDay: null, minSecondsBetweenRuns: 300 },
      usagePolicy: {
        termsUrl: 'https://www.shopify.com/legal/api-terms',
        permittedUseNote: 'Reads only our own store, using an access token we issued ourselves.',
        respectsRobots: true,
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason:
      'Requires a commercial trends data licence. Google Trends has no general-purpose public API, and scraping it is not permitted.',
    descriptor: {
      key: 'trends_licensed',
      label: 'Search trends (licensed provider)',
      description:
        'Search interest and seasonality from a licensed data partner. Deliberately not implemented against any endpoint that would require scraping.',
      sourceType: 'licensed_dataset',
      requiredCredentials: ['TRENDS_API_KEY', 'TRENDS_API_ENDPOINT'],
      rateLimit: { requestsPerMinute: 60, requestsPerDay: 5000, minSecondsBetweenRuns: 3600 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote:
          'To be used strictly within whatever licence the owner signs. No trends source will be added to this system on the basis of scraping a consumer web interface.',
        respectsRobots: true,
        authenticatedFirstParty: false,
      },
    },
  },
  {
    reason: 'Requires an approved TikTok Shop Partner account and API credentials.',
    descriptor: {
      key: 'tiktok_shop',
      label: 'TikTok Shop Partner API',
      description:
        'Product and category demand signals through the official partner programme, if the owner is accepted onto it.',
      sourceType: 'official_api',
      requiredCredentials: ['TIKTOK_SHOP_APP_KEY', 'TIKTOK_SHOP_APP_SECRET', 'TIKTOK_SHOP_ACCESS_TOKEN'],
      rateLimit: { requestsPerMinute: 20, requestsPerDay: 10000, minSecondsBetweenRuns: 600 },
      usagePolicy: {
        termsUrl: 'https://partner.tiktokshop.com/',
        permittedUseNote:
          'Only through the official partner API with approved credentials. There is no code path in this system that reads TikTok without one.',
        respectsRobots: true,
        authenticatedFirstParty: true,
      },
    },
  },
  {
    reason: 'No supplier catalogue feed has been configured yet.',
    descriptor: {
      key: 'supplier_feed',
      label: 'Supplier catalogue feed',
      description:
        'A CSV or API catalogue supplied directly by a supplier we have a relationship with. The least contentious source of all, because they gave it to us.',
      sourceType: 'supplier_feed',
      requiredCredentials: ['SUPPLIER_FEED_URL'],
      rateLimit: { requestsPerMinute: 10, requestsPerDay: 100, minSecondsBetweenRuns: 3600 },
      usagePolicy: {
        termsUrl: null,
        permittedUseNote: 'Provided directly by the supplier for this purpose.',
        respectsRobots: true,
        authenticatedFirstParty: true,
      },
    },
  },
]

const PROVIDERS = new Map<string, ResearchProvider>()
PROVIDERS.set(demoResearchProvider.descriptor.key, demoResearchProvider)
for (const planned of PLANNED) {
  PROVIDERS.set(planned.descriptor.key, new UnavailableProvider(planned.descriptor, planned.reason))
}

export const listProviders = (): readonly ResearchProvider[] => [...PROVIDERS.values()]

export const getProvider = (key: string): ResearchProvider | undefined => PROVIDERS.get(key)

export interface ProviderRuntimeState {
  isEnabled: boolean
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  nextAllowedAt: string | null
  consecutiveFailures: number
}

const DEFAULT_STATE: ProviderRuntimeState = {
  isEnabled: false,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastError: null,
  nextAllowedAt: null,
  consecutiveFailures: 0,
}

/**
 * Derives a provider's status from its configuration and its history.
 *
 * Status is never asserted directly; it always follows from observable facts,
 * so a provider cannot be marked healthy by anything other than having
 * actually succeeded.
 */
export function deriveStatus(
  provider: ResearchProvider,
  state: ProviderRuntimeState,
  now: Date = new Date(),
): ProviderStatus {
  if (!provider.isConfigured()) return 'not_configured'
  if (!state.isEnabled) return 'disabled'
  if (state.nextAllowedAt && new Date(state.nextAllowedAt) > now) return 'rate_limited'
  if (state.consecutiveFailures >= 3) return 'failing'
  if (state.consecutiveFailures > 0) return 'degraded'
  if (state.lastSuccessAt) return 'healthy'
  return 'ready'
}

function missingCredentials(descriptor: ProviderDescriptor): readonly string[] {
  return descriptor.requiredCredentials.filter((name) => {
    const value = process.env[name]
    return !value || value.trim().length === 0
  })
}

export function providerHealth(
  provider: ResearchProvider,
  state: ProviderRuntimeState = DEFAULT_STATE,
  now: Date = new Date(),
): ProviderHealth {
  const { descriptor } = provider
  return {
    key: descriptor.key,
    label: descriptor.label,
    description: descriptor.description,
    sourceType: descriptor.sourceType,
    status: deriveStatus(provider, state, now),
    isEnabled: state.isEnabled,
    isConfigured: provider.isConfigured(),
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

/**
 * Whether a provider may run now, honouring its own declared minimum gap.
 *
 * The limit is respected because it was declared, not because a service pushed
 * back with a 429.
 */
export function canRunNow(
  provider: ResearchProvider,
  state: ProviderRuntimeState,
  now: Date = new Date(),
): Result<true, string> {
  if (!provider.isConfigured()) {
    const missing = missingCredentials(provider.descriptor)
    return err(
      missing.length > 0
        ? `${provider.descriptor.label} is missing ${missing.join(', ')}.`
        : `${provider.descriptor.label} is not available yet.`,
    )
  }
  if (!state.isEnabled) return err(`${provider.descriptor.label} is switched off.`)
  if (state.nextAllowedAt && new Date(state.nextAllowedAt) > now) {
    return err(
      `${provider.descriptor.label} is rate limited until ${new Date(state.nextAllowedAt).toISOString()}.`,
    )
  }
  if (state.lastSuccessAt) {
    const elapsedSeconds = (now.getTime() - new Date(state.lastSuccessAt).getTime()) / 1000
    const minimum = provider.descriptor.rateLimit.minSecondsBetweenRuns
    if (elapsedSeconds < minimum) {
      return err(
        `${provider.descriptor.label} last ran ${Math.round(elapsedSeconds)}s ago and requires ${minimum}s between runs.`,
      )
    }
  }
  return { ok: true, value: true }
}
