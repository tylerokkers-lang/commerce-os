/**
 * Product Quality Score (Milestone: product intelligence, Phase 4).
 *
 * A measure of how complete and usable a product's own data is — never a
 * measure of whether it's a good commercial opportunity (that's
 * `scoreOpportunity` in `../scoring.ts`, a deliberately separate concern).
 * Persisted into `product_health` (0008), which already existed with
 * exactly this score/band/components/weights_version shape and had never
 * been written to.
 *
 * Same house rule as `scoreOpportunity`: a missing signal is excluded and
 * the remaining weight is renormalised, never defaulted to an average —
 * an unphotographed product does not get credit for a "typical" photo.
 */

export const QUALITY_WEIGHTS_VERSION = 'product-quality-weights@1'

export interface QualitySignals {
  /** From the Shopify Storefront API product, when the listing is reachable. */
  imageCount?: number
  descriptionLength?: number
  /** Real, named options with more than one value — a lone "Title/Default Title" doesn't count. */
  hasMeaningfulVariants?: boolean
  variantCount?: number
  /** From `products` — physical dimensions on file. */
  hasDimensions?: boolean
  hasWeight?: boolean
  /** From `supplier_products` for the assigned supplier, if any. */
  supplierAssigned: boolean
  supplierHasCost?: boolean
  supplierHasLeadTime?: boolean
  supplierHasStockFigure?: boolean
}

export interface QualityComponent {
  key: string
  label: string
  score: number | null
  maxPoints: number
  points: number
  basis: string
}

export interface QualityAssessment {
  total: number
  band: 'excellent' | 'good' | 'fair' | 'poor'
  bandLabel: string
  components: readonly QualityComponent[]
  coverage: number
  missing: readonly string[]
  weightsVersion: string
  assessedAt: string
}

// Matches the exact breakdown requested: Images 20, Description 20,
// Specifications 20, Variants 15, Supplier data 15, Shipping data 10.
const MAX_POINTS: Readonly<Record<string, number>> = {
  images: 20,
  description: 20,
  specifications: 20,
  variants: 15,
  supplierData: 15,
  shippingData: 10,
}

const clamp01to100 = (v: number) => Math.max(0, Math.min(100, v))

interface Def {
  key: string
  label: string
  compute: (s: QualitySignals) => { score: number; basis: string } | null
}

const DEFINITIONS: readonly Def[] = [
  {
    key: 'images',
    label: 'Images',
    compute: (s) => {
      if (s.imageCount === undefined) return null
      // 0 images is unsellable; 4+ is a genuinely well-photographed listing.
      const score = clamp01to100((Math.min(s.imageCount, 4) / 4) * 100)
      return { score, basis: `${s.imageCount} image${s.imageCount === 1 ? '' : 's'} on the listing.` }
    },
  },
  {
    key: 'description',
    label: 'Description',
    compute: (s) => {
      if (s.descriptionLength === undefined) return null
      // Below ~40 characters a "description" is really just a restated title.
      const score = clamp01to100((Math.min(s.descriptionLength, 400) / 400) * 100)
      return { score, basis: `${s.descriptionLength} characters of description.` }
    },
  },
  {
    key: 'specifications',
    label: 'Specifications',
    compute: (s) => {
      if (s.hasDimensions === undefined && s.hasWeight === undefined) return null
      const have = (s.hasDimensions ? 1 : 0) + (s.hasWeight ? 1 : 0)
      const of = (s.hasDimensions === undefined ? 0 : 1) + (s.hasWeight === undefined ? 0 : 1)
      const score = of === 0 ? 0 : clamp01to100((have / of) * 100)
      const parts = [s.hasDimensions ? 'dimensions on file' : s.hasDimensions === false ? 'no dimensions' : null, s.hasWeight ? 'weight on file' : s.hasWeight === false ? 'no weight' : null].filter(Boolean)
      return { score, basis: parts.join(', ') || 'No specification data available.' }
    },
  },
  {
    key: 'variants',
    label: 'Variants',
    compute: (s) => {
      if (s.hasMeaningfulVariants === undefined) return null
      if (!s.hasMeaningfulVariants) {
        return { score: 70, basis: 'Single-variant product — not a gap, just simpler than a multi-option listing.' }
      }
      const count = s.variantCount ?? 1
      return { score: 100, basis: `${count} variants with real, named options.` }
    },
  },
  {
    key: 'supplierData',
    label: 'Supplier data',
    compute: (s) => {
      if (!s.supplierAssigned) return { score: 0, basis: 'No supplier assigned to this product yet.' }
      const checks = [s.supplierHasCost, s.supplierHasLeadTime, s.supplierHasStockFigure]
      const known = checks.filter((c) => c !== undefined)
      if (known.length === 0) return null
      const have = known.filter(Boolean).length
      const score = clamp01to100((have / known.length) * 100)
      return { score, basis: `${have} of ${known.length} supplier data points on file (cost, lead time, stock figure).` }
    },
  },
  {
    key: 'shippingData',
    label: 'Shipping data',
    compute: (s) => {
      if (s.supplierHasLeadTime === undefined) return null
      return s.supplierHasLeadTime
        ? { score: 100, basis: 'Delivery lead time is on file for the assigned supplier.' }
        : { score: 0, basis: 'No delivery lead time on file for the assigned supplier.' }
    },
  },
]

function bandFor(total: number): QualityAssessment['band'] {
  if (total >= 85) return 'excellent'
  if (total >= 65) return 'good'
  if (total >= 40) return 'fair'
  return 'poor'
}

const BAND_LABELS: Record<QualityAssessment['band'], string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
}

export function scoreProductQuality(signals: QualitySignals, now: Date = new Date()): QualityAssessment {
  const raw = DEFINITIONS.map((def) => ({ def, computed: def.compute(signals) }))

  const availableMax = raw.filter((r) => r.computed !== null).reduce((sum, r) => sum + MAX_POINTS[r.def.key], 0)
  const totalMax = Object.values(MAX_POINTS).reduce((a, b) => a + b, 0)
  const coverage = totalMax === 0 ? 0 : availableMax / totalMax

  const components: QualityComponent[] = raw.map(({ def, computed }) => {
    const maxPoints = MAX_POINTS[def.key]
    const points = computed === null ? 0 : Math.round((computed.score / 100) * maxPoints * 10) / 10
    return {
      key: def.key,
      label: def.label,
      score: computed?.score ?? null,
      maxPoints,
      points,
      basis: computed?.basis ?? 'No data available for this component, so it was excluded from the score.',
    }
  })

  // Renormalised across what's actually known, same principle as scoreOpportunity.
  const earnedPoints = components.reduce((sum, c) => sum + c.points, 0)
  const total = availableMax === 0 ? 0 : Math.round((earnedPoints / availableMax) * 100)

  const missing = components.filter((c) => c.score === null).map((c) => c.label)

  return {
    total,
    band: bandFor(total),
    bandLabel: BAND_LABELS[bandFor(total)],
    components,
    coverage: Math.round(coverage * 100) / 100,
    missing,
    weightsVersion: QUALITY_WEIGHTS_VERSION,
    assessedAt: now.toISOString(),
  }
}
