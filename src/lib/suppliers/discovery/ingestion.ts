import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { createServerSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { computeProductIntelligence } from '@/lib/products/intelligence/assemble'
import { captureAndValidateMedia } from '@/lib/products/media/assemble'
import { fetchAndAssessShipping } from '@/lib/suppliers/shippingQuotes'
import { establishChannelFulfilmentSupplier } from '@/lib/marketplaces/shopify/publicationService'
import { generateCleanProductName } from '@/lib/products/naming'
import { detectDuplicateCandidate, type CandidateIdentity, type DuplicateCheckResult } from './duplicateDetection'
import { validateCandidateInput, generateCandidateSku } from './validation'

/**
 * Candidate capture and import (Milestone: supplier discovery, Phase 5).
 *
 * The one orchestrator for turning a raw supplier listing into a real
 * product. Three responsibilities, kept deliberately separate:
 *
 *   1. `captureCandidate` — records a raw candidate (manual entry today;
 *      any future connector's `discoverProducts()` output would land the
 *      same way) into `product_research`, duplicate-checked but never
 *      silently rejected — a possible duplicate is flagged, not blocked.
 *   2. `importCandidate` — promotes a candidate into a real `products` row
 *      plus a real `supplier_products` offer, then hands it to Phase 4's
 *      `computeProductIntelligence` completely unchanged (no scoring,
 *      profitability, capital, or recommendation logic is duplicated
 *      here — this file supplies data, Phase 4 evaluates it). Refuses to
 *      promote a flagged duplicate unless the caller explicitly
 *      acknowledges it.
 *   3. `rejectCandidate` — a terminal, audited "no."
 *
 * Nothing here ever creates a channel listing, places a supplier order,
 * or spends money. A freshly imported product starts at lifecycle stage
 * `discovered`, exactly where a manually-added product already starts.
 */

export interface CaptureCandidateInput {
  orgId: string
  candidateTitle: string
  category: string | null
  supplierId: string | null
  supplierSku: string | null
  sourceReference: string | null
  source: string
  unitCostMinor: number | null
  shippingCostMinor: number | null
  currency: string
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
  notes: string | null
  /** Optional supplier-hosted image URL captured alongside the candidate's own facts (Milestone: product media intelligence, Phase 7) — carried through `raw_signals` and registered as `supplier_provided` media only once/if the candidate is imported into a real product. */
  imageUrl: string | null
  /** Milestone: real supplier connector (Phase 8). Additional supplier-hosted images beyond the single legacy `imageUrl` field — a real connector's product detail read (e.g. CJdropshipping) typically returns several. Merged with `imageUrl`, deduplicated, on import. */
  imageUrls: readonly string[]
  /** Milestone: real supplier connector (Phase 8). Real per-variant data from a connector's `readProductDetail`, if any — creates real `product_variants` rows on import rather than leaving every variant collapsed into one product-level offer. Empty for manual/single-variant candidates. */
  variants: readonly CandidateVariantInput[]
  /** Milestone: real supplier connector (Phase 8). Which connector this candidate came from, if any — for traceability only, never used to claim a live connection. */
  connectorKey: string | null
  connectorProductRef: string | null
  /**
   * Real physical specifications and stock captured at discovery time
   * (Milestone: CJ import data-persistence fix), when the source actually
   * reported them — `null` for a manual entry or any connector response
   * that didn't include a figure. Carried through to `products`/
   * `supplier_products` on import so `qualityScore.ts` reads real data
   * instead of a permanent gap. Never inferred from the title/description,
   * never invented.
   */
  weightGrams: number | null
  lengthMm: number | null
  widthMm: number | null
  heightMm: number | null
  stockQty: number | null
  /**
   * Milestone: product-catalogue correction (supplier URL & clean naming).
   * The supplier's own product-page URL, when the source genuinely
   * provides one — `null` when it does not (verified against CJ's real
   * API response and documentation: neither reports one). Never
   * constructed from a guessed pattern. Persisted to
   * `supplier_products.source_url` on import.
   */
  sourceUrl: string | null
  /**
   * Milestone: supplier product verification link. Whether `sourceUrl`
   * above is presented as the exact product page (`'product'` — only
   * ever from a real supplier-provided or human-pasted URL) or the
   * supplier's own official search route, pre-filled with the stored
   * reference (`'search'` — never guaranteed to be the exact product).
   * `null` only when `sourceUrl` itself is `null`.
   */
  sourceUrlType: 'product' | 'search' | null
  identifiers: readonly { idType: string; value: string }[]
  actorUserId: string
  actorLabel: string | null
}

export interface CandidateVariantInput {
  sku: string | null
  attributes: readonly { name: string; value: string }[]
  unitCostMinor: number
  imageUrls: readonly string[]
  /** Real per-variant weight in grams, when the source reported one — persisted to `product_variants.weight_grams` on import. `null` otherwise, never invented. */
  weightGrams?: number | null
}

export interface CapturedCandidate {
  id: string
  status: 'new' | 'duplicate'
  duplicateCheck: DuplicateCheckResult
}

export async function captureCandidate(input: CaptureCandidateInput): Promise<Result<CapturedCandidate, string>> {
  const validationError = validateCandidateInput(input)
  if (validationError) return err(validationError)

  const supabase = await createServerSupabase()
  const settings = await getAutomationSettingsForOrg(input.orgId)

  const { count: pendingCount } = await supabase
    .from('product_research')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', input.orgId)
    .in('status', ['new', 'duplicate'])

  if ((pendingCount ?? 0) >= settings.maxProductsPendingReview) {
    return err(
      `${pendingCount} candidates are already awaiting review, at the configured limit of ${settings.maxProductsPendingReview}. Review or reject some before capturing more — see Settings to change this limit.`,
    )
  }

  const { data: existingCandidateRows } = input.supplierId
    ? await supabase
        .from('product_research')
        .select('id, candidate_title, supplier_id, supplier_sku, source_reference')
        .eq('org_id', input.orgId)
        .eq('supplier_id', input.supplierId)
        .neq('status', 'rejected')
    : { data: [] }

  const { data: identifierRows } =
    input.identifiers.length > 0
      ? await supabase
          .from('product_identifiers')
          .select('product_id, id_type, value, products(title)')
          .eq('org_id', input.orgId)
      : { data: [] }

  const identity: CandidateIdentity = {
    supplierId: input.supplierId,
    supplierSku: input.supplierSku,
    sourceReference: input.sourceReference,
    identifiers: input.identifiers,
  }

  const duplicateCheck = detectDuplicateCandidate(
    identity,
    (existingCandidateRows ?? []).map((r) => ({
      id: r.id,
      candidateTitle: r.candidate_title,
      supplierId: r.supplier_id,
      supplierSku: r.supplier_sku,
      sourceReference: r.source_reference,
    })),
    (identifierRows ?? []).map((r) => ({
      productId: r.product_id,
      productTitle: (r.products as unknown as { title: string } | null)?.title ?? 'Unknown product',
      idType: r.id_type,
      value: r.value,
    })),
  )

  const status = duplicateCheck.isDuplicate ? 'duplicate' : 'new'

  const { data: inserted, error } = await supabase
    .from('product_research')
    .insert({
      org_id: input.orgId,
      candidate_title: input.candidateTitle,
      category: input.category,
      source: input.source as never,
      source_reference: input.sourceReference,
      supplier_id: input.supplierId,
      supplier_sku: input.supplierSku,
      estimated_unit_cost_minor: input.unitCostMinor,
      estimated_shipping_minor: input.shippingCostMinor,
      currency: input.currency,
      notes: input.notes,
      status,
      duplicate_of: duplicateCheck.matches.find((m) => m.kind !== 'product_identifier')?.existingId ?? null,
      rejected_reason: duplicateCheck.reason,
      raw_signals: {
        deliveryDaysMin: input.deliveryDaysMin,
        deliveryDaysMax: input.deliveryDaysMax,
        imageUrl: input.imageUrl,
        imageUrls: input.imageUrls,
        variants: input.variants,
        connectorKey: input.connectorKey,
        connectorProductRef: input.connectorProductRef,
        weightGrams: input.weightGrams,
        lengthMm: input.lengthMm,
        widthMm: input.widthMm,
        heightMm: input.heightMm,
        stockQty: input.stockQty,
        sourceUrl: input.sourceUrl,
        sourceUrlType: input.sourceUrlType,
      } as never,
    })
    .select('id')
    .single()

  if (error || !inserted) return err(`Could not save candidate: ${error?.message ?? 'unknown error'}`)

  await recordAudit({
    orgId: input.orgId,
    action: duplicateCheck.isDuplicate ? 'CANDIDATE_POSSIBLE_DUPLICATE' : 'CANDIDATE_CAPTURED',
    entityType: 'product_candidate',
    entityId: inserted.id,
    actorType: 'user',
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    newValue: { candidateTitle: input.candidateTitle, supplierId: input.supplierId, source: input.source },
    reason: duplicateCheck.isDuplicate ? duplicateCheck.reason : 'Candidate captured for review.',
  })

  return ok({ id: inserted.id, status, duplicateCheck })
}

interface CandidateRow {
  id: string
  org_id: string
  candidate_title: string
  category: string | null
  status: string
  product_id: string | null
  supplier_id: string | null
  supplier_sku: string | null
  estimated_unit_cost_minor: number | null
  estimated_shipping_minor: number | null
  currency: string
  notes: string | null
  rejected_reason: string | null
  raw_signals: {
    imageUrl?: string | null
    imageUrls?: readonly string[]
    variants?: readonly CandidateVariantInput[]
    connectorKey?: string | null
    connectorProductRef?: string | null
    deliveryDaysMin?: number | null
    deliveryDaysMax?: number | null
    weightGrams?: number | null
    lengthMm?: number | null
    widthMm?: number | null
    heightMm?: number | null
    stockQty?: number | null
    sourceUrl?: string | null
    sourceUrlType?: 'product' | 'search' | null
  } | null
}

export interface ImportResult {
  productId: string
  intelligenceComputed: boolean
}

export async function importCandidate(
  orgId: string,
  candidateId: string,
  actor: { userId: string; label: string | null },
  options: { acknowledgeDuplicate?: boolean } = {},
): Promise<Result<ImportResult, string>> {
  const supabase = await createServerSupabase()

  const { data: candidate } = await supabase
    .from('product_research')
    .select('id, org_id, candidate_title, category, status, product_id, supplier_id, supplier_sku, estimated_unit_cost_minor, estimated_shipping_minor, currency, notes, rejected_reason, raw_signals')
    .eq('org_id', orgId)
    .eq('id', candidateId)
    .maybeSingle<CandidateRow>()

  if (!candidate) return err('Candidate not found.')
  if (candidate.status === 'promoted' && candidate.product_id) return err('This candidate has already been imported.')
  if (candidate.status === 'rejected') return err(`This candidate was rejected: ${candidate.rejected_reason ?? 'no reason recorded'}.`)

  if (candidate.status === 'duplicate' && !options.acknowledgeDuplicate) {
    await recordAudit({
      orgId,
      action: 'CANDIDATE_IMPORT_BLOCKED',
      entityType: 'product_candidate',
      entityId: candidateId,
      actorType: 'user',
      actorUserId: actor.userId,
      actorLabel: actor.label,
      reason: candidate.rejected_reason ?? 'Flagged as a possible duplicate.',
    })
    return err(`Import blocked — possible duplicate: ${candidate.rejected_reason ?? 'a matching record already exists'}. Re-import with the duplicate acknowledged if this is genuinely a different product.`)
  }

  if (!candidate.supplier_id) return err('No supplier is assigned to this candidate — a product cannot be imported without knowing who fulfils it.')
  if (candidate.estimated_unit_cost_minor === null) return err('No supplier cost is on file for this candidate — cannot import without a real cost.')

  const sku = generateCandidateSku(candidate.id, candidate.supplier_sku)

  // Real facts captured at discovery time (Milestone: CJ import
  // data-persistence fix) — found live testing the real CJ pipeline: a
  // genuine ~1,800-character supplier description, real delivery-day
  // estimates and real per-variant weight/dimensions were being captured
  // into `product_research` (`notes`/`raw_signals`) and then silently
  // dropped on import, leaving `qualityScore.ts` unable to tell "the
  // supplier gave us nothing" from "we had this and lost it." `notes` is
  // copied verbatim — the supplier's own text, never rewritten — and
  // every dimension/weight figure is used exactly as reported, never
  // inferred from the title or averaged across variants.
  //
  // Milestone: product-catalogue correction. `title` is the one field
  // every catalogue/Product Intelligence/dashboard view already reads as
  // "the product's name" — from here on its value is Commerce OS's own
  // clean, deterministically-generated name, never the supplier's raw
  // text directly. `supplier_title` preserves that raw text, verbatim,
  // permanently on the product's own record (not only in
  // `product_research`, a staging table) so "what was the supplier
  // actually calling this" stays answerable forever. When no confident
  // clean name can be generated, `generateCleanProductName` itself
  // returns the original title unchanged — never a guess.
  const naming = generateCleanProductName({ supplierTitle: candidate.candidate_title, category: candidate.category })

  const { data: product, error: productError } = await supabase
    .from('products')
    .insert({
      org_id: orgId,
      sku,
      title: naming.name,
      supplier_title: candidate.candidate_title,
      category: candidate.category,
      stage: 'discovered',
      description: candidate.notes,
      weight_grams: candidate.raw_signals?.weightGrams ?? null,
      length_mm: candidate.raw_signals?.lengthMm ?? null,
      width_mm: candidate.raw_signals?.widthMm ?? null,
      height_mm: candidate.raw_signals?.heightMm ?? null,
    })
    .select('id')
    .single()

  if (productError || !product) return err(`Could not create product: ${productError?.message ?? 'unknown error'}`)

  const { error: offerError } = await supabase.from('supplier_products').insert({
    org_id: orgId,
    supplier_id: candidate.supplier_id,
    product_id: product.id,
    supplier_sku: candidate.supplier_sku,
    unit_cost_minor: candidate.estimated_unit_cost_minor,
    shipping_cost_minor: candidate.estimated_shipping_minor ?? 0,
    currency: candidate.currency,
    // `lead_time_days` is a single column standing in for a min/max
    // delivery-day range; every existing reader of this field
    // (`assemble.ts`, `discovery/repository.ts`) already treats it as the
    // *maximum* — the conservative, worst-case estimate — so this follows
    // that established convention rather than inventing an average.
    lead_time_days: candidate.raw_signals?.deliveryDaysMax ?? null,
    stock_qty: candidate.raw_signals?.stockQty ?? null,
    // Milestone: product-catalogue correction. The supplier's own
    // product-page URL (null when the source genuinely has none — never
    // constructed from a guessed pattern), and the connector/reference
    // that produced this offer, persisted onto the one durable record
    // that already owns `supplier_sku`, rather than staying reachable
    // only via `product_research.raw_signals`.
    source_url: candidate.raw_signals?.sourceUrl ?? null,
    source_url_type: candidate.raw_signals?.sourceUrlType ?? null,
    connector_key: candidate.raw_signals?.connectorKey ?? null,
    connector_product_ref: candidate.raw_signals?.connectorProductRef ?? null,
  })

  if (offerError) return err(`Product was created but the supplier offer could not be saved: ${offerError.message}`)

  // Establishes the real, already-known fulfilment-supplier relationship
  // on the Shopify channel — closes a genuine circular dependency found
  // live testing this exact pipeline: Product Intelligence and the
  // Shopify eligibility gate both read the fulfilment supplier only from
  // `channel_products.fulfilment_supplier_id`, which was previously only
  // ever written by `createDraft` itself, and `createDraft` refuses to
  // run until profitability (which needs this same field) passes. Never
  // invents a supplier — `candidate.supplier_id` is the one just proven
  // real by the successful insert immediately above. A failure here must
  // never undo the import, matching every other post-import step below.
  try {
    await establishChannelFulfilmentSupplier(orgId, product.id, candidate.supplier_id)
  } catch (error) {
    console.error('[supplier-discovery] establishing channel fulfilment supplier failed after import', { productId: product.id, error })
  }

  const { error: updateError } = await supabase
    .from('product_research')
    .update({ status: 'promoted', product_id: product.id })
    .eq('org_id', orgId)
    .eq('id', candidateId)

  if (updateError) return err(`Product and offer were created but the candidate record could not be updated: ${updateError.message}`)

  await recordAudit({
    orgId,
    action: 'CANDIDATE_IMPORTED',
    entityType: 'product_candidate',
    entityId: candidateId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    newValue: { productId: product.id },
    reason: 'Candidate imported as a new product.',
  })
  await recordAudit({
    orgId,
    action: 'PRODUCT_ADDED',
    entityType: 'product',
    entityId: product.id,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    // Mirrors exactly what was written to `products` above — the clean
    // name actually saved, plus the original supplier title, so the audit
    // trail itself can answer "what was the supplier calling this" and
    // "what name did Commerce OS assign" without joining back to the
    // product row at all.
    newValue: { sku, title: naming.name, supplierTitle: candidate.candidate_title, source: 'supplier_discovery_candidate' },
    reason: `Created from supplier discovery candidate ${candidateId}.`,
  })

  // Register the candidate's own image URL, if one was captured, as
  // supplier_provided media (Milestone: product media intelligence,
  // Phase 7) — captured in the very same form submission as this
  // product's title/SKU, so `capturedTogether: true` is genuine evidence,
  // not an assumption. A failure here must never undo the import.
  // Real per-variant data (Milestone: real supplier connector, Phase 8) —
  // creates real `product_variants` rows rather than leaving every
  // variant collapsed into the one product-level offer above. A failure
  // here must never undo the import, matching the media-capture and
  // intelligence-computation failure handling immediately below.
  const variantIdBySku = new Map<string, string>()
  for (const variant of candidate.raw_signals?.variants ?? []) {
    try {
      const { data: variantRow, error: variantError } = await supabase
        .from('product_variants')
        .insert({
          org_id: orgId,
          product_id: product.id,
          sku: variant.sku ?? generateCandidateSku(`${candidateId}-${variantIdBySku.size + 1}`, null),
          title: variant.attributes.map((a) => a.value).join(' / ') || 'Variant',
          options: Object.fromEntries(variant.attributes.map((a) => [a.name, a.value])) as never,
          weight_grams: variant.weightGrams ?? null,
        })
        .select('id')
        .single()
      if (variantError || !variantRow) {
        console.error('[supplier-discovery] variant creation failed after import', { productId: product.id, error: variantError })
        continue
      }
      if (variant.sku) variantIdBySku.set(variant.sku, variantRow.id)
    } catch (error) {
      console.error('[supplier-discovery] variant creation threw after import', { productId: product.id, error })
    }
  }

  // Supplier-provided media (Phase 7 pipeline) — the candidate's own
  // image(s), merged and deduplicated across the legacy singular
  // `imageUrl` field and the newer plural `imageUrls` (Phase 8), first
  // one as primary, the rest secondary; then each variant's own images,
  // linked to the real variant row created just above.
  const productImages = Array.from(new Set([candidate.raw_signals?.imageUrl, ...(candidate.raw_signals?.imageUrls ?? [])].filter((u): u is string => Boolean(u))))
  for (const [index, url] of productImages.entries()) {
    try {
      await captureAndValidateMedia({
        orgId,
        productId: product.id,
        variantId: null,
        supplierId: candidate.supplier_id,
        supplierProductId: null,
        mediaUrl: url,
        sourceUrl: null,
        sourceType: 'supplier_provided',
        discoveryMethod: candidate.raw_signals?.connectorKey ?? 'supplier_candidate_capture',
        role: index === 0 ? 'primary' : 'secondary',
        capturedTogether: true,
        conflictingSupplierSku: null,
        actorUserId: actor.userId,
        actorLabel: actor.label,
      })
    } catch (error) {
      console.error('[supplier-discovery] media capture failed after import', { productId: product.id, error })
    }
  }

  for (const variant of candidate.raw_signals?.variants ?? []) {
    const variantId = variant.sku ? variantIdBySku.get(variant.sku) ?? null : null
    for (const url of variant.imageUrls) {
      try {
        await captureAndValidateMedia({
          orgId,
          productId: product.id,
          variantId,
          supplierId: candidate.supplier_id,
          supplierProductId: null,
          mediaUrl: url,
          sourceUrl: null,
          sourceType: 'supplier_provided',
          discoveryMethod: candidate.raw_signals?.connectorKey ?? 'supplier_candidate_capture',
          role: 'variant',
          capturedTogether: true,
          conflictingSupplierSku: null,
          actorUserId: actor.userId,
          actorLabel: actor.label,
        })
      } catch (error) {
        console.error('[supplier-discovery] variant media capture failed after import', { productId: product.id, error })
      }
    }
  }

  // Real, destination-aware shipping quote (Milestone: shipping-aware
  // publication, Phase 9) — only possible for a connector-sourced
  // candidate that actually carries a connector product reference. A
  // manually-captured candidate has none, and correctly gets no
  // shipping quote: the Shopify eligibility gate will honestly read
  // that as "no shipping quote has been fetched yet" rather than a
  // silent pass. UK ('GB') is this business's primary destination
  // today — never hard-coded elsewhere, this is the one call site that
  // chooses it, so a future second destination is a one-line change
  // here, not a rewrite.
  if (candidate.raw_signals?.connectorKey && candidate.raw_signals?.connectorProductRef) {
    try {
      await fetchAndAssessShipping({
        orgId,
        supplierId: candidate.supplier_id,
        productId: product.id,
        connectorKey: candidate.raw_signals.connectorKey,
        connectorProductRef: candidate.raw_signals.connectorProductRef,
        destinationCountry: 'GB',
        actorUserId: actor.userId,
        actorLabel: actor.label,
      })
    } catch (error) {
      console.error('[supplier-discovery] shipping quote fetch failed after import', { productId: product.id, error })
    }
  }

  // Hand off to Phase 4, unchanged — this file supplies data, Phase 4 evaluates it.
  let intelligenceComputed = false
  try {
    const result = await computeProductIntelligence(orgId, product.id, 'candidate_imported', {
      type: 'user',
      userId: actor.userId,
      label: actor.label ?? undefined,
    })
    intelligenceComputed = result !== null
  } catch (error) {
    // A failed intelligence run must never undo a successful import — the
    // product and its offer are real either way; intelligence can always
    // be recalculated later from the product page.
    console.error('[supplier-discovery] intelligence computation failed after import', { productId: product.id, error })
  }

  return ok({ productId: product.id, intelligenceComputed })
}

export async function rejectCandidate(
  orgId: string,
  candidateId: string,
  reason: string,
  actor: { userId: string; label: string | null },
): Promise<Result<true, string>> {
  if (!reason.trim()) return err('A reason is required to reject a candidate.')

  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('product_research')
    .update({ status: 'rejected', rejected_reason: reason })
    .eq('org_id', orgId)
    .eq('id', candidateId)
    .neq('status', 'promoted')

  if (error) return err(`Could not reject candidate: ${error.message}`)

  await recordAudit({
    orgId,
    action: 'CANDIDATE_REJECTED',
    entityType: 'product_candidate',
    entityId: candidateId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    reason,
  })

  return ok(true)
}
