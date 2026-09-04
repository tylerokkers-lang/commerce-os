import 'server-only'

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { calculateProfitability, assessProfitabilityGate } from '@/lib/profitability'
import { buildChannelProfiles } from '@/lib/profitability/channels'
import { getChannelReadiness } from '@/lib/marketplaces/channelReadiness'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { resolveBusinessConfiguration } from '@/lib/automation/settingsTypes'
import { scoreSupplier, type SupplierSignals } from '@/lib/suppliers/scoring'
import { scoreOpportunity, type ScoringSignals } from '@/lib/products/scoring'
import { getProductById as getStorefrontProductById } from '@/lib/shopify/storefront'
import { money, type CurrencyCode } from '@/lib/core/money'
import { getSupabaseFxStore } from '@/lib/fx/fxStore'
import { deriveChannelCurrencyLandedCost } from './currency'
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
        currency: supplierOffer.currency as CurrencyCode,
        leadTimeDays: supplierOffer.lead_time_days,
        stockQty: supplierOffer.stock_qty,
        inStock: supplierOffer.in_stock,
      }
    : null

  const normalized = normalizeProduct(product, storefrontFacts, supplierOfferFacts)

  const settings = await getAutomationSettingsForOrg(orgId)

  // --- Business-settings configuration status ---
  //
  // Milestone: business-settings configuration layer. `settings` above is
  // `DEMO_AUTOMATION_SETTINGS` (real numbers, but placeholders — never a
  // business decision) whenever no `business_settings` row exists for
  // this org yet. VAT is a second, independent way this can be
  // incomplete even once a row exists: `vat_registered = true` with no
  // `vat_rate_pct` configured is a genuinely unresolved business fact
  // (the architecture has no way to guess a rate), never silently treated
  // as 0%. Both facts feed the same gate — `recommendProduct` refuses to
  // call anything a candidate on either kind of placeholder. Extracted to
  // `settingsTypes.ts`'s `resolveBusinessConfiguration` (pure, no
  // `server-only`) so this exact rule has its own direct unit tests.
  const businessConfiguration = resolveBusinessConfiguration(settings)
  const { configured: businessSettingsConfigured, effectiveVatRatePct } = businessConfiguration

  // --- Currency: convert supplier economics into the channel currency before anything downstream touches them ---
  //
  // Found live testing the real CJdropshipping pipeline: CJ quotes in
  // USD, this channel's currency defaults to GBP — every economic figure
  // below previously used the raw USD minor units as if they were
  // already GBP, a silent conflation never caught because every Money
  // value in this function carried the same (wrong) label. Reuses the
  // existing FX architecture (`lib/fx`, Milestone 9) exactly as built —
  // no new conversion mechanism, no invented rate. `deriveChannelCurrencyLandedCost`
  // (`./currency.ts`) is the pure decision; only the actual rate lookup
  // happens here.
  const channelCurrency = currency as CurrencyCode
  const latestFxRate =
    supplierOfferFacts && supplierOfferFacts.currency !== channelCurrency
      ? await getSupabaseFxStore().getLatestRate(orgId, supplierOfferFacts.currency, channelCurrency)
      : null
  const landedCost = supplierOfferFacts
    ? deriveChannelCurrencyLandedCost(supplierOfferFacts, channelCurrency, latestFxRate, 'productEvaluation', new Date())
    : null

  // --- Compliance (reused wholesale from the already-built channel readiness assembler) ---
  const readiness = await getChannelReadiness(orgId, productId, 'shopify', product.stage, product.decision)
  const complianceVerdict: ComplianceRiskInput | null = readiness.compliance?.verdict ?? null

  // --- Shopify's own fee/fulfilment profile ---
  //
  // Computed once and reused by both the pricing search below and the
  // profitability calculation further down, so the two can never drift
  // apart by reading two different snapshots. None of Shopify's own
  // channelFeePct/channelFeeFixed/paymentFeePct/paymentFeeFixed/fulfilment
  // actually depend on `sellingPrice` (see `channels.ts` — only Amazon's
  // referral-fee shortfall does), so the price passed in here is never
  // more than a required-but-inert argument for this channel.
  const shopifyProfile = buildChannelProfiles({ category: product.category, sellingPrice: money(landedCost?.unitCostMinor ?? 0, channelCurrency) }).find((p) => p.channel === 'shopify')

  // --- Shared cost assumptions (Milestone: economic-model cost completeness) ---
  //
  // Built once from the org's real, raw settings — never the "effective"
  // 0-defaulted view `businessConfiguration` also exposes — and reused
  // verbatim by both the pricing search below and the profitability
  // calculation further down, exactly the same invariant `shopifyProfile`
  // above already guarantees for channel fees: the two can never diverge
  // on what a given product actually costs to package, return, refund,
  // charge back, or bring through customs. `undefined` (not 0) is passed
  // through whenever the org hasn't configured a figure, so
  // `calculateProfitability`'s own breakdown can honestly say "not
  // configured" rather than a confirmed zero — never silently coerced
  // here.
  const sharedCostAssumptions = {
    packaging: settings.packagingCostMinor !== null ? money(settings.packagingCostMinor, channelCurrency) : undefined,
    importDutyPct: settings.importDutyPct ?? undefined,
    returnRatePct: settings.returnRatePct ?? undefined,
    returnLossPct: settings.returnLossPct ?? undefined,
    refundRatePct: settings.refundRatePct ?? undefined,
    chargebackRatePct: settings.chargebackRatePct ?? undefined,
    chargebackFeeFixed: settings.chargebackFeeMinor !== null ? money(settings.chargebackFeeMinor, channelCurrency) : undefined,
  }

  // --- Pricing (moved ahead of profitability — see below for why) ---
  //
  // Found live testing the real CJdropshipping pipeline: this used to sit
  // *after* profitability and was gated on `profitability` already being
  // non-null, even though `recommendPricing` itself needs nothing but
  // `supplierOfferFacts` and this org's configured margin targets — it
  // runs its own internal `calculateProfitability` search, it never reads
  // an outer one. That gate meant a freshly-imported product could never
  // be priced until a channel price already existed, which nothing could
  // ever set for a brand-new product — the exact circular dependency this
  // fixes. Gated on `supplierOfferFacts` alone now, matching what the
  // function genuinely requires.
  //
  // Also found live: this previously omitted `channelFeeFixed`/
  // `paymentFeeFixed` (present in the profitability call below) and ran
  // with an implicit zero advertising assumption, while profitability
  // correctly applied the org's real `advertisingAllowancePct` — so a
  // price search that reported "hits the 35% target" was then run through
  // profitability and revealed to net ~19.5%, because the two calls used
  // different costs for the same product. `recommendPricing` now takes
  // the same `advertisingAllowancePct` and recomputes ad spend fresh at
  // every candidate price it tests, so the two calculations can no longer
  // disagree about what a given price actually nets.
  const pricing =
    landedCost?.available && shopifyProfile
      ? recommendPricing(
          {
            productCost: money(landedCost.unitCostMinor!, channelCurrency),
            supplierShipping: money(landedCost.shippingCostMinor!, channelCurrency),
            fulfilment: shopifyProfile.fulfilment,
            channelFeePct: shopifyProfile.channelFeePct,
            channelFeeFixed: shopifyProfile.channelFeeFixed,
            paymentFeePct: shopifyProfile.paymentFeePct,
            paymentFeeFixed: shopifyProfile.paymentFeeFixed,
            vatRatePct: effectiveVatRatePct,
            ...sharedCostAssumptions,
          },
          channelCurrency,
          landedCost.unitCostMinor!,
          settings.minNetMarginPct,
          settings.targetNetMarginPct,
          settings.advertisingAllowancePct,
        )
      : {
          minimumViablePriceMinor: null,
          minimumViableUnreachable: true,
          recommendedPriceMinor: null,
          recommendedUnreachable: true,
          currency: channelCurrency,
          basis: !supplierOfferFacts
            ? 'Supplier cost is not on file, so no price can be recommended.'
            : (landedCost?.detail ?? 'Supplier economics could not be converted into the channel currency.'),
        }

  // --- Profitability (the real, existing engine — never re-derived) ---
  //
  // `effectivePriceMinor`: the operator's own selected channel price when
  // one is on file — always the source of truth once it exists, never
  // overridden — otherwise the pricing engine's own recommended price
  // above, itself deterministically derived from real cost/shipping and
  // this org's configured margin targets, never a guess and never
  // written back to `channel_products.price_minor` (that column stays
  // exactly what the operator actually selected, or null). This is what
  // lets profitability — and everything below that depends on it —
  // actually run for a product nobody has priced yet.
  const effectivePriceMinor = priceMinor ?? pricing.recommendedPriceMinor

  let profitability: ReturnType<typeof calculateProfitability> | null = null
  let profitabilityGatePasses = false
  let profitabilityFailureReason: string | null = !supplierOfferFacts
    ? 'Not assessed — no supplier cost is on file for this channel yet.'
    : !landedCost?.available
      ? (landedCost?.detail ?? 'Supplier economics could not be converted into the channel currency.')
      : pricing.recommendedUnreachable
        ? pricing.basis
        : 'Not assessed.'

  if (effectivePriceMinor !== null && landedCost?.available && shopifyProfile) {
    const sellingPrice = money(effectivePriceMinor, channelCurrency)
    // Same formula the pricing search above now applies at every candidate
    // price — evaluated here just once, at the actual effective price.
    const adSpendPerUnit = money(Math.round((effectivePriceMinor * settings.advertisingAllowancePct) / 100), channelCurrency)
    profitability = calculateProfitability({
      sellingPrice,
      productCost: money(landedCost.unitCostMinor!, channelCurrency),
      supplierShipping: money(landedCost.shippingCostMinor!, channelCurrency),
      fulfilment: shopifyProfile.fulfilment,
      channelFeePct: shopifyProfile.channelFeePct,
      channelFeeFixed: shopifyProfile.channelFeeFixed,
      paymentFeePct: shopifyProfile.paymentFeePct,
      paymentFeeFixed: shopifyProfile.paymentFeeFixed,
      adSpendPerUnit,
      vatRatePct: effectiveVatRatePct,
      ...sharedCostAssumptions,
    })
    const gate = assessProfitabilityGate(profitability, { minGrossMarginPct: settings.minGrossMarginPct, minNetMarginPct: settings.minNetMarginPct })
    profitabilityGatePasses = gate.passes
    profitabilityFailureReason = gate.passes ? null : gate.failures.join(' ')
  }

  // --- Supplier reliability ---
  let supplierScoreResult: ReturnType<typeof scoreSupplier> | null = null
  if (supplierRow && supplierOfferFacts) {
    const signals: SupplierSignals = {
      // Deliberately the supplier's own currency here, not the channel's:
      // this only ever compares this offer against other offers for the
      // same product (all in the same supplier currency in practice), so
      // no conversion is needed — only a correct label, never the
      // channel-currency mislabelling this file used to apply uniformly.
      unitCost: money(supplierOfferFacts.unitCostMinor, supplierOfferFacts.currency),
      shippingCost: money(supplierOfferFacts.shippingCostMinor, supplierOfferFacts.currency),
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
  //
  // `availableOperatingCapitalMinor` (Settings) is denominated in the
  // org's own channel currency — comparing it against the supplier's raw,
  // unconverted cost would repeat the exact currency conflation this
  // milestone fixes, so this uses the channel-currency landed cost.
  const capitalExposureRatio =
    settings.availableOperatingCapitalMinor && settings.availableOperatingCapitalMinor > 0 && landedCost?.available
      ? landedCost.unitCostMinor! / settings.availableOperatingCapitalMinor
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
    sellingPrice: profitability ? money(effectivePriceMinor ?? 0, channelCurrency) : money(0, channelCurrency),
    supplierCost: money(landedCost?.unitCostMinor ?? 0, channelCurrency),
    landedCost: money((landedCost?.unitCostMinor ?? 0) + (landedCost?.shippingCostMinor ?? 0), channelCurrency),
    contributionMarginPct: profitability?.contributionMarginPct ?? null,
    deliveryDaysMax: supplierOfferFacts?.leadTimeDays ?? undefined,
    shippingCostShare: effectivePriceMinor && landedCost?.available && effectivePriceMinor > 0 ? landedCost.shippingCostMinor! / effectivePriceMinor : undefined,
    ipRisk: readiness.compliance?.ip.level,
    supplierReliability: supplierScoreResult?.total,
    sources: { contributionMarginPct: 'derived' as never },
  }
  const opportunity = scoreOpportunity(opportunitySignals, { exceptional: 90, strong: 80, test: settings.minOpportunityScore, watch: Math.max(0, settings.minOpportunityScore - 10) })

  // --- Recommendation ---
  const { recommendation, reason: recommendationReason } = recommendProduct({
    businessSettingsConfigured,
    missingRequiredSettings: businessConfiguration.missingRequired,
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
    newValue: {
      recommendation,
      qualityScore: quality.total,
      opportunityScore: opportunity.total,
      riskScore: risk.total,
      capitalRequirementMinor: capital.capitalRequirementMinor,
      // Safe, non-secret provenance for whatever currency conversion was
      // (or wasn't) applied — never a raw rate-provider credential, just
      // the pair/rate/source already stored in `exchange_rates`.
      currencyConversion:
        !supplierOfferFacts || supplierOfferFacts.currency === channelCurrency
          ? null
          : landedCost?.rateUsed
            ? { pair: `${supplierOfferFacts.currency}->${channelCurrency}`, rate: landedCost.rateUsed.rate, source: landedCost.rateUsed.source, observedAt: landedCost.rateUsed.observedAt }
            : { pair: `${supplierOfferFacts.currency}->${channelCurrency}`, status: 'unavailable' },
    },
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
