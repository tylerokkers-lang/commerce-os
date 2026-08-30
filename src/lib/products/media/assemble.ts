import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { createServerSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import { fetchImageFacts } from './imageFetch'
import { assessImageQuality } from './qualityCheck'
import { assessSourceRisk } from './sourceRiskCheck'
import { assessProductMatch, type ProductMatchInput } from './productMatch'
import { detectDuplicateMedia, type ExistingMedia } from './duplicateDetection'
import { scoreMedia, type MediaProvenanceStatus } from './mediaScore'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Media capture and validation orchestrator (Milestone: product media
 * intelligence, Phase 7).
 *
 * The one place that ties the pure engines together: fetches real facts
 * about a candidate image (`imageFetch.ts`), checks it against existing
 * media on the product (`duplicateDetection.ts`), runs the three
 * independent assessments (quality, source risk, product match), scores
 * the result deterministically (`mediaScore.ts`), and persists exactly
 * one `product_media` row plus an audit entry. Mirrors the structure of
 * `suppliers/discovery/ingestion.ts` (Phase 5) and
 * `products/intelligence/assemble.ts` (Phase 4): this file supplies and
 * evaluates media; it never touches channel publication or supplier
 * ordering.
 *
 * A failed fetch does not abort the capture — it still creates a
 * `product_media` row (facts recorded as unavailable, quality
 * `not_assessed`), which `scoreMedia` will always route to
 * `review_required`. A human can always see and act on it; nothing is
 * silently dropped.
 */

type MediaSourceType = Database['public']['Enums']['media_source_type']

const PROVENANCE_BY_SOURCE_TYPE: Record<MediaSourceType, MediaProvenanceStatus> = {
  supplier_provided: 'verified_supplier',
  manufacturer_provided: 'verified_manufacturer',
  user_provided: 'user_provided_unverified_rights',
  other_unverified: 'unverified_source',
}

export interface CaptureMediaInput {
  orgId: string
  productId: string
  variantId: string | null
  supplierId: string | null
  supplierProductId: string | null
  mediaUrl: string
  sourceUrl: string | null
  sourceType: MediaSourceType
  discoveryMethod: string
  role: Database['public']['Enums']['media_role']
  /** True when captured in the same action as the product's own identifying facts (e.g. Phase 5's candidate capture form). */
  capturedTogether: boolean
  /** An explicit, independent supplier SKU claim carried by the media itself, if any — used only to detect a genuine conflict, never to establish a match. */
  conflictingSupplierSku: string | null
  actorUserId: string
  actorLabel: string | null
}

export interface CapturedMedia {
  id: string
  validationStatus: Database['public']['Enums']['media_validation_status']
  validationReason: string
  isDuplicate: boolean
  duplicateOfMediaId: string | null
}

export async function captureAndValidateMedia(input: CaptureMediaInput): Promise<Result<CapturedMedia, string>> {
  const supabase = await createServerSupabase()

  const { data: product } = await supabase
    .from('products')
    .select('id, title, sku')
    .eq('org_id', input.orgId)
    .eq('id', input.productId)
    .maybeSingle()

  if (!product) return err('Product not found.')

  const { data: existingRows } = await supabase
    .from('product_media')
    .select('id, media_url, checksum')
    .eq('org_id', input.orgId)
    .eq('product_id', input.productId)

  const existing: readonly ExistingMedia[] = (existingRows ?? []).map((r) => ({ id: r.id, mediaUrl: r.media_url, checksum: r.checksum }))
  const duplicateCheck = detectDuplicateMedia({ mediaUrl: input.mediaUrl, checksum: null }, existing)

  if (duplicateCheck.isDuplicate) {
    return ok({
      id: duplicateCheck.matchedMediaId!,
      validationStatus: 'review_required',
      validationReason: duplicateCheck.reason ?? 'Duplicate.',
      isDuplicate: true,
      duplicateOfMediaId: duplicateCheck.matchedMediaId,
    })
  }

  const settings = await getAutomationSettingsForOrg(input.orgId)
  const fetchResult = await fetchImageFacts(input.mediaUrl)

  const facts = fetchResult.ok
    ? fetchResult.value
    : { widthPx: null, heightPx: null, fileSizeBytes: null, format: null, contentType: '' }

  const quality = assessImageQuality(
    { widthPx: facts.widthPx, heightPx: facts.heightPx, fileSizeBytes: facts.fileSizeBytes, format: facts.format },
    {
      minWidthPx: settings.minImageWidthPx,
      minHeightPx: settings.minImageHeightPx,
      maxFileSizeBytes: settings.maxImageFileSizeBytes,
      allowedFormats: settings.allowedImageFormats,
    },
  )

  const sourceRisk = assessSourceRisk(input.mediaUrl, input.sourceUrl)

  const matchInput: ProductMatchInput = {
    capturedTogether: input.capturedTogether,
    productTitle: product.title,
    supplierSku: product.sku,
    mediaUrl: input.mediaUrl,
    sourceUrl: input.sourceUrl,
    conflictingSupplierSku: input.conflictingSupplierSku,
  }
  const productMatch = assessProductMatch(matchInput)

  const provenanceStatus = PROVENANCE_BY_SOURCE_TYPE[input.sourceType]
  const scoreResult = scoreMedia({ provenanceStatus, quality, sourceRisk, productMatch })

  const fetchFailureNote = fetchResult.ok ? null : ` Fetching the image failed: ${fetchResult.error}`
  const validationReason = fetchFailureNote ? `${scoreResult.reason}${fetchFailureNote}` : scoreResult.reason
  const validationStatus = fetchResult.ok ? scoreResult.status : (scoreResult.status === 'approved' ? 'review_required' : scoreResult.status)

  const { data: inserted, error: insertError } = await supabase
    .from('product_media')
    .insert({
      org_id: input.orgId,
      product_id: input.productId,
      variant_id: input.variantId,
      supplier_id: input.supplierId,
      supplier_product_id: input.supplierProductId,
      media_type: 'image',
      role: input.role,
      media_url: input.mediaUrl,
      source_url: input.sourceUrl,
      source_type: input.sourceType,
      discovery_method: input.discoveryMethod,
      width: facts.widthPx,
      height: facts.heightPx,
      file_size_bytes: facts.fileSizeBytes,
      format: facts.format,
      provenance_status: provenanceStatus,
      quality_status: quality.status,
      quality_score: quality.score,
      quality_components: quality.components as never,
      watermark_status: sourceRisk.status,
      watermark_detail: sourceRisk.detail,
      product_match_status: productMatch.status,
      product_match_detail: productMatch.detail,
      validation_status: validationStatus,
      validation_reason: validationReason,
      rejection_reason: validationStatus === 'rejected' ? validationReason : null,
      validated_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (insertError || !inserted) return err(`Could not save media: ${insertError?.message ?? 'unknown error'}`)

  await recordAudit({
    orgId: input.orgId,
    action: 'MEDIA_CAPTURED',
    entityType: 'product_media',
    entityId: inserted.id,
    actorType: 'user',
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    newValue: { productId: input.productId, mediaUrl: input.mediaUrl, sourceType: input.sourceType },
    reason: `Captured via ${input.discoveryMethod}.`,
  })
  await recordAudit({
    orgId: input.orgId,
    action: 'MEDIA_VALIDATED',
    entityType: 'product_media',
    entityId: inserted.id,
    actorType: 'user',
    actorUserId: input.actorUserId,
    actorLabel: input.actorLabel,
    newValue: { validationStatus, provenanceStatus, qualityStatus: quality.status, watermarkStatus: sourceRisk.status, productMatchStatus: productMatch.status },
    reason: validationReason,
  })

  return ok({ id: inserted.id, validationStatus, validationReason, isDuplicate: false, duplicateOfMediaId: null })
}
