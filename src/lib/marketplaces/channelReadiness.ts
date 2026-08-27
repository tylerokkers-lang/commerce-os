import 'server-only'

import { assessPublicationReadiness, type PublicationDecision } from './publicationGate'
import { assessAmazonCapability, assessEbayCapability, assessShopifyCapability, type SupplierSignals } from '@/lib/suppliers/scoring'
import { calculateProfitability, assessProfitabilityGate } from '@/lib/profitability'
import { buildChannelProfiles } from '@/lib/profitability/channels'
import { assessCompliance, type ComplianceAssessment, type ComplianceContext } from '@/lib/compliance/rules'
import type { IdentifierRecord } from '@/lib/products/identifiers'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
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

async function loadSupplier(orgId: string, supplierId: string): Promise<SupplierRow | null> {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('suppliers')
    .select('name, country, platform, supports_blind_shipping, supports_custom_packaging, supports_custom_invoice, provides_tracking, handles_returns, typical_delivery_days_min, typical_delivery_days_max')
    .eq('org_id', orgId)
    .eq('id', supplierId)
    .maybeSingle()
  return data
}

async function loadSupplierOffer(orgId: string, supplierId: string, productId: string) {
  const supabase = await createServerSupabase()
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
  orgId: string,
  productId: string,
  supplierId: string | null,
  supplier: SupplierRow | null,
  supplierCapability: ReturnType<typeof assessShopifyCapability> | null,
  offer: { unit_cost_minor: number } | null,
  priceMinor: number | null,
): Promise<ComplianceContext | null> {
  const supabase = await createServerSupabase()

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

export interface ChannelReadinessResult {
  readiness: PublicationDecision
  compliance: ComplianceAssessment | null
  /** Present only when a compliance assessment was actually computed — explains what it could not check and why. */
  complianceCaveats: readonly string[]
}

export async function getChannelReadiness(
  orgId: string,
  productId: string,
  channel: ChannelKey,
  productStage: ProductStage,
  productDecision: ProductDecision,
): Promise<ChannelReadinessResult> {
  const supabase = await createServerSupabase()

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

  const supplier = supplierId ? await loadSupplier(orgId, supplierId) : null
  const offer = supplierId ? await loadSupplierOffer(orgId, supplierId, productId) : null
  const supplierCapability = supplier ? assessSupplierCapability(channel, supplier) : null

  let profitabilityGatePasses = false
  let profitabilityFailureReason: string | null = 'Not assessed — no listing price and/or no supplier cost is on file for this channel yet.'

  if (priceMinor !== null && offer && (channel === 'shopify' || channel === 'amazon_uk')) {
    const sellingPrice = money(priceMinor, currency as never)
    const profile = buildChannelProfiles({ category: null, sellingPrice }).find((p) => p.channel === channel)
    if (profile) {
      const settings = await getAutomationSettingsForOrg(orgId)
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
        vatRatePct: 0,
      })
      const gate = assessProfitabilityGate(result, { minGrossMarginPct: 0, minNetMarginPct: settings.minNetMarginPct })
      profitabilityGatePasses = gate.passes
      profitabilityFailureReason = gate.passes ? null : gate.failures.join(' ')
    }
  } else if (channel === 'ebay') {
    profitabilityFailureReason = 'Not assessed — eBay\'s real UK fee schedule is not yet wired into the profitability engine (unverified against official documentation).'
  }

  const complianceContext = await loadComplianceContext(orgId, productId, supplierId, supplier, supplierCapability, offer, priceMinor)
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

  return { readiness, compliance, complianceCaveats: compliance ? COMPLIANCE_DATA_CAVEATS : [] }
}
