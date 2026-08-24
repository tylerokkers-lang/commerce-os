import type { ChannelKey } from '@/lib/core/domain'
import type { FactBundle } from '../types'
import type { ComplianceStatusLabel, Recommendation } from './types'

/**
 * Phase 2 — structured recommendations, built entirely from a `FactBundle`
 * that has already been assembled from real Commerce-OS facts
 * (`factBundle.ts`). Nothing here is AI-authored: this is the same kind of
 * deterministic rule set `ceo/priorities.ts`'s `buildPriorities` already
 * is, applied to "what's worth suggesting" rather than "what's worth
 * flagging." A `Recommendation` is advisory only — see `types.ts` for how
 * `requiresApproval`/`executable` are decided, and note neither field here
 * grants anything; only `validate.ts`/`propose.ts` can create a real,
 * trackable approval.
 */

const CHANNEL_LABELS: Record<string, string> = { shopify: 'Shopify', amazon_uk: 'Amazon UK' }

function complianceStatusFor(productId: string, channel: string, bundle: FactBundle): ComplianceStatusLabel {
  // Both sides are raw ChannelKeys (`factBundle.ts` never labels `complianceIssues[].channel`) — labelled only for display, below.
  const issue = bundle.complianceIssues.find((c) => c.productId === productId && c.channel === channel)
  if (!issue) return 'unknown'
  return issue.verdict === 'fail' ? 'blocked' : 'review_required'
}

/** Loss-making or thin-margin known products become an `UPDATE_PRICE` recommendation — the only type that can currently become a real proposal (see `types.ts`). Worst margin first. */
function priceRecommendations(bundle: FactBundle): Recommendation[] {
  const candidates: { productId: string; title: string; sku: string; channel: string; netMarginPct: number; netProfitMinor: number | null }[] = []
  for (const p of bundle.products) {
    for (const c of p.channels) {
      if (c.knownNetMarginPct !== null && c.knownNetMarginPct < 0) {
        candidates.push({ productId: p.id, title: p.title, sku: p.sku, channel: c.channel, netMarginPct: c.knownNetMarginPct, netProfitMinor: c.netProfitMinor })
      }
    }
  }
  candidates.sort((a, b) => a.netMarginPct - b.netMarginPct)

  return candidates.slice(0, 5).map((c) => ({
    id: `rec:price:${c.productId}:${c.channel}`,
    type: 'UPDATE_PRICE' as const,
    title: `Review pricing for ${c.title} on ${CHANNEL_LABELS[c.channel] ?? c.channel}`,
    explanation: `${c.title} (${c.sku}) has a net margin of ${c.netMarginPct.toFixed(1)}% on ${CHANNEL_LABELS[c.channel] ?? c.channel}, currently loss-making at current price and cost.`,
    supportingFacts: [
      { category: 'fact' as const, label: 'Net margin', value: `${c.netMarginPct.toFixed(1)}%` },
      { category: 'fact' as const, label: 'Net profit per unit', value: c.netProfitMinor === null ? 'unknown' : `${(c.netProfitMinor / 100).toFixed(2)} minor-unit basis` },
    ],
    targetEntityType: 'product' as const, targetEntityId: c.productId, targetLabel: c.title, channel: c.channel as ChannelKey,
    expectedBenefit: 'A price increase within the org\'s configured safe limits, if it clears the minimum-margin threshold, would restore a positive margin.',
    risk: 'A higher price may reduce conversion or unit sales — this is a margin fact, not a demand prediction.',
    confidence: 'medium' as const,
    complianceStatus: complianceStatusFor(c.productId, c.channel, bundle),
    currencyContext: null,
    assumptions: ['No sales-elasticity model exists in this codebase — a margin improvement is calculated, a sales-volume outcome is not predicted.'],
    requiresApproval: true,
    executable: true,
    suggestedNextStep: `Ask "increase the price of ${c.title} by 5%" (or any percentage) to generate a reviewable proposal.`,
    href: '/products',
  }))
}

/** A real, active compliance block/review is always worth surfacing as a recommendation to look at the product — never bypassed, never re-decided here (the verdict itself is Milestone 1/2's compliance engine's, unchanged). */
function complianceRecommendations(bundle: FactBundle): Recommendation[] {
  return bundle.complianceIssues.slice(0, 5).map((c) => ({
    id: `rec:compliance:${c.productId}:${c.channel}`,
    type: 'REVIEW_PRODUCT' as const,
    title: `${c.verdict === 'fail' ? 'Resolve the compliance block' : 'Complete the compliance review'} for ${c.title} on ${CHANNEL_LABELS[c.channel] ?? c.channel}`,
    explanation: c.verdict === 'fail'
      ? `${c.title} is currently BLOCKED on ${CHANNEL_LABELS[c.channel] ?? c.channel}: ${c.blockingReasons[0] ?? 'see /compliance for the specific requirement.'}`
      : `${c.title} needs compliance review on ${CHANNEL_LABELS[c.channel] ?? c.channel} before its status is fully decided.`,
    supportingFacts: c.blockingReasons.map((r) => ({ category: 'fact' as const, label: 'Requirement', value: r })),
    targetEntityType: 'product' as const, targetEntityId: c.productId, targetLabel: c.title, channel: c.channel as ChannelKey,
    expectedBenefit: 'Resolving this unblocks the listing on this channel.',
    risk: 'This block is never bypassed automatically — resolving it requires the underlying requirement to genuinely be met.',
    confidence: 'high' as const,
    complianceStatus: c.verdict === 'fail' ? 'blocked' as const : 'review_required' as const,
    currencyContext: null,
    assumptions: [],
    requiresApproval: false,
    executable: false,
    suggestedNextStep: 'Review the specific requirement on /compliance.',
    href: '/compliance',
  }))
}

/** A supplier scoring poorly, or blocked on a channel, is worth a review recommendation — never an automatic switch (Milestone 6's supplier-switching automation, unchanged, still owns that decision). */
function supplierRecommendations(bundle: FactBundle): Recommendation[] {
  return bundle.supplierRisk
    .filter((s) => s.score < 50 || s.amazonStatus === 'blocked')
    .slice(0, 3)
    .map((s) => ({
      id: `rec:supplier:${s.id}`,
      type: 'REVIEW_SUPPLIER' as const,
      title: `Review supplier ${s.name}`,
      explanation: `${s.name} scores ${s.score}/100${s.statusReason ? ` — ${s.statusReason}` : ''}.`,
      supportingFacts: [
        { category: 'fact' as const, label: 'Score', value: `${s.score}/100` },
        { category: 'fact' as const, label: 'Amazon UK status', value: s.amazonStatus },
        { category: 'fact' as const, label: 'On-time rate', value: s.onTimeRatePct === null ? 'unknown' : `${s.onTimeRatePct.toFixed(1)}%` },
      ],
      targetEntityType: 'supplier' as const, targetEntityId: s.id, targetLabel: s.name, channel: null,
      expectedBenefit: 'Identifying a redundant or better-scoring supplier reduces single-supplier risk.',
      risk: 'Switching suppliers has its own cost/lead-time risk — this is a review recommendation, not a switch decision.',
      confidence: 'medium' as const,
      complianceStatus: 'unknown' as const,
      currencyContext: null,
      assumptions: [],
      requiresApproval: false,
      executable: false,
      suggestedNextStep: `Review ${s.name} on /suppliers/${s.id}.`,
      href: `/suppliers/${s.id}`,
    }))
}

export function buildRecommendations(bundle: FactBundle): readonly Recommendation[] {
  return [...priceRecommendations(bundle), ...complianceRecommendations(bundle), ...supplierRecommendations(bundle)]
}
