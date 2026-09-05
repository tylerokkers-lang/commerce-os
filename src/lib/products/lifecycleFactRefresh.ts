import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { recordAudit } from '@/lib/audit'
import { createServiceSupabase } from '@/lib/supabase/server'
import { getChannelReadiness } from '@/lib/marketplaces/channelReadiness'
import { ENGINE_VERSION as PROFITABILITY_ENGINE_VERSION } from './lifecycleFactVersion'
import type { ChannelKey, ProductDecision, ProductStage } from '@/lib/core/domain'

/**
 * The one place a compliance or profitability verdict becomes a durable,
 * queryable current fact (Milestone: continuous candidate lifecycle).
 *
 * The audit that preceded this milestone found the exact gap: both engines
 * were already real and already assembled from live data by
 * `getChannelReadiness` — but its results were used to render a page or
 * feed a recommendation and then discarded. `compliance_records` (0008)
 * has had a complete, correct shape since Milestone 2 with *zero writers*
 * and zero rows; `profitability_records` (0050) is its new mirror image.
 * Nothing here recomputes or reinterprets either engine: this calls the
 * same assembler every page already calls, and writes down what it said.
 *
 * The honesty rules, which the tests pin down individually:
 *
 *   - `pass` is written only when the engine genuinely returned a pass.
 *   - `fail` is written only when the engine genuinely returned a fail.
 *     "Could not assess" is NEVER written as `fail`.
 *   - Missing or unavailable inputs produce `not_assessed`, never `pass`.
 *   - If the assessment itself could not be run at all (the product row is
 *     gone, the database threw), NOTHING is written — a previously valid
 *     verdict is left exactly as it was rather than being overwritten with
 *     a fabricated one.
 *   - Every row carries its own `assessed_at`, the inputs it was computed
 *     from, and the thresholds/ruleset it was judged against, so a reader
 *     can always tell what a stored verdict actually means.
 */

export interface LifecycleFactRefreshResult {
  channel: ChannelKey
  complianceVerdict: 'pass' | 'fail' | 'review_required' | 'not_assessed'
  profitabilityVerdict: 'pass' | 'fail' | 'not_assessed'
  complianceBlockingReasons: readonly string[]
  profitabilityFailureReasons: readonly string[]
}

export async function refreshCandidateLifecycleFacts(
  orgId: string,
  productId: string,
  channel: ChannelKey,
): Promise<Result<LifecycleFactRefreshResult, string>> {
  const supabase = createServiceSupabase()

  const { data: product, error: productError } = await supabase
    .from('products')
    .select('stage, decision')
    .eq('org_id', orgId)
    .eq('id', productId)
    .maybeSingle()

  // Fail closed and write nothing: without the product row there is no
  // assessment to record, and overwriting a previous verdict here would be
  // exactly the fabrication this module exists to prevent.
  if (productError) return err(`Could not read product ${productId}: ${productError.message}`)
  if (!product) return err(`Product ${productId} does not exist for this organisation.`)

  let readiness: Awaited<ReturnType<typeof getChannelReadiness>>
  try {
    readiness = await getChannelReadiness(
      orgId,
      productId,
      channel,
      product.stage as ProductStage,
      product.decision as ProductDecision,
      supabase,
    )
  } catch (error) {
    return err(`Could not assess ${channel} readiness for ${productId}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const { compliance, profitability, supplierId } = readiness
  const assessedAt = new Date().toISOString()

  // --- Compliance ---
  //
  // `compliance === null` means `loadComplianceContext` could not build a
  // context at all. That is a real, current fact — "we cannot assess this"
  // — and is recorded as `not_assessed` with the reason, never as a fail
  // and never as a pass.
  const complianceVerdict = compliance?.verdict ?? 'not_assessed'
  const complianceBlockingReasons = compliance
    ? compliance.blockingReasons
    : ['Not assessed — the product’s compliance context could not be assembled (no product record readable for this organisation).']

  const { error: complianceError } = await supabase.from('compliance_records').upsert(
    {
      org_id: orgId,
      product_id: productId,
      channel,
      verdict: complianceVerdict,
      checks: (compliance?.checks ?? []) as never,
      blocking_reasons: [...complianceBlockingReasons],
      ruleset_version: compliance?.rulesetVersion ?? 'not-assessed',
      supplier_id: supplierId,
      ip_risk: compliance?.ip.level ?? 'unknown',
      restricted_category: compliance?.restrictedCategory ?? false,
      requires_documentation: compliance?.requiresDocumentation ?? false,
      assessed_at: assessedAt,
      assessed_by: 'system',
    },
    { onConflict: 'org_id,product_id,channel' },
  )
  if (complianceError) return err(`Could not persist the compliance verdict: ${complianceError.message}`)

  // --- Profitability ---
  const { error: profitabilityError } = await supabase.from('profitability_records').upsert(
    {
      org_id: orgId,
      product_id: productId,
      channel,
      verdict: profitability.verdict,
      failure_reasons: [...profitability.failureReasons],
      gross_margin_pct: profitability.grossMarginPct,
      net_margin_pct: profitability.netMarginPct,
      min_gross_margin_pct: profitability.minGrossMarginPct,
      min_net_margin_pct: profitability.minNetMarginPct,
      selling_price_minor: profitability.sellingPriceMinor,
      unit_cost_minor: profitability.unitCostMinor,
      shipping_cost_minor: profitability.shippingCostMinor,
      currency: profitability.currency,
      supplier_id: supplierId,
      engine_version: PROFITABILITY_ENGINE_VERSION,
      assessed_at: assessedAt,
      assessed_by: 'system',
      updated_at: assessedAt,
    },
    { onConflict: 'org_id,product_id,channel' },
  )
  if (profitabilityError) return err(`Could not persist the profitability verdict: ${profitabilityError.message}`)

  await recordAudit({
    orgId,
    action: complianceVerdict === 'pass' ? 'COMPLIANCE_APPROVED' : complianceVerdict === 'fail' ? 'COMPLIANCE_BLOCKED' : 'COMPLIANCE_ASSESSED',
    entityType: 'product',
    entityId: productId,
    actorType: 'system',
    reason: `Lifecycle facts refreshed for ${channel}: compliance ${complianceVerdict}, profitability ${profitability.verdict}.`,
    newValue: { channel, complianceVerdict, profitabilityVerdict: profitability.verdict },
    metadata: {
      complianceBlockingReasons: [...complianceBlockingReasons],
      profitabilityFailureReasons: [...profitability.failureReasons],
      netMarginPct: profitability.netMarginPct,
    },
  })

  return ok({
    channel,
    complianceVerdict,
    profitabilityVerdict: profitability.verdict,
    complianceBlockingReasons,
    profitabilityFailureReasons: profitability.failureReasons,
  })
}
