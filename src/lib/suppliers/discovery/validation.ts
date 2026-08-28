/**
 * Pure candidate-capture validation, kept separate from `ingestion.ts`
 * (which imports `server-only` and therefore cannot be imported directly
 * into Vitest) — the same "pure logic in one file, server-only
 * orchestration in a sibling file" split this codebase already uses
 * throughout (`products/decision.ts` vs `decisionExecutor.ts`,
 * `products/channelDecision.ts` vs `channelDecisionExecutor.ts`).
 */

export interface CandidateValidationInput {
  candidateTitle: string
  currency: string
  unitCostMinor: number | null
  shippingCostMinor: number | null
  deliveryDaysMin: number | null
  deliveryDaysMax: number | null
}

/** Returns the first validation error, or null when the input is acceptable. Never throws — a malformed capture attempt is an ordinary, explainable outcome. */
export function validateCandidateInput(input: CandidateValidationInput): string | null {
  if (!input.candidateTitle.trim()) return 'A product title is required.'
  if (!/^[A-Z]{3}$/i.test(input.currency)) return `"${input.currency}" is not a valid 3-letter currency code.`
  if (input.unitCostMinor !== null && input.unitCostMinor < 0) return 'Supplier cost cannot be negative.'
  if (input.shippingCostMinor !== null && input.shippingCostMinor < 0) return 'Shipping cost cannot be negative.'
  if (input.deliveryDaysMin !== null && input.deliveryDaysMax !== null && input.deliveryDaysMin > input.deliveryDaysMax) {
    return 'Minimum delivery days cannot exceed maximum delivery days.'
  }
  return null
}

/**
 * A generated SKU for an imported candidate — candidates never carry a
 * SKU themselves (a raw supplier listing has a *supplier* SKU, not one of
 * ours), so one is derived deterministically at import time. Prefixed
 * `CAND-` so an imported-from-discovery product is always identifiable
 * from its SKU alone, in the audit trail or anywhere else.
 */
export function generateCandidateSku(candidateId: string, supplierSku: string | null): string {
  const suffix = candidateId.replace(/-/g, '').slice(0, 8).toUpperCase()
  return supplierSku
    ? `CAND-${supplierSku.replace(/[^A-Z0-9]/gi, '').slice(0, 12).toUpperCase()}-${suffix.slice(0, 4)}`
    : `CAND-${suffix}`
}
