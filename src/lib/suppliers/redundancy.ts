import {
  assessAmazonCapability,
  assessShopifyCapability,
  rankSuppliers,
  type ChannelCapability,
  type SupplierScore,
  type SupplierSignals,
} from './scoring'
import {
  compareChannels,
  type ChannelComparison,
  type ChannelProfileInput,
  type ChannelProjectionInput,
  type MarginThresholds,
} from '@/lib/profitability/channels'
import type { ChannelKey } from '@/lib/core/domain'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * Supplier redundancy.
 *
 * The workflow this implements is the one in `docs/MILESTONES.md` Milestone 3:
 * detect that the preferred supplier is unavailable, evaluate the
 * alternatives through the same profitability and compliance-capability
 * checks any supplier is judged by, and decide — within the configured
 * automation policy — whether to switch automatically or ask first.
 *
 * Two things are re-checked when a supplier changes, and only two: cost (via
 * the single profitability engine) and channel capability. A different
 * supplier does not change the product's own identifiers, IP risk or
 * category, so the wider compliance assessment does not need re-running —
 * only the parts that are actually a function of *which supplier* fulfils
 * the order.
 *
 * This module decides. It does not execute anything: no supplier order is
 * placed, no listing is changed. That stays behind the approval and
 * automation machinery in later milestones (§5 of `docs/PRINCIPLES.md`).
 */

export type AutomationLevel = Enums<'automation_level'>

export interface UnavailabilityReason {
  key: 'out_of_stock' | 'connector_failing' | 'price_increase' | 'manual_flag'
  detail: string
}

export interface AlternativeCandidate {
  id: string
  name: string
  signals: SupplierSignals
}

export interface RedundancyRequest {
  productTitle: string
  channels: readonly ChannelKey[]
  reason: UnavailabilityReason
  automationLevel: AutomationLevel
  thresholds: MarginThresholds
  /** What the currently preferred supplier was approved for, before it became unavailable. */
  previousChannelStatus: Readonly<Record<ChannelKey, ChannelCapability['status']>>
  alternatives: readonly AlternativeCandidate[]
  /** Selling price and everything except cost, which comes from the chosen alternative. */
  economics: Omit<ChannelProjectionInput, 'productCost' | 'supplierShipping'>
  profileInput: Omit<ChannelProfileInput, 'sellingPrice'>
}

export type RedundancyOutcome =
  | 'no_alternative_available'
  | 'switch_automatically'
  | 'request_approval'

export interface AlternativeAssessment {
  candidate: AlternativeCandidate
  score: SupplierScore
  capability: Readonly<Record<ChannelKey, ChannelCapability>>
  channels: ChannelComparison
  /** True when every channel the previous supplier was approved for still is. */
  preservesApprovedChannels: boolean
  /** True when this alternative is at least as profitable as the failure threshold requires. */
  meetsProfitabilityBar: boolean
}

export interface RedundancyDecision {
  outcome: RedundancyOutcome
  reason: string
  /** The alternative recommended or auto-selected, when one exists. */
  recommended: AlternativeAssessment | null
  /** Every alternative considered, ranked, for transparency. */
  assessed: readonly AlternativeAssessment[]
  requiresOwnerApproval: boolean
}

const CAPABILITY_BY_CHANNEL: Record<
  ChannelKey,
  (signals: SupplierSignals) => ChannelCapability
> = {
  shopify: assessShopifyCapability,
  amazon_uk: assessAmazonCapability,
}

function assessAlternative(
  candidate: AlternativeCandidate,
  request: RedundancyRequest,
  scoreLookup: SupplierScore,
): AlternativeAssessment {
  const capability = Object.fromEntries(
    request.channels.map((channel) => [channel, CAPABILITY_BY_CHANNEL[channel](candidate.signals)]),
  ) as Record<ChannelKey, ChannelCapability>

  const channels = compareChannels(
    {
      ...request.economics,
      productCost: candidate.signals.unitCost,
      supplierShipping: candidate.signals.shippingCost,
    },
    { ...request.profileInput, sellingPrice: request.economics.sellingPrice },
    request.thresholds,
  )

  const preservesApprovedChannels = request.channels.every((channel) => {
    const wasApproved = request.previousChannelStatus[channel] === 'approved'
    return !wasApproved || capability[channel].status === 'approved'
  })

  const meetsProfitabilityBar = request.channels.every((channel) => {
    const wasApproved = request.previousChannelStatus[channel] === 'approved'
    if (!wasApproved) return true
    return channels.projections.find((p) => p.channel === channel)?.gate.passes ?? false
  })

  return {
    candidate,
    score: scoreLookup,
    capability,
    channels,
    preservesApprovedChannels,
    meetsProfitabilityBar,
  }
}

/**
 * What each automation level permits once a genuinely suitable alternative
 * has been found. Compliance is never bypassed at any level — that guardrail
 * from `docs/PRINCIPLES.md` §4 applies before this function is even reached,
 * since an alternative that fails compliance is filtered out first.
 */
function policyPermitsAutoSwitch(level: AutomationLevel, assessment: AlternativeAssessment): boolean {
  switch (level) {
    case 'manual':
      // Recommends only. Nothing is ever auto-selected at this level.
      return false
    case 'assisted':
      // Prepares the switch for a human to approve; never executes it alone.
      return false
    case 'supervised':
      // May act automatically, but only when the alternative is provably no
      // worse: same approved channels, and the profitability gate still
      // passes everywhere it needs to.
      return assessment.preservesApprovedChannels && assessment.meetsProfitabilityBar
    case 'autonomous':
      // May act within the same safety boundary as supervised. Autonomy
      // widens which *decisions* are made without asking, not the compliance
      // or profitability floor itself.
      return assessment.preservesApprovedChannels && assessment.meetsProfitabilityBar
  }
}

/**
 * Evaluates whether, and how, to replace an unavailable supplier.
 *
 * Ranks alternatives on the composite supplier score (never on price alone,
 * consistent with every other supplier decision in this system), then applies
 * the automation policy to the best one that actually preserves what the
 * business already had approved.
 */
export function evaluateSupplierRedundancy(request: RedundancyRequest): RedundancyDecision {
  if (request.alternatives.length === 0) {
    return {
      outcome: 'no_alternative_available',
      reason: `${request.productTitle}: the preferred supplier is unavailable (${request.reason.detail}) and no alternative supplier is on file. This needs the owner's attention — the product cannot be resupplied automatically.`,
      recommended: null,
      assessed: [],
      requiresOwnerApproval: true,
    }
  }

  const ranked = rankSuppliers(
    request.alternatives.map((candidate) => ({ supplier: candidate, signals: candidate.signals })),
  )

  const assessed = ranked.map((entry) =>
    assessAlternative(entry.supplier, request, entry.score),
  )

  // Only an alternative that keeps every previously approved channel approved
  // and still clears the profitability gate there is eligible to be chosen at
  // all — ineligible ones are still reported, for transparency, but never
  // recommended.
  const eligible = assessed.filter((a) => a.preservesApprovedChannels && a.meetsProfitabilityBar)

  if (eligible.length === 0) {
    return {
      outcome: 'request_approval',
      reason: `${request.productTitle}: the preferred supplier is unavailable (${request.reason.detail}). ${assessed.length} alternative${assessed.length === 1 ? '' : 's'} considered, but none preserves the channels this product was approved for at an acceptable margin. A person needs to decide whether to accept a reduced channel set, a lower margin, or pause the product.`,
      recommended: assessed[0] ?? null,
      assessed,
      requiresOwnerApproval: true,
    }
  }

  const best = eligible[0]
  const canAutoSwitch = policyPermitsAutoSwitch(request.automationLevel, best)

  if (canAutoSwitch) {
    return {
      outcome: 'switch_automatically',
      reason: `${request.productTitle}: switched to ${best.candidate.name} (score ${best.score.total}/100) after ${request.reason.detail}. Every previously approved channel remains approved and profitable, and the "${request.automationLevel}" automation level permits this switch without approval.`,
      recommended: best,
      assessed,
      requiresOwnerApproval: false,
    }
  }

  return {
    outcome: 'request_approval',
    reason: `${request.productTitle}: recommend switching to ${best.candidate.name} (score ${best.score.total}/100) after ${request.reason.detail}. Every previously approved channel remains approved and profitable, but the "${request.automationLevel}" automation level requires your approval before switching supplier.`,
    recommended: best,
    assessed,
    requiresOwnerApproval: true,
  }
}
