import type { ProposedAction, Recommendation } from './actions/types'

/**
 * Commerce Intelligence chat (Milestone 12).
 *
 * The chat is an interface over the existing intelligence layer, never a
 * second one: everything in `ai/` either (a) turns already-computed facts
 * (`getCEOCommandCentre()`, `getOpportunities()`, `getSuppliers()`, …) into
 * a bounded, serialisable `FactBundle`, or (b) turns a `FactBundle` plus a
 * conversation into language. No module here queries a table, computes a
 * priority, classifies a health status, or evaluates compliance — those
 * remain exactly Milestone 6–11's job.
 */

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

/** How a `FactBundle` reference maps back into the rest of the application — every one a real, existing route, never a fabricated link. */
export type ChatReferenceType =
  | 'priority' | 'compliance' | 'opportunity' | 'supplier' | 'channel' | 'approval' | 'product' | 'advertising_campaign'

export interface ChatReference {
  type: ChatReferenceType
  id: string
  label: string
  href: string | null
}

/**
 * The one thing every provider (real model or offline fallback) is allowed
 * to reason over. Built once per turn by `factBundle.ts`, entirely from
 * already-loaded view models — never a raw table row, never a query the
 * provider could shape itself. `isDemo`/`dataSourceFailures`/
 * `currencyCautions` exist so a provider (and, in the offline case, the UI)
 * can be honest about exactly how much of this bundle is trustworthy.
 */
export interface FactBundle {
  generatedAt: string
  isDemo: boolean
  orgName: string
  /** Non-empty when `getCEOCommandCentre()` itself had to fall back for a source — carried through so the chat never presents a degraded read as complete. */
  dataSourceFailures: readonly string[]
  /** Metrics this bundle deliberately left out because they were `unavailable`/`unknown`/`stale` (e.g. a mixed-currency sales window) — named explicitly so a provider states the limitation instead of guessing. */
  currencyCautions: readonly string[]
  overallHealth: string
  healthAreas: readonly { label: string; status: string; reasons: readonly string[] }[]
  executiveSummary: readonly { label: string; value: string; status: string }[]
  priorities: readonly {
    id: string; severity: string; category: string; title: string; detail: string
    recommendedNextStep: string; source: string; actionHref: string | null
  }[]
  complianceIssues: readonly {
    productId: string; sku: string; title: string; channel: string
    verdict: string; blockingReasons: readonly string[]
  }[]
  channels: readonly {
    channel: string; label: string
    revenue: string; netRevenue: string
    knownNetMarginPct: number | null
    lossMakingProductCount: number
  }[]
  topOpportunities: readonly {
    id: string; title: string; band: string; headline: string
    score: number; amazonCompliance: string; shopifyCompliance: string
  }[]
  opportunitySummary: { total: number; recommendedForTesting: number; needsReview: number; channelDivergent: number } | null
  supplierRisk: readonly {
    id: string; name: string; score: number
    shopifyStatus: string; amazonStatus: string; statusReason: string | null; onTimeRatePct: number | null
  }[]
  pendingApprovals: readonly { id: string; title: string; impact: string | null; expiresAt: string | null }[]
  /**
   * Milestone 13 — the bounded, real set of catalogue entities `ai/actions/`
   * is allowed to match a user's own message against for entity resolution
   * (`intentExtraction.ts`). Sourced from `products/repository.ts`'s
   * `getProducts()` (titles/SKUs — a real Milestone 1 read) joined with
   * whatever per-channel price/margin facts the CEO Command Centre's
   * analytics already computed for that product; never a second product
   * listing query.
   */
  products: readonly {
    id: string; sku: string; title: string; category: string | null; stage: string
    channels: readonly { channel: string; label: string; knownNetMarginPct: number | null; netProfitMinor: number | null }[]
  }[]
  /**
   * Milestone 14 — real, classified advertising campaigns from
   * `analytics/repository.ts`'s `getAdvertisingIntelligence()`. Every
   * figure here is already a fact/calculated `Metric` collapsed to a
   * plain string by `factBundle.ts` — an `unavailable` metric becomes an
   * explicit "unavailable — reason" string, never a coerced zero.
   */
  advertisingCampaigns: readonly {
    campaignKey: string; campaignName: string; channel: string; isPaused: boolean
    spend: string; attributedRevenue: string; roas: string; acosPct: string
    classification: string; severity: string; reasons: readonly string[]
    /**
     * Milestone 22 — the raw identity `automation/advertisingAutomation.ts`'s
     * `CampaignActionRequest` needs to actually act on this campaign
     * (`PAUSE_CAMPAIGN`/`INCREASE_BUDGET`/`DECREASE_BUDGET`), never derived
     * from the display strings above. `provider`/`externalAccountId` are
     * `null` for a campaign of unknown provenance (hand-entered/demo/
     * pre-Milestone-15 data) — chat-driven execution honestly refuses to
     * act on those rather than guessing a platform.
     */
    externalCampaignId: string
    provider: string | null
    externalAccountId: string | null
    dailyBudgetMinor: number | null
  }[]
  advertisingScorecard: { overall: string; totalCampaigns: number; totalSpend: string; overallRoas: string; tacosPct: string } | null
}

/** Whether an answer used the real language model, or the deterministic fact-only fallback — the UI must never present the two identically. */
export type AnswerGroundedIn = 'live_model' | 'fact_only'

export type ChatFactStatus = 'grounded' | 'partial' | 'insufficient_data'

export interface ChatAnswer {
  content: string
  groundedIn: AnswerGroundedIn
  factStatus: ChatFactStatus
  references: readonly ChatReference[]
  /** e.g. a data-source failure, a currency-mixing caution — surfaced to the UI verbatim, never folded silently into `content`. */
  warnings: readonly string[]
  /**
   * Milestone 13 — deterministic, code-derived structured cards, built by
   * `ai/actions/recommend.ts`/`validate.ts` from the same `FactBundle` as
   * `content`, never parsed out of the model's own reply. See
   * `ai/actions/types.ts`'s module comment for why the model contributes
   * nothing to these beyond `content` itself.
   */
  recommendations: readonly Recommendation[]
  proposedAction: ProposedAction | null
}

export type ChatProviderErrorKind = 'not_configured' | 'request_failed' | 'invalid_response'

export interface ChatProviderError {
  kind: ChatProviderErrorKind
  message: string
}

/**
 * Satisfied twice, the same pattern as `AutomationStore`/`FxRateStore`/
 * `EventStore` elsewhere in this codebase: `anthropicProvider.ts` (real,
 * `server-only`) and `offlineProvider.ts` (deterministic, no network call,
 * used whenever `ANTHROPIC_API_KEY` is not configured and in every test).
 * Neither implementation is given tool/function-calling access — a
 * `ChatProvider` only ever turns already-supplied text into more text; it
 * cannot query, mutate, or execute anything.
 */
export interface ChatProvider {
  complete(system: string, messages: readonly ChatMessage[]): Promise<
    { ok: true; value: string } | { ok: false; error: ChatProviderError }
  >
}
