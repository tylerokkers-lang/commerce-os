import 'server-only'

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { calculateProfitability, assessProfitabilityGate } from '@/lib/profitability'
import { buildChannelProfiles } from '@/lib/profitability/channels'
import { getChannelReadiness } from '@/lib/marketplaces/channelReadiness'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { scoreSupplier, type SupplierSignals } from '@/lib/suppliers/scoring'
import { scoreOpportunity, type ScoringSignals } from '@/lib/products/scoring'
import { getProductById as getStorefrontProductById } from '@/lib/shopify/storefront'
import { money } from '@/lib/core/money'
import { normalizeProduct, type StorefrontFacts, type SupplierOfferFacts } from './enrichment'
import { scoreProductQuality, type QualitySignals } from './qualityScore'
import { scoreProductRisk, type ComplianceRiskInput } from './riskScore'
import { assessCapitalRequirement } from './capitalRanking'
import { recommendPricing } from './pricingEngine'
import { recommendProduct, type ProductRecommendation } from './recommendation'

/**
 * The product intelligence assembler (Milestone: product intelligence,
 * Phase 4) — the one place that loads real facts and runs every engine in
 * `src/lib/products/intelligence`, `@/lib/profitability` and
 * `@/lib/products/scoring` in sequence, then persists the result.
 *
 * Scoped to the Shopify channel for this phase, per the brief: "Phase 4
 * should work with the Shopify products currently available through the
 * existing Storefront/Admin architecture... do not build the full
 * supplier marketplace in this phase." A product with listings on other
 * channels only has its Shopify listing considered here; extending this
 * to rank across channels is future work, not silently assumed today.
 *
 * Every write goes through the service-role client, matching every other
 * engine-written table in this schema (product_scores/product_health
 * already established the pattern) — RLS policies for the three tables
 * this milestone touches (0038) grant read-only access to org members for
 * exactly that reason.
 */

export interface ProductIntelligenceResult {
  productId: string
  quality: ReturnType<typeof scoreProductQuality>
  risk: ReturnType<typeof scoreProductRisk>
  opportunity: ReturnType<typeof scoreOpportunity>
  capital: ReturnType<typeof assessCapitalRequirement>
  pricing: ReturnType<typeof recommendPricing>
  profitabilityBreakdown: ReturnType<typeof calculateProfitability>['breakdown']
  recommendation: ProductRecommendation
  recommendationReason: string
  currency: string
  computedAt: string
}

async function loadSupplierOffer(orgId: string, supplierId: string, productId: string) {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('supplier_products')
    .select('unit_cost_minor, shipping_cost_minor, currency, lead_time_days, stock_qty, in_stock')
    .eq('org_id', orgId)
    .eq('supplier_id', supplierId)
    .eq('product_id', productId)
    .maybeSingle()
  return data
}

export async function computeProductIntelligence(
  orgId: string,
  productId: string,
  trigger: string,
  actor: { type: 'user' | 'system'; userId?: string; label?: string },
): Promise<ProductIntelligenceResult | null> {
  const supabase = await createServerSupabase()

  const { data: product } = await supabase
    .from('products')
    .select('id, title, description, category, stage, decision, weight_grams, length_mm, width_mm, height_mm')
    .eq('org_id', orgId)
    .eq('id', productId)
    .maybeSingle()
  if (!product) return null

  const { data: channelRow } = await supabase.from('channels').select('id').eq('org_id', orgId).eq('key', 'shopify').maybeSingle()

  let priceMinor: number | null = null
  let currency = 'GBP'
  let supplierId: string | null = null
  let externalId: string | null = null

  if (channelRow) {
    const { data: listing } = await supabase
      .from('channel_products')
      .select('price_minor, currency, fulfilment_supplier_id, external_id')
      .eq('org_id', orgId)
      .eq('product_id', productId)
      .eq('channel_id', channelRow.id)
      .maybeSingle()
    if (listing) {
      priceMinor = listing.price_minor
      currency = listing.currency
      supplierId = listing.fulfilment_supplier_id
      externalId = listing.external_id
    }
  }

  const supplierOffer = supplierId ? await loadSupplierOffer(orgId, supplierId, productId) : null

  const { data: supplierRow } = supplierId
    ? await supabase
        .from('suppliers')
        .select('name, country, platform, handles_returns, provides_tracking, supports_blind_shipping, supports_custom_invoice, supports_custom_packaging')
        .eq('org_id', orgId)
        .eq('id', supplierId)
        .maybeSingle()
    : { data: null }

  const storefrontResult = externalId ? await getStorefrontProductById(externalId) : null
  const storefrontProduct = storefrontResult?.ok ? storefrontResult.value : null

  const storefrontFacts: StorefrontFacts | null = storefrontProduct
    ? {
        description: storefrontProduct.description,
        imageCount: storefrontProduct.images.length,
        variantCount: storefrontProduct.variants.length,
        hasMeaningfulVariants: storefrontProduct.options.some((o) => o.name !== 'Title' && o.values.length > 1),
        tags: storefrontProduct.tags,
        vendor: null,
      }
    : null

  const supplierOfferFacts: SupplierOfferFacts | null = supplierOffer
    ? {
        unitCostMinor: supplierOffer.unit_cost_minor,
        shippingCostMinor: supplierOffer.shipping_cost_minor,
        leadTimeDays: supplierOffer.lead_time_days,
        stockQty: supplierOffer.stock_qty,
        inStock: supplierOffer.in_stock,
      }
    : null

  const normalized = normalizeProduct(product, storefrontFacts, supplierOfferFacts)

  const settings = await getAutomationSettingsForOrg(orgId)

  // --- Compliance (reused wholesale from the already-built channel readiness assembler) ---
  const readiness = await getChannelReadiness(orgId, productId, 'shopify', product.stage, product.decision)
  const complianceVerdict: ComplianceRiskInput | null = readiness.compliance?.verdict ?? null

  // --- Profitability (the real, existing engine — never re-derived) ---
  let profitability: ReturnType<typeof calculateProfitability> | null = null
  let profitabilityGatePasses = false
  let profitabilityFailureReason: string | null = 'Not assessed — no listing price and/or no supplier cost is on file for this channel yet.'

  if (priceMinor !== null && supplierOfferFacts) {
    const sellingPrice = money(priceMinor, currency as never)
    const adSpendPerUnit = money(Math.round((priceMinor * settings.advertisingAllowancePct) / 100), currency as never)
    const profile = buildChannelProfiles({ category: product.category, sellingPrice, shopifyAdSpendPerUnit: adSpendPerUnit }).find((p) => p.channel === 'shopify')
    if (profile) {
      profitability = calculateProfitability({
        sellingPrice,
        productCost: money(supplierOfferFacts.unitCostMinor, currency as never),
        supplierShipping: money(supplierOfferFacts.shippingCostMinor, currency as never),
        fulfilment: profile.fulfilment,
        channelFeePct: profile.channelFeePct,
        channelFeeFixed: profile.channelFeeFixed,
        paymentFeePct: profile.paymentFeePct,
        paymentFeeFixed: profile.paymentFeeFixed,
        adSpendPerUnit: profile.adSpendPerUnit,
        vatRatePct: 0,
      })
      const gate = assessProfitabilityGate(profitability, { minGrossMarginPct: settings.minGrossMarginPct, minNetMarginPct: settings.minNetMarginPct })
      profitabilityGatePasses = gate.passes
      profitabilityFailureReason = gate.passes ? null : gate.failures.join(' ')
    }
  }

  // --- Supplier reliability ---
  let supplierScoreResult: ReturnType<typeof scoreSupplier> | null = null
  if (supplierRow && supplierOfferFacts) {
    const signals: SupplierSignals = {
      unitCost: money(supplierOfferFacts.unitCostMinor, currency as never),
      shippingCost: money(supplierOfferFacts.shippingCostMinor, currency as never),
      deliveryDaysMax: supplierOfferFacts.leadTimeDays ?? undefined,
      handlesReturns: supplierRow.handles_returns,
      providesTracking: supplierRow.provides_tracking,
      supportsBlindShipping: supplierRow.supports_blind_shipping,
      supportsCustomInvoice: supplierRow.supports_custom_invoice,
      supportsCustomPackaging: supplierRow.supports_custom_packaging,
      // Not tracked on `suppliers` at all yet, unlike the five flags above.
      // `false` is the conservative default (never claims a capability the
      // supplier hasn't confirmed) rather than a no-op: scoreSupplier does
      // read both, so this modestly understates rather than inflates
      // reliability until these are actually captured.
      acceptsFaultyReturns: false,
      supportsOwnBranding: false,
    }
    supplierScoreResult = scoreSupplier(signals)
  }

  // --- Quality ---
  const qualitySignals: QualitySignals = {
    imageCount: normalized.imageCount.value ?? undefined,
    descriptionLength: normalized.description.value?.length,
    hasMeaningfulVariants: normalized.hasMeaningfulVariants.value ?? undefined,
    variantCount: normalized.variantCount.value ?? undefined,
    hasDimensions: product.length_mm !== null && product.width_mm !== null && product.height_mm !== null,
    hasWeight: product.weight_grams !== null,
    supplierAssigned: supplierId !== null,
    supplierHasCost: supplierOfferFacts ? true : supplierId !== null ? false : undefined,
    supplierHasLeadTime: supplierOfferFacts ? supplierOfferFacts.leadTimeDays !== null : supplierId !== null ? false : undefined,
    supplierHasStockFigure: supplierOfferFacts ? supplierOfferFacts.stockQty !== null : supplierId !== null ? false : undefined,
  }
  const quality = scoreProductQuality(qualitySignals)

  // --- Capital exposure ratio, for the risk score ---
  const capitalExposureRatio =
    settings.availableOperatingCapitalMinor && settings.availableOperatingCapitalMinor > 0 && supplierOfferFacts
      ? supplierOfferFacts.unitCostMinor / settings.availableOperatingCapitalMinor
      : undefined

  // --- Risk ---
  const risk = scoreProductRisk({
    supplierReliabilityScore: supplierScoreResult?.total,
    deliveryDaysMax: supplierOfferFacts?.leadTimeDays ?? undefined,
    worstComplianceVerdict: complianceVerdict ?? undefined,
    qualityScore: quality.total,
    supplierInStock: supplierOfferFacts?.inStock,
    supplierStockFigureKnown: supplierOfferFacts ? supplierOfferFacts.stockQty !== null : undefined,
    capitalExposureRatio,
  })

  // --- Capital-aware ranking ---
  const capital = assessCapitalRequirement({
    capitalRequirementMinor: profitability ? profitability.cashRequiredPerUnit.minor : null,
    contributionMinor: profitability ? profitability.contribution.minor : null,
    availableOperatingCapitalMinor: settings.availableOperatingCapitalMinor,
    cashBufferMinor: settings.cashBufferMinor,
  })

  // --- Opportunity (the real, existing 19-component engine) ---
  const opportunitySignals: ScoringSignals = {
    sellingPrice: profitability ? money(priceMinor ?? 0, currency as never) : money(0, currency as never),
    supplierCost: money(supplierOfferFacts?.unitCostMinor ?? 0, currency as never),
    landedCost: money((supplierOfferFacts?.unitCostMinor ?? 0) + (supplierOfferFacts?.shippingCostMinor ?? 0), currency as never),
    contributionMarginPct: profitability?.contributionMarginPct ?? null,
    deliveryDaysMax: supplierOfferFacts?.leadTimeDays ?? undefined,
    shippingCostShare: priceMinor && supplierOfferFacts && priceMinor > 0 ? supplierOfferFacts.shippingCostMinor / priceMinor : undefined,
    ipRisk: readiness.compliance?.ip.level,
    supplierReliability: supplierScoreResult?.total,
    sources: { contributionMarginPct: 'derived' as never },
  }
  const opportunity = scoreOpportunity(opportunitySignals, { exceptional: 90, strong: 80, test: settings.minOpportunityScore, watch: Math.max(0, settings.minOpportunityScore - 10) })

  // --- Pricing ---
  const pricing =
    supplierOfferFacts && profitability
      ? recommendPricing(
          {
            productCost: money(supplierOfferFacts.unitCostMinor, currency as never),
            supplierShipping: money(supplierOfferFacts.shippingCostMinor, currency as never),
            fulfilment: buildChannelProfiles({ category: product.category, sellingPrice: money(priceMinor ?? supplierOfferFacts.unitCostMinor * 3, currency as never) }).find((p) => p.channel === 'shopify')?.fulfilment,
            channelFeePct: buildChannelProfiles({ category: product.category, sellingPrice: money(priceMinor ?? supplierOfferFacts.unitCostMinor * 3, currency as never) }).find((p) => p.channel === 'shopify')?.channelFeePct,
            paymentFeePct: buildChannelProfiles({ category: product.category, sellingPrice: money(priceMinor ?? supplierOfferFacts.unitCostMinor * 3, currency as never) }).find((p) => p.channel === 'shopify')?.paymentFeePct,
            vatRatePct: 0,
          },
          currency as never,
          supplierOfferFacts.unitCostMinor,
          settings.minNetMarginPct,
          settings.targetNetMarginPct,
        )
      : { minimumViablePriceMinor: null, minimumViableUnreachable: true, recommendedPriceMinor: null, recommendedUnreachable: true, currency: currency as never, basis: 'Supplier cost is not on file, so no price can be recommended.' }

  // --- Recommendation ---
  const { recommendation, reason: recommendationReason } = recommendProduct({
    profitabilityGatePasses,
    profitabilityFailureReason,
    supplierAssigned: supplierId !== null,
    worstComplianceVerdict: complianceVerdict,
    qualityScore: quality.total,
    minQualityScore: settings.minQualityScore,
    riskScore: risk.total,
    maxRiskScore: settings.maxRiskScore,
    capitalStatus: capital.status,
    capitalEfficiencyScore: capital.capitalEfficiencyScore,
    opportunityScore: opportunity.total,
    minOpportunityScore: settings.minOpportunityScore,
    strongOpportunityScore: Math.max(settings.minOpportunityScore + 10, 80),
  })

  const ENGINE_VERSION = 'product-intelligence@1'
  const computedAt = new Date().toISOString()
  const service = createServiceSupabase()

  const { data: healthRow, error: healthError } = await service
    .from('product_health')
    .insert({ org_id: orgId, product_id: productId, score: quality.total, band: quality.band, components: quality.components as never, weights_version: quality.weightsVersion, computed_at: computedAt })
    .select('id')
    .single()
  if (healthError || !healthRow) throw new Error(`Could not persist quality score: ${healthError?.message}`)

  const { data: scoreRow, error: scoreError } = await service
    .from('product_scores')
    .insert({ org_id: orgId, product_id: productId, total_score: opportunity.total, band: opportunity.band, components: opportunity.components as never, weights_version: opportunity.weightsVersion, rationale: opportunity.reasons.join(' ') || null, scored_at: computedAt })
    .select('id')
    .single()
  if (scoreError || !scoreRow) throw new Error(`Could not persist opportunity score: ${scoreError?.message}`)

  const { data: riskRow, error: riskError } = await service
    .from('product_risk_scores')
    .insert({ org_id: orgId, product_id: productId, score: risk.total, band: risk.band, components: risk.components as never, weights_version: risk.weightsVersion, computed_at: computedAt })
    .select('id')
    .single()
  if (riskError || !riskRow) throw new Error(`Could not persist risk score: ${riskError?.message}`)

  await service.from('product_intelligence').upsert(
    {
      org_id: orgId,
      product_id: productId,
      quality_score_id: healthRow.id,
      opportunity_score_id: scoreRow.id,
      risk_score_id: riskRow.id,
      capital_requirement_minor: capital.capitalRequirementMinor,
      capital_efficiency_score: capital.capitalEfficiencyScore,
      capital_breakdown: capital as never,
      profitability_breakdown: (profitability?.breakdown ?? []) as never,
      recommended_price_minor: pricing.recommendedPriceMinor,
      minimum_viable_price_minor: pricing.minimumViablePriceMinor,
      currency,
      recommendation,
      recommendation_reason: recommendationReason,
      engine_version: ENGINE_VERSION,
      computed_at: computedAt,
    },
    { onConflict: 'org_id,product_id' },
  )

  await service.from('product_intelligence_history').insert({
    org_id: orgId,
    product_id: productId,
    quality_score: quality.total,
    opportunity_score: opportunity.total,
    risk_score: risk.total,
    capital_requirement_minor: capital.capitalRequirementMinor,
    capital_efficiency_score: capital.capitalEfficiencyScore,
    recommendation,
    recommendation_reason: recommendationReason,
    trigger,
    engine_version: ENGINE_VERSION,
    actor_type: actor.type,
    actor_user_id: actor.userId ?? null,
    actor_label: actor.label ?? null,
    occurred_at: computedAt,
  })

  await recordAudit({
    orgId,
    action: 'PRODUCT_SCORED',
    entityType: 'product',
    entityId: productId,
    actorType: actor.type,
    actorUserId: actor.userId,
    actorLabel: actor.label,
    newValue: { recommendation, qualityScore: quality.total, opportunityScore: opportunity.total, riskScore: risk.total, capitalRequirementMinor: capital.capitalRequirementMinor },
    reason: `${trigger}: ${recommendationReason}`,
  })

  return {
    productId,
    quality,
    risk,
    opportunity,
    capital,
    pricing,
    profitabilityBreakdown: profitability?.breakdown ?? [],
    recommendation,
    recommendationReason,
    currency,
    computedAt,
  }
}
