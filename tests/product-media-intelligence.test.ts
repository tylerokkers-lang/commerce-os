import { describe, expect, it } from 'vitest'
import { assessImageQuality, type QualityThresholds } from '@/lib/products/media/qualityCheck'
import { assessSourceRisk } from '@/lib/products/media/sourceRiskCheck'
import { assessProductMatch } from '@/lib/products/media/productMatch'
import { detectDuplicateMedia } from '@/lib/products/media/duplicateDetection'
import { scoreMedia, assessMediaReadiness, type MediaScoreInputs } from '@/lib/products/media/mediaScore'

const THRESHOLDS: QualityThresholds = { minWidthPx: 800, minHeightPx: 800, maxFileSizeBytes: 5_242_880, allowedFormats: ['jpeg', 'png', 'webp'] }

describe('Image quality engine', () => {
  it('a large, well-formed JPEG passes every component', () => {
    const result = assessImageQuality({ widthPx: 1200, heightPx: 1200, fileSizeBytes: 500_000, format: 'jpeg' }, THRESHOLDS)
    expect(result.status).toBe('pass')
    expect(result.score).toBe(100)
  })

  it('below the minimum resolution fails, even if everything else passes', () => {
    const result = assessImageQuality({ widthPx: 400, heightPx: 400, fileSizeBytes: 100_000, format: 'jpeg' }, THRESHOLDS)
    expect(result.status).toBe('fail')
    expect(result.components.find((c) => c.key === 'resolution')?.status).toBe('fail')
  })

  it('an unsupported format fails regardless of resolution', () => {
    const result = assessImageQuality({ widthPx: 2000, heightPx: 2000, fileSizeBytes: 100_000, format: 'gif' }, THRESHOLDS)
    expect(result.status).toBe('fail')
    expect(result.components.find((c) => c.key === 'format')?.status).toBe('fail')
  })

  it('an oversized file fails', () => {
    const result = assessImageQuality({ widthPx: 2000, heightPx: 2000, fileSizeBytes: 10_000_000, format: 'png' }, THRESHOLDS)
    expect(result.status).toBe('fail')
    expect(result.components.find((c) => c.key === 'file_size')?.status).toBe('fail')
  })

  it('an extreme aspect ratio is flagged for review, not a hard failure', () => {
    const result = assessImageQuality({ widthPx: 3200, heightPx: 800, fileSizeBytes: 100_000, format: 'jpeg' }, THRESHOLDS)
    expect(result.status).toBe('review_required')
    expect(result.components.find((c) => c.key === 'aspect_ratio')?.status).toBe('review_required')
  })

  it('undetermined dimensions are not_assessed, never guessed as pass or fail, and excluded from the score', () => {
    const result = assessImageQuality({ widthPx: null, heightPx: null, fileSizeBytes: 100_000, format: 'jpeg' }, THRESHOLDS)
    expect(result.components.find((c) => c.key === 'resolution')?.status).toBe('not_assessed')
    expect(result.components.find((c) => c.key === 'aspect_ratio')?.status).toBe('not_assessed')
    // Only format + file_size were assessable, and both pass.
    expect(result.score).toBe(100)
  })

  it('when nothing at all could be assessed, the score is null, not zero', () => {
    const result = assessImageQuality({ widthPx: null, heightPx: null, fileSizeBytes: null, format: null }, THRESHOLDS)
    expect(result.status).toBe('not_assessed')
    expect(result.score).toBeNull()
  })

  it('the overall status is the worst component, never averaged away by passing ones', () => {
    // format fails, resolution/file_size pass — overall must be fail, not "3 pass / 1 fail = mostly fine".
    const result = assessImageQuality({ widthPx: 2000, heightPx: 2000, fileSizeBytes: 100_000, format: 'bmp' }, THRESHOLDS)
    expect(result.status).toBe('fail')
  })
})

describe('Watermark / branding source-risk check', () => {
  it('detects a known marketplace-hosted image URL', () => {
    const result = assessSourceRisk('https://m.media-amazon.com/images/I/abc.jpg', null)
    expect(result.status).toBe('detected')
    expect(result.matchedTerm).toContain('amazon')
  })

  it('detects a known brand term in the source URL even when the media URL itself is clean', () => {
    const result = assessSourceRisk('https://cdn.example.com/img/123.jpg', 'https://www.ebay.co.uk/itm/123456')
    expect(result.status).toBe('detected')
  })

  it('a clean, unrelated URL is only ever "uncertain" — never a confident "no watermark" claim', () => {
    const result = assessSourceRisk('https://cdn.example-supplier.com/products/abc123.jpg', null)
    expect(result.status).toBe('uncertain')
    expect(result.detail.toLowerCase()).not.toContain('no watermark')
    expect(result.detail).toContain('not configured')
  })

  it('has no third possible status value ("not_detected") — the type itself only allows detected | uncertain', () => {
    const result = assessSourceRisk('https://cdn.example-supplier.com/products/abc123.jpg', null)
    expect(['detected', 'uncertain']).toContain(result.status)
  })
})

describe('Product-match assessment', () => {
  it('media captured in the same action as the product facts is matched — the strongest evidence', () => {
    const result = assessProductMatch({
      capturedTogether: true,
      productTitle: 'Wireless Mouse',
      supplierSku: 'WM-100',
      mediaUrl: 'https://cdn.example.com/random-file-name.jpg',
      sourceUrl: null,
      conflictingSupplierSku: null,
    })
    expect(result.status).toBe('matched')
  })

  it('a URL containing the product SKU is matched even without capturedTogether', () => {
    const result = assessProductMatch({
      capturedTogether: false,
      productTitle: 'Wireless Mouse',
      supplierSku: 'WM-100',
      mediaUrl: 'https://cdn.example.com/wm-100-main.jpg',
      sourceUrl: null,
      conflictingSupplierSku: null,
    })
    expect(result.status).toBe('matched')
  })

  it('a URL containing a distinctive title keyword is matched', () => {
    const result = assessProductMatch({
      capturedTogether: false,
      productTitle: 'Stainless Steel Water Bottle',
      supplierSku: null,
      mediaUrl: 'https://cdn.example.com/waterbottle-photo.jpg',
      sourceUrl: null,
      conflictingSupplierSku: null,
    })
    expect(result.status).toBe('matched')
  })

  it('no evidence at all is uncertain, never asserted as mismatched', () => {
    const result = assessProductMatch({
      capturedTogether: false,
      productTitle: 'Ceramic Mug',
      supplierSku: 'CM-42',
      mediaUrl: 'https://cdn.example.com/img000123.jpg',
      sourceUrl: null,
      conflictingSupplierSku: null,
    })
    expect(result.status).toBe('uncertain')
  })

  it('an explicit conflicting supplier SKU is mismatched — a genuine conflict, not silence', () => {
    const result = assessProductMatch({
      capturedTogether: false,
      productTitle: 'Ceramic Mug',
      supplierSku: 'CM-42',
      mediaUrl: 'https://cdn.example.com/other-product.jpg',
      sourceUrl: null,
      conflictingSupplierSku: 'ZZ-99',
    })
    expect(result.status).toBe('mismatched')
  })
})

describe('Duplicate media detection', () => {
  it('an identical checksum is a duplicate regardless of URL', () => {
    const result = detectDuplicateMedia(
      { mediaUrl: 'https://cdn.example.com/new-path.jpg', checksum: 'abc123' },
      [{ id: 'm1', mediaUrl: 'https://cdn.example.com/old-path.jpg', checksum: 'abc123' }],
    )
    expect(result.isDuplicate).toBe(true)
    expect(result.matchedMediaId).toBe('m1')
  })

  it('an identical URL (case/trailing-slash insensitive) is a duplicate', () => {
    const result = detectDuplicateMedia(
      { mediaUrl: 'HTTPS://CDN.EXAMPLE.COM/photo.jpg/', checksum: null },
      [{ id: 'm2', mediaUrl: 'https://cdn.example.com/photo.jpg', checksum: null }],
    )
    expect(result.isDuplicate).toBe(true)
    expect(result.matchedMediaId).toBe('m2')
  })

  it('a genuinely different URL and no checksum match is not a duplicate', () => {
    const result = detectDuplicateMedia(
      { mediaUrl: 'https://cdn.example.com/a.jpg', checksum: null },
      [{ id: 'm3', mediaUrl: 'https://cdn.example.com/b.jpg', checksum: null }],
    )
    expect(result.isDuplicate).toBe(false)
    expect(result.matchedMediaId).toBeNull()
  })
})

const BASE_QUALITY_PASS = assessImageQuality({ widthPx: 1200, heightPx: 1200, fileSizeBytes: 400_000, format: 'jpeg' }, THRESHOLDS)
const BASE_RISK_CLEAN = assessSourceRisk('https://cdn.example-supplier.com/abc.jpg', null)
const BASE_MATCH_OK = assessProductMatch({ capturedTogether: true, productTitle: 'X', supplierSku: null, mediaUrl: 'https://cdn.example-supplier.com/abc.jpg', sourceUrl: null, conflictingSupplierSku: null })

function baseInputs(overrides: Partial<MediaScoreInputs> = {}): MediaScoreInputs {
  return { provenanceStatus: 'verified_supplier', quality: BASE_QUALITY_PASS, sourceRisk: BASE_RISK_CLEAN, productMatch: BASE_MATCH_OK, ...overrides }
}

describe('Deterministic media scoring (🟢/🟡/🔴/⚪ ladder)', () => {
  it('supplier-provided, passing quality, matched, no risk -> APPROVED', () => {
    expect(scoreMedia(baseInputs()).status).toBe('approved')
  })

  it('a quality failure REJECTS regardless of everything else', () => {
    const failingQuality = assessImageQuality({ widthPx: 100, heightPx: 100, fileSizeBytes: 100, format: 'jpeg' }, THRESHOLDS)
    expect(scoreMedia(baseInputs({ quality: failingQuality })).status).toBe('rejected')
  })

  it('a mismatched product REJECTS even with clean quality and provenance', () => {
    const mismatch = assessProductMatch({ capturedTogether: false, productTitle: 'X', supplierSku: 'A', mediaUrl: '', sourceUrl: null, conflictingSupplierSku: 'B' })
    expect(scoreMedia(baseInputs({ productMatch: mismatch })).status).toBe('rejected')
  })

  it('a detected watermark/branding risk REJECTS', () => {
    const detected = assessSourceRisk('https://m.media-amazon.com/img.jpg', null)
    expect(scoreMedia(baseInputs({ sourceRisk: detected })).status).toBe('rejected')
  })

  it('an unverified (Level 4) source always needs REVIEW, even with perfect quality', () => {
    expect(scoreMedia(baseInputs({ provenanceStatus: 'unverified_source' })).status).toBe('review_required')
  })

  it('an uncertain product match needs REVIEW rather than being auto-approved', () => {
    const uncertain = assessProductMatch({ capturedTogether: false, productTitle: 'X', supplierSku: null, mediaUrl: 'y', sourceUrl: null, conflictingSupplierSku: null })
    expect(scoreMedia(baseInputs({ productMatch: uncertain })).status).toBe('review_required')
  })

  it('quality flagged for review (e.g. extreme aspect ratio) needs REVIEW, not auto-approval', () => {
    const reviewQuality = assessImageQuality({ widthPx: 3200, heightPx: 800, fileSizeBytes: 100_000, format: 'jpeg' }, THRESHOLDS)
    expect(scoreMedia(baseInputs({ quality: reviewQuality })).status).toBe('review_required')
  })

  it('quality that could not be assessed at all needs REVIEW rather than a guessed approval', () => {
    const unassessed = assessImageQuality({ widthPx: null, heightPx: null, fileSizeBytes: null, format: null }, THRESHOLDS)
    expect(scoreMedia(baseInputs({ quality: unassessed })).status).toBe('review_required')
  })

  it('user-provided media that otherwise clears everything is APPROVED, but the reason names the unverified licensing', () => {
    const result = scoreMedia(baseInputs({ provenanceStatus: 'user_provided_unverified_rights' }))
    expect(result.status).toBe('approved')
    expect(result.reason.toLowerCase()).toContain('usage rights')
  })
})

describe('Product-level media readiness (feeds the Shopify eligibility gate)', () => {
  it('no media at all is media_not_ready, with an explicit "no media" reason', () => {
    const result = assessMediaReadiness([], 1)
    expect(result.status).toBe('media_not_ready')
    expect(result.reason).toContain('No media has been attached')
  })

  it('enough approved images including a primary is media_ready', () => {
    const result = assessMediaReadiness([{ role: 'primary', validationStatus: 'approved' }], 1)
    expect(result.status).toBe('media_ready')
    expect(result.hasApprovedPrimary).toBe(true)
  })

  it('enough approved images but none set as primary is media_review_required, not media_ready', () => {
    const result = assessMediaReadiness([{ role: 'secondary', validationStatus: 'approved' }], 1)
    expect(result.status).toBe('media_review_required')
  })

  it('fewer approved images than required, with at least one pending review, is media_review_required', () => {
    const result = assessMediaReadiness([{ role: 'primary', validationStatus: 'review_required' }], 2)
    expect(result.status).toBe('media_review_required')
  })

  it('only rejected media (no approved, none pending) is media_not_ready — ⚪ NO_ACCEPTABLE_MEDIA', () => {
    const result = assessMediaReadiness([{ role: 'primary', validationStatus: 'rejected' }], 1)
    expect(result.status).toBe('media_not_ready')
    expect(result.approvedCount).toBe(0)
  })
})
