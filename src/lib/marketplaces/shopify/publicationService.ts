import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { createServerSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications/create'
import { getChannelReadiness } from '../channelReadiness'
import { getProductIntelligence } from '@/lib/products/intelligence/repository'
import { getSupplierOffersForProduct } from '@/lib/suppliers/discovery/repository'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { getProductMedia, getApprovedMediaForPublication } from '@/lib/products/media/repository'
import { getShippingSuitability } from '@/lib/suppliers/shippingQuotes'
import type { ShippingSuitabilityStatus } from '@/lib/suppliers/shippingPolicy'
import { getMarketplaceConnector } from '../connectors/registry'
import type { CreateListingImage, CreateListingInput, CreateListingVariant, MarketplaceConnector } from '../connectors/types'
import { planListingTransition, type ListingState } from '../listingLifecycle'
import { decideChannelFulfilmentAction } from '../publicationGate'
import { assessShopifyEligibility, type ShopifyEligibilityResult } from './eligibility'
import { buildShopifyProductPayload } from './payloadBuilder'
import { checkPriceOverride, type PriceOverrideResult } from './priceOverride'
import type { TablesUpdate } from '@/lib/supabase/database.types'
import { classifyActionRisk } from '@/lib/automation/riskClassification'
import { buildDryRunResult, type DryRunResult } from '@/lib/automation/dryRun'
import { evaluateAutomationPolicy } from '@/lib/automation/policyEngine'
import { createAutomationAction, completeAutomationAction } from '@/lib/automation/actions'
import { withMarketplaceConnectorGate } from '../connectors/executionGate'
import type { PolicyRequirement, PolicyResult } from '@/lib/automation/types'
import type { AutomationRiskLevel } from '@/lib/automation/types'

/** This business's primary sales destination today — Shopify UK-first, per Phase 8/9's own design. Never hard-coded anywhere else; every other call site reads it from here. */
const PRIMARY_DESTINATION_COUNTRY = 'GB'

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
  /** Milestone: shipping-aware publication (Phase 9) — the same result `eligibility`'s "shipping" requirement is built from, exposed directly so the UI never has to re-derive it. */
  shipping: {
    status: ShippingSuitabilityStatus
    reason: string
    destinationCountry: string
    method: string | null
    shippingCostMinor: number | null
    currency: string | null
    totalDeliveryDaysMin: number | null
    totalDeliveryDaysMax: number | null
    providesTracking: boolean | 'unknown' | null
  }
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

/**
 * Records the real, already-known fulfilment supplier for a product on
 * the Shopify channel — the fix for a genuine circular dependency found
 * live testing the CJdropshipping pipeline: `getChannelReadiness` and
 * `computeProductIntelligence` (`products/intelligence/assemble.ts`) both
 * read a product's fulfilment supplier *only* from
 * `channel_products.fulfilment_supplier_id` — but the only place that
 * field was ever written was `createDraft`, below, which itself refuses
 * to run unless the profitability gate already passes, which itself
 * requires that same field. A freshly-imported product could therefore
 * never be assessed, and could never reach a state where `createDraft`
 * would succeed, regardless of Shopify write access.
 *
 * The correct fix is not to weaken the gate or to have intelligence
 * assume a supplier — it is to establish the channel/fulfilment-supplier
 * relationship at the one point it is genuinely, unambiguously already
 * known: right after a supplier-sourced candidate is imported
 * (`suppliers/discovery/ingestion.ts`'s `importCandidate`, the caller),
 * when exactly one real `supplier_products` offer has just been created
 * for it. This never invents a supplier: it only ever records the
 * `supplierId` its caller already knows to be real, using the exact same
 * insert-or-update path (`loadChannelProductRow`/`writeChannelProductRow`)
 * every other `channel_products` write in this file already uses — no
 * second implementation of that logic.
 *
 * Deliberately conservative in two ways: a no-op, never an error, when
 * no Shopify channel is configured for the org yet (nothing to
 * establish); and never overwrites a channel listing that already
 * records a fulfilment supplier (an operator's own prior choice, e.g.
 * from switching suppliers, is never silently replaced).
 */
export async function establishChannelFulfilmentSupplier(orgId: string, productId: string, supplierId: string): Promise<Result<{ recorded: boolean }, string>> {
  const { channelId, listing } = await loadChannelProductRow(orgId, productId)
  const action = decideChannelFulfilmentAction({ channelId, existingFulfilmentSupplierId: listing?.fulfilment_supplier_id ?? null })
  if (action !== 'write') return ok({ recorded: false })

  // `action === 'write'` only when decideChannelFulfilmentAction has already confirmed channelId is non-null.
  const result = await writeChannelProductRow(orgId, channelId as string, productId, listing?.id ?? null, { fulfilment_supplier_id: supplierId })
  if (!result.ok) return result
  return ok({ recorded: true })
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
  const mediaState = await getProductMedia(orgId, productId)
  const shipping = await getShippingSuitability(orgId, productId, PRIMARY_DESTINATION_COUNTRY)

  const selectedPriceMinor = listing?.price_minor ?? intelligence?.recommendedPriceMinor ?? null
  const preferredOffer = offers[0] ?? null

  const eligibility = assessShopifyEligibility({
    corePublication: readiness.readiness,
    hasTitle: Boolean(product.title?.trim()),
    hasDescription: Boolean(product.description?.trim()),
    mediaReadiness: mediaState.readiness.status,
    mediaReadinessReason: mediaState.readiness.reason,
    shippingStatus: shipping.status,
    shippingReason: shipping.reason,
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
    shipping: {
      status: shipping.status,
      reason: shipping.reason,
      destinationCountry: PRIMARY_DESTINATION_COUNTRY,
      method: shipping.bestQuote?.method ?? null,
      shippingCostMinor: shipping.bestQuote?.shippingCost.minor ?? null,
      currency: shipping.bestQuote?.shippingCost.currency ?? null,
      totalDeliveryDaysMin: shipping.bestQuote?.totalDeliveryDaysMin ?? null,
      totalDeliveryDaysMax: shipping.bestQuote?.totalDeliveryDaysMax ?? null,
      providesTracking: shipping.bestQuote?.providesTracking ?? null,
    },
  })
}

/**
 * Milestone: automation control plane. The eligibility-check-and-payload-
 * build half of `createDraft`, extracted unchanged so `dryRunCreateShopifyDraft`
 * below can produce the exact same payload a real `createDraft` call would
 * send — without this becoming two independently-maintained copies of the
 * same variant/media/payload assembly. Behaviourally identical to what
 * `createDraft` always did inline; this is a pure relocation; the eligibility
 * gate itself still lives in each caller (`createDraft` errors on
 * ineligibility, the dry run instead reports it as a blocking reason).
 */
async function prepareShopifyDraftPayload(orgId: string, productId: string, selectedPriceMinor: number): Promise<Result<{ preview: ShopifyPublicationPreview; payload: CreateListingInput }, string>> {
  const previewResult = await assembleShopifyPublicationPreview(orgId, productId)
  if (!previewResult.ok) return previewResult
  const preview = previewResult.value

  const supabase = await createServerSupabase()
  const { data: variantRows } = await supabase.from('product_variants').select('sku, options').eq('org_id', orgId).eq('product_id', productId).eq('is_active', true)
  const variants: readonly CreateListingVariant[] = (variantRows ?? []).map((v) => ({
    sku: v.sku,
    priceMinor: selectedPriceMinor, // Per-variant pricing isn't tracked on product_variants — every variant shares the product's selected price. Documented limitation, see HANDOVER.md.
    options: Object.entries((v.options as Record<string, string>) ?? {}).map(([name, value]) => ({ name, value })),
    weightGrams: null,
  }))
  const approvedMedia = await getApprovedMediaForPublication(orgId, productId)
  const images: readonly CreateListingImage[] = approvedMedia.map((m) => ({ url: m.media_url, altText: preview.product.title }))

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

  return ok({ preview, payload })
}

/**
 * Milestone: automation control plane. Dry-run capability (design
 * requirement §4): reports exactly what `createDraft` would do — eligible or
 * not, the precise payload that would be sent, every requirement checked,
 * and why — without creating a Shopify listing, writing `channel_products`,
 * or recording an audit entry. Safe to call as often as needed (e.g. from a
 * "preview" button) with zero side effects.
 */
export async function dryRunCreateShopifyDraft(orgId: string, productId: string, selectedPriceMinor: number): Promise<Result<DryRunResult<CreateListingInput>, string>> {
  const { channelId, listing: existingListing } = await loadChannelProductRow(orgId, productId)
  if (!channelId) return err('Shopify channel is not set up for this organisation.')

  const prepared = await prepareShopifyDraftPayload(orgId, productId, selectedPriceMinor)
  if (!prepared.ok) return prepared
  const { preview, payload } = prepared.value

  const alreadyPublished = Boolean(existingListing?.external_id)
  const writeAccessConfigured = getShopifyConnector().descriptor.capabilities.createListings

  const requirements: PolicyRequirement[] = [
    ...preview.eligibility.requirements,
    {
      key: 'not_already_published',
      label: 'Not already published',
      satisfied: !alreadyPublished,
      detail: alreadyPublished ? `Already published to Shopify as ${existingListing?.external_id}.` : 'No existing Shopify listing on file for this product.',
    },
    {
      key: 'write_access_configured',
      label: 'Shopify write access configured',
      satisfied: writeAccessConfigured,
      detail: writeAccessConfigured ? 'This connector can create listings.' : 'Shopify write access is not configured — the createListings capability is false.',
    },
  ]

  const blocked = alreadyPublished || !preview.eligibility.eligible || !writeAccessConfigured
  const policy: PolicyResult = {
    outcome: blocked ? 'block' : 'allow_automatic',
    requirements,
    reason: alreadyPublished
      ? `Already published as ${existingListing?.external_id}.`
      : !preview.eligibility.eligible
        ? `Not eligible for Shopify publication: ${preview.eligibility.blockingReasons.join(' ')}`
        : !writeAccessConfigured
          ? 'Shopify write access is not configured.'
          : 'Eligible for Shopify draft creation.',
    // No percentage/amount magnitude applies to "create a listing" — honestly
    // unknown rather than assumed low, per `riskClassification.ts`.
    riskLevel: classifyActionRisk({ actionType: 'publish_product' }),
  }

  return ok(buildDryRunResult(policy, payload))
}

interface Actor {
  userId: string
  label: string | null
}

/**
 * Milestone: execution reliability & unified write path. Every operator-
 * triggered Shopify write (`createDraft`, `publishLive`, `pauseListing`)
 * now records a real `automation_actions` row and is evaluated by the same
 * `evaluateAutomationPolicy` choke point every autonomous action already
 * goes through — the kill switch, the fail-closed unknown-automation-state
 * check, and the business-settings-configured gate all apply here too, not
 * only to scheduled jobs. The operator's own explicit click is what makes
 * the domain outcome `'auto_permitted'` (the eligibility/state-machine
 * checks that already ran are the real domain decision); the policy layer
 * below can still refuse it for a reason the operator's click cannot see
 * or override — exactly the same relationship `priceExecution.ts` has
 * between a domain engine's verdict and the policy engine's own checks.
 */
async function gatePublicationAction(
  orgId: string,
  actionType: 'publish_product' | 'pause_product',
  productId: string,
  reason: string,
  riskLevel: AutomationRiskLevel,
  idempotencyKey: string,
): Promise<Result<{ actionId: string }, string>> {
  const settings = await getAutomationSettingsForOrg(orgId)
  const policy = evaluateAutomationPolicy({
    actionType,
    settings,
    domainOutcome: 'auto_permitted',
    domainReason: reason,
    domainRequirements: [],
    riskLevel,
  })

  const created = await createAutomationAction({
    orgId,
    idempotencyKey,
    actionType,
    entityType: 'channel_product',
    entityId: productId,
    reason: policy.reason,
    inputFacts: {},
    decision: {},
    policy,
    automationLevel: settings.automationLevel,
    actorType: 'user',
  })

  if (created.status !== 'executing') {
    return err(created.alreadyExisted && created.status === 'succeeded' ? 'This action has already been completed.' : `Blocked: ${policy.reason}`)
  }
  return ok({ actionId: created.id })
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
  const { channelId, listing: existingListing } = await loadChannelProductRow(orgId, productId)
  if (!channelId) return err('Shopify channel is not set up for this organisation.')

  if (existingListing?.external_id) {
    return ok({ externalId: existingListing.external_id, listingUrl: existingListing.listing_url, alreadyExisted: true })
  }

  const prepared = await prepareShopifyDraftPayload(orgId, productId, selectedPriceMinor)
  if (!prepared.ok) return prepared
  const { preview, payload } = prepared.value

  if (!preview.eligibility.eligible) {
    return err(`Not eligible for Shopify publication: ${preview.eligibility.blockingReasons.join(' ')}`)
  }

  // Milestone: execution reliability & unified write path — the policy
  // choke point (kill switch, business-settings-configured, risk), checked
  // immediately before any connector call. Draft creation is reversible
  // and never customer-visible, so its own risk is classified `'low'`
  // (never `'unknown'`, unlike `dryRunCreateShopifyDraft`'s honestly
  // uncommitted classification for a preview that hasn't decided to act).
  const gated = await gatePublicationAction(orgId, 'publish_product', productId, 'Operator requested a Shopify draft.', 'low', `draft-${productId}`)
  if (!gated.ok) return gated
  const { actionId } = gated.value

  // The capability gate — never call a marketplace write method when its
  // capability is declared false, exactly matching every other write in
  // this codebase (see the JSDoc on MarketplaceConnector.createListing).
  if (!getShopifyConnector().descriptor.capabilities.createListings) {
    await completeAutomationAction(actionId, { succeeded: false, error: 'Shopify write access is not configured — createListings capability is false.', orgId, entityType: 'channel_product', entityId: productId, verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable' })
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

  const result = await withMarketplaceConnectorGate(orgId, getShopifyConnector(), () => getShopifyConnector().createListing(payload))

  if (!result.ok) {
    const detail = typeof result.error === 'string' ? result.error : result.error.detail
    await completeAutomationAction(actionId, { succeeded: false, error: detail, orgId, entityType: 'channel_product', entityId: productId, verificationStatus: 'failed', reconciliationStatus: 'not_applicable' })
    await writeChannelProductRow(orgId, channelId, productId, existingListing?.id ?? null, {
      sync_error: detail,
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
      error: detail,
      reason: `Shopify draft creation failed.`,
    })
    return err(`Shopify draft creation failed: ${detail}`)
  }

  // VERIFY — Milestone: automation control plane. `createListing`'s own
  // "accepted" response was never proof the listing genuinely exists on
  // Shopify's side; `priceExecution.ts`'s SUBMIT->VERIFY->RECONCILE pipeline
  // already applies this discipline to price writes, and this closes the
  // matching gap for listing creation. `not_applicable` (not `'failed'`)
  // when the connector cannot read a listing back at all — an honest
  // "cannot confirm," never presented as a rejection of the write itself.
  let verificationStatus: 'verified' | 'failed' | 'uncertain' | 'not_applicable' = 'not_applicable'
  if (result.value.externalId && getShopifyConnector().descriptor.capabilities.verifyWrites) {
    const verifyResult = await withMarketplaceConnectorGate(orgId, getShopifyConnector(), () => getShopifyConnector().verifyListingState(result.value.externalId!))
    if (verifyResult.ok) {
      verificationStatus = verifyResult.value.priceMinor === selectedPriceMinor ? 'verified' : 'failed'
    } else {
      verificationStatus = 'uncertain'
    }
  }

  await completeAutomationAction(actionId, {
    succeeded: true,
    error: null,
    orgId,
    entityType: 'channel_product',
    entityId: productId,
    externalRef: result.value.externalId,
    verificationStatus,
    reconciliationStatus: verificationStatus === 'verified' ? 'matched' : verificationStatus === 'failed' ? 'discrepancy' : 'pending',
  })

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
    await recordListingTransition(orgId, writeResult.value.id, preview.currentListing?.workflowState ?? null, 'pending_approval', 'Shopify draft created.', actor, { payload: payload as never, verificationStatus })
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
    reason: `Shopify draft created from the controlled publication workflow.${verificationStatus !== 'not_applicable' ? ` Verification: ${verificationStatus}.` : ''}`,
    metadata: { verificationStatus },
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

  const idempotencyKey = `publish-${productId}`
  const gated = await gatePublicationAction(orgId, 'publish_product', productId, 'Owner explicitly triggered live publication.', 'medium', idempotencyKey)
  if (!gated.ok) return gated
  const { actionId } = gated.value

  if (!getShopifyConnector().descriptor.capabilities.writeListings) {
    await completeAutomationAction(actionId, { succeeded: false, error: 'Shopify write access is not configured — writeListings capability is false.', orgId, entityType: 'channel_product', entityId: productId, verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable' })
    await recordAudit({
      orgId, action: 'CHANNEL_SYNC_FAILED', entityType: 'channel_product', entityId: productId,
      actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label,
      result: 'failure', error: 'Shopify write access is not configured — writeListings capability is false.',
      reason: 'Attempted live publication with write access not configured.',
    })
    return err('Shopify write access is not configured (IMPLEMENTED: yes, CONFIGURED: no, VERIFIED: no) — publication was not attempted against Shopify.')
  }

  const result = await withMarketplaceConnectorGate(orgId, getShopifyConnector(), () => getShopifyConnector().setListingStatus({ externalId: listing.external_id!, idempotencyKey, status: 'active' }))

  if (!result.ok) {
    const detail = typeof result.error === 'string' ? result.error : result.error.detail
    await completeAutomationAction(actionId, { succeeded: false, error: detail, orgId, entityType: 'channel_product', entityId: productId, verificationStatus: 'failed', reconciliationStatus: 'not_applicable' })
    await recordAudit({
      orgId, action: 'CHANNEL_SYNC_FAILED', entityType: 'channel_product', entityId: productId,
      actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label,
      result: 'failure', error: detail, reason: `Live publication failed.`,
    })
    await createNotification({
      orgId, severity: 'critical', category: 'catalogue',
      title: `Publication failed for ${freshPreview.value.product.title}`,
      body: `Shopify rejected the live-publication request: ${detail}`,
      entityType: 'channel_product', entityId: productId,
      dedupeKey: `publication-failed:${orgId}:${idempotencyKey}`,
    })
    return err(`Live publication failed: ${detail}`)
  }

  // VERIFY — Milestone: execution reliability. Never assume the write
  // call's own "accepted" response is proof; read the listing back.
  let verified = false
  let verificationStatus: 'verified' | 'failed' | 'uncertain' = 'uncertain'
  if (getShopifyConnector().descriptor.capabilities.verifyWrites) {
    const verifyResult = await withMarketplaceConnectorGate(orgId, getShopifyConnector(), () => getShopifyConnector().verifyListingState(listing.external_id!))
    if (verifyResult.ok && verifyResult.value.status === 'active') {
      verified = true
      verificationStatus = 'verified'
    } else if (verifyResult.ok) {
      verificationStatus = 'failed'
    }
  }

  await completeAutomationAction(actionId, {
    succeeded: verified, error: verified ? null : 'The write was submitted, but the marketplace could not be confirmed to reflect it.',
    orgId, entityType: 'channel_product', entityId: productId,
    verificationStatus, reconciliationStatus: verified ? 'matched' : verificationStatus === 'failed' ? 'discrepancy' : 'pending',
  })

  if (!verified) {
    await recordAudit({
      orgId, action: 'CHANNEL_SYNC_FAILED', entityType: 'channel_product', entityId: productId,
      actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label,
      result: 'failure', error: 'Unverified after submission.', reason: 'Live publication submitted but could not be confirmed against Shopify — Commerce OS has NOT marked this live.',
    })
    await createNotification({
      orgId, severity: 'critical', category: 'catalogue',
      title: `Publication verification failed for ${freshPreview.value.product.title}`,
      body: 'Submitted to Shopify, but its own reported state could not be confirmed to match. Commerce OS has NOT marked this listing live.',
      entityType: 'channel_product', entityId: productId,
      dedupeKey: `publication-failed:${orgId}:${idempotencyKey}`,
    })
    return err('Publication was submitted, but the marketplace could not be confirmed to reflect it — treated as unverified, not as succeeded. Commerce OS has not marked this listing live.')
  }

  await supabase.from('channel_products').update({ status: 'live', workflow_state: 'published', last_synced_at: new Date().toISOString(), sync_error: null }).eq('id', listing.id)
  await recordListingTransition(orgId, listing.id, listing.workflow_state, 'published', 'Owner explicitly triggered live publication.', actor)
  await recordAudit({
    orgId, action: 'LISTING_PUBLISHED', entityType: 'channel_product', entityId: productId,
    actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label,
    reason: 'Product published live on Shopify by explicit owner action, verified against the marketplace.',
  })
  await createNotification({
    orgId, severity: 'success', category: 'catalogue',
    title: `${freshPreview.value.product.title} is now published`,
    body: 'Verified live on Shopify.',
    entityType: 'channel_product', entityId: productId,
    dedupeKey: `publication-published:${orgId}:${idempotencyKey}`,
  })

  return ok(true)
}

export async function pauseListing(orgId: string, productId: string, reason: string, actor: Actor): Promise<Result<true, string>> {
  const supabase = await createServerSupabase()
  const { listing } = await loadChannelProductRow(orgId, productId)
  if (!listing || !listing.external_id) return err('No Shopify listing exists for this product.')

  const transitionPlan = planListingTransition({ from: listing.workflow_state, to: 'paused', reason })
  if (!transitionPlan.ok) return err(transitionPlan.error)

  // Milestone: execution reliability. A stable idempotency key — the
  // previous `pause-${productId}-${Date.now()}` produced a fresh key on
  // every call, so a genuine retry of a failed pause could never be
  // recognised as the same action, unlike every other write in this file.
  const idempotencyKey = `pause-${productId}`
  const gated = await gatePublicationAction(orgId, 'pause_product', productId, reason, 'medium', idempotencyKey)
  if (!gated.ok) return gated
  const { actionId } = gated.value

  if (!getShopifyConnector().descriptor.capabilities.writeListings) {
    await completeAutomationAction(actionId, { succeeded: false, error: 'Shopify write access is not configured — writeListings capability is false.', orgId, entityType: 'channel_product', entityId: productId, verificationStatus: 'not_applicable', reconciliationStatus: 'not_applicable' })
    return err('Shopify write access is not configured (IMPLEMENTED: yes, CONFIGURED: no, VERIFIED: no) — pause was not attempted against Shopify.')
  }

  const result = await withMarketplaceConnectorGate(orgId, getShopifyConnector(), () => getShopifyConnector().setListingStatus({ externalId: listing.external_id!, idempotencyKey, status: 'paused' }))
  if (!result.ok) {
    const detail = typeof result.error === 'string' ? result.error : result.error.detail
    await completeAutomationAction(actionId, { succeeded: false, error: detail, orgId, entityType: 'channel_product', entityId: productId, verificationStatus: 'failed', reconciliationStatus: 'not_applicable' })
    return err(`Pause failed: ${detail}`)
  }

  // VERIFY — never assume the write call's own "accepted" response is proof.
  let verified = false
  let verificationStatus: 'verified' | 'failed' | 'uncertain' = 'uncertain'
  if (getShopifyConnector().descriptor.capabilities.verifyWrites) {
    const verifyResult = await withMarketplaceConnectorGate(orgId, getShopifyConnector(), () => getShopifyConnector().verifyListingState(listing.external_id!))
    if (verifyResult.ok && verifyResult.value.status === 'paused') {
      verified = true
      verificationStatus = 'verified'
    } else if (verifyResult.ok) {
      verificationStatus = 'failed'
    }
  }

  await completeAutomationAction(actionId, {
    succeeded: verified, error: verified ? null : 'The write was submitted, but the marketplace could not be confirmed to reflect it.',
    orgId, entityType: 'channel_product', entityId: productId,
    verificationStatus, reconciliationStatus: verified ? 'matched' : verificationStatus === 'failed' ? 'discrepancy' : 'pending',
  })

  if (!verified) {
    return err('Pause was submitted, but the marketplace could not be confirmed to reflect it — treated as unverified, not as succeeded. Commerce OS has not marked this listing paused.')
  }

  await supabase.from('channel_products').update({ status: 'paused', workflow_state: 'paused', last_synced_at: new Date().toISOString() }).eq('id', listing.id)
  await recordListingTransition(orgId, listing.id, listing.workflow_state, 'paused', reason, actor)
  await recordAudit({ orgId, action: 'LISTING_PAUSED', entityType: 'channel_product', entityId: productId, actorType: 'user', actorUserId: actor.userId, actorLabel: actor.label, reason: `${reason} (verified against the marketplace)` })

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
