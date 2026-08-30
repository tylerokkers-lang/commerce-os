import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { createServerSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { getChannelReadiness } from '../channelReadiness'
import { getProductIntelligence } from '@/lib/products/intelligence/repository'
import { getSupplierOffersForProduct } from '@/lib/suppliers/discovery/repository'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { getMarketplaceConnector } from '../connectors/registry'
import type { CreateListingImage, CreateListingVariant, MarketplaceConnector } from '../connectors/types'
import { planListingTransition, type ListingState } from '../listingLifecycle'
import { assessShopifyEligibility, type ShopifyEligibilityResult } from './eligibility'
import { buildShopifyProductPayload } from './payloadBuilder'
import { checkPriceOverride, type PriceOverrideResult } from './priceOverride'
import type { TablesUpdate } from '@/lib/supabase/database.types'

/**
 * Looked up through the registry (typed as the shared `MarketplaceConnector`
 * interface) rather than importing `shopifyConnector` directly — the
 * concrete class's own write-method signatures are looser than the
 * interface's (an honest stub taking no arguments still satisfies the
 * interface structurally), so a direct import resolves to the narrower
 * class type and rejects the arguments every other caller of this
 * interface passes. Always registered, hence the assertion.
 */
function getShopifyConnector(): MarketplaceConnector {
  const connector = getMarketplaceConnector('shopify')
  if (!connector) throw new Error('The Shopify connector is not registered — this should never happen.')
  return connector
}

/**
 * Controlled Shopify publication (Milestone: Phase 6) — the one
 * orchestrator. Every function here loads real data, calls the reused
 * engines from Phases 3/4/5 (`getChannelReadiness`, `getProductIntelligence`,
 * `getSupplierOffersForProduct`) and the Milestone 4 listing state
 * machine (`planListingTransition`), and never recalculates anything
 * those already compute. `channel_products` (0005) is the one
 * product↔Shopify mapping table — `external_id`/`listing_url`/`status`/
 * `workflow_state`/`price_minor` are all reused as-is; nothing new was
 * added to represent "a Commerce product may have a Shopify product id."
 *
 * DRAFT FIRST, ALWAYS: `createDraft` only ever creates a Shopify DRAFT
 * (`CreateListingInput.status` is hard-typed `'draft'`, not a caller
 * choice). Going live is `publishLive`, a genuinely separate, explicitly
 * triggered action that re-checks eligibility from scratch — never a
 * side effect of draft creation.
 */

export interface ShopifyPublicationPreview {
  eligibility: ShopifyEligibilityResult
  product: { id: string; title: string; description: string | null; category: string | null; sku: string }
  pricing: {
    supplierCostMinor: number | null
    supplierShippingMinor: number | null
    selectedPriceMinor: number | null
    recommendedPriceMinor: number | null
    minimumViablePriceMinor: number | null
    currency: string
  }
  intelligence: {
    qualityScore: number
    riskScore: number
    opportunityScore: number
    recommendation: string
  } | null
  supplier: { supplierId: string; supplierName: string; unitCostMinor: number; shippingCostMinor: number } | null
  currentListing: { externalId: string | null; listingUrl: string | null; status: string; workflowState: ListingState } | null
}

async function loadChannelProductRow(orgId: string, productId: string) {
  const supabase = await createServerSupabase()
  const { data: channelRow } = await supabase.from('channels').select('id').eq('org_id', orgId).eq('key', 'shopify').maybeSingle()
  if (!channelRow) return { channelId: null, listing: null }

  const { data: listing } = await supabase
    .from('channel_products')
    .select('id, external_id, listing_url, status, workflow_state, price_minor, compare_at_minor, currency, fulfilment_supplier_id')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('channel_id', channelRow.id)
    .is('variant_id', null)
    .maybeSingle()

  return { channelId: channelRow.id, listing }
}

/**
 * Insert-or-update by explicit lookup, never `.upsert(..., { onConflict })`
 * — `channel_products`' own unique constraint
 * (`org_id, channel_id, product_id, variant_id`) includes a nullable
 * `variant_id`, and Postgres treats two NULLs as distinct for uniqueness
 * purposes by default, so an `onConflict` upsert would silently create a
 * second row instead of updating the existing product-level one every
 * time this function is called for the same product. Explicit
 * select-then-insert-or-update sidesteps that entirely.
 */
async function writeChannelProductRow(
  orgId: string,
  channelId: string,
  productId: string,
  existingId: string | null,
  fields: TablesUpdate<'channel_products'>,
): Promise<Result<{ id: string }, string>> {
  const supabase = await createServerSupabase()

  if (existingId) {
    const { data, error } = await supabase.from('channel_products').update(fields).eq('id', existingId).select('id').single()
    if (error || !data) return err(error?.message ?? 'Could not update the channel listing record.')
    return ok(data)
  }

  const { data, error } = await supabase
    .from('channel_products')
    .insert({ org_id: orgId, channel_id: channelId, product_id: productId, ...fields })
    .select('id')
    .single()
  if (error || !data) return err(error?.message ?? 'Could not create the channel listing record.')
  return ok(data)
}

export async function assembleShopifyPublicationPreview(orgId: string, productId: string): Promise<Result<ShopifyPublicationPreview, string>> {
  const supabase = await createServerSupabase()

  const { data: product } = await supabase
    .from('products')
    .select('id, title, description, category, sku, stage, decision')
    .eq('org_id', orgId)
    .eq('id', productId)
    .maybeSingle()
  if (!product) return err('Product not found.')

  const { data: candidateRow } = await supabase
    .from('product_research')
    .select('status')
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .maybeSingle()

  const { listing } = await loadChannelProductRow(orgId, productId)
  const readiness = await getChannelReadiness(orgId, productId, 'shopify', product.stage, product.decision)
  const intelligence = await getProductIntelligence(orgId, productId)
  const offers = await getSupplierOffersForProduct(orgId, productId)
  const settings = await getAutomationSettingsForOrg(orgId)

  const selectedPriceMinor = listing?.price_minor ?? intelligence?.recommendedPriceMinor ?? null
  const preferredOffer = offers[0] ?? null

  const eligibility = assessShopifyEligibility({
    corePublication: readiness.readiness,
    hasTitle: Boolean(product.title?.trim()),
    hasDescription: Boolean(product.description?.trim()),
    imageCount: 0, // Honest gap: no image source exists yet for a product never previously listed — see HANDOVER.md.
    minImageCount: settings.minProductImages,
    selectedPriceMinor,
    variantsValid: true, // A product with zero variants gets Shopify's own implicit default variant — never invalid on its own.
    variantIssue: null,
    isDuplicateCandidate: candidateRow?.status === 'duplicate',
  })

  return ok({
    eligibility,
    product: { id: product.id, title: product.title, description: product.description, category: product.category, sku: product.sku },
    pricing: {
      supplierCostMinor: preferredOffer?.unitCostMinor ?? null,
      supplierShippingMinor: preferredOffer?.shippingCostMinor ?? null,
      selectedPriceMinor,
      recommendedPriceMinor: intelligence?.recommendedPriceMinor ?? null,
      minimumViablePriceMinor: intelligence?.minimumViablePriceMinor ?? null,
      currency: listing?.currency ?? intelligence?.currency ?? preferredOffer?.currency ?? 'GBP',
    },
    intelligence: intelligence
      ? { qualityScore: intelligence.quality.total, riskScore: intelligence.risk.total, opportunityScore: intelligence.opportunity.total, recommendation: intelligence.recommendation }
      : null,
    supplier: preferredOffer ? { supplierId: preferredOffer.supplierId, supplierName: preferredOffer.supplierName, unitCostMinor: preferredOffer.unitCostMinor, shippingCostMinor: preferredOffer.shippingCostMinor } : null,
    currentListing: listing ? { externalId: listing.external_id, listingUrl: listing.listing_url, status: listing.status, workflowState: listing.workflow_state } : null,
  })
}

interface Actor {
  userId: string
  label: string | null
}

async function recordListingTransition(
  orgId: string,
  channelProductId: string,
  from: ListingState | null,
  to: ListingState,
  reason: string,
  actor: Actor,
  evidence: Record<string, unknown> = {},
) {
  const supabase = await createServerSupabase()
  await supabase.from('channel_listing_transitions').insert({
    org_id: orgId,
    channel_product_id: channelProductId,
    from_state: from,
    to_state: to,
    reason,
    actor_type: 'user',
    actor_user_id: actor.userId,
    actor_label: actor.label,
    evidence: evidence as never,
  })
}

/**
 * IDEMPOTENT: if `channel_products.external_id` is already set, this
 * returns that existing record rather than attempting a second create —
 * the brief's own "check whether the product already has a Shopify
 * publication record" requirement. A retry after a timeout or a page
 * refresh can never create a duplicate listing through this function.
 *
 * The genuine residual gap (documented, not hidden): if a create request
 * reaches Shopify's servers and succeeds, but the response is lost before
 * this function records `external_id`, a retry has no way to discover
 * the already-created product from this side alone — Shopify's
 * `productCreate` has no idempotency-key parameter. The mitigation is the
 * traceability tag every payload carries (`payloadBuilder.ts`); resolving
 * that specific edge case with a proper search-before-create check is
 * flagged as follow-up work, not built this phase.
 */
export async function createDraft(orgId: string, productId: string, selectedPriceMinor: number, actor: Actor): Promise<Result<{ externalId: string; listingUrl: string | null; alreadyExisted: boolean }, string>> {
  const supabase = await createServerSupabase()

  const { channelId, listing: existingListing } = await loadChannelProductRow(orgId, productId)
  if (!channelId) return err('Shopify channel is not set up for this organisation.')

  if (existingListing?.external_id) {
    return ok({ externalId: existingListing.external_id, listingUrl: existingListing.listing_url, alreadyExisted: true })
  }

  const previewResult = await assembleShopifyPublicationPreview(orgId, productId)
  if (!previewResult.ok) return previewResult
  const preview = previewResult.value

  if (!preview.eligibility.eligible) {
    return err(`Not eligible for Shopify publication: ${preview.eligibility.blockingReasons.join(' ')}`)
  }

  const { data: variantRows } = await supabase.from('product_variants').select('sku, options').eq('org_id', orgId).eq('product_id', productId).eq('is_active', true)
  const variants: readonly CreateListingVariant[] = (variantRows ?? []).map((v) => ({
    sku: v.sku,
    priceMinor: selectedPriceMinor, // Per-variant pricing isn't tracked on product_variants — every variant shares the product's selected price. Documented limitation, see HANDOVER.md.
    options: Object.entries((v.options as Record<string, string>) ?? {}).map(([name, value]) => ({ name, value })),
    weightGrams: null,
  }))
  const images: readonly CreateListingImage[] = [] // Honest gap: no image source exists yet — see HANDOVER.md.

  const idempotencyKey = `draft-${productId}`

  const payload = buildShopifyProductPayload({
    productId,
    idempotencyKey,
    title: preview.product.title,
    descriptionHtml: preview.product.description ?? '',
    productType: preview.product.category,
    vendor: null,
    tags: [],
    productSku: preview.product.sku,
    currency: preview.pricing.currency,
    selectedPriceMinor,
    compareAtPriceMinor: null,
    weightGrams: null,
    images,
    variants,
    seoTitle: null,
    seoDescription: null,
  })

  // The capability gate — never call a marketplace write method when its
  // capability is declared false, exactly matching every other write in
  // this codebase (see the JSDoc on MarketplaceConnector.createListing).
  if (!getShopifyConnector().descriptor.capabilities.createListings) {
    await recordAudit({
      orgId,
      action: 'CHANNEL_SYNC_FAILED',
      entityType: 'channel_product',
      entityId: productId,
      actorType: 'user',
      actorUserId: actor.userId,
      actorLabel: actor.label,
      result: 'failure',
      error: 'Shopify write access is not configured — createListings capability is false.',
      reason: 'Attempted Shopify draft creation with write access not configured.',
      metadata: { payloadVersion: 1, payload: payload as never },
    })
    return err('Shopify write access is not configured (IMPLEMENTED: yes, CONFIGURED: no, VERIFIED: no) — see Settings → Integrations for exactly what is missing.')
  }

  const result = await getShopifyConnector().createListing(payload)

  if (!result.ok) {
    await writeChannelProductRow(orgId, channelId, productId, existingListing?.id ?? null, {
      sync_error: result.error.detail,
      last_synced_at: new Date().toISOString(),
    })
    await recordAudit({
      orgId,
      action: 'CHANNEL_SYNC_FAILED',
      entityType: 'channel_product',
      entityId: productId,
      actorType: 'user',
      actorUserId: actor.userId,
      actorLabel: actor.label,
      result: 'failure',
      error: result.error.detail,
      reason: `Shopify draft creation failed: ${result.error.reason}.`,
    })
    return err(`Shopify draft creation failed: ${result.error.detail}`)
  }

  const writeResult = await writeChannelProductRow(orgId, channelId, productId, existingListing?.id ?? null, {
    external_id: result.value.externalId,
    external_sku: preview.product.sku,
    listing_url: result.value.adminUrl,
    status: 'draft',
    workflow_state: 'pending_approval',
    price_minor: selectedPriceMinor,
    currency: preview.pricing.currency,
    fulfilment_supplier_id: preview.supplier?.supplierId ?? null,
    last_synced_at: new Date().toISOString(),
    sync_error: null,
  })

  if (writeResult.ok) {
    await recordListingTransition(orgId, writeResult.value.id, preview.currentListing?.workflowState ?? null, 'pending_approval', 'Shopify draft created.', actor, { payload: payload as never })
  }

  await recordAudit({
    orgId,
    action: 'LISTING_CREATED',
    entityType: 'channel_product',
    entityId: productId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    newValue: { externalId: result.value.externalId, selectedPriceMinor, selectedSupplierId: preview.supplier?.supplierId ?? null },
    reason: 'Shopify draft created from the controlled publication workflow.',
  })

  return ok({ externalId: result.value.externalId!, listingUrl: result.value.adminUrl, alreadyExisted: false })
}

/**
 * Live publication — genuinely separate from `createDraft`, explicitly
 * triggered, and re-checks eligibility completely fresh (not from a
 * cached preview) before ever calling the marketplace. Requires a draft
 * to already exist (`workflow_state === 'pending_approval'`).
 */
export async function publishLive(orgId: string, productId: string, actor: Actor): Promise<Result<true, string>> {
  const supabase = await createServerSupabase()
  const { listing } = await loadChannelProductRow(orgId, productId)

  if (!listing || !listing.external_id) return err('No Shopify draft exists for this product yet — create one first.')
  if (listing.workflow_state !== 'pending_approval') {
    return err(`Cannot publish from state "${listing.workflow_state}" — a draft must be pending approval first.`)
  }

  const freshPreview = await assembleShopifyPublicationPreview(orgId, productId)
  if (!freshPreview.ok) return freshPreview
  if (!freshPreview.value.eligibility.eligible) {
    return err(`Eligibility no longer passes — publication blocked: ${freshPreview.value.eligibility.blockingReasons.join(' ')}`)
  }

  const transitionPlan = planListingTransition({ from: listing.workflow_state, to: 'published', reason: 'Owner explicitly triggered live publication.' })
  if (!transitionPlan.ok) return err(transitionPlan.error)

  if (!getShopifyConnector().descriptor.capabilities.writeListings) {
    await recordAudit({
      orgId, action: 'CHANNEL_SYNC_FAILED', entityType: 'channel_product', entityId: productId,
      actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label,
      result: 'failure', error: 'Shopify write access is not configured — writeListings capability is false.',
      reason: 'Attempted live publication with write access not configured.',
    })
    return err('Shopify write access is not configured (IMPLEMENTED: yes, CONFIGURED: no, VERIFIED: no) — publication was not attempted against Shopify.')
  }

  const idempotencyKey = `publish-${productId}`
  const result = await getShopifyConnector().setListingStatus({ externalId: listing.external_id, idempotencyKey, status: 'active' })

  if (!result.ok) {
    await recordAudit({
      orgId, action: 'CHANNEL_SYNC_FAILED', entityType: 'channel_product', entityId: productId,
      actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label,
      result: 'failure', error: result.error.detail, reason: `Live publication failed: ${result.error.reason}.`,
    })
    return err(`Live publication failed: ${result.error.detail}`)
  }

  await supabase.from('channel_products').update({ status: 'live', workflow_state: 'published', last_synced_at: new Date().toISOString(), sync_error: null }).eq('id', listing.id)
  await recordListingTransition(orgId, listing.id, listing.workflow_state, 'published', 'Owner explicitly triggered live publication.', actor)
  await recordAudit({
    orgId, action: 'LISTING_PUBLISHED', entityType: 'channel_product', entityId: productId,
    actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label,
    reason: 'Product published live on Shopify by explicit owner action.',
  })

  return ok(true)
}

export async function pauseListing(orgId: string, productId: string, reason: string, actor: Actor): Promise<Result<true, string>> {
  const supabase = await createServerSupabase()
  const { listing } = await loadChannelProductRow(orgId, productId)
  if (!listing || !listing.external_id) return err('No Shopify listing exists for this product.')

  const transitionPlan = planListingTransition({ from: listing.workflow_state, to: 'paused', reason })
  if (!transitionPlan.ok) return err(transitionPlan.error)

  if (!getShopifyConnector().descriptor.capabilities.writeListings) {
    return err('Shopify write access is not configured (IMPLEMENTED: yes, CONFIGURED: no, VERIFIED: no) — pause was not attempted against Shopify.')
  }

  const result = await getShopifyConnector().setListingStatus({ externalId: listing.external_id, idempotencyKey: `pause-${productId}-${Date.now()}`, status: 'paused' })
  if (!result.ok) return err(`Pause failed: ${result.error.detail}`)

  await supabase.from('channel_products').update({ status: 'paused', workflow_state: 'paused', last_synced_at: new Date().toISOString() }).eq('id', listing.id)
  await recordListingTransition(orgId, listing.id, listing.workflow_state, 'paused', reason, actor)
  await recordAudit({ orgId, action: 'LISTING_PAUSED', entityType: 'channel_product', entityId: productId, actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label, reason })

  return ok(true)
}

export async function overrideSellingPrice(
  orgId: string,
  productId: string,
  newPriceMinor: number,
  reason: string,
  actor: Actor,
): Promise<Result<PriceOverrideResult, string>> {
  if (!reason.trim()) return err('A reason is required to override the selected price.')

  const { channelId, listing } = await loadChannelProductRow(orgId, productId)
  if (!channelId) return err('Shopify channel is not set up for this organisation.')
  const intelligence = await getProductIntelligence(orgId, productId)
  const offers = await getSupplierOffersForProduct(orgId, productId)
  const settings = await getAutomationSettingsForOrg(orgId)
  const offer = offers[0]

  if (!intelligence || !offer) return err('Cannot check this price without real cost and profitability data on file.')

  const overrideCheck = checkPriceOverride({
    costs: { productCost: { minor: offer.unitCostMinor, currency: offer.currency as never }, supplierShipping: { minor: offer.shippingCostMinor, currency: offer.currency as never }, vatRatePct: 0 },
    currency: offer.currency as never,
    recommendedPriceMinor: intelligence.recommendedPriceMinor ?? offer.unitCostMinor,
    selectedPriceMinor: newPriceMinor,
    minNetMarginPct: settings.minNetMarginPct,
  })

  const previousPriceMinor = listing?.price_minor ?? null

  await writeChannelProductRow(orgId, channelId, productId, listing?.id ?? null, {
    price_minor: newPriceMinor,
    currency: offer.currency,
  })

  await recordAudit({
    orgId,
    action: 'PRICE_CHANGED',
    entityType: 'channel_product',
    entityId: productId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    previousValue: { priceMinor: previousPriceMinor },
    newValue: { priceMinor: newPriceMinor },
    reason: `Manual price override: ${reason}`,
  })

  return ok(overrideCheck)
}
