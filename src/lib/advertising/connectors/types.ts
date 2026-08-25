import type { Result } from '@/lib/core/result'
import type { CurrencyCode } from '@/lib/core/money'
import type { AdvertisingPlatform } from '@/lib/analytics/advertisingAnalytics'

/**
 * The advertising platform connector interface (Milestone 15).
 *
 * Deliberately mirrors `src/lib/marketplaces/connectors/types.ts`, which
 * itself mirrors the supplier and research-provider connector interfaces —
 * the same "this connector exists" vs "we have it connected and working"
 * distinction, the same declared capability set, the same env-var-name-only
 * credential declaration, the same `Result<T, E>` error convention. Nothing
 * here is a new pattern; it is the fourth application of one.
 *
 * `AdvertisingPlatform` (`amazon_ads`/`meta_ads`/`google_ads`/`tiktok_ads`)
 * is imported from `analytics/advertisingAnalytics.ts` rather than
 * redeclared here — it already existed (Milestone 10), and this module is
 * the thing that finally gives it real connectors to describe.
 */

export type AdvertisingConnectionStatus = 'not_configured' | 'demo' | 'connected' | 'degraded' | 'error'

export interface AdvertisingRateLimit {
  requestsPerMinute: number | null
  requestsPerDay: number | null
  minSecondsBetweenRuns: number
}

/**
 * What this connector can actually do — declared up front so a caller can
 * tell "not supported by this platform's API" apart from "not built yet"
 * apart from "failed this attempt," the same three facts
 * `MarketplaceCapabilities`'s own comment insists on never collapsing.
 */
export interface AdvertisingCapabilities {
  readCampaigns: boolean
  pauseCampaign: boolean
  setBudget: boolean
  /** Can this connector read a campaign back after writing to it, to confirm the write actually took? See `MarketplaceCapabilities.verifyWrites` — identical reasoning. */
  verifyWrites: boolean
}

export interface AdvertisingConnectorDescriptor {
  /** Unique registry key — `<platform>` for the real connector, `<platform>_demo` for its demo pair. */
  key: string
  label: string
  platform: AdvertisingPlatform
  capabilities: AdvertisingCapabilities
  /** Environment variable names. Never values. */
  requiredCredentials: readonly string[]
  rateLimit: AdvertisingRateLimit
}

export interface AdvertisingConnectionHealth {
  status: AdvertisingConnectionStatus
  checkedAt: string
  /** Present only when status is 'error' or 'degraded'. */
  detail: string | null
}

/**
 * Phase 3 — the normalized fact every provider must translate its own API
 * shape into. The intelligence engine (`advertisingAnalytics.ts`) never
 * sees a provider-specific field; it only ever sees `advertising` table
 * rows (which `advertising/sync.ts` writes from this shape) and has no
 * knowledge that a `NormalizedCampaignFact` or an `AdvertisingProvider`
 * exists at all — Phase 6's "do not rewrite advertisingAnalytics.ts"
 * requirement, enforced structurally by this type never being imported
 * there.
 */
export interface NormalizedCampaignFact {
  provider: AdvertisingPlatform
  externalAccountId: string
  externalCampaignId: string
  campaignName: string
  status: 'active' | 'paused' | 'archived' | 'unknown'
  /** One calendar day of data — matches `advertising` table's `period_date` grain exactly, never a multi-day bucket. */
  periodDate: string
  impressions: number
  clicks: number
  conversions: number
  spendMinor: number
  revenueMinor: number
  currency: CurrencyCode
  dailyBudgetMinor: number | null
  /** The attribution model/window the platform itself reports (e.g. "7-day click"), where the API exposes one — never invented when it doesn't. */
  attributionModel: string | null
  /** When the platform itself last computed these figures, per its own API — distinct from `syncedAt` (when *we* pulled it), so a genuinely stale upstream figure can be told apart from a stale pull. */
  reportedAt: string
}

export interface FetchCampaignsOptions {
  /** Only fetch records changed/reported since this point, where the platform supports it. */
  sinceIso?: string
  limit: number
}

export interface FetchOutcome<T> {
  records: readonly T[]
  requestsMade: number
  warnings: readonly string[]
}

/**
 * A closed set, not a bare string — same reasoning as
 * `WriteFailureReason` in the marketplace connector interface.
 */
export type AdvertisingWriteFailureReason = 'not_supported' | 'not_configured' | 'requires_approval' | 'rejected'

export interface AdvertisingWriteFailure {
  reason: AdvertisingWriteFailureReason
  detail: string
}

export interface AdvertisingWriteOutcome {
  accepted: boolean
  /** The platform's own reference for this specific write, when it gives one distinct from the campaign id. */
  externalRef: string | null
}

export interface CampaignWriteInput {
  externalCampaignId: string
  /** Idempotency: resubmitting the same write must never create a duplicate platform-side change. */
  idempotencyKey: string
}

export interface AdvertisingProvider {
  readonly descriptor: AdvertisingConnectorDescriptor

  /** Must return false when credentials are absent — never permitted to report itself ready without them. */
  isConfigured(): boolean

  getConnectionHealth(): Promise<Result<AdvertisingConnectionHealth, string>>

  fetchCampaigns(options: FetchCampaignsOptions): Promise<Result<FetchOutcome<NormalizedCampaignFact>, string>>

  /**
   * Every write is gated by the matching `descriptor.capabilities` flag at
   * the call site (`advertising/sync.ts`/`automation/advertisingExecution.ts`)
   * — a connector declaring `pauseCampaign: false` must never have this
   * called at all, not called-and-told-no.
   */
  pauseCampaign(input: CampaignWriteInput): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>>
  setCampaignBudget(input: CampaignWriteInput & { dailyBudgetMinor: number }): Promise<Result<AdvertisingWriteOutcome, AdvertisingWriteFailure>>

  /**
   * VERIFY: reads the campaign back from the platform itself, so a write
   * can be confirmed against the provider's own state rather than assumed
   * from the write call's own response. Only meaningful when
   * `capabilities.verifyWrites` is true.
   */
  verifyCampaignState(externalCampaignId: string): Promise<Result<NormalizedCampaignFact, string>>
}

/** Runtime health, combining the descriptor with what has actually happened — the shape `/advertising`'s connections section renders. */
export interface AdvertisingConnectorSummary {
  key: string
  label: string
  platform: AdvertisingPlatform
  capabilities: AdvertisingCapabilities
  status: AdvertisingConnectionStatus
  isConfigured: boolean
  missingCredentials: readonly string[]
  rateLimit: AdvertisingRateLimit
  lastSyncAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  consecutiveFailures: number
}
