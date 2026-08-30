import type { QualityAssessment } from './qualityCheck'
import type { SourceRiskAssessment } from './sourceRiskCheck'
import type { ProductMatchAssessment } from './productMatch'

/**
 * The final media verdict (Milestone: product media intelligence,
 * Phase 7) — a fixed, ordered ladder, never a weighted average that
 * could let one good score compensate for a hard problem. Mirrors the
 * exact style of `products/intelligence/recommendation.ts`'s
 * deterministic ladder from Phase 4: each rule either returns a verdict
 * with a reason, or falls through to the next.
 */

export type MediaProvenanceStatus = 'verified_supplier' | 'verified_manufacturer' | 'user_provided_unverified_rights' | 'unverified_source'
export type MediaValidationStatus = 'approved' | 'review_required' | 'rejected'

export interface MediaScoreInputs {
  provenanceStatus: MediaProvenanceStatus
  quality: QualityAssessment
  sourceRisk: SourceRiskAssessment
  productMatch: ProductMatchAssessment
}

export interface MediaScoreResult {
  status: MediaValidationStatus
  reason: string
}

export function scoreMedia(input: MediaScoreInputs): MediaScoreResult {
  if (input.quality.status === 'fail') {
    const failing = input.quality.components.find((c) => c.status === 'fail')
    return { status: 'rejected', reason: `Quality check failed: ${failing?.detail ?? 'a quality requirement was not met.'}` }
  }

  if (input.productMatch.status === 'mismatched') {
    return { status: 'rejected', reason: `Product match failed: ${input.productMatch.detail}` }
  }

  if (input.sourceRisk.status === 'detected') {
    return { status: 'rejected', reason: `Watermark/branding risk detected: ${input.sourceRisk.detail}` }
  }

  if (input.provenanceStatus === 'unverified_source') {
    return { status: 'review_required', reason: 'Source is an unverified, non-supplier origin (Level 4) — requires manual review regardless of quality.' }
  }

  if (input.productMatch.status === 'uncertain') {
    return { status: 'review_required', reason: `Product match could not be confirmed: ${input.productMatch.detail}` }
  }

  if (input.quality.status === 'review_required') {
    const flagged = input.quality.components.find((c) => c.status === 'review_required')
    return { status: 'review_required', reason: `Quality check flagged for review: ${flagged?.detail ?? 'a quality requirement needs review.'}` }
  }

  if (input.quality.status === 'not_assessed') {
    return { status: 'review_required', reason: 'Image dimensions/format/size could not be determined — cannot confirm quality without a human check.' }
  }

  // Reaching here means: quality passes, product match is at least
  // matched, no watermark/branding was detected (only ever "uncertain",
  // never confirmed absent), and provenance is Level 1-3.
  const licensingNote =
    input.provenanceStatus === 'user_provided_unverified_rights'
      ? ' Usage rights were not independently verified — the administrator who attached this image is responsible for confirming it may be used.'
      : ''

  return {
    status: 'approved',
    reason: `Clears quality, product match and the deterministic watermark/branding check.${licensingNote}`,
  }
}

// ---------------------------------------------------------------------------
// Product-level readiness — the aggregate the eligibility gate consumes.
// ---------------------------------------------------------------------------

export type MediaReadinessStatus = 'media_ready' | 'media_review_required' | 'media_not_ready'

export interface MediaReadinessInput {
  role: string
  validationStatus: MediaValidationStatus
}

export interface MediaReadinessResult {
  status: MediaReadinessStatus
  approvedCount: number
  hasApprovedPrimary: boolean
  reason: string
}

export function assessMediaReadiness(media: readonly MediaReadinessInput[], minApprovedImages: number): MediaReadinessResult {
  const approved = media.filter((m) => m.validationStatus === 'approved')
  const hasApprovedPrimary = approved.some((m) => m.role === 'primary')
  const hasReviewRequired = media.some((m) => m.validationStatus === 'review_required')

  if (approved.length >= minApprovedImages && hasApprovedPrimary) {
    return {
      status: 'media_ready',
      approvedCount: approved.length,
      hasApprovedPrimary,
      reason: `${approved.length} approved image${approved.length === 1 ? '' : 's'}, including a primary image.`,
    }
  }

  if (approved.length >= minApprovedImages && !hasApprovedPrimary) {
    return {
      status: 'media_review_required',
      approvedCount: approved.length,
      hasApprovedPrimary,
      reason: `${approved.length} approved image${approved.length === 1 ? '' : 's'}, but none is set as the primary image.`,
    }
  }

  if (hasReviewRequired) {
    return {
      status: 'media_review_required',
      approvedCount: approved.length,
      hasApprovedPrimary,
      reason: `Only ${approved.length} of the required ${minApprovedImages} approved image(s) so far, and at least one image is awaiting review.`,
    }
  }

  if (media.length === 0) {
    return { status: 'media_not_ready', approvedCount: 0, hasApprovedPrimary: false, reason: 'No media has been attached to this product yet.' }
  }

  return {
    status: 'media_not_ready',
    approvedCount: approved.length,
    hasApprovedPrimary,
    reason: `${approved.length} of the required ${minApprovedImages} approved image(s) — no acceptable media currently on file.`,
  }
}
