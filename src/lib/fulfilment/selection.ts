import { rankSuppliers, type RankedSupplier, type SupplierSignals } from '@/lib/suppliers/scoring'

/**
 * Fulfilment supplier selection (Milestone 5).
 *
 * A thin adapter over `suppliers/scoring.ts`'s `rankSuppliers` — the same
 * ranking engine research candidates use in Milestone 2, applied here to
 * choosing who fulfils one specific order rather than who should supply a
 * new product. Never re-implements the ranking; only decides which
 * candidates to rank and reports the result in fulfilment-specific terms.
 */

export interface FulfilmentSupplierCandidate {
  id: string
  name: string
  signals: SupplierSignals
  /** True only for a supplier the channel listing was actually approved against. */
  isApprovedForListing: boolean
}

export interface FulfilmentSupplierChoice {
  chosen: FulfilmentSupplierCandidate | null
  ranked: readonly RankedSupplier<FulfilmentSupplierCandidate>[]
  /** True when the chosen supplier is the one the listing was approved against. */
  matchesApprovedSupplier: boolean
  rationale: string
}

/**
 * Chooses a supplier to fulfil an order, preferring the approved supplier
 * when it is genuinely available among the candidates, and falling back to
 * the best-ranked alternative — the exact scenario the redundancy evaluator
 * (`suppliers/redundancy.ts`) exists to formalise — when it is not.
 */
export function chooseFulfilmentSupplier(
  candidates: readonly FulfilmentSupplierCandidate[],
): FulfilmentSupplierChoice {
  if (candidates.length === 0) {
    return {
      chosen: null,
      ranked: [],
      matchesApprovedSupplier: false,
      rationale: 'No supplier is available to fulfil this order.',
    }
  }

  const ranked = rankSuppliers(candidates.map((candidate) => ({ supplier: candidate, signals: candidate.signals })))
  const approved = candidates.find((c) => c.isApprovedForListing)
  const approvedIsBestRanked = approved && ranked[0].supplier.id === approved.id

  if (approved && approvedIsBestRanked) {
    return {
      chosen: approved,
      ranked,
      matchesApprovedSupplier: true,
      rationale: `${approved.name} is both the listing's approved supplier and the best-ranked candidate (${ranked[0].score.total}/100).`,
    }
  }

  if (approved) {
    // The approved supplier exists but is no longer the best choice — still
    // used for fulfilment (compliance was assessed against it specifically),
    // but the gap is worth surfacing rather than silently ranking around it.
    return {
      chosen: approved,
      ranked,
      matchesApprovedSupplier: true,
      rationale: `${approved.name} remains the listing's approved supplier, though ${ranked[0].supplier.name} now scores higher (${ranked[0].score.total} vs ${ranked.find((r) => r.supplier.id === approved.id)?.score.total ?? '?'}). Switching would require a compliance re-check.`,
    }
  }

  return {
    chosen: ranked[0].supplier,
    ranked,
    matchesApprovedSupplier: false,
    rationale: `No approved supplier is available for this order; ${ranked[0].supplier.name} was chosen as the best-ranked alternative (${ranked[0].score.total}/100). This requires a compliance re-check before fulfilment proceeds.`,
  }
}
