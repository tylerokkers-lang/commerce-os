import { assessCompliance, type ComplianceContext } from '@/lib/compliance/rules'
import { RULESET_VERSION } from '@/lib/compliance/rules'
import type { MarketDescriptor, MarketComplianceResult } from './types'

/**
 * Country-aware compliance (Milestone 9 §3).
 *
 * This module never reimplements a compliance rule. For the one country
 * this codebase has a real, tested ruleset for (GB — `assessCompliance`,
 * Milestone 2), it delegates entirely. For every other country, it
 * produces an explicit `unknown` verdict naming exactly what is missing —
 * "no compliance ruleset registered for this country" — rather than
 * guessing, inventing a law, or silently reusing the UK's verdict. This is
 * the architecture the brief asks for: extensible to ingest a real
 * ruleset for Germany or the US later, honest about having none today.
 *
 * A `MarketComplianceResult` is a structurally different type from
 * `ComplianceAssessment` (`compliance/rules.ts`) specifically so a
 * UK-channel result and a market-scoped result can never be assigned to
 * each other or accidentally compared as if they meant the same thing.
 */

/** Countries this codebase has an actual, registered compliance ruleset for. Adding a country here means a real ruleset exists to delegate to — never just a market catalog entry. */
const COUNTRIES_WITH_RULESETS = new Set(['GB'])

export function assessMarketCompliance(
  market: MarketDescriptor,
  productId: string,
  context: ComplianceContext,
  now: Date = new Date(),
): MarketComplianceResult {
  if (!COUNTRIES_WITH_RULESETS.has(market.countryCode)) {
    return {
      productId, marketKey: market.marketKey, countryCode: market.countryCode,
      verdict: 'not_assessed',
      checks: [],
      blockingReasons: [],
      missingFacts: [`No compliance ruleset is registered for ${market.countryLabel} (${market.countryCode}) yet — this is not a pass, a fail, or a guess; it is genuinely unassessed.`],
      rulesetVersion: RULESET_VERSION,
      assessedAt: now.toISOString(),
      source: 'no_ruleset',
    }
  }

  // GB: delegate entirely to the existing, tested engine. `channelKey`
  // decides which channel's rule variant applies (Amazon's stricter
  // seller-of-record rules vs Shopify's) — the same decision the engine
  // already makes for the two live UK channels; a GB market with no
  // corresponding channel (there is none today) would have no basis to
  // pick a variant, so this branch requires one.
  const channel = market.channelKey ?? 'shopify'
  const assessment = assessCompliance(channel, context, now)

  return {
    productId, marketKey: market.marketKey, countryCode: market.countryCode,
    verdict: assessment.verdict,
    checks: assessment.checks.map((c) => ({ key: c.key, label: c.label, outcome: c.outcome, evidence: c.evidence, remediable: c.remediable })),
    blockingReasons: assessment.blockingReasons,
    missingFacts: [],
    rulesetVersion: assessment.rulesetVersion,
    assessedAt: assessment.assessedAt,
    source: 'delegated',
  }
}
