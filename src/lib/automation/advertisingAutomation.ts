import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import { classifyActionRisk } from './riskClassification'
import type { AutomationSettings } from './settingsTypes'
import type { PolicyRequirement, PolicyResult } from './types'
import type { AdvertisingPlatform, CampaignClassification } from '@/lib/analytics/advertisingAnalytics'

/**
 * Guarded advertising campaign automation (Milestone 15).
 *
 * Mirrors `priceAutomation.ts`'s split exactly: the domain-specific
 * safety gates live here, `policyEngine.ts`'s `evaluateAutomationPolicy`
 * (shared with pricing, unchanged) makes the final `PolicyResult`. One
 * deliberate difference from `priceAutomation.ts`: `assessCampaignActionPolicy`
 * takes no `automationLevel` at all. Price changes let `supervised`/
 * `autonomous` reach `auto_permitted`; campaign actions never do, this
 * milestone, full stop — `domainOutcome` below has no branch that can ever
 * produce `'auto_permitted'`, for any settings, any level, any input. This
 * is the explicit, structural "dry-run boundary" the brief asked for
 * (Phase 15): not a runtime flag that could be misconfigured, but an
 * absence of the code path entirely. A future milestone that wants to
 * allow autonomous campaign actions would need to deliberately add that
 * branch, not flip a setting.
 */

export type CampaignActionType = 'pause_campaign' | 'increase_ad_budget' | 'decrease_ad_budget'

/**
 * No existing setting captures "how old can synced campaign data be before
 * it's too stale to act on" (Phase 10) — `maxDailyAdSpendMinor`/`minRoas`/
 * `maxAutoAdIncreasePct` all govern the *action*, not the *data*. Rather
 * than inventing a UI-configurable threshold with no existing convention
 * to anchor it to, this is a fixed, documented constant: twice the daily
 * sync cadence a connected platform is expected to run at, so one missed
 * sync does not immediately block every action, but two in a row does.
 */
export const MAX_CAMPAIGN_DATA_AGE_HOURS = 48

export interface CampaignActionRequest {
  actionType: CampaignActionType
  /**
   * Identity, kept as three genuinely distinct fields, never conflated —
   * `provider` is which ad platform ran the campaign (`amazon_ads` etc.),
   * `externalAccountId` is that platform's advertiser/account id,
   * `externalCampaignId` is the campaign itself within that account. None
   * of these is `channel` (`ChannelKey`, `'shopify' | 'amazon_uk'`) — the
   * sales channel a campaign is *attributed to*, a genuinely different
   * axis (see `docs/SECURITY.md`'s Milestone 15 section: a TikTok Ads
   * campaign can drive traffic to the Shopify channel). `channel` lives on
   * `CampaignActionInput`/`advertising_connections`, not here, precisely
   * because it is a routing/attribution fact, not part of the campaign's
   * own identity on its platform.
   */
  provider: AdvertisingPlatform
  externalAccountId: string
  externalCampaignId: string
  campaignName: string
  /** The real, already-computed classification (`advertisingAnalytics.ts`'s `classifyCampaign`) this action is responding to — context only, never re-derived here and never itself a safety gate (a `healthy` campaign can still be the subject of a manually-requested review). */
  classification: CampaignClassification | null
  /** Null only when genuinely unknown — never coerced to 0. */
  currentDailyBudgetMinor: number | null
  /** Null for `pause_campaign`, which has no budget component. */
  proposedDailyBudgetMinor: number | null
  isPaused: boolean
  /** From `advertising_connections.status` for this platform — an action is never proposed against a platform that is not actually connected (Phase 9: "provider connection validity"). */
  connectionStatus: 'not_configured' | 'demo' | 'connected' | 'degraded' | 'error'
  /** Hours since `advertising.synced_at` for the underlying campaign data — null when no synced row exists at all (Phase 9: "missing data" / "missing organisation configuration"). */
  dataAgeHours: number | null
  /** For explanation only — not a gate by itself, folded into `domainReason`. */
  roas: number | null
  /**
   * Phase 9 (Milestone 17) — the fuller metrics snapshot behind a
   * monitor-generated recommendation, persisted into `inputFacts` purely
   * so a later reader can see exactly what the decision was based on.
   * Never read by any policy gate in this file — `roas` above (and the
   * gates that actually check freshness/spend/budget elsewhere in this
   * function) remain the only figures that affect the decision itself.
   * Optional because the chat-driven path has no equivalent campaign
   * metrics source to populate it from (campaign actions have no
   * chat-driven path at all today — see `ai/actions/validate.ts`'s
   * `REVIEW_ONLY_REASONS` for `PAUSE_CAMPAIGN`/`INCREASE_BUDGET`/`DECREASE_BUDGET`).
   */
  metricsSnapshot?: {
    spendMinor: number | null
    attributedRevenueMinor: number | null
    acosPct: number | null
    cpaMinor: number | null
    averageOrderValueMinor: number | null
    impressions: number | null
    clicks: number | null
    conversions: number | null
    dataAsOf: string | null
  }
}

export interface CampaignActionAssessment {
  pctChange: number | null
  policy: PolicyResult
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0
}

function safetyGates(request: CampaignActionRequest): PolicyRequirement[] {
  const gates: PolicyRequirement[] = [
    {
      key: 'campaign_identity_valid',
      label: 'Campaign identity is complete',
      satisfied: isNonEmpty(request.externalCampaignId) && isNonEmpty(request.externalAccountId),
      detail: isNonEmpty(request.externalCampaignId) && isNonEmpty(request.externalAccountId)
        ? `${request.provider}: account ${request.externalAccountId}, campaign ${request.externalCampaignId}.`
        : 'A real campaign and account identifier are both required — never a guessed or empty one.',
    },
    {
      key: 'connection_live',
      label: 'Advertising platform connected',
      satisfied: request.connectionStatus === 'connected' || request.connectionStatus === 'demo',
      detail: `Connection status: ${request.connectionStatus}.`,
    },
    {
      key: 'data_fresh',
      label: 'Campaign data is fresh',
      satisfied: request.dataAgeHours !== null && request.dataAgeHours <= MAX_CAMPAIGN_DATA_AGE_HOURS,
      detail: request.dataAgeHours === null
        ? 'Advertising data is stale; fresh synchronization required — no synced data exists for this campaign at all.'
        : request.dataAgeHours <= MAX_CAMPAIGN_DATA_AGE_HOURS
          ? `Data is ${request.dataAgeHours.toFixed(1)}h old, against a ${MAX_CAMPAIGN_DATA_AGE_HOURS}h freshness limit.`
          : `Advertising data is stale; fresh synchronization required — data is ${request.dataAgeHours.toFixed(1)}h old, against a ${MAX_CAMPAIGN_DATA_AGE_HOURS}h freshness limit.`,
    },
  ]

  if (request.actionType === 'pause_campaign') {
    gates.push({
      key: 'not_already_paused',
      label: 'Campaign is not already paused',
      satisfied: !request.isPaused,
      detail: request.isPaused ? 'This campaign is already paused — pausing it again is not a real action.' : 'Campaign is currently active.',
    })
  } else {
    gates.push({
      key: 'not_paused_for_budget_change',
      label: 'Campaign is active',
      satisfied: !request.isPaused,
      detail: request.isPaused ? 'A budget change on a paused campaign has no effect until it is resumed — resume it first.' : 'Campaign is currently active.',
    })
    gates.push({
      key: 'budget_known',
      label: 'Current and proposed budget are both known',
      satisfied: request.currentDailyBudgetMinor !== null && request.proposedDailyBudgetMinor !== null,
      detail: request.currentDailyBudgetMinor === null || request.proposedDailyBudgetMinor === null
        ? 'The current or proposed daily budget is unknown — never guessed.'
        : `Current: ${request.currentDailyBudgetMinor} minor units. Proposed: ${request.proposedDailyBudgetMinor} minor units.`,
    })
  }

  return gates
}

const ACTION_TYPE_TO_AUTOMATION: Record<CampaignActionType, 'pause_campaign' | 'increase_ad_budget' | 'decrease_ad_budget'> = {
  pause_campaign: 'pause_campaign',
  increase_ad_budget: 'increase_ad_budget',
  decrease_ad_budget: 'decrease_ad_budget',
}

function describeAction(request: CampaignActionRequest): string {
  const classificationNote = request.classification ? ` — classified ${request.classification.replace(/_/g, ' ')}` : ''
  if (request.actionType === 'pause_campaign') return `pause "${request.campaignName}"${classificationNote}`
  const direction = request.actionType === 'increase_ad_budget' ? 'increase' : 'decrease'
  return `${direction} the daily budget for "${request.campaignName}" from ${request.currentDailyBudgetMinor ?? '?'} to ${request.proposedDailyBudgetMinor ?? '?'} minor units${request.roas !== null ? ` (current ROAS ${request.roas.toFixed(2)})` : ''}${classificationNote}`
}

export function assessCampaignActionPolicy(request: CampaignActionRequest, settings: AutomationSettings): CampaignActionAssessment {
  const gates = safetyGates(request)
  const gateFailures = gates.filter((g) => !g.satisfied)

  const pctChange = request.currentDailyBudgetMinor !== null && request.currentDailyBudgetMinor > 0 && request.proposedDailyBudgetMinor !== null
    ? ((request.proposedDailyBudgetMinor - request.currentDailyBudgetMinor) / request.currentDailyBudgetMinor) * 100
    : null

  const maxSpendExceeded = request.actionType === 'increase_ad_budget'
    && request.proposedDailyBudgetMinor !== null
    && request.proposedDailyBudgetMinor > settings.maxDailyAdSpendMinor

  // Never 'auto_permitted' — see module comment. Every path here ends in
  // 'blocked' (a safety gate failed, or the proposed spend exceeds the
  // configured daily cap outright) or 'pending_approval' (every gate
  // passed, but this milestone still always asks a human).
  const domainOutcome: DomainOutcome = gateFailures.length > 0 || maxSpendExceeded ? 'blocked' : 'pending_approval'

  const domainReason = gateFailures.length > 0
    ? `Blocked: ${gateFailures.map((g) => g.detail).join(' ')}`
    : maxSpendExceeded
      ? `Blocked: proposed daily budget (${request.proposedDailyBudgetMinor} minor units) exceeds the configured maximum daily ad spend of ${settings.maxDailyAdSpendMinor} minor units.`
      : `Proposing to ${describeAction(request)}. No automated advertising action executes without your approval.`

  const policy = evaluateAutomationPolicy({
    actionType: ACTION_TYPE_TO_AUTOMATION[request.actionType],
    settings,
    domainOutcome,
    domainReason,
    domainRequirements: gates,
    percentageChecks: pctChange !== null
      ? [{ label: 'Maximum automatic ad budget change', actualPct: pctChange, limitPct: settings.maxAutoAdIncreasePct }]
      : [],
    // Milestone: autonomous decision & capability layer. Migrated to the
    // shared classifier. `pause_campaign` has no budget magnitude at all —
    // previously defaulted to `'low'` by the old ternary's false branch;
    // now honestly `'unknown'`. This changes nothing about execution:
    // `domainOutcome` above can never be `'auto_permitted'` for any
    // campaign action, by explicit design (see the module comment) — an
    // `'unknown'`-risk action is *also* never auto-permitted
    // (`policyEngine.ts`), so both old and new code already agreed on the
    // one outcome that matters, `require_approval`/`block`, for every input.
    riskLevel: pctChange !== null
      ? classifyActionRisk({ actionType: ACTION_TYPE_TO_AUTOMATION[request.actionType], magnitude: { kind: 'percentage', actualPct: pctChange, limitPct: settings.maxAutoAdIncreasePct } })
      : classifyActionRisk({ actionType: ACTION_TYPE_TO_AUTOMATION[request.actionType] }),
  })

  return { pctChange, policy }
}
