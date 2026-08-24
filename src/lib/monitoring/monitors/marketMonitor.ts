import type { ComplianceContext } from '@/lib/compliance/rules'
import { assessMarketCompliance } from '@/lib/markets/countryCompliance'
import { getMarketCostProfile } from '@/lib/markets/marketCostProfiles'
import { projectMarketProfitability, resolveMarketProjectionInput, type ForeignCostInput } from '@/lib/markets/marketProfitability'
import { evaluateMarketExpansion } from '@/lib/markets/expansion'
import { resolveMarketStatus } from '@/lib/markets/catalog'
import { fxRateFact } from '@/lib/fx/types'
import type { CurrencyCode } from '@/lib/core/money'
import type { MarketDescriptor } from '@/lib/markets/types'
import type { Monitor, MonitorContext, MonitorRunOutcome } from '../eventTypes'

/**
 * Market reassessment monitoring (Milestone 9 §10) — compliance,
 * profitability, and supplier-capability change detection, all scoped to
 * one (product, market) pair.
 *
 * This module composes the real Milestone 9 engines
 * (`assessMarketCompliance`, `projectMarketProfitability`,
 * `evaluateMarketExpansion`) rather than reimplementing any part of their
 * logic — the same "engines are pure, monitors only notice change and
 * enqueue a job" separation every other monitor in this codebase follows.
 * It never enables a market, never launches a listing, never writes a
 * price — it enqueues `market_recheck`, and the automation policy engine
 * decides and acts from there.
 */

export interface MarketMonitorSubject {
  productId: string
  supplierId: string
  market: MarketDescriptor
  complianceContext: ComplianceContext
  profitabilityInput: ForeignCostInput
  comparisonCurrency?: CurrencyCode
}

const MONITOR_KEY = 'market_expansion'

export const marketMonitor: Monitor<MarketMonitorSubject> = {
  descriptor: { key: MONITOR_KEY, label: 'Market expansion', category: 'compliance', defaultIntervalMinutes: 24 * 60 },

  async run(ctx: MonitorContext, subjects: readonly MarketMonitorSubject[]): Promise<MonitorRunOutcome> {
    const errors: string[] = []
    let observationsCreated = 0
    let eventsCreated = 0
    let eventsDeduplicated = 0

    if (!ctx.supplierMarketFacts) {
      return { subjectsChecked: 0, observationsCreated: 0, eventsCreated: 0, eventsDeduplicated: 0, errors: ['marketMonitor requires ctx.supplierMarketFacts, which was not provided.'] }
    }
    const supplierMarketFacts = ctx.supplierMarketFacts

    for (const subject of subjects) {
      try {
        const subjectKey = `${subject.productId}:${subject.market.marketKey}`
        const compliance = assessMarketCompliance(subject.market, subject.productId, subject.complianceContext, ctx.now)
        const supplierCapability = await supplierMarketFacts.loadSupplierMarketCapability(ctx.orgId, subject.supplierId, subject.market.countryCode, ctx.now)

        const costProfile = getMarketCostProfile(subject.market.marketKey)
        let profitability = null
        if (costProfile) {
          // FX normalisation happens before the profitability engine ever
          // runs, per the brief's own pipeline: a supplier's cost, quoted
          // in their own currency, is converted into the market's
          // currency here — using a fresh rate or not at all. This is
          // exactly the step that lets a currency movement flip a
          // market's real pass/fail, not just a side comparison figure.
          const costCurrency = subject.profitabilityInput.productCostForeign.currency
          const costFxFact = costCurrency === subject.market.currency || !ctx.fxStore
            ? fxRateFact({ base: costCurrency, quote: subject.market.currency, rate: 1, source: 'identity', observedAt: ctx.now.toISOString(), retrievedAt: ctx.now.toISOString() }, 'automation', ctx.now)
            : fxRateFact(await ctx.fxStore.getLatestRate(ctx.orgId, costCurrency as never, subject.market.currency as never), 'automation', ctx.now)
          const resolvedInput = resolveMarketProjectionInput(subject.profitabilityInput, subject.market.currency, costFxFact)

          if (resolvedInput.ok) {
            let comparison: Parameters<typeof projectMarketProfitability>[3]
            if (subject.comparisonCurrency && ctx.fxStore) {
              const rate = await ctx.fxStore.getLatestRate(ctx.orgId, subject.market.currency as never, subject.comparisonCurrency as never)
              comparison = { currency: subject.comparisonCurrency, fxFact: fxRateFact(rate, 'automation', ctx.now) }
            }
            profitability = projectMarketProfitability(resolvedInput.value, costProfile, { minGrossMarginPct: 10, minNetMarginPct: 5 }, comparison)
          }
        }

        const marketplaceStatusSnapshot = await resolveMarketStatus(subject.market)

        const assessment = evaluateMarketExpansion({
          productId: subject.productId, market: subject.market, compliance, profitability, supplierCapability,
          marketplaceStatus: marketplaceStatusSnapshot.status,
        }, ctx.now)

        const previous = await ctx.events.getObservation(ctx.orgId, MONITOR_KEY, 'market_product', subjectKey)
        const previousRecommendation = previous?.value.recommendation as string | undefined
        const previousProfitabilityPasses = previous?.value.profitabilityPasses as boolean | null | undefined
        const previousCompliancePass = previous?.value.compliancePass as boolean | null | undefined
        const previousCanShip = previous?.value.canShip as boolean | null | undefined

        const currentProfitabilityPasses = profitability ? profitability.gate.passes : null
        const currentCompliancePass = compliance.verdict === 'pass'
        const currentCanShip = supplierCapability.canShip.value

        // Each underlying fact gets its own event, attributed to exactly
        // what changed — never one vague "something changed" event
        // standing in for three different facts.
        if (previousProfitabilityPasses === true && currentProfitabilityPasses === false) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'MARKET_PROFITABILITY_DETERIORATED', subjectType: 'market_product', subjectId: subjectKey,
            source: 'internal', severity: 'warning', facts: { marketKey: subject.market.marketKey, netMarginPct: profitability?.native.netMarginPct ?? null },
            dedupeKey: `market:${subjectKey}:profitability_deteriorated`,
          })
          if (!result.deduplicated) {
            eventsCreated++
            await ctx.store.enqueueJob({
              orgId: ctx.orgId, jobType: 'market_recheck',
              payload: { productId: subject.productId, marketKey: subject.market.marketKey, supplierId: subject.supplierId, complianceContext: subject.complianceContext, profitabilityInput: subject.profitabilityInput, comparisonCurrency: subject.comparisonCurrency },
              idempotencyKey: `event:${result.id}`, correlationId: result.id,
            })
          } else {
            eventsDeduplicated++
          }
        } else if (previousProfitabilityPasses === false && currentProfitabilityPasses === true) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'MARKET_PROFITABILITY_RECOVERED', subjectType: 'market_product', subjectId: subjectKey,
            source: 'internal', severity: 'info', dedupeKey: null,
          })
          if (!result.deduplicated) eventsCreated++
        }

        if (previousCompliancePass === true && currentCompliancePass === false) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'MARKET_COMPLIANCE_RECHECK_REQUIRED', subjectType: 'market_product', subjectId: subjectKey,
            source: 'internal', severity: 'warning', facts: { marketKey: subject.market.marketKey, verdict: compliance.verdict },
            dedupeKey: `market:${subjectKey}:compliance_recheck`,
          })
          if (!result.deduplicated) {
            eventsCreated++
            await ctx.store.enqueueJob({
              orgId: ctx.orgId, jobType: 'market_recheck',
              payload: { productId: subject.productId, marketKey: subject.market.marketKey, supplierId: subject.supplierId, complianceContext: subject.complianceContext, profitabilityInput: subject.profitabilityInput, comparisonCurrency: subject.comparisonCurrency },
              idempotencyKey: `event:${result.id}`, correlationId: result.id,
            })
          } else {
            eventsDeduplicated++
          }
        }

        if (previousCanShip === true && currentCanShip === false) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'MARKET_SUPPLIER_CAPABILITY_CHANGED', subjectType: 'market_product', subjectId: subjectKey,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'warning',
            facts: { marketKey: subject.market.marketKey, countryCode: subject.market.countryCode }, dedupeKey: `market:${subjectKey}:supplier_capability`,
          })
          if (!result.deduplicated) {
            eventsCreated++
            await ctx.store.enqueueJob({
              orgId: ctx.orgId, jobType: 'market_recheck',
              payload: { productId: subject.productId, marketKey: subject.market.marketKey, supplierId: subject.supplierId, complianceContext: subject.complianceContext, profitabilityInput: subject.profitabilityInput, comparisonCurrency: subject.comparisonCurrency },
              idempotencyKey: `event:${result.id}`, correlationId: result.id,
            })
          } else {
            eventsDeduplicated++
          }
        } else if (previousCanShip === false && currentCanShip === true) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'MARKET_SUPPLIER_CAPABILITY_CHANGED', subjectType: 'market_product', subjectId: subjectKey,
            source: 'external', sourceConnectorKey: subject.supplierId, severity: 'info',
            facts: { marketKey: subject.market.marketKey, recovered: true }, dedupeKey: null,
          })
          if (!result.deduplicated) eventsCreated++
        }

        const becameViable = previousRecommendation !== undefined
          && !['ready', 'promising'].includes(previousRecommendation)
          && ['ready', 'promising'].includes(assessment.recommendation)
        if (becameViable) {
          const result = await ctx.events.createEvent({
            orgId: ctx.orgId, eventType: 'MARKET_BECAME_VIABLE', subjectType: 'market_product', subjectId: subjectKey,
            source: 'internal', severity: 'info',
            previousValue: { recommendation: previousRecommendation }, currentValue: { recommendation: assessment.recommendation },
            facts: { marketKey: subject.market.marketKey, score: assessment.score }, dedupeKey: `market:${subjectKey}:became_viable:${assessment.recommendation}`,
          })
          if (!result.deduplicated) {
            eventsCreated++
            await ctx.store.enqueueJob({
              orgId: ctx.orgId, jobType: 'market_recheck',
              payload: { productId: subject.productId, marketKey: subject.market.marketKey, supplierId: subject.supplierId, complianceContext: subject.complianceContext, profitabilityInput: subject.profitabilityInput, comparisonCurrency: subject.comparisonCurrency },
              idempotencyKey: `event:${result.id}`, correlationId: result.id,
            })
          } else {
            eventsDeduplicated++
          }
        }

        await ctx.events.upsertObservation(ctx.orgId, MONITOR_KEY, 'market_product', subjectKey, {
          status: 'ok',
          value: { recommendation: assessment.recommendation, profitabilityPasses: currentProfitabilityPasses, compliancePass: currentCompliancePass, canShip: currentCanShip },
          lastCheckedAt: ctx.now.toISOString(),
        })
        observationsCreated++
      } catch (error) {
        errors.push(`${subject.productId}:${subject.market.marketKey}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { subjectsChecked: subjects.length, observationsCreated, eventsCreated, eventsDeduplicated, errors }
  },
}
