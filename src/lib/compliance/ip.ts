/**
 * Intellectual property risk (§59).
 *
 * This is a screening tool, not a legal opinion, and the wording throughout is
 * chosen to keep that distinction visible. It looks for the patterns that
 * usually precede a trademark complaint, a counterfeit takedown or a copyright
 * claim, and raises them for a person to decide on.
 *
 * It never clears a product. The best result it can return is "no risk signals
 * were detected", which is a statement about this system's checks, not about
 * the product's legal position.
 */

export type IpRiskLevel = 'low' | 'medium' | 'high' | 'unknown'

export interface IpSignal {
  key: string
  /** How much this pattern moves the assessment. */
  severity: 'high' | 'medium' | 'low'
  reason: string
}

export interface IpAssessment {
  level: IpRiskLevel
  signals: readonly IpSignal[]
  reasons: readonly string[]
  /** True when a person must decide before the product may be listed. */
  requiresHumanReview: boolean
  summary: string
  assessedAt: string
}

export interface IpAssessmentInput {
  title: string
  description?: string | null
  /** Brand named on the product, if any. */
  brand?: string | null
  /** Brands the business owns. A product carrying our own brand is not a risk. */
  ownBrands?: readonly string[]
  category?: string | null
  supplierCountry?: string | null
  supplierPlatform?: string | null
  unitCostMinor?: number
  typicalRetailMinor?: number
  /** True when the only product images available came from the supplier. */
  imagesFromSupplier?: boolean
  /** True when we hold written authorisation to resell the brand. */
  hasBrandAuthorisation?: boolean
  /** Brand names the owner has configured as off limits. */
  restrictedBrands?: readonly string[]
}

/**
 * Phrases that habitually accompany replica, knock-off or unlicensed goods.
 * Matching one is not proof of anything; it is a reason to look.
 */
const SUSPICIOUS_PHRASES: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\breplica\b/i, reason: 'The title or description uses the word "replica".' },
  { pattern: /\binspired by\b/i, reason: 'Described as "inspired by" another product, which often signals a copied design.' },
  { pattern: /\b(?:style|type)\s+of\s+\w+/i, reason: 'Described as being in the style of another product.' },
  { pattern: /\bcompatible with\b/i, reason: 'Marketed as compatible with a branded product, which brings trademark use into scope.' },
  { pattern: /\bfor\s+(?:iphone|airpods|dyson|lego|nintendo|playstation|xbox|samsung galaxy)\b/i, reason: 'References a well-known brand as the use case, which requires care over how that brand is used in the listing.' },
  { pattern: /\b(?:oem|aaa\+?|1:1|mirror quality|unbranded genuine)\b/i, reason: 'Uses supplier vocabulary commonly associated with counterfeit goods.' },
  { pattern: /\bgenuine\b.*\bno box\b/i, reason: 'Claims genuine goods without original packaging, a common counterfeit pattern.' },
]

/**
 * Categories where branded, patented or licensed goods dominate, so an
 * unbranded equivalent deserves a closer look.
 */
const HIGH_BRAND_DENSITY_CATEGORIES: readonly string[] = [
  'Electronics', 'Computers', 'Phone Accessories', 'Toys', 'Fashion',
  'Footwear', 'Watches', 'Cosmetics', 'Fragrance', 'Sportswear',
]

export function assessIpRisk(input: IpAssessmentInput, now: Date = new Date()): IpAssessment {
  const signals: IpSignal[] = []
  const haystack = `${input.title} ${input.description ?? ''}`

  const ownBrands = (input.ownBrands ?? []).map((b) => b.toLowerCase())
  const brand = input.brand?.trim()
  const isOwnBrand = brand ? ownBrands.includes(brand.toLowerCase()) : false

  // A third-party brand without written authorisation is the single most
  // common cause of a marketplace IP complaint.
  if (brand && !isOwnBrand) {
    if (input.hasBrandAuthorisation) {
      signals.push({
        key: 'branded_authorised',
        severity: 'low',
        reason: `Carries the third-party brand "${brand}", and written authorisation to resell it is recorded.`,
      })
    } else {
      signals.push({
        key: 'branded_unauthorised',
        severity: 'high',
        reason: `Carries the third-party brand "${brand}" with no authorisation to resell on file. Selling branded goods without it invites a takedown regardless of whether the goods are genuine.`,
      })
    }
  }

  const restricted = (input.restrictedBrands ?? []).find((b) =>
    haystack.toLowerCase().includes(b.toLowerCase()),
  )
  if (restricted) {
    signals.push({
      key: 'restricted_brand',
      severity: 'high',
      reason: `Mentions "${restricted}", which the owner has configured as an off-limits brand.`,
    })
  }

  for (const { pattern, reason } of SUSPICIOUS_PHRASES) {
    if (pattern.test(haystack)) {
      signals.push({ key: `phrase:${pattern.source.slice(0, 24)}`, severity: 'medium', reason })
    }
  }

  // A branded item offered far below its usual retail price is the classic
  // counterfeit signature.
  if (
    brand &&
    !isOwnBrand &&
    input.unitCostMinor !== undefined &&
    input.typicalRetailMinor !== undefined &&
    input.typicalRetailMinor > 0
  ) {
    const ratio = input.unitCostMinor / input.typicalRetailMinor
    if (ratio < 0.2) {
      signals.push({
        key: 'implausible_price',
        severity: 'high',
        reason: `Offered at ${(ratio * 100).toFixed(0)}% of typical retail for a branded item. A genuine article rarely wholesales this far below retail.`,
      })
    }
  }

  if (input.category && HIGH_BRAND_DENSITY_CATEGORIES.includes(input.category)) {
    signals.push({
      key: 'brand_dense_category',
      severity: 'low',
      reason: `"${input.category}" is a category where patents, licences and trademarks are common, so design similarity deserves checking.`,
    })
  }

  if (input.imagesFromSupplier) {
    signals.push({
      key: 'supplier_images',
      // Low, not medium. Using supplier photography is a copyright question
      // about the listing assets, not about whether the product may be sold,
      // and it is fixed by commissioning photographs rather than by a legal
      // review. Rating it higher would push every research candidate into a
      // compliance review and make the signal useless for telling products
      // apart.
      severity: 'low',
      reason: 'The only images available came from the supplier, so copyright ownership of the photographs is unclear. Commission original photography before listing.',
    })
  }

  if (input.supplierPlatform === 'aliexpress' && brand && !isOwnBrand) {
    signals.push({
      key: 'marketplace_branded',
      severity: 'high',
      reason: 'A branded item sourced from an open marketplace listing, where the chain of authenticity cannot be established.',
    })
  }

  // Level is driven by the worst signal, not by an average: one high-severity
  // finding is enough on its own.
  const hasHigh = signals.some((s) => s.severity === 'high')
  const mediumCount = signals.filter((s) => s.severity === 'medium').length
  const lowCount = signals.filter((s) => s.severity === 'low').length

  let level: IpRiskLevel
  if (hasHigh) level = 'high'
  else if (mediumCount >= 2) level = 'high'
  else if (mediumCount === 1) level = 'medium'
  // Several minor signals together are worth a look; one on its own is not.
  else if (lowCount >= 3) level = 'medium'
  else level = 'low'

  const summary =
    level === 'low'
      ? 'No IP risk signals were detected by these checks. That is a statement about the checks, not a legal clearance.'
      : level === 'medium'
        ? 'Some IP risk signals were found. Review them before listing.'
        : 'Significant IP risk signals were found. This product must not be listed until a person has reviewed it.'

  return {
    level,
    signals,
    reasons: signals.map((s) => s.reason),
    // Anything above low needs a person. Automation never clears IP risk.
    requiresHumanReview: level !== 'low',
    summary,
    assessedAt: now.toISOString(),
  }
}
