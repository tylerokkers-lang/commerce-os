import { fromMajor, type Money } from '@/lib/core/money'
import type { ComplaintAnalysis, ComplaintTheme } from './complaints'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * Differentiation suggestions (§11).
 *
 * Every suggestion is derived from an observed complaint theme, so it answers
 * a problem customers actually report rather than a marketing hunch. Each one
 * records which theme it addresses and how strong the evidence was, so a
 * suggestion can be traced back to the reviews that prompted it.
 *
 * These are original ideas about how to make a better product. Nothing here
 * copies a competitor's text, images, branding or design, and the suggestions
 * are written as instructions to ourselves rather than as listing copy.
 */

export type DifferentiationKind = Enums<'differentiation_kind'>

export interface DifferentiationSuggestion {
  kind: DifferentiationKind
  suggestion: string
  addressesComplaint: ComplaintTheme | null
  evidenceStrength: 'weak' | 'moderate' | 'strong'
  /** Rough additional unit cost, where the change has one. */
  estimatedCost: Money | null
  /** Why this is worth doing, in terms of the evidence. */
  rationale: string
}

interface Playbook {
  theme: ComplaintTheme
  kind: DifferentiationKind
  suggest: (finding: { mentions: number; frequency: number }) => string
  estimatedCost: Money | null
}

/**
 * The response to each complaint theme.
 *
 * These are the interventions that are actually available to a small operator:
 * specification changes a supplier can make, what goes in the box, and how the
 * product is explained. Nothing here requires owning a factory.
 */
const PLAYBOOK: readonly Playbook[] = [
  {
    theme: 'performance',
    kind: 'quality',
    suggest: () =>
      'Specify a higher performance grade with the supplier and have a sample independently checked before committing. The single most common complaint is that the product underperforms what the category promises, so this is the difference customers would notice first.',
    estimatedCost: fromMajor(1.2),
  },
  {
    theme: 'durability',
    kind: 'quality',
    suggest: () =>
      'Ask the supplier for the failure point behind the reported breakages and specify a stronger material or fixing at that point. Then offer a longer warranty than the category norm, which is only affordable once the failure is actually fixed.',
    estimatedCost: fromMajor(0.9),
  },
  {
    theme: 'missing_components',
    kind: 'bundle',
    suggest: () =>
      'Include the parts customers report having to buy separately. Bundling them costs less than the returns and poor reviews caused by leaving them out, and it justifies a higher price against competitors who do not.',
    estimatedCost: fromMajor(1.5),
  },
  {
    theme: 'instructions',
    kind: 'instructions',
    suggest: () =>
      'Write and photograph our own step-by-step instructions in clear English, and add a short fitting video linked by QR code. Competitors ship a single unlabelled diagram, so this is cheap to beat.',
    estimatedCost: fromMajor(0.35),
  },
  {
    theme: 'packaging',
    kind: 'packaging',
    suggest: () =>
      'Specify a rigid box with moulded or corrugated protection at the corners that arrive damaged. Damage in transit is charged back to us twice, once as a refund and once as a review.',
    estimatedCost: fromMajor(0.8),
  },
  {
    theme: 'sizing',
    kind: 'positioning',
    suggest: () =>
      'Put the actual dimensions and a size-in-context photograph in the first two images, and state the fit plainly in the opening line of the description. Size surprises are the cheapest returns to eliminate.',
    estimatedCost: null,
  },
  {
    theme: 'accuracy',
    kind: 'positioning',
    suggest: () =>
      'Describe the product conservatively and let it exceed the claim. Most of the anger in this category is aimed at listings that promised more than the product delivers, and understating is free.',
    estimatedCost: null,
  },
  {
    theme: 'delivery',
    kind: 'support',
    suggest: () =>
      'Use a supplier who can dispatch domestically within two working days, and state the delivery window honestly rather than optimistically. Late delivery drives both refunds and marketplace metric damage.',
    estimatedCost: null,
  },
  {
    theme: 'quality',
    kind: 'quality',
    suggest: () =>
      'Move up a material grade and inspect a pre-production sample. "Feels cheap" is a first-impression judgement that costs a review before the product has even been used.',
    estimatedCost: fromMajor(1.1),
  },
  {
    theme: 'support',
    kind: 'support',
    suggest: () =>
      'Include a card with a direct support contact and a same-working-day reply commitment. Customers who reach a person rarely leave the review they were about to write.',
    estimatedCost: fromMajor(0.1),
  },
  {
    theme: 'value',
    kind: 'value',
    suggest: () =>
      'Either add enough to the bundle to justify the price, or reposition below the complaint threshold. Being mid-priced and unremarkable is the worst of both.',
    estimatedCost: null,
  },
]

/** Suggestions worth making regardless of what the reviews say. */
const BASELINE: readonly DifferentiationSuggestion[] = [
  {
    kind: 'positioning',
    suggestion:
      'Commission original photography rather than using supplier images. It is required to avoid inheriting someone else’s copyright, and it is the single clearest visual signal that separates a real brand from a reseller.',
    addressesComplaint: null,
    evidenceStrength: 'moderate',
    estimatedCost: fromMajor(0.4),
    rationale:
      'Applies to every product. Supplier images carry unclear ownership and are shared with every competitor selling the same item.',
  },
]

export interface DifferentiationInput {
  analysis: ComplaintAnalysis
  /** Cap on how many suggestions to return. */
  limit?: number
}

/**
 * Turns complaint analysis into a ranked set of concrete changes.
 *
 * Ordered by the severity of the problem each one solves, so the first
 * suggestion is the one that would change the most.
 */
export function suggestDifferentiation(input: DifferentiationInput): readonly DifferentiationSuggestion[] {
  const { analysis } = input
  const limit = input.limit ?? 6

  const fromComplaints = analysis.findings
    .map((finding) => {
      const play = PLAYBOOK.find((p) => p.theme === finding.theme)
      if (!play) return null

      // Evidence strength follows how many people said it and how angry they
      // were, not how plausible the idea sounds.
      const strength: DifferentiationSuggestion['evidenceStrength'] =
        finding.severity >= 0.25 ? 'strong' : finding.severity >= 0.1 ? 'moderate' : 'weak'

      const suggestion: DifferentiationSuggestion = {
        kind: play.kind,
        suggestion: play.suggest(finding),
        addressesComplaint: finding.theme,
        evidenceStrength: strength,
        estimatedCost: play.estimatedCost,
        rationale: `${finding.mentions} of ${analysis.sampleSize} sampled reviews raised ${finding.label.toLowerCase()}, averaging ${finding.averageRating} stars.`,
      }
      return suggestion
    })
    .filter((s): s is DifferentiationSuggestion => s !== null)

  return [...fromComplaints, ...BASELINE].slice(0, limit)
}

/**
 * Total added unit cost of a set of suggestions.
 *
 * Differentiation is not free, and the profitability engine has to see the cost
 * before the idea is treated as a plan.
 */
export function differentiationCost(
  suggestions: readonly DifferentiationSuggestion[],
): Money {
  const total = suggestions.reduce((sum, s) => sum + (s.estimatedCost?.minor ?? 0), 0)
  return { minor: total, currency: 'GBP' }
}
