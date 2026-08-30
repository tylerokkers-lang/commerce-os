/**
 * Media duplicate detection (Milestone: product media intelligence,
 * Phase 7).
 *
 * Two real, deterministic signals: an identical checksum (the actual
 * bytes are the same, regardless of URL — the strongest possible
 * evidence) and an identical URL (the same asset referenced twice,
 * common when a candidate is captured more than once). Never attempts
 * perceptual/near-duplicate matching across genuinely different files —
 * that would require real image analysis this codebase does not have.
 */

export interface ExistingMedia {
  id: string
  mediaUrl: string
  checksum: string | null
}

export interface DuplicateCheckResult {
  isDuplicate: boolean
  matchedMediaId: string | null
  reason: string | null
}

function normaliseUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

export function detectDuplicateMedia(
  candidate: { mediaUrl: string; checksum: string | null },
  existing: readonly ExistingMedia[],
): DuplicateCheckResult {
  if (candidate.checksum) {
    const checksumMatch = existing.find((m) => m.checksum === candidate.checksum)
    if (checksumMatch) {
      return { isDuplicate: true, matchedMediaId: checksumMatch.id, reason: 'An identical file (matching checksum) is already attached to this product.' }
    }
  }

  const urlMatch = existing.find((m) => normaliseUrl(m.mediaUrl) === normaliseUrl(candidate.mediaUrl))
  if (urlMatch) {
    return { isDuplicate: true, matchedMediaId: urlMatch.id, reason: 'This exact URL is already attached to this product.' }
  }

  return { isDuplicate: false, matchedMediaId: null, reason: null }
}
