/**
 * Duplicate detection (Milestone: supplier discovery, Phase 5).
 *
 * A repeatedly-imported product is the single most common way a discovery
 * pipeline degrades into noise, so this is deliberately conservative: it
 * never silently merges two records it cannot be certain are the same
 * item. Every match is reported with a plain-English reason a person can
 * check, and a candidate flagged as a possible duplicate still requires a
 * human decision (import anyway, or reject) rather than being blocked
 * outright — the brief's own "POSSIBLE_DUPLICATE... show the reason"
 * requirement, not an automatic rejection.
 */

export interface CandidateIdentity {
  supplierId: string | null
  supplierSku: string | null
  sourceReference: string | null
  identifiers: readonly { idType: string; value: string }[]
}

export interface ExistingCandidate {
  id: string
  candidateTitle: string
  supplierId: string | null
  supplierSku: string | null
  sourceReference: string | null
}

export interface ExistingProductIdentifier {
  productId: string
  productTitle: string
  idType: string
  value: string
}

export type DuplicateMatch =
  | { kind: 'candidate_supplier_sku'; existingId: string; label: string }
  | { kind: 'candidate_source_reference'; existingId: string; label: string }
  | { kind: 'product_identifier'; existingId: string; idType: string; value: string; label: string }

export interface DuplicateCheckResult {
  isDuplicate: boolean
  matches: readonly DuplicateMatch[]
  /** The single, plain-English reason shown in the queue — the strongest match, when there's more than one. */
  reason: string | null
}

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Checks a candidate's identity against every existing candidate from the
 * same supplier and every product identifier already on file (a real
 * barcode/GTIN/EAN/UPC match is a strong signal even across suppliers —
 * two suppliers selling the same physical product is the normal case
 * "PRODUCT SOURCE HISTORY" exists for, not itself a duplicate of the
 * candidate; the duplicate here is against a candidate that has *not yet*
 * been imported, catching a second identical capture attempt).
 */
export function detectDuplicateCandidate(
  candidate: CandidateIdentity,
  existingCandidates: readonly ExistingCandidate[],
  existingProductIdentifiers: readonly ExistingProductIdentifier[],
): DuplicateCheckResult {
  const matches: DuplicateMatch[] = []

  if (candidate.supplierId) {
    for (const existing of existingCandidates) {
      if (existing.supplierId !== candidate.supplierId) continue

      if (candidate.supplierSku && existing.supplierSku && normalise(existing.supplierSku) === normalise(candidate.supplierSku)) {
        matches.push({
          kind: 'candidate_supplier_sku',
          existingId: existing.id,
          label: `Matches supplier SKU "${existing.supplierSku}" already captured as "${existing.candidateTitle}".`,
        })
      }

      if (candidate.sourceReference && existing.sourceReference && normalise(existing.sourceReference) === normalise(candidate.sourceReference)) {
        matches.push({
          kind: 'candidate_source_reference',
          existingId: existing.id,
          label: `Matches the source reference already captured as "${existing.candidateTitle}".`,
        })
      }
    }
  }

  for (const identifier of candidate.identifiers) {
    const match = existingProductIdentifiers.find(
      (p) => p.idType === identifier.idType && normalise(p.value) === normalise(identifier.value),
    )
    if (match) {
      matches.push({
        kind: 'product_identifier',
        existingId: match.productId,
        idType: identifier.idType,
        value: identifier.value,
        label: `${identifier.idType.toUpperCase()} ${identifier.value} already belongs to the existing product "${match.productTitle}".`,
      })
    }
  }

  return {
    isDuplicate: matches.length > 0,
    matches,
    reason: matches[0]?.label ?? null,
  }
}
