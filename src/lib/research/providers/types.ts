import type { Money } from '@/lib/core/money'
import type { Enums } from '@/lib/supabase/database.types'
import type { Result } from '@/lib/core/result'

/**
 * The research provider interface (§7).
 *
 * Providers are pluggable so that authorised APIs, licensed datasets and
 * permitted public sources can be added one at a time without the rest of the
 * system knowing where data came from.
 *
 * What a provider may not do is equally part of the contract. There is no hook
 * here for fetching an arbitrary URL, no HTML parsing helper, and no way to
 * present credentials the provider was not given. A provider that needs to
 * scrape a site that forbids it cannot be expressed in this interface, which is
 * the intended outcome rather than an oversight.
 */

export type ProviderSourceType = Enums<'provider_source_type'>
export type ProviderStatus = Enums<'provider_status'>

/** Declared limits. The runner honours these instead of discovering them by being throttled. */
export interface RateLimit {
  requestsPerMinute: number | null
  requestsPerDay: number | null
  /** Minimum gap between runs of this provider. */
  minSecondsBetweenRuns: number
}

/**
 * The terms under which a provider may be used.
 *
 * Recorded explicitly so the boundary is a stated fact that can be reviewed,
 * rather than an assumption buried in whoever wrote the integration.
 */
export interface UsagePolicy {
  /** Where the permission comes from. */
  termsUrl: string | null
  /** What this source permits, in the owner's own words. */
  permittedUseNote: string
  /** Whether the provider honours robots directives, where applicable. */
  respectsRobots: boolean
  /** True only for first-party APIs used with our own credentials. */
  authenticatedFirstParty: boolean
}

export interface ProviderDescriptor {
  key: string
  label: string
  description: string
  sourceType: ProviderSourceType
  /** Environment variable names. Never values. */
  requiredCredentials: readonly string[]
  rateLimit: RateLimit
  usagePolicy: UsagePolicy
}

/** A single sampled customer review or piece of feedback. */
export interface ReviewSample {
  rating: number
  title?: string
  body: string
  /** ISO date. */
  postedAt?: string
  verifiedPurchase?: boolean
}

/**
 * What a provider returns for one product idea.
 *
 * Every numeric field is explicitly an estimate. Nothing here is an observed
 * trading figure for our own business, and the naming keeps that distinction
 * impossible to lose downstream.
 */
export interface ResearchCandidate {
  /** Stable identifier within the provider, used to detect duplicates. */
  externalRef: string
  title: string
  category: string
  brand?: string | null
  description?: string

  estimatedSellingPrice: Money
  estimatedUnitCost: Money
  estimatedShippingCost: Money
  estimatedMonthlyUnits?: number

  monthlySearchVolume?: number
  searchTrendPct?: number
  trendDurationMonths?: number
  seasonalityIndex?: number

  competitorCount?: number
  topCompetitorReviewCount?: number

  reviewCount?: number
  ratingAvg?: number
  reviewSample?: readonly ReviewSample[]

  expectedReturnRatePct?: number
  productComplexity?: number
  hasBattery?: boolean
  isElectrical?: boolean
  isChildrensProduct?: boolean
  isFoodContact?: boolean
  isCosmetic?: boolean

  /** Supplier hints the provider can offer, if any. */
  supplierHint?: {
    name: string
    country: string
    platform: string
    deliveryDaysMin: number
    deliveryDaysMax: number
  }

  /** Free-form provider payload, retained for traceability. */
  raw: Record<string, unknown>
}

export interface FetchOptions {
  /** Maximum candidates to return. Providers must honour this. */
  limit: number
  /** Restrict to these categories when the source supports it. */
  categories?: readonly string[]
  /** Anything already seen, so a provider can skip known items. */
  knownRefs?: ReadonlySet<string>
}

export interface FetchOutcome {
  candidates: readonly ResearchCandidate[]
  /** How many requests this run consumed, for rate limit accounting. */
  requestsMade: number
  /** Non-fatal problems worth surfacing without failing the run. */
  warnings: readonly string[]
}

export interface ResearchProvider {
  readonly descriptor: ProviderDescriptor

  /**
   * Whether this provider can run right now.
   *
   * Must return false when credentials are absent. A provider is never
   * permitted to report itself as ready without them, because that is how a
   * system ends up claiming a live integration it does not have (§56).
   */
  isConfigured(): boolean

  /**
   * Fetches candidates.
   *
   * Returns a `Result` rather than throwing so a single failing provider
   * degrades that provider's status without taking the run down.
   */
  fetch(options: FetchOptions): Promise<Result<FetchOutcome, string>>
}

/** Runtime health, combining the descriptor with what actually happened. */
export interface ProviderHealth {
  key: string
  label: string
  description: string
  sourceType: ProviderSourceType
  status: ProviderStatus
  isEnabled: boolean
  isConfigured: boolean
  missingCredentials: readonly string[]
  rateLimit: RateLimit
  usagePolicy: UsagePolicy
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  nextAllowedAt: string | null
  consecutiveFailures: number
}
