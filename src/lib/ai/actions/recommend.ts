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

/** Every non-`scale_opportunity`, non-`healthy`, non-`insufficient_data` campaign becomes a `REVIEW_CAMPAIGN` escalation — unchanged from Milestone 14. */
function underperformingCampaignRecommendations(bundle: FactBundle): Recommendation[] {
  return bundle.advertisingCampaigns
    .filter((c) => c.classification !== 'healthy' && c.classification !== 'insufficient_data' && c.classification !== 'scale_opportunity')
    .slice(0, 5)
    .map((c) => ({
      id: `rec:campaign:${c.campaignKey}`,
      type: 'REVIEW_CAMPAIGN' as const,
      title: `Review campaign ${c.campaignName} on ${CHANNEL_LABELS[c.channel] ?? c.channel}`,
      explanation: c.reasons[0] ?? `${c.campaignName} was classified ${c.classification.replace(/_/g, ' ')}.`,
      supportingFacts: [
        { category: 'fact' as const, label: 'Spend', value: c.spend },
        { category: 'fact' as const, label: 'Attributed revenue', value: c.attributedRevenue },
        { category: 'calculated' as const, label: 'ROAS', value: c.roas },
      ],
      targetEntityType: 'advertising_campaign' as const, targetEntityId: c.campaignKey, targetLabel: c.campaignName, channel: c.channel as ChannelKey,
      expectedBenefit: 'Raises this campaign for your review — no spend, budget or pause state changes on its own.',
      risk: 'This only escalates the item; use chat to request a specific pause or budget change once you have decided.',
      confidence: 'high' as const,
      complianceStatus: 'unknown' as const,
      currencyContext: null,
      assumptions: [],
      requiresApproval: true,
      executable: true,
      suggestedNextStep: `Ask "review campaign ${c.campaignName}" to raise this for your review.`,
      href: '/advertising',
    }))
}

/**
 * Milestone 23 — `scale_opportunity` campaigns, previously excluded here
 * entirely: `bundle.advertisingCampaigns` carried no `productId`, so this
 * function could not re-check the compliance-block override
 * `ceo/priorities.ts`'s "7. Advertising intelligence" section already
 * applies — recommending a budget increase without that check would risk
 * the exact unrestricted-scaling-recommendation bug that override exists
 * to prevent. `productId` now flows through `FactBundle` (the same
 * threading pattern Milestone 22 used for `provider`/`externalAccountId`),
 * so the identical check `ceo/priorities.ts` performs is replicated here —
 * never a second, independently-decided compliance verdict.
 *
 * A compliance-blocked product's campaign gets a `REVIEW_PRODUCT`
 * recommendation pointing at `/compliance` instead — the same
 * "state the conflict explicitly, never silently drop it" choice
 * `ceo/priorities.ts`'s `scale_blocked` priority already makes. An
 * unblocked one becomes `INCREASE_BUDGET` — genuinely `executable` since
 * Milestone 22 built the real chat-to-approval path for it, always
 * `requiresApproval: true` (the domain policy this executes through,
 * `automation/advertisingAutomation.ts`'s `assessCampaignActionPolicy`,
 * can never auto-permit a spend change, for any input). No specific
 * percentage is suggested — the same "or any percentage" convention
 * `priceRecommendations` above already uses, since this codebase has no
 * elasticity model to compute a "correct" increase from.
 */
function scaleOpportunityRecommendations(bundle: FactBundle): Recommendation[] {
  return bundle.advertisingCampaigns
    .filter((c) => c.classification === 'scale_opportunity')
    .slice(0, 5)
    .map((c) => {
      const blockedForCompliance = c.productId
        ? bundle.complianceIssues.some((issue) => issue.productId === c.productId && issue.channel === c.channel && issue.verdict === 'fail')
        : false
      const channelLabel = CHANNEL_LABELS[c.channel] ?? c.channel

      if (blockedForCompliance) {
        return {
          id: `rec:campaign_scale_blocked:${c.campaignKey}`,
          type: 'REVIEW_PRODUCT' as const,
          title: `${c.campaignName} on ${channelLabel} looks like a scaling opportunity, but the product is compliance-blocked`,
          explanation: 'This campaign would otherwise qualify for a scaling recommendation, but the advertised product is currently BLOCKED by compliance on this channel — the block is never bypassed, so scaling is not recommended until it is resolved.',
          supportingFacts: [
            { category: 'fact' as const, label: 'Spend', value: c.spend },
            { category: 'calculated' as const, label: 'ROAS', value: c.roas },
          ],
          targetEntityType: 'product' as const, targetEntityId: c.productId!, targetLabel: c.campaignName, channel: c.channel as ChannelKey,
          expectedBenefit: 'Resolving the compliance block unblocks both the listing and a real scaling recommendation for this campaign.',
          risk: 'The compliance block is never bypassed automatically.',
          confidence: 'high' as const,
          complianceStatus: 'blocked' as const,
          currencyContext: null,
          assumptions: [],
          requiresApproval: false,
          executable: false,
          suggestedNextStep: 'Resolve the compliance block on /compliance before considering a budget increase.',
          href: '/compliance',
        }
      }

      return {
        id: `rec:campaign_scale:${c.campaignKey}`,
        type: 'INCREASE_BUDGET' as const,
        title: `Increase budget for ${c.campaignName} on ${channelLabel}`,
        explanation: c.reasons[0] ?? `${c.campaignName} was classified a profitable scaling opportunity.`,
        supportingFacts: [
          { category: 'fact' as const, label: 'Spend', value: c.spend },
          { category: 'fact' as const, label: 'Attributed revenue', value: c.attributedRevenue },
          { category: 'calculated' as const, label: 'ROAS', value: c.roas },
        ],
        targetEntityType: 'advertising_campaign' as const, targetEntityId: c.campaignKey, targetLabel: c.campaignName, channel: c.channel as ChannelKey,
        expectedBenefit: 'A higher daily budget on a genuinely profitable campaign, within the org\'s configured safe limits, would capture more of the same profitable demand.',
        risk: 'A budget increase does not guarantee proportionally higher revenue — this is a performance fact, not a demand prediction. No automated advertising action executes without your approval, and the policy engine may still block or require approval depending on the org\'s configured daily ad-spend cap.',
        confidence: 'medium' as const,
        complianceStatus: 'pass' as const,
        currencyContext: null,
        assumptions: ['No sales-elasticity model exists in this codebase — a spend increase is proposed, a revenue outcome is not predicted.'],
        requiresApproval: true,
        executable: true,
        suggestedNextStep: `Ask "increase the budget for campaign ${c.campaignName} by 10%" (or any percentage) to generate a reviewable proposal.`,
        href: '/advertising',
      }
    })
}

function campaignRecommendations(bundle: FactBundle): Recommendation[] {
  return [...underperformingCampaignRecommendations(bundle), ...scaleOpportunityRecommendations(bundle)]
}

export function buildRecommendations(bundle: FactBundle): readonly Recommendation[] {
  return [...priceRecommendations(bundle), ...complianceRecommendations(bundle), ...supplierRecommendations(bundle), ...campaignRecommendations(bundle)]
}
