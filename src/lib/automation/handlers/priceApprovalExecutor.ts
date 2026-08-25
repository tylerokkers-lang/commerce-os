import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import { loadProductChannelProfitFacts, toPriceCostInput } from '@/lib/analytics/liveAnalyticsFacts'
import { buildProductChannelProfitAnalytics } from '@/lib/analytics/profitAnalytics'
import { isKnown } from '@/lib/analytics/types'
import { assessPriceChangePolicy } from '../priceAutomation'
import { submitPriceChangeAction } from '../priceExecution'
import { connectorForChannel } from '@/lib/marketplaces/connectors/registry'
import type { DecisionExecutionOutcome } from '../executionDispatch'
import type { AutomationStore } from '../store'
import type { AutomationSettings } from '../settingsTypes'
import type { ChannelKey } from '@/lib/core/domain'

/**
 * Phase 4 — execution-time revalidation for an approved price change
 * (Milestone 16), mirroring `advertisingApprovalExecutor.ts`'s structure
 * exactly. Deliberately follows `ai/actions/validate.ts`'s
 * `validateUpdatePrice` logic (the existing "re-derive a price change
 * fresh from live data" pattern, already proven for the chat-preview
 * path) rather than `priceAutomation.ts`'s `assessPriceChange` wrapper —
 * this function needs the same live re-lookup that function already does.
 *
 * `update_price` decisions can be created by two different existing
 * flows with two different `ai_decisions.entity_type`/`inputFacts`
 * shapes: the monitor-driven job path (`priceExecution.ts`'s
 * `executePriceChange`, `entityType: 'channel_product'`) and the
 * chat-driven path (`ai/actions/propose.ts`, `entityType: 'product'`).
 * `resolveChannelProduct` below reads whichever one is present and
 * resolves the same `{channelProductId, productId, channel, externalId}`
 * either way, so everything after it is identical regardless of origin.
 */

export interface ApprovedPriceDecision {
  orgId: string
  isDemo: boolean
  automationActionId: string
  idempotencyKey: string
  entityType: string
  entityId: string
  /** Present only for the chat-driven (`entityType: 'product'`) path — the monitor-driven path resolves its channel from `channel_products` directly. */
  channelHint: ChannelKey | null
  productTitle: string
  newPriceMinor: number
}

export interface ResolvedChannelProduct {
  channelProductId: string
  productId: string
  channel: ChannelKey
  externalId: string | null
}

/** Exported for reuse by `automation/recovery.ts` (Milestone 17), which needs the exact same `entityType: 'channel_product' | 'product'` resolution this executor uses — never a second implementation of it. */
export async function resolveChannelProduct(orgId: string, decision: Pick<ApprovedPriceDecision, 'entityType' | 'entityId' | 'channelHint'>): Promise<ResolvedChannelProduct | null> {
  const supabase = createServiceSupabase()

  if (decision.entityType === 'channel_product') {
    const { data: cp } = await supabase.from('channel_products').select('id, product_id, channel_id, external_id').eq('org_id', orgId).eq('id', decision.entityId).maybeSingle()
    if (!cp) return null
    const { data: ch } = await supabase.from('channels').select('key').eq('id', cp.channel_id).maybeSingle()
    if (!ch || (ch.key !== 'shopify' && ch.key !== 'amazon_uk')) return null
    return { channelProductId: cp.id, productId: cp.product_id, channel: ch.key, externalId: cp.external_id }
  }

  // entityType === 'product'
  if (!decision.channelHint) return null
  const { data: ch } = await supabase.from('channels').select('id').eq('org_id', orgId).eq('key', decision.channelHint).maybeSingle()
  if (!ch) return null
  const { data: cp } = await supabase.from('channel_products').select('id, external_id').eq('org_id', orgId).eq('product_id', decision.entityId).eq('channel_id', ch.id).maybeSingle()
  if (!cp) return null
  return { channelProductId: cp.id, productId: decision.entityId, channel: decision.channelHint, externalId: cp.external_id }
}

export async function executeApprovedPriceChange(decision: ApprovedPriceDecision, settings: AutomationSettings, store: AutomationStore): Promise<DecisionExecutionOutcome> {
  const resolved = await resolveChannelProduct(decision.orgId, decision)
  if (!resolved || !resolved.externalId) {
    const reason = `${decision.productTitle} no longer has a live listing on the resolved channel — cannot revalidate against current data.`
    await store.completeAutomationAction(decision.automationActionId, {
      succeeded: false, error: `Blocked on revalidation: ${reason}`, orgId: decision.orgId,
      entityType: decision.entityType, entityId: decision.entityId,
      verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable',
    })
    return { kind: 'revalidation_blocked', automationActionId: decision.automationActionId, reason }
  }

  const { rows } = await loadProductChannelProfitFacts(decision.orgId)
  const row = rows.find((r) => r.productId === resolved.productId && r.channel === resolved.channel)
  if (!row) {
    const reason = `${decision.productTitle} no longer has live cost/price data on ${resolved.channel}.`
    await store.completeAutomationAction(decision.automationActionId, {
      succeeded: false, error: `Blocked on revalidation: ${reason}`, orgId: decision.orgId,
      entityType: decision.entityType, entityId: decision.entityId,
      verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable',
    })
    return { kind: 'revalidation_blocked', automationActionId: decision.automationActionId, reason }
  }

  const priceCostInput = toPriceCostInput(row, settings.minNetMarginPct)
  if (priceCostInput.sellingPriceMinor === null) {
    const reason = `${decision.productTitle} has no live listing price on ${resolved.channel} on file.`
    await store.completeAutomationAction(decision.automationActionId, {
      succeeded: false, error: `Blocked on revalidation: ${reason}`, orgId: decision.orgId,
      entityType: decision.entityType, entityId: decision.entityId,
      verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable',
    })
    return { kind: 'revalidation_blocked', automationActionId: decision.automationActionId, reason }
  }

  const before = buildProductChannelProfitAnalytics(resolved.productId, resolved.channel, priceCostInput)
  const after = buildProductChannelProfitAnalytics(resolved.productId, resolved.channel, { ...priceCostInput, sellingPriceMinor: decision.newPriceMinor })
  if (!isKnown(before.projection) || !isKnown(after.projection)) {
    const reason = `Cannot assess the current profitability of this price change for ${decision.productTitle} on ${resolved.channel}.`
    await store.completeAutomationAction(decision.automationActionId, {
      succeeded: false, error: `Blocked on revalidation: ${reason}`, orgId: decision.orgId,
      entityType: decision.entityType, entityId: decision.entityId,
      verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable',
    })
    return { kind: 'revalidation_blocked', automationActionId: decision.automationActionId, reason }
  }

  const assessment = assessPriceChangePolicy(
    {
      productTitle: decision.productTitle,
      before: before.projection.value.profitability,
      after: after.projection.value.profitability,
      oldPriceMinor: priceCostInput.sellingPriceMinor,
      newPriceMinor: decision.newPriceMinor,
      // Same as the chat-preview path (ai/actions/validate.ts): never permits
      // auto-apply regardless of the org's real configured level. An owner
      // approval is the missing authorization that lets a `require_approval`-shaped
      // outcome proceed here — only a fresh `block` (a genuinely changed fact,
      // e.g. margin no longer clears the minimum) stops execution.
      automationLevel: 'assisted',
    },
    settings,
  )

  if (assessment.policy.outcome === 'block') {
    await store.completeAutomationAction(decision.automationActionId, {
      succeeded: false, error: `Blocked on revalidation: ${assessment.policy.reason}`, orgId: decision.orgId,
      entityType: decision.entityType, entityId: decision.entityId,
      verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable',
    })
    return { kind: 'revalidation_blocked', automationActionId: decision.automationActionId, reason: assessment.policy.reason }
  }

  const connector = connectorForChannel(resolved.channel, decision.isDemo)
  const result = await submitPriceChangeAction(
    {
      orgId: decision.orgId,
      channelProductId: resolved.channelProductId,
      externalId: resolved.externalId,
      productTitle: decision.productTitle,
      newPriceMinor: decision.newPriceMinor,
      pctChange: priceCostInput.sellingPriceMinor > 0 ? ((decision.newPriceMinor - priceCostInput.sellingPriceMinor) / priceCostInput.sellingPriceMinor) * 100 : 0,
      connector,
      automationActionId: decision.automationActionId,
      idempotencyKey: decision.idempotencyKey,
    },
    store,
  )

  return { kind: 'executed', automationActionId: decision.automationActionId, succeeded: result.executed, error: result.executed ? null : 'See automation_actions.error for detail.' }
}
