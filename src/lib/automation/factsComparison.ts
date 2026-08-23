/**
 * Compares the facts a decision was proposed on against the current ones for
 * the same keys (brief §18: "if the underlying facts materially change
 * before execution, invalidate the approval"). Kept in its own file, with no
 * `server-only` import, so it is unit-testable without a database —
 * `approvalWorkflow.ts` (which does need `server-only`) imports this rather
 * than defining it inline.
 *
 * Any key present in both that now disagrees invalidates the approval — this
 * is deliberately strict: a decision proposed against stock of 12 must not
 * execute once stock reads 3, even if 3 still happens to be "enough" by some
 * other measure, because the reasoning the owner approved was specifically
 * about 12.
 */
export function factsHaveMaterializedChanged(
  proposedFacts: Record<string, unknown>,
  currentFacts: Record<string, unknown>,
): boolean {
  return Object.keys(proposedFacts).some((key) => {
    if (!(key in currentFacts)) return false
    return JSON.stringify(proposedFacts[key]) !== JSON.stringify(currentFacts[key])
  })
}
