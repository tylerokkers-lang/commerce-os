import { demoCandidates } from '@/lib/research/providers/demo'
import {
  evaluateCandidate,
  rankOpportunities,
  type EvaluatedOpportunity,
  type EvaluationContext,
} from '@/lib/research/pipeline'
import { scoreSupplier, type SupplierScore } from '@/lib/suppliers/scoring'
import { DEMO_SUPPLIERS, suppliersFor } from './suppliers'

/**
 * Runs the simulated research provider through the real pipeline.
 *
 * Nothing here is hand-authored output. The candidates go through the same
 * complaint analysis, supplier ranking, per-channel profitability, compliance
 * rules and scoring that a live provider's candidates would, which is what
 * makes the demo worth having: it exercises the gates rather than illustrating
 * them.
 *
 * The evaluation is deterministic given a fixed clock, so the figures are
 * stable across renders and can be asserted in tests.
 */

/** Fixed so demo output does not shift between renders. */
export const DEMO_CLOCK = new Date('2026-08-22T09:00:00Z')

/**
 * The demo business's settings. These match the defaults shown on the settings
 * page, so the gates behave the way the settings screen says they will.
 */
export const DEMO_CONTEXT: Omit<EvaluationContext, 'suppliers'> = {
  minGrossMarginPct: 25,
  minNetMarginPct: 10,
  minOpportunityScore: 70,
  // The demo business is VAT registered.
  vatRatePct: 20,
  maxDeliveryDays: 7,
  blockedCategories: [],
  ownBrands: ['Commerce OS'],
  restrictedBrands: [],
  // Simulated data is the weakest evidence there is, and the scoring engine
  // reflects that in the confidence it reports.
  signalSource: 'simulated',
}

let cached: readonly EvaluatedOpportunity[] | null = null

/** Evaluates every simulated candidate. Memoised because it is pure. */
export function demoEvaluations(): readonly EvaluatedOpportunity[] {
  if (cached) return cached

  const evaluated = demoCandidates().map((candidate) =>
    evaluateCandidate(
      candidate,
      { ...DEMO_CONTEXT, suppliers: suppliersFor(candidate.externalRef) },
      DEMO_CLOCK,
    ),
  )

  cached = rankOpportunities(evaluated)
  return cached
}

export function demoEvaluationByRef(ref: string): EvaluatedOpportunity | undefined {
  return demoEvaluations().find((e) => e.candidate.externalRef === ref)
}

/** Scores every demo supplier with the real supplier scoring engine. */
export function demoSupplierScores(): ReadonlyMap<string, SupplierScore> {
  const map = new Map<string, SupplierScore>()

  for (const supplier of DEMO_SUPPLIERS) {
    // Cost only means something relative to an alternative, and a supplier's
    // standing score should not depend on which product happens to be open.
    // So cost is measured as how much this supplier typically costs against
    // the best quote, averaged over the products where it actually competes.
    const premiums: number[] = []
    for (const ref of supplier.supplies) {
      const quotes = suppliersFor(ref)
      if (quotes.length < 2) continue

      const landed = (q: (typeof quotes)[number]) =>
        q.signals.unitCost.minor + q.signals.shippingCost.minor
      const best = Math.min(...quotes.map(landed))
      const mine = quotes.find((q) => q.id === supplier.id)
      if (mine && best > 0) premiums.push(landed(mine) / best)
    }

    map.set(
      supplier.id,
      scoreSupplier(
        {
          ...supplier.signals,
          costPremiumRatio:
            premiums.length === 0
              ? undefined
              : premiums.reduce((a, b) => a + b, 0) / premiums.length,
        },
        DEMO_CLOCK,
      ),
    )
  }

  return map
}
