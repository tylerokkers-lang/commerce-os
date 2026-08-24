import type { ExpansionAssessment } from './expansion'
import type { AffectedAssessment, MarketExpansionRepository, StoredExpansionAssessment } from './repository'

interface StoredRow {
  orgId: string
  assessment: ExpansionAssessment
  sourcePayload: Record<string, unknown>
  isDemo: boolean
}

function toSummary(row: StoredRow): StoredExpansionAssessment {
  const a = row.assessment
  return {
    productId: a.productId, marketKey: a.marketKey, countryCode: a.countryCode, currency: a.currency,
    recommendation: a.recommendation, score: a.score, components: a.components,
    nativeProfitMinor: a.profitability?.native.netProfit.minor ?? null,
    nativeMarginPct: a.profitability?.native.netMarginPct ?? null,
    comparisonCurrency: a.profitability?.comparison?.currency ?? null,
    comparisonProfitMinor: a.profitability?.comparison?.netProfit.minor ?? null,
    fxRateUsed: a.profitability?.comparison?.exchangeRate?.rate ?? null,
    fxObservedAt: a.profitability?.comparison?.exchangeRate?.observedAt ?? null,
    blockers: a.blockers, missingFacts: a.missingFacts, engineVersion: a.engineVersion, assessedAt: a.assessedAt,
  }
}

/** A real (not mocked) in-memory `MarketExpansionRepository`, the same pattern as every other store in this codebase. */
export function createInMemoryMarketRepository() {
  const rows: StoredRow[] = []

  function latestByProductMarket(orgId: string): Map<string, StoredRow> {
    const latest = new Map<string, StoredRow>()
    for (const row of rows) {
      if (row.orgId !== orgId) continue
      const key = `${row.assessment.productId}:${row.assessment.marketKey}`
      const existing = latest.get(key)
      if (!existing || new Date(row.assessment.assessedAt) > new Date(existing.assessment.assessedAt)) {
        latest.set(key, row)
      }
    }
    return latest
  }

  const store: MarketExpansionRepository & { getState: () => readonly StoredRow[] } = {
    async recordExpansionAssessment(orgId, assessment, sourcePayload, isDemo = false) {
      rows.push({ orgId, assessment, sourcePayload, isDemo })
    },

    async findAssessmentsUsingCurrency(orgId, base, quote) {
      const affected: AffectedAssessment[] = []
      for (const row of latestByProductMarket(orgId).values()) {
        const usesCurrency = row.assessment.currency === base || row.assessment.currency === quote
          || row.assessment.profitability?.comparison?.currency === base || row.assessment.profitability?.comparison?.currency === quote
        if (usesCurrency) {
          affected.push({ productId: row.assessment.productId, marketKey: row.assessment.marketKey, recheckPayload: row.sourcePayload })
        }
      }
      return affected
    },

    async getLatestAssessment(orgId, productId, marketKey) {
      const row = latestByProductMarket(orgId).get(`${productId}:${marketKey}`)
      return row ? toSummary(row) : null
    },

    async listAssessmentsForProduct(orgId, productId) {
      return [...latestByProductMarket(orgId).values()]
        .filter((row) => row.assessment.productId === productId)
        .map(toSummary)
    },

    getState() {
      return [...rows]
    },
  }

  return store
}
