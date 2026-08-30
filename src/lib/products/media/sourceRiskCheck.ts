/**
 * Watermark / branding risk detection (Milestone: product media
 * intelligence, Phase 7).
 *
 * Deliberately NOT computer vision. This codebase has no image-analysis
 * or vision-model provider configured, and the brief is explicit that one
 * should not be invented to make this feature look more sophisticated
 * than it is. What follows is the honest, real thing that CAN be checked
 * deterministically without looking at pixels at all: the URL an image
 * was found at. An image hosted on `*.amazon.co.uk`, `*.ebayimg.com`,
 * `*.aliexpress-media.com` etc. very likely carries that marketplace's
 * own watermark/branding baked into the pixels — a genuine, well-known
 * pattern, not a guess.
 *
 * Because this can only ever look at metadata, not content, a clean
 * result is never reported as "no watermark" — only `uncertain`, per the
 * brief's own explicit rule. `detected` is the one confident, positive
 * signal this check can produce.
 */

export type WatermarkStatus = 'detected' | 'uncertain'

export interface SourceRiskAssessment {
  status: WatermarkStatus
  detail: string
  matchedTerm: string | null
}

// Real, well-known marketplace/retailer domains and brand terms whose
// product imagery is known to commonly carry visible branding/watermarks.
// Deliberately conservative and short — a false negative (missing a real
// watermark) is far more likely than a false positive here, which is the
// correct direction of error for a check that can only ever escalate to
// `uncertain`, never confidently clear an image.
const KNOWN_MARKETPLACE_HOSTS: readonly string[] = [
  'amazon.', 'ebayimg.com', 'ebaystatic.com', 'aliexpress', 'alicdn.com',
  'temu.com', 'walmartimages.com', 'etsystatic.com', 'shopify.com/s/files',
]

const KNOWN_BRAND_TERMS: readonly string[] = ['amazon', 'ebay', 'aliexpress', 'temu', 'walmart', 'etsy']

function normalise(value: string): string {
  return value.toLowerCase()
}

export function assessSourceRisk(mediaUrl: string, sourceUrl: string | null): SourceRiskAssessment {
  const haystacks = [mediaUrl, sourceUrl ?? ''].map(normalise)

  for (const host of KNOWN_MARKETPLACE_HOSTS) {
    if (haystacks.some((h) => h.includes(host))) {
      return {
        status: 'detected',
        detail: `The image or source URL references a known marketplace/retailer domain ("${host}"), which commonly carries that platform's own watermark or branding.`,
        matchedTerm: host,
      }
    }
  }

  for (const term of KNOWN_BRAND_TERMS) {
    if (haystacks.some((h) => h.includes(term))) {
      return {
        status: 'detected',
        detail: `The image or source URL references a known third-party brand name ("${term}").`,
        matchedTerm: term,
      }
    }
  }

  return {
    status: 'uncertain',
    detail: 'No known marketplace domain or brand term was found in the URL — this does not confirm the image is free of a watermark or branding, only that this deterministic check found no evidence of one. Actual visual watermark detection would require an image-analysis provider, which is not configured (PLANNED, not built).',
    matchedTerm: null,
  }
}
