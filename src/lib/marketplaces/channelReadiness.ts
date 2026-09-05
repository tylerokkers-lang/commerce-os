import 'server-only'

import { assessPublicationReadiness, type PublicationDecision } from './publicationGate'
import { assessAmazonCapability, assessEbayCapability, assessShopifyCapability, type SupplierSignals } from '@/lib/suppliers/scoring'
import { calculateProfitability, assessProfitabilityGate } from '@/lib/profitability'
import { buildChannelProfiles } from '@/lib/profitability/channels'
import { assessCompliance, type ComplianceAssessment, type ComplianceContext } from '@/lib/compliance/rules'
import type { IdentifierRecord } from '@/lib/products/identifiers'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { resolveBusinessConfiguration } from '@/lib/automation/settingsTypes'
import { createServerSupabase } from '@/lib/supabase/server'
import { money } from '@/lib/core/money'
import type { ChannelKey, ProductDecision, ProductStage } from '@/lib/core/domain'

/**
 * Live per-(product, channel) readiness — the deterministic "why" behind a
 * SELL/HOLD/REVIEW-style recommendation, assembled entirely from
 * `assessPublicationReadiness` (Milestone 4) and `assessCompliance`
 * (Milestone: compliance §14) with genuinely real inputs read from
 * Postgres. This never scores or decides anything itself, and never
 * duplicates either engine — it only gathers the facts they already know
 * how to weigh. A missing supplier, price, cost, or compliance fact
 * produces `null`/`false`/empty inputs, which both engines already treat
 * as a failed or `not_assessed` requirement, never a fabricated pass.
 *
 * Compliance data completeness, honestly, as of this milestone: `products`
 * genuinely has `title`/`description`/`category`/`brand`,
 * `product_identifiers` genuinely holds real GTIN/UPC/EAN records, and
 * `compliance_documents` genuinely holds real per-product document rows
 * (`doc_type`/`expires_on`) — all three assembled live below. One thing is
 * NOT tracked anywhere in this schema yet, so it is always passed as
 * absent rather than guessed: the regulated-category flags (`hasBattery`/
 * `isElectrical`/`isChildrensProduct`/`isFoodContact`/`isCosmetic`) —
 * `getChannelReadiness`'s `complianceCaveats` says so explicitly, so the
 * absence of a battery/electrical finding is never mistaken for "checked,
 * found fine." eBay profitability is likewise not wired: `buildChannelProfiles`
 * only models Shopify/Amazon UK's real fee schedules — eBay's has not been
 * verified against official documentation, the same rigor Milestone 21's
 * connector work applied.
 */

/**
 * Milestone: continuous candidate lifecycle. Every query in this module
 * already filters `org_id` explicitly (never relying on RLS alone for its
 * scoping), so the same code is safe to run either as the signed-in user
 * (`createServerSupabase`, the original and still-default behaviour for
 * every page/action caller) or as the service role from a background job
 * that has no session at all. Injecting the client is what makes the
 * compliance/profitability assembly reachable from automation without
 * duplicating a single line of it.
 */
export type ReadinessClient = Awaited<ReturnType<typeof createServerSupabase>>

interface SupplierRow {
  country: string | null
  platform: string | null
  supports_blind_shipping: boolean
  supports_custom_packaging: boolean
  supports_custom_invoice: boolean
  provides_tracking: boolean
  handles_returns: boolean
  typical_delivery_days_min: number | null
  typical_delivery_days_max: number | null
  name: string
}

async function loadSupplier(supabase: ReadinessClient, orgId: string, supplierId: string): Promise<SupplierRow | null> {
  const { data } = await supabase
    .from('suppliers')
    .select('name, country, platform, supports_blind_shipping, supports_custom_packaging, supports_custom_invoice, provides_tracking, handles_returns, typical_delivery_days_min, typical_delivery_days_max')
    .eq('org_id', orgId)
    .eq('id', supplierId)
    .maybeSingle()
  return data
}

async function loadSupplierOffer(supabase: ReadinessClient, orgId: string, supplierId: string, productId: string) {
  const { data } = await supabase
    .from('supplier_products')
    .select('unit_cost_minor, shipping_cost_minor, currency')
    .eq('org_id', orgId)
    .eq('supplier_id', supplierId)
    .eq('product_id', productId)
    .maybeSingle()
  return data
}

function assessSupplierCapability(channel: ChannelKey, supplier: SupplierRow): ReturnType<typeof assessShopifyCapability> {
  const signals: SupplierSignals = {
    unitCost: money(0), // Capability checks below never read cost — only fulfilment/returns/packaging flags.
    shippingCost: money(0),
    deliveryDaysMin: supplier.typical_delivery_days_min ?? undefined,
    deliveryDaysMax: supplier.typical_delivery_days_max ?? undefined,
    handlesReturns: supplier.handles_returns,
    providesTracking: supplier.provides_tracking,
    supportsBlindShipping: supplier.supports_blind_shipping,
    supportsCustomInvoice: supplier.supports_custom_invoice,
    supportsCustomPackaging: supplier.supports_custom_packaging,
    // Not tracked on `suppliers` yet, and not read by any of
    // assessAmazonCapability/assessShopifyCapability/assessEbayCapability
    // (confirmed by inspection) — false is the conservative default where
    // it matters, and a no-op where it doesn't.
    acceptsFaultyReturns: false,
    supportsOwnBranding: false,
  }

  if (channel === 'amazon_uk') return assessAmazonCapability(signals)
  if (channel === 'ebay') return assessEbayCapability(signals)
  return assessShopifyCapability(signals)
}

const COMPLIANCE_DATA_CAVEATS: readonly string[] = [
  'Product safety category flags (lithium battery, electrical, children\'s product, food contact, cosmetic) are not yet tracked anywhere in Commerce-OS, so category-specific documentation requirements could not be evaluated for this product — this is a genuine data gap, not a "no issues found" result.',
]

async function loadComplianceContext(
  supabase: ReadinessClient,
  orgId: string,
  productId: string,
  supplier: SupplierRow | null,
  supplierCapability: ReturnType<typeof assessShopifyCapability> | null,
  offer: { unit_cost_minor: number } | null,
  priceMinor: number | null,
): Promise<ComplianceContext | null> {
  const { data: product } = await supabase
    .from('products')
    .select('title, description, category, brand')
    .eq('org_id', orgId)
    .eq('id', productId)
    .maybeSingle()
  if (!product) return null

  const { data: identifierRows } = await supabase
    .from('product_identifiers')
    .select('id_type, value, source, validation')
    .eq('org_id', orgId)
    .eq('product_id', productId)

  const identifiers: readonly IdentifierRecord[] = (identifierRows ?? []).map((row) => ({
    idType: row.id_type,
    value: row.value,
    source: row.source,
    validation: row.validation,
  }))

  const { data: settings } = await supabase.from('business_settings').select('blocked_categories').eq('org_id', orgId).maybeSingle()

  const { data: documentRows } = await supabase
    .from('compliance_documents')
    .select('doc_type, expires_on')
    .eq('org_id', orgId)
    .eq('product_id', productId)
  const documents = (documentRows ?? []).map((d) => ({ docType: d.doc_type, expiresOn: d.expires_on }))

  return {
    title: product.title,
    description: product.description,
    category: product.category,
    brand: product.brand,
    // Not tracked anywhere in this schema yet — see COMPLIANCE_DATA_CAVEATS.
    hasBattery: undefined,
    isChildrensProduct: undefined,
    isFoodContact: undefined,
    isCosmetic: undefined,
    isElectrical: undefined,
    identifiers,
    supplierCapability: supplierCapability?.status ?? null,
    supplierCapabilityReasons: supplierCapability?.reasons ?? [],
    supplierName: supplier?.name ?? null,
    documents,
    blockedCategories: settings?.blocked_categories ?? [],
    ipInput: {
      title: product.title,
      description: product.description,
      brand: product.brand,
      category: product.category,
      supplierCountry: supplier?.country ?? null,
      supplierPlatform: supplier?.platform ?? null,
      unitCostMinor: offer?.unit_cost_minor,
      typicalRetailMinor: priceMinor ?? undefined,
    },
  }
}

/**
 * The profitability verdict as a real three-state fact (Milestone:
 * continuous candidate lifecycle). `ProfitabilityGate` itself is a boolean
 * — correct for its own purpose, but structurally unable to distinguish
 * "calculated, and it failed" from "could not be calculated at all" (no
 * price on file, no supplier cost, eBay's fee schedule unwired). The
 * lifecycle gate must never read the second as the first, so this carries
 * both the verdict and the inputs it was computed from.
 */
export interface ChannelProfitabilityVerdict {
  verdict: 'pass' | 'fail' | 'not_assessed'
  grossMarginPct: number | null
  netMarginPct: number | null
  failureReasons: readonly string[]
  minGrossMarginPct: number | null
  minNetMarginPct: number | null
  sellingPriceMinor: number | null
  unitCostMinor: number | null
  shippingCostMinor: number | null
  currency: string | null
}

export interface ChannelReadinessResult {
  readiness: PublicationDecision
  compliance: ComplianceAssessment | null
  /** Present only when a compliance assessment was actually computed — explains what it could not check and why. */
  complianceCaveats: readonly string[]
  /** Milestone: continuous candidate lifecycle — the same profitability result the gate above consumed, kept in full so it can be persisted as a current fact rather than recomputed. */
  profitability: ChannelProfitabilityVerdict
  /** The supplier whose economics `profitability` describes; `null` when no fulfilment supplier is on file for this channel. */
  supplierId: string | null
}

export async function getChannelReadiness(
  orgId: string,
  productId: string,
  channel: ChannelKey,
  productStage: ProductStage,
  productDecision: ProductDecision,
  client?: ReadinessClient,
): Promise<ChannelReadinessResult> {
  const supabase = client ?? (await createServerSupabase())

  const { data: channelDecisionRow } = await supabase
    .from('channel_product_decisions')
    .select('decision')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('channel', channel)
    .maybeSingle()

  const { data: channelRow } = await supabase.from('channels').select('id').eq('org_id', orgId).eq('key', channel).maybeSingle()

  let priceMinor: number | null = null
  let currency = 'GBP'
  let supplierId: string | null = null

  if (channelRow) {
    const { data: listing } = await supabase
      .from('channel_products')
      .select('price_minor, currency, fulfilment_supplier_id')
      .eq('org_id', orgId)
      .eq('product_id', productId)
      .eq('channel_id', channelRow.id)
      .maybeSingle()
    if (listing) {
      priceMinor = listing.price_minor
      currency = listing.currency
      supplierId = listing.fulfilment_supplier_id
    }
  }

  const supplier = supplierId ? await loadSupplier(supabase, orgId, supplierId) : null
  const offer = supplierId ? await loadSupplierOffer(supabase, orgId, supplierId, productId) : null
  const supplierCapability = supplier ? assessSupplierCapability(channel, supplier) : null

  const profitability: ChannelProfitabilityVerdict = {
    verdict: 'not_assessed',
    grossMarginPct: null,
    netMarginPct: null,
    failureReasons: ['Not assessed — no listing price and/or no supplier cost is on file for this channel yet.'],
    minGrossMarginPct: null,
    minNetMarginPct: null,
    sellingPriceMinor: priceMinor,
    unitCostMinor: offer?.unit_cost_minor ?? null,
    shippingCostMinor: offer?.shipping_cost_minor ?? null,
    currency: offer ? currency : null,
  }

  if (priceMinor !== null && offer && (channel === 'shopify' || channel === 'amazon_uk')) {
    const sellingPrice = money(priceMinor, currency as never)
    const profile = buildChannelProfiles({ category: null, sellingPrice }).find((p) => p.channel === channel)
    if (profile) {
      const settings = await getAutomationSettingsForOrg(orgId)
      // Milestone: production autonomy proof. These economics previously
      // diverged from `products/intelligence/assemble.ts`'s, for the same
      // product, in three ways that all pointed the same direction —
      // flattering: `vatRatePct` was hardcoded `0`, `minGrossMarginPct` was
      // hardcoded `0`, and none of the configured return/refund/chargeback/
      // duty/packaging assumptions were passed at all. That mattered far
      // more after this verdict became the persisted
      // `profitability_records` row gating `compliance_review -> approved`:
      // six of the seven business settings an operator is asked to
      // configure had no effect whatsoever on the gate that authorises
      // approval, and a VAT-registered business would have had ~1/6 of a
      // VAT-inclusive price counted as margin that HMRC will take. Now
      // identical to the intelligence engine's inputs, including its
      // "unknown is not zero" discipline: an unset assumption is passed as
      // `undefined` so the breakdown reports it as not configured, never
      // as a confirmed zero.
      const businessConfiguration = resolveBusinessConfiguration(settings)
      const result = calculateProfitability({
        sellingPrice,
        productCost: money(offer.unit_cost_minor, currency as never),
        supplierShipping: money(offer.shipping_cost_minor, currency as never),
        fulfilment: profile.fulfilment,
        channelFeePct: profile.channelFeePct,
        channelFeeFixed: profile.channelFeeFixed,
        paymentFeePct: profile.paymentFeePct,
        paymentFeeFixed: profile.paymentFeeFixed,
        adSpendPerUnit: profile.adSpendPerUnit,
        vatRatePct: businessConfiguration.effectiveVatRatePct,
        packaging: settings.packagingCostMinor !== null ? money(settings.packagingCostMinor, currency as never) : undefined,
        importDutyPct: settings.importDutyPct ?? undefined,
        returnRatePct: settings.returnRatePct ?? undefined,
        returnLossPct: settings.returnLossPct ?? undefined,
        refundRatePct: settings.refundRatePct ?? undefined,
        chargebackRatePct: settings.chargebackRatePct ?? undefined,
        chargebackFeeFixed: settings.chargebackFeeMinor !== null ? money(settings.chargebackFeeMinor, currency as never) : undefined,
      })
      const thresholds = { minGrossMarginPct: settings.minGrossMarginPct, minNetMarginPct: settings.minNetMarginPct }
      const gate = assessProfitabilityGate(result, thresholds)
      profitability.verdict = gate.passes ? 'pass' : 'fail'
      profitability.grossMarginPct = result.grossMarginPct
      profitability.netMarginPct = result.netMarginPct
      profitability.failureReasons = gate.passes ? [] : gate.failures
      profitability.minGrossMarginPct = thresholds.minGrossMarginPct
      profitability.minNetMarginPct = thresholds.minNetMarginPct
      profitability.currency = currency
    }
  } else if (channel === 'ebay') {
    profitability.failureReasons = ['Not assessed — eBay\'s real UK fee schedule is not yet wired into the profitability engine (unverified against official documentation).']
  }

  // The gate's own input stays a boolean, exactly as before: `not_assessed`
  // is passed as `false` with its reason intact, which
  // `assessPublicationReadiness` already treats as an unmet requirement —
  // never as a pass. The tri-state distinction is preserved separately, in
  // `profitability`, for the lifecycle gate and for persistence.
  const profitabilityGatePasses = profitability.verdict === 'pass'
  const profitabilityFailureReason = profitability.verdict === 'pass' ? null : profitability.failureReasons.join(' ')

  const complianceContext = await loadComplianceContext(supabase, orgId, productId, supplier, supplierCapability, offer, priceMinor)
  const compliance = complianceContext ? assessCompliance(channel, complianceContext) : null

  const automationLevel = (await getAutomationSettingsForOrg(orgId)).automationLevel

  const readiness = assessPublicationReadiness({
    channel,
    productStage,
    productDecision,
    channelDecision: channelDecisionRow?.decision ?? null,
    supplierCapability,
    profitabilityGatePasses,
    profitabilityFailureReason,
    compliance,
    automationLevel,
  })

  return { readiness, compliance, complianceCaveats: compliance ? COMPLIANCE_DATA_CAVEATS : [], profitability, supplierId }
}
