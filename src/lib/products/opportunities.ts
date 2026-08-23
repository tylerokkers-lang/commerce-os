import 'server-only'

import { demoEvaluationByRef, demoEvaluations } from '@/lib/demo/research'
import { demoOpportunities } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'
import type { EvaluatedOpportunity } from '@/lib/research/pipeline'
import type { OpportunitySummary } from '@/lib/core/domain'

/**
 * Opportunity reads.
 *
 * In live mode this returns nothing until a research provider has actually run,
 * which is the honest answer for a business that has not yet done any research.
 * The persistence path lands with the first live provider in a later milestone;
 * inventing candidates here would defeat the purpose of the whole pipeline.
 */

export async function getOpportunities(): Promise<readonly OpportunitySummary[]> {
  const session = await requireSession()
  return session.isDemo ? demoOpportunities() : []
}

/** The full evaluation behind one opportunity, for the detail view. */
export async function getOpportunityDetail(id: string): Promise<EvaluatedOpportunity | null> {
  const session = await requireSession()
  if (!session.isDemo) return null
  return demoEvaluationByRef(id) ?? null
}

export interface IntelligenceSummary {
  total: number
  recommendedForTesting: number
  needsReview: number
  awaitingSupplier: number
  watching: number
  rejected: number
  /** Score of the strongest candidate, or null when there are none. */
  topScore: number | null
  /** Candidates where at least one channel is blocked but another is not. */
  channelDivergent: number
  highIpRisk: number
}

/**
 * Counts for the dashboard's Product Intelligence panel.
 *
 * `channelDivergent` is called out on its own because a product that is viable
 * on one channel and blocked on the other is the case most easily lost when
 * channels are averaged together.
 */
export async function getIntelligenceSummary(): Promise<IntelligenceSummary> {
  const session = await requireSession()

  if (!session.isDemo) {
    return {
      total: 0, recommendedForTesting: 0, needsReview: 0, awaitingSupplier: 0,
      watching: 0, rejected: 0, topScore: null, channelDivergent: 0, highIpRisk: 0,
    }
  }

  const evaluations = demoEvaluations()
  const count = (action: string) =>
    evaluations.filter((e) => e.recommendation.action === action).length

  return {
    total: evaluations.length,
    recommendedForTesting: count('test'),
    needsReview: count('review'),
    awaitingSupplier: count('source_supplier'),
    watching: count('watch'),
    rejected: count('reject'),
    topScore: evaluations.length === 0 ? null : Math.max(...evaluations.map((e) => e.score.total)),
    channelDivergent: evaluations.filter(
      (e) =>
        e.recommendation.eligibleChannels.length > 0 &&
        e.recommendation.blockedChannels.length > 0,
    ).length,
    highIpRisk: evaluations.filter((e) => e.compliance.amazon_uk.ip.level === 'high').length,
  }
}

/** Candidates whose demand is rising fastest, regardless of recommendation. */
export async function getTrendingOpportunities(limit = 4): Promise<readonly OpportunitySummary[]> {
  const session = await requireSession()
  if (!session.isDemo) return []

  const byTrend = [...demoEvaluations()]
    .filter((e) => (e.candidate.searchTrendPct ?? 0) > 0)
    .sort((a, b) => (b.candidate.searchTrendPct ?? 0) - (a.candidate.searchTrendPct ?? 0))
    .slice(0, limit)
    .map((e) => e.candidate.externalRef)

  const summaries = await getOpportunities()
  return byTrend
    .map((ref) => summaries.find((s) => s.id === ref))
    .filter((s): s is OpportunitySummary => s !== undefined)
}
