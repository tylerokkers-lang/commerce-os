import type { ProductDecision } from '@/lib/core/domain'

/**
 * The single source of truth for "which product decisions permit an
 * automated operational action" — imported by every gate that needs it
 * (`marketplaces/publicationGate.ts`, `automation/priceExecution.ts`) so the
 * answer is defined in exactly one place, never re-derived per call site.
 *
 * Only `add`/`test` ever permit progressing to the next gate in the chain
 * (channel eligibility -> compliance -> supplier -> profitability ->
 * budget/cashflow -> approval -> execution). Passing this check is never
 * sufficient on its own — it is the first gate, not a replacement for any
 * of the others.
 */
export const EXECUTION_PERMITTED_DECISIONS: ReadonlySet<ProductDecision> = new Set(['add', 'test'])

export const decisionPermitsExecution = (decision: ProductDecision): boolean => EXECUTION_PERMITTED_DECISIONS.has(decision)
export const decisionBlocksExecution = (decision: ProductDecision): boolean => !decisionPermitsExecution(decision)

export function decisionBlockReason(decision: ProductDecision): string {
  return `Product decision is "${decision}" — only "add" or "test" products may proceed to marketplace/pricing execution.`
}
