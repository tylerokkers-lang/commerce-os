import 'server-only'

import { assessPublicationReadiness, type PublicationDecision } from './publicationGate'
import { assessAmazonCapability, assessEbayCapability, assessShopifyCapability, type SupplierSignals } from '@/lib/suppliers/scoring'
import { calculateProfitability, assessProfitabilityGate } from '@/lib/profitability'
import { buildChannelProfiles } from '@/lib/profitability/channels'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { createServerSupabase } from '@/lib/supabase/server'
import { money } from '@/lib/core/money'
import type { ChannelKey, ProductDecision, ProductStage } from '@/lib/core/domain'

/**
 * Live per-(product, channel) readiness — the deterministic "why" behind a
 * SELL/HOLD/REVIEW-style recommendation, assembled entirely from
 * `assessPublicationReadiness` (Milestone 4) with genuinely real inputs
 * read from Postgres. This never scores or decides anything itself — it
 * only gathers the facts the existing gate already knows how to weigh, and
 * is honest about what it could not find: a missing supplier, price, or
 * cost produces `null`/`false` inputs, which the gate already treats as a
 * failed requirement, never a fabricated pass (`assessPublicationReadiness`
 * itself: "No supplier has been assessed" / "Not assessed").
 *
 * Explicitly NOT wired this pass: live compliance assessment (needs a
 * `ComplianceContext` — brand, IP risk, regulated-category flags — this
 * repository does not yet assemble live) and eBay profitability (its real
 * UK fee schedule has not been verified against eBay's own documentation,
 * the same rigor Milestone 21's connector work applied — see
 * `profitability/channels.ts`'s `buildChannelProfiles`, which only returns
 * Shopify/Amazon UK profiles today). Both come back `null`/unsatisfied
 * here, which correctly keeps the recommendation at REVIEW rather than
 * inventing a verdict for a check that was never actually performed.
 */

async function loadSupplierCapability(
  orgId: string,
  channel: ChannelKey,
  supplierId: string,
  productId: string,
): Promise<ReturnType<typeof assessShopifyCapability> | null> {
  const supabase = await createServerSupabase()

  const { data: supplier } = await supabase
    .from('suppliers')
    .select('supports_blind_shipping, supports_custom_packaging, supports_custom_invoice, provides_tracking, handles_returns, typical_delivery_days_min, typical_delivery_days_max')
    .eq('org_id', orgId)
    .eq('id', supplierId)
    .maybeSingle()
  if (!supplier) return null

  const { data: offer } = await supabase
    .from('supplier_products')
    .select('unit_cost_minor, shipping_cost_minor, currency')
    .eq('org_id', orgId)
    .eq('supplier_id', supplierId)
    .eq('product_id', productId)
    .maybeSingle()
  if (!offer) return null

  const signals: SupplierSignals = {
    unitCost: money(offer.unit_cost_minor, offer.currency as never),
    shippingCost: money(offer.shipping_cost_minor, offer.currency as never),
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

export async function getChannelReadiness(
  orgId: string,
  productId: string,
  channel: ChannelKey,
  productStage: ProductStage,
  productDecision: ProductDecision,
): Promise<PublicationDecision> {
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

  const supplierCapability = supplierId ? await loadSupplierCapability(orgId, channel, supplierId, productId) : null

  let profitabilityGatePasses = false
  let profitabilityFailureReason: string | null = 'Not assessed — no listing price and/or no supplier cost is on file for this channel yet.'

  if (priceMinor !== null && supplierId && (channel === 'shopify' || channel === 'amazon_uk')) {
    const { data: offer } = await supabase
      .from('supplier_products')
      .select('unit_cost_minor, shipping_cost_minor')
      .eq('org_id', orgId)
      .eq('supplier_id', supplierId)
      .eq('product_id', productId)
      .maybeSingle()

    if (offer) {
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
    }
  } else if (channel === 'ebay') {
    profitabilityFailureReason = 'Not assessed — eBay\'s real UK fee schedule is not yet wired into the profitability engine (unverified against official documentation).'
  }

  const automationLevel = (await getAutomationSettingsForOrg(orgId)).automationLevel

  return assessPublicationReadiness({
    channel,
    productStage,
    productDecision,
    channelDecision: channelDecisionRow?.decision ?? null,
    supplierCapability,
    profitabilityGatePasses,
    profitabilityFailureReason,
    compliance: null,
    automationLevel,
  })
}
