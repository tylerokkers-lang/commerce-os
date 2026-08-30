/**
 * Product-match assessment (Milestone: product media intelligence,
 * Phase 7).
 *
 * Deterministic, text-based evidence only — never a guess, and never a
 * claim of certainty this codebase cannot back up. The strongest
 * available signal is "this media and this product's identifying facts
 * were captured together, in the same action" (`capturedTogether`) —
 * when a supplier candidate is captured with both a SKU/title and an
 * image URL in one form submission, the person doing the capturing is
 * the evidence that the two belong together. Absent that, this falls
 * back to a weak textual-overlap check (does the URL contain the SKU or
 * a normalised title keyword?), which can raise confidence but can never
 * establish a match with certainty — a mismatch is only ever asserted
 * when there is a genuine, explicit conflict, never inferred from a lack
 * of a match signal.
 */

export type ProductMatchStatus = 'matched' | 'mismatched' | 'uncertain'

export interface ProductMatchAssessment {
  status: ProductMatchStatus
  detail: string
}

export interface ProductMatchInput {
  /** True when this media was captured as part of the same action that recorded the product's own identifying facts (e.g. Phase 5's candidate capture form). */
  capturedTogether: boolean
  productTitle: string
  supplierSku: string | null
  mediaUrl: string
  sourceUrl: string | null
  /** Set only when the caller has an explicit, independent supplier SKU claim to check the media against (e.g. a later manual attach naming a different supplier than the one actually assigned). A genuine conflict, not merely "no match found", is what earns `mismatched`. */
  conflictingSupplierSku: string | null
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function titleKeywords(title: string): readonly string[] {
  return title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4) // Skip short, low-signal words ("the", "for", "set").
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
}

export function assessProductMatch(input: ProductMatchInput): ProductMatchAssessment {
  if (input.conflictingSupplierSku && input.supplierSku && normalise(input.conflictingSupplierSku) !== normalise(input.supplierSku)) {
    return {
      status: 'mismatched',
      detail: `The media's own supplier SKU ("${input.conflictingSupplierSku}") does not match this product's assigned supplier SKU ("${input.supplierSku}").`,
    }
  }

  if (input.capturedTogether) {
    return {
      status: 'matched',
      detail: 'Captured together with this product\'s own identifying facts in the same action.',
    }
  }

  const haystack = normalise(`${input.mediaUrl} ${input.sourceUrl ?? ''}`)

  if (input.supplierSku && haystack.includes(normalise(input.supplierSku))) {
    return { status: 'matched', detail: `The media or source URL contains this product's supplier SKU ("${input.supplierSku}").` }
  }

  const keywords = titleKeywords(input.productTitle)
  const matchedKeyword = keywords.find((k) => haystack.includes(k))
  if (matchedKeyword) {
    return { status: 'matched', detail: `The media or source URL contains a keyword from the product title ("${matchedKeyword}").` }
  }

  return {
    status: 'uncertain',
    detail: 'No deterministic evidence (shared capture action, matching SKU, or matching title keyword) was found linking this media to this specific product.',
  }
}
