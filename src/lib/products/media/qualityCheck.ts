/**
 * Deterministic image quality checks (Milestone: product media
 * intelligence, Phase 7).
 *
 * Every threshold is read from `business_settings` by the caller and
 * passed in here — nothing is hard-coded, matching the brief's own
 * instruction. A dimension/size that could not be determined (the fetch
 * failed, or the format's header parser couldn't extract it) is excluded
 * from scoring rather than assumed to pass or fail — the same "missing
 * data is not zero" principle every other scoring engine in this codebase
 * already follows.
 */

export interface QualityThresholds {
  minWidthPx: number
  minHeightPx: number
  maxFileSizeBytes: number
  allowedFormats: readonly string[]
}

export interface ImageFacts {
  widthPx: number | null
  heightPx: number | null
  fileSizeBytes: number | null
  format: string | null
}

export interface QualityComponent {
  key: string
  label: string
  status: 'pass' | 'review_required' | 'fail' | 'not_assessed'
  detail: string
}

export interface QualityAssessment {
  status: 'pass' | 'review_required' | 'fail' | 'not_assessed'
  score: number | null
  components: readonly QualityComponent[]
}

const EXTREME_ASPECT_RATIO = 3 // wider/taller than 3:1 either way is flagged

function assessResolution(facts: ImageFacts, thresholds: QualityThresholds): QualityComponent {
  if (facts.widthPx === null || facts.heightPx === null) {
    return { key: 'resolution', label: 'Resolution', status: 'not_assessed', detail: 'Image dimensions could not be determined.' }
  }
  const meets = facts.widthPx >= thresholds.minWidthPx && facts.heightPx >= thresholds.minHeightPx
  return {
    key: 'resolution',
    label: 'Resolution',
    status: meets ? 'pass' : 'fail',
    detail: meets
      ? `${facts.widthPx}×${facts.heightPx}px clears the ${thresholds.minWidthPx}×${thresholds.minHeightPx}px minimum.`
      : `${facts.widthPx}×${facts.heightPx}px is below the ${thresholds.minWidthPx}×${thresholds.minHeightPx}px minimum.`,
  }
}

function assessFormat(facts: ImageFacts, thresholds: QualityThresholds): QualityComponent {
  if (!facts.format) {
    return { key: 'format', label: 'File format', status: 'not_assessed', detail: 'File format could not be determined.' }
  }
  const allowed = thresholds.allowedFormats.includes(facts.format)
  return {
    key: 'format',
    label: 'File format',
    status: allowed ? 'pass' : 'fail',
    detail: allowed ? `${facts.format.toUpperCase()} is an allowed format.` : `${facts.format.toUpperCase()} is not in the allowed format list (${thresholds.allowedFormats.join(', ')}).`,
  }
}

function assessFileSize(facts: ImageFacts, thresholds: QualityThresholds): QualityComponent {
  if (facts.fileSizeBytes === null) {
    return { key: 'file_size', label: 'File size', status: 'not_assessed', detail: 'File size could not be determined.' }
  }
  const withinLimit = facts.fileSizeBytes <= thresholds.maxFileSizeBytes
  const mb = (facts.fileSizeBytes / (1024 * 1024)).toFixed(2)
  const maxMb = (thresholds.maxFileSizeBytes / (1024 * 1024)).toFixed(1)
  return {
    key: 'file_size',
    label: 'File size',
    status: withinLimit ? 'pass' : 'fail',
    detail: withinLimit ? `${mb}MB is within the ${maxMb}MB limit.` : `${mb}MB exceeds the ${maxMb}MB limit.`,
  }
}

function assessAspectRatio(facts: ImageFacts): QualityComponent {
  if (facts.widthPx === null || facts.heightPx === null || facts.heightPx === 0) {
    return { key: 'aspect_ratio', label: 'Aspect ratio', status: 'not_assessed', detail: 'Aspect ratio could not be determined.' }
  }
  const ratio = facts.widthPx / facts.heightPx
  const extreme = ratio > EXTREME_ASPECT_RATIO || ratio < 1 / EXTREME_ASPECT_RATIO
  return {
    key: 'aspect_ratio',
    label: 'Aspect ratio',
    status: extreme ? 'review_required' : 'pass',
    detail: extreme
      ? `An extreme aspect ratio (${ratio.toFixed(2)}:1) is unusual for a product photo and may not display well.`
      : `A normal aspect ratio (${ratio.toFixed(2)}:1).`,
  }
}

const RANK: Record<QualityComponent['status'], number> = { fail: 0, review_required: 1, not_assessed: 2, pass: 3 }

export function assessImageQuality(facts: ImageFacts, thresholds: QualityThresholds): QualityAssessment {
  const components = [assessResolution(facts, thresholds), assessFormat(facts, thresholds), assessFileSize(facts, thresholds), assessAspectRatio(facts)]

  // The overall status is the worst of the four — a single hard failure
  // (wrong format, too small, too large) fails the whole assessment,
  // never averaged away by three passing checks.
  const worst = components.reduce((acc, c) => (RANK[c.status] < RANK[acc.status] ? c : acc), components[0])

  const assessed = components.filter((c) => c.status !== 'not_assessed')
  const score = assessed.length === 0 ? null : Math.round((assessed.filter((c) => c.status === 'pass').length / assessed.length) * 100)

  return { status: worst.status, score, components }
}
