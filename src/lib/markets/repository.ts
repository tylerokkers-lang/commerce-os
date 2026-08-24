import type { ExpansionRecommendation, ExpansionScoreComponent } from './expansion'

/**
 * Persistence for `market_expansion_assessments` — an append-only history
 * (Milestone 9 §12), never overwritten, so a monitor can compare "what did
 * we conclude last time" and the CEO dashboard can show when a market's
 * status genuinely changed. `MarketExpansionRepository` is satisfied
 * twice, exactly like `EventStore`/`AutomationStore`:
 * `supabaseMarketRepository.ts` (production) and
 * `inMemoryMarketRepository.ts` (tests).
 *
 * `StoredExpansionAssessment` is deliberately a lighter summary than the
 * engine's own `ExpansionAssessment` — only what the table genuinely
 * persists (score, recommendation, native/comparison profit, blockers).
 * The full compliance checks and profitability breakdown are not
 * duplicated into storage; a UI that needs the full detail re-runs the
 * (cheap, pure, deterministic) engine, the same way this codebase already
 * prefers recomputing a pure result over storing every field of it twice.
 */

export interface StoredExpansionAssessment {
  productId: string
  marketKey: string
  countryCode: string
  currency: string
  recommendation: ExpansionRecommendation
  score: number
  components: readonly ExpansionScoreComponent[]
  nativeProfitMinor: number | null
  nativeMarginPct: number | null
  comparisonCurrency: string | null
  comparisonProfitMinor: number | null
  fxRateUsed: number | null
  fxObservedAt: string | null
  blockers: readonly string[]
  missingFacts: readonly string[]
  engineVersion: string
  assessedAt: string
}

export interface AffectedAssessment {
  productId: string
  marketKey: string
  /** The exact `market_recheck` job payload that last produced this assessment — replayed verbatim by `handleFxRecheck`. */
  recheckPayload: Record<string, unknown>
}

export interface MarketExpansionRepository {
  recordExpansionAssessment(orgId: string, assessment: import('./expansion').ExpansionAssessment, sourcePayload: Record<string, unknown>, isDemo?: boolean): Promise<void>
  /** Every (product, market) pair whose most recent assessment was computed in `currency` or compared against it via `base`/`quote`. */
  findAssessmentsUsingCurrency(orgId: string, base: string, quote: string): Promise<readonly AffectedAssessment[]>
  getLatestAssessment(orgId: string, productId: string, marketKey: string): Promise<StoredExpansionAssessment | null>
  /** Every market this product has an assessment for, most recent per market — the data behind the global expansion matrix (§8). */
  listAssessmentsForProduct(orgId: string, productId: string): Promise<readonly StoredExpansionAssessment[]>
}
