import 'server-only'

import { loadProductChannelProfitFacts, toPriceCostInput } from '@/lib/analytics/liveAnalyticsFacts'
import { buildProductChannelProfitAnalytics } from '@/lib/analytics/profitAnalytics'
import { isKnown } from '@/lib/analytics/types'
import { assessPriceChangePolicy } from '@/lib/automation/priceAutomation'
import { assessCampaignActionPolicy, type CampaignActionType } from '@/lib/automation/advertisingAutomation'
import { getAutomationSettings } from '@/lib/automation/settings'
import { loadFreshCampaignFacts, loadConnectionStatus } from '@/lib/automation/handlers/advertisingApprovalExecutor'
import type { SessionContext } from '@/lib/security/session'
import type { FactBundle } from '../types'
import { EXECUTABLE_ACTION_TYPES, type ComplianceStatusLabel, type LabelledFact, type ProposedAction, type RawActionIntent } from './types'

/**
 * Only what this module actually reads off a `FactBundle` — deliberately
 * narrow so `propose.ts` can supply a freshly-refetched compliance
 * snapshot at approval-request time without rebuilding a whole bundle.
 * `advertisingCampaigns` (Milestone 22) widens this from its original
 * price-only scope, but both real callers (`propose.ts`, `ai/repository.ts`)
 * already pass a full `FactBundle`, which structurally satisfies it.
 */
export interface ComplianceContext {
  complianceIssues: readonly { productId: string; channel: string; verdict: string }[]
  advertisingCampaigns: FactBundle['advertisingCampaigns']
}

/**
 * Phase 3's deterministic validation gate. Every field on the
 * `RawActionIntent` this receives came from parsing the *user's own*
 * message (`intentExtraction.ts`) — but the current price, cost, margin,
 * and compliance status used below are never taken from that intent or
 * from the `FactBundle`'s cached margin snapshot either. They are
 * re-resolved here, at proposal time, straight from
 * `analytics/liveAnalyticsFacts.ts` (the same org-scoped, service-role
 * Supabase reads `getAnalyticsDashboard()` itself uses) and run back
 * through the one real profitability engine
 * (`analytics/profitAnalytics.ts`'s `buildProductChannelProfitAnalytics`,
 * which itself calls `profitability/channels.ts`'s `projectChannel` — the
 * same engine every other price decision in this codebase goes through).
 * `assessPriceChangePolicy` (`automation/priceAutomation.ts`) is called
 * with `automationLevel` hard-coded to `'assisted'` regardless of the
 * org's real configured level — the one line in this file that actually
 * enforces "an AI-chat-originated price change can never auto-apply": with
 * `'assisted'`, `evaluateAutomationPolicy` can only return `block` or
 * `require_approval`, never `allow_automatic`, no matter what the org's
 * real automation level or spending limits say.
 */

function complianceStatusFor(productId: string, channel: string, bundle: ComplianceContext): ComplianceStatusLabel {
  const issue = bundle.complianceIssues.find((c) => c.productId === productId && c.channel === channel)
  if (!issue) return 'unknown'
  return issue.verdict === 'fail' ? 'blocked' : 'review_required'
}

/** Exactly one of the two match pairs on a `RawActionIntent` is ever populated (see `types.ts`'s module comment) — this resolves whichever one it is into the generic target shape every `ProposedAction` carries. */
function targetOf(intent: RawActionIntent): { type: 'product' | 'advertising_campaign'; id: string; label: string } {
  if (intent.matchedCampaignKey) return { type: 'advertising_campaign', id: intent.matchedCampaignKey, label: intent.matchedCampaignName ?? intent.matchedCampaignKey }
  return { type: 'product', id: intent.matchedProductId ?? '', label: intent.matchedProductTitle ?? '' }
}

function invalid(intent: RawActionIntent, reason: string): ProposedAction {
  const target = targetOf(intent)
  return {
    id: `invalid:${Date.now()}`,
    actionType: intent.actionType,
    targetEntityType: target.type,
    targetEntityId: target.id,
    targetLabel: target.label,
    channel: intent.channel,
    newPriceMinor: null,
    provider: null, externalAccountId: null, externalCampaignId: null, proposedDailyBudgetMinor: null, campaignClassification: null,
    currentState: [], proposedState: [],
    reason,
    supportingFacts: [],
    risk: '',
    complianceStatus: 'unknown',
    confidence: 'low',
    outcome: 'invalid',
    policyReasons: [reason],
    requiresApproval: false,
    executable: false,
    approvalId: null,
  }
}

async function validateUpdatePrice(session: SessionContext, intent: RawActionIntent, bundle: ComplianceContext): Promise<ProposedAction> {
  if (!intent.matchedProductId || !intent.matchedProductTitle) return invalid(intent, 'No product was matched for this price change.')
  const matchedProductId = intent.matchedProductId
  const matchedProductTitle = intent.matchedProductTitle
  if (!intent.channel) return invalid(intent, `Which channel? ${matchedProductTitle} is listed on more than one — say "on Amazon UK" or "on Shopify".`)
  if (intent.requestedPriceMinor === null && intent.requestedPricePct === null) {
    return invalid(intent, `A price change needs a specific amount — try "by 10%" or "to £27.49".`)
  }
  // `loadProductChannelProfitFacts` is a live-only, service-role Supabase
  // read with no demo branch of its own (unlike `getAutomationSettings`
  // below) — calling it unguarded in demo mode throws (a real bug found
  // via browser verification: a 500 from `/api/chat` whenever a real
  // product+price intent was detected in the default, credential-free
  // demo session). Checked here rather than inside that shared loader, so
  // its live-mode callers (`analytics/repository.ts`) are unaffected.
  if (session.isDemo) {
    return invalid(intent, 'Demo mode has no live product/cost data to assess a price change against — connect Supabase to try this for real.')
  }

  const { rows } = await loadProductChannelProfitFacts(session.orgId)
  const row = rows.find((r) => r.productId === matchedProductId && r.channel === intent.channel)
  if (!row) return invalid(intent, `${matchedProductTitle} has no live listing/cost data on ${intent.channel} to price against.`)

  const settings = await getAutomationSettings(session)
  const priceCostInput = toPriceCostInput(row, settings.minNetMarginPct)
  if (priceCostInput.sellingPriceMinor === null) return invalid(intent, `${matchedProductTitle} has no live listing price on ${intent.channel} on file.`)

  const before = buildProductChannelProfitAnalytics(matchedProductId, intent.channel, priceCostInput)
  if (!isKnown(before.projection)) {
    return invalid(intent, `Cannot assess a price change for ${matchedProductTitle} on ${intent.channel}: ${before.projection.source}.`)
  }

  const oldPriceMinor = priceCostInput.sellingPriceMinor
  const newPriceMinor = intent.requestedPriceMinor ?? Math.round(oldPriceMinor * (1 + intent.requestedPricePct! / 100))
  if (newPriceMinor <= 0) return invalid(intent, 'The requested price is not a valid positive amount.')

  const after = buildProductChannelProfitAnalytics(matchedProductId, intent.channel, { ...priceCostInput, sellingPriceMinor: newPriceMinor })
  if (!isKnown(after.projection)) {
    return invalid(intent, `Cannot assess the proposed price for ${matchedProductTitle} on ${intent.channel}: ${after.projection.source}.`)
  }

  const assessment = assessPriceChangePolicy({
    productTitle: matchedProductTitle,
    before: before.projection.value.profitability,
    after: after.projection.value.profitability,
    oldPriceMinor, newPriceMinor,
    automationLevel: 'assisted', // Never auto-permits, regardless of the org's real setting — see module comment.
  }, settings)

  const currency = priceCostInput.sellingPriceCurrency
  const currentState: LabelledFact[] = [
    { category: 'fact', label: 'Current price', value: `${(oldPriceMinor / 100).toFixed(2)} ${currency}` },
    { category: 'fact', label: 'Current net margin', value: `${(assessment.before.netMarginPct ?? 0).toFixed(1)}%` },
  ]
  const proposedState: LabelledFact[] = [
    { category: 'calculated', label: 'Proposed price', value: `${(newPriceMinor / 100).toFixed(2)} ${currency}` },
    { category: 'calculated', label: 'Projected net margin', value: `${(assessment.after.netMarginPct ?? 0).toFixed(1)}%` },
  ]
  const supportingFacts: LabelledFact[] = assessment.policy.requirements.map((r) => ({
    category: 'calculated' as const, label: r.label, value: `${r.satisfied ? 'OK' : 'NOT MET'} — ${r.detail}`,
  }))

  const outcome = assessment.policy.outcome === 'block' ? 'blocked' : 'requires_approval'
  const compliance = complianceStatusFor(matchedProductId, intent.channel, bundle)

  return {
    id: `propose:update_price:${matchedProductId}:${intent.channel}:${Date.now()}`,
    actionType: 'UPDATE_PRICE',
    targetEntityType: 'product', targetEntityId: matchedProductId, targetLabel: matchedProductTitle, channel: intent.channel,
    newPriceMinor,
    provider: null, externalAccountId: null, externalCampaignId: null, proposedDailyBudgetMinor: null, campaignClassification: null,
    currentState, proposedState,
    reason: assessment.policy.reason,
    supportingFacts,
    risk: compliance === 'blocked'
      ? `${matchedProductTitle} is currently BLOCKED by compliance on ${intent.channel} for an unrelated reason — a price change here does not resolve that block.`
      : 'A price change may affect conversion and unit sales — not modelled here.',
    complianceStatus: compliance,
    confidence: assessment.before.netMarginPct !== null && assessment.after.netMarginPct !== null ? 'high' : 'low',
    outcome,
    policyReasons: assessment.policy.requirements.filter((r) => !r.satisfied).map((r) => r.detail),
    requiresApproval: outcome === 'requires_approval',
    executable: true,
    approvalId: null,
  }
}

const CAMPAIGN_ACTION_TYPE_MAP: Record<'PAUSE_CAMPAIGN' | 'INCREASE_BUDGET' | 'DECREASE_BUDGET', CampaignActionType> = {
  PAUSE_CAMPAIGN: 'pause_campaign', INCREASE_BUDGET: 'increase_ad_budget', DECREASE_BUDGET: 'decrease_ad_budget',
}

/**
 * Milestone 22 — `PAUSE_CAMPAIGN`/`INCREASE_BUDGET`/`DECREASE_BUDGET`,
 * mirroring `validateUpdatePrice` above exactly: re-resolve everything
 * live rather than trust the chat turn's cached `FactBundle` figures,
 * call the one real domain policy engine, never invent a mapping.
 *
 * Reuses `advertisingApprovalExecutor.ts`'s own `loadFreshCampaignFacts`/
 * `loadConnectionStatus` — the exact same live reads that function's own
 * execution-time revalidation performs — rather than a second
 * implementation of "how fresh is this campaign's data." `roas: null` and
 * no `metricsSnapshot` match `CampaignActionRequest`'s own documented
 * anticipation of exactly this chat-driven path (see that module's
 * comment): a real numeric ROAS is not obtainable here without re-parsing
 * `FactBundle`'s display-string metrics, which this codebase never does.
 *
 * `assessCampaignActionPolicy` never returns `allow_automatic` for any
 * input (see that module's own comment) — unlike price changes, no
 * `automationLevel` override is needed here to enforce "never auto-applies."
 */
async function validateCampaignAction(session: SessionContext, intent: RawActionIntent, bundle: ComplianceContext): Promise<ProposedAction> {
  if (!intent.matchedCampaignKey || !intent.matchedCampaignName || !intent.channel) {
    return invalid(intent, 'No campaign was matched for this action.')
  }
  const campaign = bundle.advertisingCampaigns.find((c) => c.campaignKey === intent.matchedCampaignKey)
  if (!campaign) return invalid(intent, `${intent.matchedCampaignName} could not be found in the current campaign data.`)
  if (!campaign.provider || !campaign.externalAccountId) {
    return invalid(intent, `${campaign.campaignName}'s advertising platform is not known — this data was not synced from a real, identified connector, so it cannot be acted on through chat. Review on /advertising instead.`)
  }

  // `loadFreshCampaignFacts`/`loadConnectionStatus` are live-only,
  // service-role Supabase reads with no demo branch — the same reason
  // `validateUpdatePrice` above guards demo mode before its own live read.
  if (session.isDemo) {
    return invalid(intent, 'Demo mode has no live campaign/connection data to assess this action against — connect Supabase to try this for real.')
  }

  const actionType = CAMPAIGN_ACTION_TYPE_MAP[intent.actionType as 'PAUSE_CAMPAIGN' | 'INCREASE_BUDGET' | 'DECREASE_BUDGET']

  let proposedDailyBudgetMinor: number | null = null
  if (actionType !== 'pause_campaign') {
    if (intent.requestedPriceMinor === null && intent.requestedPricePct === null) {
      return invalid(intent, 'A budget change needs a specific amount — try "by 10%" or "to £30/day".')
    }
    if (campaign.dailyBudgetMinor === null && intent.requestedPricePct !== null) {
      return invalid(intent, `${campaign.campaignName} has no known current daily budget to apply a percentage change against — try a specific amount instead.`)
    }
    proposedDailyBudgetMinor = intent.requestedPriceMinor ?? Math.round((campaign.dailyBudgetMinor ?? 0) * (1 + intent.requestedPricePct! / 100))
    if (proposedDailyBudgetMinor <= 0) return invalid(intent, 'The requested budget is not a valid positive amount.')
  }

  const fresh = await loadFreshCampaignFacts(session.orgId, intent.channel, campaign.provider, campaign.externalAccountId, campaign.externalCampaignId)
  const connectionStatus = await loadConnectionStatus(session.orgId, campaign.provider)
  const settings = await getAutomationSettings(session)

  const request = {
    actionType,
    provider: campaign.provider as never,
    externalAccountId: campaign.externalAccountId,
    externalCampaignId: campaign.externalCampaignId,
    campaignName: campaign.campaignName,
    classification: (campaign.classification || null) as never,
    currentDailyBudgetMinor: fresh?.currentDailyBudgetMinor ?? campaign.dailyBudgetMinor,
    proposedDailyBudgetMinor,
    isPaused: fresh?.isPaused ?? campaign.isPaused,
    connectionStatus,
    dataAgeHours: fresh?.dataAgeHours ?? null,
    roas: null,
  }

  const assessment = assessCampaignActionPolicy(request, settings)

  const currentState: LabelledFact[] = [
    { category: 'fact', label: 'Current state', value: request.isPaused ? 'Paused' : 'Active' },
    ...(request.currentDailyBudgetMinor !== null
      ? [{ category: 'fact' as const, label: 'Current daily budget', value: `${request.currentDailyBudgetMinor} minor units` }]
      : []),
  ]
  const proposedState: LabelledFact[] = actionType === 'pause_campaign'
    ? [{ category: 'calculated', label: 'Proposed state', value: 'Paused' }]
    : [{ category: 'calculated', label: 'Proposed daily budget', value: `${proposedDailyBudgetMinor} minor units` }]
  const supportingFacts: LabelledFact[] = assessment.policy.requirements.map((r) => ({
    category: 'calculated' as const, label: r.label, value: `${r.satisfied ? 'OK' : 'NOT MET'} — ${r.detail}`,
  }))

  const outcome = assessment.policy.outcome === 'block' ? 'blocked' : 'requires_approval'
  const compliance: ComplianceStatusLabel = 'unknown' // Compliance assessment does not cover advertising campaigns — the same 'unknown' REVIEW_CAMPAIGN already reports for this axis.

  return {
    id: `propose:${intent.actionType.toLowerCase()}:${campaign.campaignKey}:${Date.now()}`,
    actionType: intent.actionType,
    targetEntityType: 'advertising_campaign', targetEntityId: campaign.campaignKey, targetLabel: campaign.campaignName, channel: intent.channel,
    newPriceMinor: null,
    provider: campaign.provider, externalAccountId: campaign.externalAccountId, externalCampaignId: campaign.externalCampaignId,
    proposedDailyBudgetMinor, campaignClassification: campaign.classification || null,
    currentState, proposedState,
    reason: assessment.policy.reason,
    supportingFacts,
    risk: 'A campaign action may affect traffic, sales and ad spend — not modelled here beyond the daily budget cap itself.',
    complianceStatus: compliance,
    confidence: request.currentDailyBudgetMinor !== null && request.dataAgeHours !== null ? 'high' : 'low',
    outcome,
    policyReasons: assessment.policy.requirements.filter((r) => !r.satisfied).map((r) => r.detail),
    requiresApproval: outcome === 'requires_approval',
    executable: true,
    approvalId: null,
  }
}

const REVIEW_ONLY_REASONS: Partial<Record<RawActionIntent['actionType'], string>> = {
  CREATE_LISTING: 'Creating a new listing needs lifecycle stage, supplier capability and a full compliance assessment resolved together — this chat does not yet assemble all three for an arbitrary product on demand. Review on /products and /compliance.',
  PAUSE_LISTING: 'Pausing a listing runs through the same publication-readiness engine as publishing — not yet wired to an arbitrary chat-initiated target in this milestone. Review on /automation.',
  ADJUST_INVENTORY_THRESHOLD: 'Inventory thresholds are an organisation-wide setting, not a per-product action — change it on /settings.',
  REVIEW_ADVERTISING: 'No advertising connector exists in this codebase yet (Milestone 10/11) — there is no live spend data to act on.',
  REVIEW_SUPPLIER: 'Supplier review is a manual judgement call — see /suppliers for the full scoring detail.',
  REVIEW_PRODUCT: 'Review this product directly — see /products for full detail.',
  // PAUSE_CAMPAIGN/INCREASE_BUDGET/DECREASE_BUDGET graduated to real,
  // policy-evaluated proposals in Milestone 22 (`validateCampaignAction`
  // below) — no longer listed here. A campaign of unknown provenance
  // (no `provider` on its `FactBundle` entry) still honestly falls back
  // to `invalid`, never a fabricated review-only reason.
}

function reviewOnly(intent: RawActionIntent, bundle: ComplianceContext): ProposedAction {
  const target = targetOf(intent)
  const compliance = intent.channel && target.type === 'product' ? complianceStatusFor(target.id, intent.channel, bundle) : 'unknown'
  return {
    id: `review:${intent.actionType}:${target.id}:${Date.now()}`,
    actionType: intent.actionType,
    targetEntityType: target.type, targetEntityId: target.id, targetLabel: target.label, channel: intent.channel,
    newPriceMinor: null,
    provider: null, externalAccountId: null, externalCampaignId: null, proposedDailyBudgetMinor: null, campaignClassification: null,
    currentState: [], proposedState: [],
    reason: REVIEW_ONLY_REASONS[intent.actionType] ?? 'Not currently executable through this chat.',
    supportingFacts: [],
    risk: '',
    complianceStatus: compliance,
    confidence: 'low',
    outcome: 'not_executable',
    policyReasons: [],
    requiresApproval: false,
    executable: false,
    approvalId: null,
  }
}

/** REQUEST_APPROVAL and REVIEW_CAMPAIGN: pure escalations, no domain policy to check beyond a real, matched entity — both dispatch through the same shape, differing only in which entity was matched. */
function validateEscalation(intent: RawActionIntent, bundle: ComplianceContext): ProposedAction {
  const target = targetOf(intent)
  const compliance = intent.channel && target.type === 'product' ? complianceStatusFor(target.id, intent.channel, bundle) : 'unknown'
  return {
    id: `propose:${intent.actionType.toLowerCase()}:${target.id}:${Date.now()}`,
    actionType: intent.actionType,
    targetEntityType: target.type, targetEntityId: target.id, targetLabel: target.label, channel: intent.channel,
    newPriceMinor: null,
    provider: null, externalAccountId: null, externalCampaignId: null, proposedDailyBudgetMinor: null, campaignClassification: null,
    currentState: [], proposedState: [],
    reason: `Flag ${target.label} for the owner's attention.`,
    supportingFacts: [],
    risk: 'This only raises the item for review — it does not change anything by itself.',
    complianceStatus: compliance,
    confidence: 'high',
    outcome: 'requires_approval',
    policyReasons: [],
    requiresApproval: true,
    executable: true,
    approvalId: null,
  }
}

export async function validateActionIntent(session: SessionContext, intent: RawActionIntent, bundle: ComplianceContext): Promise<ProposedAction> {
  if (!EXECUTABLE_ACTION_TYPES.includes(intent.actionType)) return reviewOnly(intent, bundle)

  if (intent.actionType === 'UPDATE_PRICE') return validateUpdatePrice(session, intent, bundle)

  if (intent.actionType === 'PAUSE_CAMPAIGN' || intent.actionType === 'INCREASE_BUDGET' || intent.actionType === 'DECREASE_BUDGET') {
    return validateCampaignAction(session, intent, bundle)
  }

  // REQUEST_APPROVAL / REVIEW_CAMPAIGN.
  return validateEscalation(intent, bundle)
}
