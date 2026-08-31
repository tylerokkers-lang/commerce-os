import type { PublicationDecision, PublicationRequirement } from '../publicationGate'
import type { MediaReadinessStatus } from '@/lib/products/media/mediaScore'
import type { ShippingSuitabilityStatus } from '@/lib/suppliers/shippingPolicy'

/**
 * Shopify publication eligibility (Milestone: controlled Shopify
 * publication, Phase 6).
 *
 * Deliberately a thin composition, not a second gate: `corePublication`
 * is `assessPublicationReadiness`'s own output (Milestone 4 — operator
 * decision, lifecycle, supplier, profitability, compliance, automation
 * permission), reused wholesale, never re-derived. This file adds only
 * the requirements that are specific to actually building and sending a
 * Shopify payload — content completeness (images, description, a
 * selected price, valid variants) — which the core gate was never asked
 * to check, since it applies to every channel, not just what a Shopify
 * listing specifically needs on the page.
 *
 * `ELIGIBLE`/`BLOCKED`, never a silent pass — every requirement carries
 * its own explanation, exactly the brief's own example output.
 */

export interface ShopifyEligibilityInputs {
  corePublication: PublicationDecision
  hasTitle: boolean
  hasDescription: boolean
  mediaReadiness: MediaReadinessStatus
  mediaReadinessReason: string
  /** Milestone: shipping-aware publication (Phase 9). From `shippingQuotes.ts`'s `getShippingSuitability` — a fresh, known, within-limit quote is `approved`; anything else (no quote yet, unknown estimate, stale, or too slow) blocks eligibility, never a silent pass. */
  shippingStatus: ShippingSuitabilityStatus
  shippingReason: string
  selectedPriceMinor: number | null
  variantsValid: boolean
  variantIssue: string | null
  isDuplicateCandidate: boolean
}

export interface ShopifyEligibilityResult {
  eligible: boolean
  requirements: readonly PublicationRequirement[]
  blockingReasons: readonly string[]
  warnings: readonly string[]
}

function req(key: string, label: string, satisfied: boolean, detail: string): PublicationRequirement {
  return { key, label, satisfied, detail }
}

export function assessShopifyEligibility(input: ShopifyEligibilityInputs): ShopifyEligibilityResult {
  const contentRequirements: PublicationRequirement[] = [
    req('title', 'Product title', input.hasTitle, input.hasTitle ? 'Title is set.' : 'No product title on file.'),
    req(
      'description',
      'Customer-facing description',
      input.hasDescription,
      input.hasDescription ? 'Description is set.' : 'No customer-facing description on file.',
    ),
    req('images', 'Product images', input.mediaReadiness === 'media_ready', input.mediaReadinessReason),
    req('shipping', 'Supplier shipping suitability', input.shippingStatus === 'approved', input.shippingReason),
    req(
      'selling_price',
      'Selling price selected',
      input.selectedPriceMinor !== null && input.selectedPriceMinor > 0,
      input.selectedPriceMinor !== null && input.selectedPriceMinor > 0
        ? `Selling price is set (${(input.selectedPriceMinor / 100).toFixed(2)}).`
        : 'No selling price has been selected yet.',
    ),
    req(
      'variants',
      'Valid variants',
      input.variantsValid,
      input.variantsValid ? 'Variant data is valid.' : (input.variantIssue ?? 'Variant data is incomplete or invalid.'),
    ),
    req(
      'not_duplicate',
      'Not a flagged duplicate',
      !input.isDuplicateCandidate,
      input.isDuplicateCandidate ? 'This product originated from a candidate still flagged as a possible duplicate.' : 'Not flagged as a duplicate.',
    ),
  ]

  const requirements = [...input.corePublication.requirements, ...contentRequirements]
  const failing = requirements.filter((r) => !r.satisfied)

  return {
    eligible: failing.length === 0,
    requirements,
    blockingReasons: failing.map((r) => r.detail),
    warnings: input.corePublication.outcome === 'pending_approval' ? ['Publication requires owner approval before going live.'] : [],
  }
}
