import type { AnalyticsDashboard, AdvertisingIntelligence } from '@/lib/analytics/repository'
import type { MonitoringStatus } from '@/lib/monitoring/repository'
import type { AutomationStatus } from '@/lib/automation/repository'
import type { ApprovalItem, ComplianceIssue } from '@/lib/core/domain'
import { formatMoney } from '@/lib/core/money'
import { isKnown } from '@/lib/analytics/types'
import type { Priority, PrioritySeverity } from './types'

/**
 * The executive priority queue (Milestone 11 §2/§17) — "what needs my
 * attention" and "your priorities today" are the same deterministic list,
 * shown once. No LLM, no invented score: severity and ordering are fixed
 * rules over facts this codebase already computed.
 *
 * `analytics.alerts` (Milestone 10's `businessHealth.ts`) already covers
 * revenue decline, profit decline (including "despite revenue growth"),
 * data-quality gaps, and supplier at-risk/unavailable — those are mapped
 * through, never re-derived. This module only *adds* the facts Milestone
 * 10 did not already turn into an alert: loss-making products (kept
 * channel-specific, per `docs/PRINCIPLES.md` §3 — never collapsed into
 * one global "unprofitable"), automation health, pending approvals,
 * compliance rechecks, and fulfilment problems.
 */

const SEVERITY_RANK: Record<PrioritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const ALERT_SEVERITY: Record<string, PrioritySeverity> = { critical: 'critical', warning: 'high', info: 'low' }

function alertCategory(key: string): Priority['category'] {
  if (key.startsWith('revenue_decline') || key.startsWith('profit_decline')) return 'financial_risk'
  if (key.startsWith('supplier_')) return 'supplier_failure'
  if (key.startsWith('data_quality_')) return 'data_quality'
  return 'data_quality'
}

export interface BuildPrioritiesInput {
  analytics: AnalyticsDashboard
  monitoring: MonitoringStatus
  automation: AutomationStatus
  approvals: readonly ApprovalItem[]
  /** Optional so every pre-existing call site (tests, demo scenarios not focused on compliance) keeps working unchanged — defaults to no known issues, never a guess. */
  complianceIssues?: readonly ComplianceIssue[]
  /** Optional for the same reason — defaults to no campaigns, never a guess (Milestone 14). */
  advertisingIntelligence?: AdvertisingIntelligence
  now: string
}

const CHANNEL_LABELS: Record<string, string> = { shopify: 'Shopify', amazon_uk: 'Amazon UK' }

export function buildPriorities(input: BuildPrioritiesInput): readonly Priority[] {
  const priorities: Priority[] = []
  const complianceIssues = input.complianceIssues ?? []

  // 1. Everything Milestone 10 already turned into a business alert.
  for (const alert of input.analytics.alerts) {
    priorities.push({
      id: `alert:${alert.key}:${alert.affectedEntityId ?? ''}`,
      severity: ALERT_SEVERITY[alert.severity] ?? 'medium',
      category: alertCategory(alert.key),
      title: alert.message,
      detail: alert.message,
      affectedEntityType: alert.affectedEntityType,
      affectedEntityId: alert.affectedEntityId,
      occurredAt: alert.detectedAt,
      source: alert.source,
      evidence: alert.evidence,
      recommendedNextStep: alert.actionable ? 'Review the affected area and decide whether action is needed.' : 'Informational — no action required.',
      actionRequired: alert.actionable,
      actionHref: alert.affectedEntityType === 'supplier' && alert.affectedEntityId ? `/suppliers/${alert.affectedEntityId}` : null,
    })
  }

  // 2. Loss-making products, kept channel-specific — never "Product X is unprofitable" as a blanket claim.
  const lossMakingByChannel = new Map<string, number>()
  for (const p of input.analytics.lossMakingProducts) {
    lossMakingByChannel.set(p.channel, (lossMakingByChannel.get(p.channel) ?? 0) + 1)
  }
  for (const [channel, count] of lossMakingByChannel) {
    priorities.push({
      id: `loss_making:${channel}`,
      severity: 'critical',
      category: 'financial_risk',
      title: `${count} product${count === 1 ? ' is' : 's are'} currently loss-making on ${CHANNEL_LABELS[channel] ?? channel}.`,
      detail: `${count} product${count === 1 ? '' : 's'} with a known cost and price project a net loss on ${CHANNEL_LABELS[channel] ?? channel} at current cost and price.`,
      affectedEntityType: 'channel', affectedEntityId: channel,
      occurredAt: input.now, source: 'analytics/profitAnalytics.ts: buildProductChannelProfitAnalytics',
      evidence: { channel, count, productIds: input.analytics.lossMakingProducts.filter((p) => p.channel === channel).map((p) => p.productId) },
      recommendedNextStep: 'Review pricing or supplier cost for the affected products.',
      actionRequired: true, actionHref: '/opportunities',
    })
  }

  // 3. Automation health.
  if (input.automation.settings.automationPaused) {
    priorities.push({
      id: 'automation:paused_all',
      severity: 'critical', category: 'automation_failure',
      title: 'All automation is paused.',
      detail: input.automation.settings.automationPausedReason ?? 'No reason was recorded.',
      affectedEntityType: 'automation', affectedEntityId: null,
      occurredAt: input.automation.settings.automationPausedAt ?? input.now,
      source: 'automation/settingsTypes.ts: automationPaused',
      evidence: { reason: input.automation.settings.automationPausedReason, pausedAt: input.automation.settings.automationPausedAt },
      recommendedNextStep: 'Resume automation from /automation once the reason for pausing has been resolved.',
      actionRequired: true, actionHref: '/automation',
    })
  }
  for (const category of input.automation.settings.automationPausedCategories) {
    priorities.push({
      id: `automation:paused_category:${category}`,
      severity: 'medium', category: 'automation_failure',
      title: `The "${category.replace(/_/g, ' ')}" automation category is paused.`,
      detail: `Actions in this category require manual handling until it is resumed.`,
      affectedEntityType: 'automation_category', affectedEntityId: category,
      occurredAt: input.now, source: 'automation/settingsTypes.ts: automationPausedCategories',
      evidence: { category }, recommendedNextStep: 'Resume this category from /automation if it is safe to do so.',
      actionRequired: true, actionHref: '/automation',
    })
  }
  if (input.automation.risk.failedActions > 0) {
    priorities.push({
      id: 'automation:failed_actions',
      severity: 'high', category: 'automation_failure',
      title: `${input.automation.risk.failedActions} automation action${input.automation.risk.failedActions === 1 ? '' : 's'} failed.`,
      detail: 'Recent automation actions did not complete successfully.',
      affectedEntityType: 'automation', affectedEntityId: null,
      occurredAt: input.now, source: 'automation/repository.ts: getAutomationStatus',
      evidence: { failedActions: input.automation.risk.failedActions },
      recommendedNextStep: 'Review recent automation activity on /automation.',
      actionRequired: true, actionHref: '/automation',
    })
  }
  if (input.automation.risk.deadLetterJobs > 0) {
    priorities.push({
      id: 'automation:dead_letter',
      severity: 'high', category: 'automation_failure',
      title: `${input.automation.risk.deadLetterJobs} job${input.automation.risk.deadLetterJobs === 1 ? '' : 's'} exhausted every retry and stopped.`,
      detail: 'These jobs will not run again automatically.',
      affectedEntityType: 'automation', affectedEntityId: null,
      occurredAt: input.now, source: 'automation/repository.ts: getAutomationStatus',
      evidence: { deadLetterJobs: input.automation.risk.deadLetterJobs },
      recommendedNextStep: 'Review dead-lettered jobs on /automation.',
      actionRequired: true, actionHref: '/automation',
    })
  }

  // 4. Pending approvals — escalated to critical only when genuinely close to (or past) expiry, a real fact, not a guess.
  for (const approval of input.approvals) {
    const hoursToExpiry = approval.expiresAt ? (new Date(approval.expiresAt).getTime() - new Date(input.now).getTime()) / (1000 * 60 * 60) : null
    const severity: PrioritySeverity = hoursToExpiry !== null && hoursToExpiry <= 24 ? 'critical' : 'high'
    priorities.push({
      id: `approval:${approval.id}`,
      severity, category: 'pending_approval',
      title: approval.title,
      detail: approval.detail,
      affectedEntityType: 'approval', affectedEntityId: approval.id,
      occurredAt: approval.createdAt, source: 'automation/approvals.ts: getPendingApprovals',
      evidence: { decisionType: approval.decisionType, confidence: approval.confidence, expiresAt: approval.expiresAt },
      recommendedNextStep: 'Review and approve or reject on /approvals.',
      actionRequired: true, actionHref: '/approvals',
    })
  }

  // 5a. Products actively BLOCKED by compliance (verdict = 'fail') — a fatal
  // decision already made, distinct from and more severe than "needs a
  // recheck." Consolidated per channel, per `docs/PRINCIPLES.md` §3 — a
  // product blocked on Amazon and live on Shopify is never one blanket
  // claim. Never implies automation bypassed the block: the recommended
  // next step is always to review, never "automation will handle it."
  const blockedByChannel = new Map<string, ComplianceIssue[]>()
  for (const issue of complianceIssues) {
    if (issue.verdict !== 'fail') continue
    const list = blockedByChannel.get(issue.channel) ?? []
    list.push(issue)
    blockedByChannel.set(issue.channel, list)
  }
  for (const [channel, issues] of blockedByChannel) {
    priorities.push({
      id: `compliance:blocked:${channel}`,
      severity: 'critical', category: 'compliance_risk',
      title: `${issues.length} product${issues.length === 1 ? ' is' : 's are'} blocked by compliance on ${CHANNEL_LABELS[channel] ?? channel}.`,
      detail: `Blocked, not merely under review — a decision already made against the current ruleset. ${issues[0].blockingReasons[0] ?? 'See /compliance for the specific requirement.'}`,
      affectedEntityType: 'channel', affectedEntityId: channel,
      occurredAt: issues.reduce((latest, i) => (i.assessedAt > latest ? i.assessedAt : latest), issues[0].assessedAt),
      source: 'compliance/repository.ts: getComplianceIssues',
      evidence: { channel, count: issues.length, productIds: issues.map((i) => i.productId), reasons: issues.map((i) => i.blockingReasons).flat() },
      recommendedNextStep: 'Review the blocking requirement on /compliance — a block is never bypassed automatically.',
      actionRequired: true, actionHref: '/compliance',
    })
  }

  // 5b. review_required listings — genuinely different from a fatal block: not yet decided, not automatically approved either.
  const reviewByChannel = new Map<string, ComplianceIssue[]>()
  for (const issue of complianceIssues) {
    if (issue.verdict !== 'review_required') continue
    const list = reviewByChannel.get(issue.channel) ?? []
    list.push(issue)
    reviewByChannel.set(issue.channel, list)
  }
  for (const [channel, issues] of reviewByChannel) {
    priorities.push({
      id: `compliance:review_required:${channel}`,
      severity: 'high', category: 'compliance_risk',
      title: `${issues.length} product${issues.length === 1 ? ' needs' : 's need'} compliance review on ${CHANNEL_LABELS[channel] ?? channel}.`,
      detail: 'Not yet decided — never treated as approved while unresolved.',
      affectedEntityType: 'channel', affectedEntityId: channel,
      occurredAt: issues.reduce((latest, i) => (i.assessedAt > latest ? i.assessedAt : latest), issues[0].assessedAt),
      source: 'compliance/repository.ts: getComplianceIssues',
      evidence: { channel, count: issues.length, productIds: issues.map((i) => i.productId) },
      recommendedNextStep: 'Review the outstanding requirement on /compliance.',
      actionRequired: true, actionHref: '/compliance',
    })
  }

  // 5c. Compliance rechecks required (staleness-triggered — a listing whose supplier/product details changed since its last assessment, distinct from an active fail/review verdict above).
  if (input.monitoring.businessAlerts.complianceRechecksRequired > 0) {
    priorities.push({
      id: 'compliance:rechecks_required',
      severity: 'high', category: 'compliance_risk',
      title: `${input.monitoring.businessAlerts.complianceRechecksRequired} product listing${input.monitoring.businessAlerts.complianceRechecksRequired === 1 ? '' : 's'} require a compliance recheck.`,
      detail: 'The supplier or product details behind an approved listing changed since it was last assessed.',
      affectedEntityType: 'compliance', affectedEntityId: null,
      occurredAt: input.now, source: 'monitoring/repository.ts: getMonitoringStatus',
      evidence: { count: input.monitoring.businessAlerts.complianceRechecksRequired },
      recommendedNextStep: 'Review affected listings on /compliance.',
      actionRequired: true, actionHref: '/compliance',
    })
  }

  // 6. Fulfilment problems.
  const missingTracking = input.analytics.fulfilment.missingTracking
  if (missingTracking.status === 'fact' && (missingTracking.value as number) > 0) {
    priorities.push({
      id: 'fulfilment:missing_tracking',
      severity: 'medium', category: 'customer_risk',
      title: `${missingTracking.value} order${missingTracking.value === 1 ? '' : 's'} shipped with no tracking number on file.`,
      detail: 'Delivery outcome for these orders is unknown, not assumed successful.',
      affectedEntityType: 'fulfilment', affectedEntityId: null,
      occurredAt: input.now, source: 'analytics/fulfilmentAnalytics.ts: buildFulfilmentAnalytics',
      evidence: { missingTracking: missingTracking.value },
      recommendedNextStep: 'Review recent shipments on /orders.',
      actionRequired: true, actionHref: '/orders',
    })
  }
  const lateDeliveries = input.analytics.fulfilment.lateDeliveries
  if (lateDeliveries.status === 'fact' && (lateDeliveries.value as number) > 0) {
    priorities.push({
      id: 'fulfilment:late_deliveries',
      severity: 'medium', category: 'customer_risk',
      title: `${lateDeliveries.value} order${lateDeliveries.value === 1 ? '' : 's'} delivered later than promised.`,
      detail: 'These deliveries missed their promised-by date.',
      affectedEntityType: 'fulfilment', affectedEntityId: null,
      occurredAt: input.now, source: 'analytics/fulfilmentAnalytics.ts: buildFulfilmentAnalytics',
      evidence: { lateDeliveries: lateDeliveries.value },
      recommendedNextStep: 'Review delivery performance on /orders.',
      actionRequired: true, actionHref: '/orders',
    })
  }

  // 7. Advertising intelligence (Milestone 14) — real per-campaign
  // classifications from `analytics/advertisingAnalytics.ts`'s
  // `classifyCampaign`, never re-derived here. A `scale_opportunity` is
  // never surfaced as an unrestricted recommendation for a product that is
  // currently compliance-BLOCKED on the same channel (`docs/PRINCIPLES.md`
  // §3/Milestone 11's compliance-visibility rule extended to advertising)
  // — the block is never bypassed, and the conflict is stated explicitly
  // rather than silently dropping the campaign from view.
  const CHANNEL_LABELS_AD: Record<string, string> = { shopify: 'Shopify', amazon_uk: 'Amazon UK' }
  for (const { fact: campaignFact, classification } of input.advertisingIntelligence?.campaigns ?? []) {
    const { identity } = campaignFact
    const channelLabel = CHANNEL_LABELS_AD[identity.channel] ?? identity.channel
    const blockedForCompliance = identity.productId
      ? complianceIssues.some((c) => c.productId === identity.productId && c.channel === identity.channel && c.verdict === 'fail')
      : false

    if (classification.classification === 'wasted_spend') {
      priorities.push({
        id: `advertising:wasted_spend:${identity.campaignKey}`,
        severity: 'critical', category: 'advertising_risk',
        title: `${identity.campaignName} on ${channelLabel} is wasting advertising spend.`,
        detail: classification.reasons.join(' '),
        affectedEntityType: 'advertising_campaign', affectedEntityId: identity.campaignKey,
        occurredAt: input.now, source: 'analytics/advertisingAnalytics.ts: classifyCampaign',
        evidence: { campaignKey: identity.campaignKey, channel: identity.channel, spend: isKnown(campaignFact.spend) ? formatMoney(campaignFact.spend.value) : null },
        recommendedNextStep: 'Review or pause this campaign on /advertising.',
        actionRequired: true, actionHref: '/advertising',
      })
    } else if (classification.classification === 'poor_profitability') {
      priorities.push({
        id: `advertising:poor_profitability:${identity.campaignKey}`,
        severity: 'high', category: 'advertising_risk',
        title: `${identity.campaignName} on ${channelLabel} is spending above its break-even advertising cost.`,
        detail: classification.reasons.join(' '),
        affectedEntityType: 'advertising_campaign', affectedEntityId: identity.campaignKey,
        occurredAt: input.now, source: 'analytics/advertisingAnalytics.ts: classifyCampaign',
        evidence: { campaignKey: identity.campaignKey, channel: identity.channel },
        recommendedNextStep: 'Review this campaign\'s bids/targeting or the product\'s own cost and price on /advertising.',
        actionRequired: true, actionHref: '/advertising',
      })
    } else if (classification.classification === 'high_acos_low_roas') {
      priorities.push({
        id: `advertising:high_acos_low_roas:${identity.campaignKey}`,
        severity: 'high', category: 'advertising_risk',
        title: `${identity.campaignName} on ${channelLabel} is below the configured minimum ROAS.`,
        detail: classification.reasons.join(' '),
        affectedEntityType: 'advertising_campaign', affectedEntityId: identity.campaignKey,
        occurredAt: input.now, source: 'analytics/advertisingAnalytics.ts: classifyCampaign',
        evidence: { campaignKey: identity.campaignKey, channel: identity.channel },
        recommendedNextStep: 'Review this campaign\'s targeting/bids on /advertising.',
        actionRequired: true, actionHref: '/advertising',
      })
    } else if (classification.classification === 'declining_performance') {
      priorities.push({
        id: `advertising:declining:${identity.campaignKey}`,
        severity: 'medium', category: 'advertising_risk',
        title: `${identity.campaignName} on ${channelLabel} has declined against the prior period.`,
        detail: classification.reasons.join(' '),
        affectedEntityType: 'advertising_campaign', affectedEntityId: identity.campaignKey,
        occurredAt: input.now, source: 'analytics/advertisingAnalytics.ts: classifyCampaign',
        evidence: { campaignKey: identity.campaignKey, channel: identity.channel },
        recommendedNextStep: 'Review recent performance on /advertising.',
        actionRequired: true, actionHref: '/advertising',
      })
    } else if (classification.classification === 'scale_opportunity') {
      if (blockedForCompliance) {
        priorities.push({
          id: `advertising:scale_blocked:${identity.campaignKey}`,
          severity: 'high', category: 'advertising_risk',
          title: `${identity.campaignName} on ${channelLabel} looks like a scaling opportunity, but the product is compliance-blocked.`,
          detail: 'This campaign would otherwise qualify for a scaling recommendation, but the advertised product is currently BLOCKED by compliance on this channel — the block is never bypassed, so scaling is not recommended until it is resolved.',
          affectedEntityType: 'advertising_campaign', affectedEntityId: identity.campaignKey,
          occurredAt: input.now, source: 'analytics/advertisingAnalytics.ts: classifyCampaign + compliance/repository.ts: getComplianceIssues',
          evidence: { campaignKey: identity.campaignKey, channel: identity.channel, productId: identity.productId },
          recommendedNextStep: 'Resolve the compliance block on /compliance before considering a budget increase.',
          actionRequired: true, actionHref: '/compliance',
        })
      } else {
        priorities.push({
          id: `advertising:scale:${identity.campaignKey}`,
          severity: 'low', category: 'opportunity',
          title: `${identity.campaignName} on ${channelLabel} may be a profitable scaling opportunity.`,
          detail: classification.reasons.join(' '),
          affectedEntityType: 'advertising_campaign', affectedEntityId: identity.campaignKey,
          occurredAt: input.now, source: 'analytics/advertisingAnalytics.ts: classifyCampaign',
          evidence: { campaignKey: identity.campaignKey, channel: identity.channel },
          recommendedNextStep: 'Review on /advertising — a budget increase is never applied automatically.',
          actionRequired: false, actionHref: '/advertising',
        })
      }
    }
  }

  return sortPriorities(priorities)
}

/** Critical first, then by severity, then most recent first within the same severity — deterministic and stable. */
export function sortPriorities(priorities: readonly Priority[]): readonly Priority[] {
  return [...priorities].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (bySeverity !== 0) return bySeverity
    return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  })
}
