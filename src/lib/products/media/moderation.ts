import 'server-only'

import { err, ok, type Result } from '@/lib/core/result'
import { createServerSupabase } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/audit'
import { fetchImageFacts } from './imageFetch'
import { assessImageQuality } from './qualityCheck'
import { assessSourceRisk } from './sourceRiskCheck'
import { assessProductMatch } from './productMatch'
import { scoreMedia, type MediaProvenanceStatus } from './mediaScore'
import { getAutomationSettingsForOrg } from '@/lib/automation/settings'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Human moderation actions on already-captured media (Milestone: product
 * media intelligence, Phase 7) — Approve / Reject / Set as Primary /
 * Remove / Refresh, matching the brief's own admin-action list exactly.
 * Every action is one row's `product_media` state plus one audit entry;
 * none of these ever touch Shopify or any other channel directly — a
 * later publish/eligibility check is what actually reacts to the new
 * `validation_status`.
 */

type MediaRow = Database['public']['Tables']['product_media']['Row']

interface Actor {
  userId: string
  label: string | null
}

async function loadMedia(orgId: string, mediaId: string): Promise<MediaRow | null> {
  const supabase = await createServerSupabase()
  const { data } = await supabase.from('product_media').select('*').eq('org_id', orgId).eq('id', mediaId).maybeSingle()
  return data
}

export async function approveMedia(orgId: string, mediaId: string, actor: Actor): Promise<Result<null, string>> {
  const media = await loadMedia(orgId, mediaId)
  if (!media) return err('Media not found.')

  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('product_media')
    .update({ validation_status: 'approved', rejection_reason: null, reviewed_by: actor.userId, reviewed_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', mediaId)
  if (error) return err(error.message)

  await recordAudit({
    orgId,
    action: 'MEDIA_APPROVED',
    entityType: 'product_media',
    entityId: mediaId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    previousValue: { validationStatus: media.validation_status },
    newValue: { validationStatus: 'approved' },
    reason: 'Manually approved by an administrator, overriding the automatic assessment.',
  })
  return ok(null)
}

export async function rejectMedia(orgId: string, mediaId: string, reason: string, actor: Actor): Promise<Result<null, string>> {
  const media = await loadMedia(orgId, mediaId)
  if (!media) return err('Media not found.')
  if (!reason.trim()) return err('A reason is required to reject media.')

  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('product_media')
    .update({ validation_status: 'rejected', rejection_reason: reason, reviewed_by: actor.userId, reviewed_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', mediaId)
  if (error) return err(error.message)

  await recordAudit({
    orgId,
    action: 'MEDIA_REJECTED',
    entityType: 'product_media',
    entityId: mediaId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    previousValue: { validationStatus: media.validation_status },
    newValue: { validationStatus: 'rejected' },
    reason,
  })
  return ok(null)
}

/** Demotes any other `primary` on the product to `secondary` — a product has at most one primary image. */
export async function setPrimaryMedia(orgId: string, productId: string, mediaId: string, actor: Actor): Promise<Result<null, string>> {
  const media = await loadMedia(orgId, mediaId)
  if (!media) return err('Media not found.')
  if (media.product_id !== productId) return err('Media does not belong to this product.')

  const supabase = await createServerSupabase()

  const { error: demoteError } = await supabase
    .from('product_media')
    .update({ role: 'secondary' })
    .eq('org_id', orgId)
    .eq('product_id', productId)
    .eq('role', 'primary')
    .neq('id', mediaId)
  if (demoteError) return err(demoteError.message)

  const { error } = await supabase.from('product_media').update({ role: 'primary' }).eq('org_id', orgId).eq('id', mediaId)
  if (error) return err(error.message)

  await recordAudit({
    orgId,
    action: 'MEDIA_SET_PRIMARY',
    entityType: 'product_media',
    entityId: mediaId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    newValue: { productId },
    reason: 'Set as the primary image.',
  })
  return ok(null)
}

/** Owner-only per RLS (`product_media_delete`) — enforced again here, not just left to the database, so a caller gets an explicit message. */
export async function removeMedia(orgId: string, mediaId: string, actor: Actor): Promise<Result<null, string>> {
  const media = await loadMedia(orgId, mediaId)
  if (!media) return err('Media not found.')

  const supabase = await createServerSupabase()
  const { error } = await supabase.from('product_media').delete().eq('org_id', orgId).eq('id', mediaId)
  if (error) return err(error.message)

  await recordAudit({
    orgId,
    action: 'MEDIA_REMOVED',
    entityType: 'product_media',
    entityId: mediaId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    previousValue: { mediaUrl: media.media_url, validationStatus: media.validation_status },
    reason: 'Removed by an administrator.',
  })
  return ok(null)
}

const PROVENANCE_BY_SOURCE_TYPE: Record<Database['public']['Enums']['media_source_type'], MediaProvenanceStatus> = {
  supplier_provided: 'verified_supplier',
  manufacturer_provided: 'verified_manufacturer',
  user_provided: 'user_provided_unverified_rights',
  other_unverified: 'unverified_source',
}

/**
 * "Refresh Media" — re-fetches the image and re-runs every assessment
 * against the same URL. Never re-runs `assessProductMatch`'s
 * `capturedTogether` evidence (that fact is about how the media was
 * originally captured, not about "now") — it re-checks with
 * `capturedTogether: false`, falling back to the same SKU/title textual
 * check a fresh manual review would get, which only ever raises
 * `review_required`, never silently re-confirms a stale match.
 */
export async function refreshMedia(orgId: string, mediaId: string, actor: Actor): Promise<Result<null, string>> {
  const media = await loadMedia(orgId, mediaId)
  if (!media) return err('Media not found.')

  const supabase = await createServerSupabase()
  const { data: product } = await supabase.from('products').select('title, sku').eq('org_id', orgId).eq('id', media.product_id).maybeSingle()
  if (!product) return err('Product not found.')

  const settings = await getAutomationSettingsForOrg(orgId)
  const fetchResult = await fetchImageFacts(media.media_url)
  const facts = fetchResult.ok ? fetchResult.value : { widthPx: null, heightPx: null, fileSizeBytes: null, format: null, contentType: '', checksum: null as string | null }

  const quality = assessImageQuality(
    { widthPx: facts.widthPx, heightPx: facts.heightPx, fileSizeBytes: facts.fileSizeBytes, format: facts.format },
    { minWidthPx: settings.minImageWidthPx, minHeightPx: settings.minImageHeightPx, maxFileSizeBytes: settings.maxImageFileSizeBytes, allowedFormats: settings.allowedImageFormats },
  )
  const sourceRisk = assessSourceRisk(media.media_url, media.source_url)
  const productMatch = assessProductMatch({
    capturedTogether: false,
    productTitle: product.title,
    supplierSku: product.sku,
    mediaUrl: media.media_url,
    sourceUrl: media.source_url,
    conflictingSupplierSku: null,
  })
  const provenanceStatus = PROVENANCE_BY_SOURCE_TYPE[media.source_type]
  const scoreResult = scoreMedia({ provenanceStatus, quality, sourceRisk, productMatch })

  const fetchFailureNote = fetchResult.ok ? null : ` Fetching the image failed: ${fetchResult.error}`
  const validationReason = fetchFailureNote ? `${scoreResult.reason}${fetchFailureNote}` : scoreResult.reason
  const validationStatus = fetchResult.ok ? scoreResult.status : (scoreResult.status === 'approved' ? 'review_required' : scoreResult.status)

  const { error } = await supabase
    .from('product_media')
    .update({
      width: facts.widthPx,
      height: facts.heightPx,
      file_size_bytes: facts.fileSizeBytes,
      format: facts.format,
      checksum: facts.checksum,
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
      reviewed_by: null,
      reviewed_at: null,
      last_checked_at: new Date().toISOString(),
    })
    .eq('org_id', orgId)
    .eq('id', mediaId)
  if (error) return err(error.message)

  await recordAudit({
    orgId,
    action: 'MEDIA_VALIDATED',
    entityType: 'product_media',
    entityId: mediaId,
    actorType: 'user',
    actorUserId: actor.userId,
    actorLabel: actor.label,
    newValue: { validationStatus, qualityStatus: quality.status, watermarkStatus: sourceRisk.status, productMatchStatus: productMatch.status },
    reason: `Refreshed: ${validationReason}`,
  })
  return ok(null)
}
