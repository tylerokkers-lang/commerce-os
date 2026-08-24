import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import type { AffectedAssessment, MarketExpansionRepository, StoredExpansionAssessment } from './repository'
import type { ExpansionRecommendation, ExpansionScoreComponent } from './expansion'

interface Row {
  product_id: string
  market_key: string
  country_code: string
  currency: string
  recommendation: string
  score: number
  score_components: unknown
  native_profit_minor: number | null
  native_margin_pct: number | null
  comparison_currency: string | null
  comparison_profit_minor: number | null
  fx_rate_used: number | null
  fx_observed_at: string | null
  blockers: string[]
  missing_facts: string[]
  engine_version: string
  assessed_at: string
}

function rowToSummary(row: Row): StoredExpansionAssessment {
  return {
    productId: row.product_id, marketKey: row.market_key, countryCode: row.country_code, currency: row.currency,
    recommendation: row.recommendation as ExpansionRecommendation, score: row.score, components: row.score_components as readonly ExpansionScoreComponent[],
    nativeProfitMinor: row.native_profit_minor, nativeMarginPct: row.native_margin_pct,
    comparisonCurrency: row.comparison_currency, comparisonProfitMinor: row.comparison_profit_minor,
    fxRateUsed: row.fx_rate_used, fxObservedAt: row.fx_observed_at,
    blockers: row.blockers, missingFacts: row.missing_facts, engineVersion: row.engine_version, assessedAt: row.assessed_at,
  }
}

/** The production `MarketExpansionRepository`: real, append-only writes/reads against `market_expansion_assessments`. */
export function getSupabaseMarketRepository(): MarketExpansionRepository {
  return {
    async recordExpansionAssessment(orgId, assessment, sourcePayload, isDemo = false) {
      const supabase = createServiceSupabase()
      await supabase.from('market_expansion_assessments').insert({
        org_id: orgId, product_id: assessment.productId, market_key: assessment.marketKey,
        country_code: assessment.countryCode, currency: assessment.currency,
        recommendation: assessment.recommendation, score: assessment.score, score_components: assessment.components as never,
        native_profit_minor: assessment.profitability?.native.netProfit.minor ?? null,
        native_margin_pct: assessment.profitability?.native.netMarginPct ?? null,
        comparison_currency: assessment.profitability?.comparison?.currency ?? null,
        comparison_profit_minor: assessment.profitability?.comparison?.netProfit.minor ?? null,
        fx_rate_used: assessment.profitability?.comparison?.exchangeRate?.rate ?? null,
        fx_observed_at: assessment.profitability?.comparison?.exchangeRate?.observedAt ?? null,
        blockers: assessment.blockers as never, missing_facts: assessment.missingFacts as never,
        source_payload: sourcePayload as never, engine_version: assessment.engineVersion, assessed_at: assessment.assessedAt, is_demo: isDemo,
      })
    },

    async findAssessmentsUsingCurrency(orgId, base, quote) {
      const supabase = createServiceSupabase()
      // The most recent assessment per (product, market) — a distinct-on
      // style query isn't portable via PostgREST, so this fetches a
      // bounded recent window and reduces to "latest per key" in memory,
      // the same approach `liveSubjects.ts` already established for
      // similar cases.
      const { data } = await supabase
        .from('market_expansion_assessments')
        .select('product_id, market_key, currency, comparison_currency, source_payload, assessed_at')
        .eq('org_id', orgId)
        .or(`currency.eq.${base},currency.eq.${quote},comparison_currency.eq.${base},comparison_currency.eq.${quote}`)
        .order('assessed_at', { ascending: false })
        .limit(500)

      const latestByKey = new Map<string, AffectedAssessment>()
      for (const row of data ?? []) {
        const key = `${row.product_id}:${row.market_key}`
        if (!latestByKey.has(key)) {
          latestByKey.set(key, { productId: row.product_id, marketKey: row.market_key, recheckPayload: (row.source_payload as Record<string, unknown>) ?? {} })
        }
      }
      return [...latestByKey.values()]
    },

    async getLatestAssessment(orgId, productId, marketKey) {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('market_expansion_assessments')
        .select('product_id, market_key, country_code, currency, recommendation, score, score_components, native_profit_minor, native_margin_pct, comparison_currency, comparison_profit_minor, fx_rate_used, fx_observed_at, blockers, missing_facts, engine_version, assessed_at')
        .eq('org_id', orgId).eq('product_id', productId).eq('market_key', marketKey)
        .order('assessed_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      return data ? rowToSummary(data) : null
    },

    async listAssessmentsForProduct(orgId, productId) {
      const supabase = createServiceSupabase()
      const { data } = await supabase
        .from('market_expansion_assessments')
        .select('product_id, market_key, country_code, currency, recommendation, score, score_components, native_profit_minor, native_margin_pct, comparison_currency, comparison_profit_minor, fx_rate_used, fx_observed_at, blockers, missing_facts, engine_version, assessed_at')
        .eq('org_id', orgId).eq('product_id', productId)
        .order('assessed_at', { ascending: false })
        .limit(200)

      const latestByMarket = new Map<string, Row>()
      for (const row of data ?? []) {
        if (!latestByMarket.has(row.market_key)) latestByMarket.set(row.market_key, row)
      }
      return [...latestByMarket.values()].map(rowToSummary)
    },
  }
}
