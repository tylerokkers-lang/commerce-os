/**
 * Execution recovery — the pure decision logic behind the reaper
 * (`automation/recovery.ts`, `server-only`), split out the same way
 * `advertising/monitorPlan.ts` and `advertising/verificationCheck.ts` are,
 * so the one genuinely safety-critical decision here — "what did we
 * actually learn from re-checking the provider" — is directly
 * unit-testable without a database or a live connector.
 *
 * The problem this exists for: an `automation_actions` row can be left
 * `status: 'executing'` forever if the process handling it crashes between
 * calling the provider's write and recording the outcome. At that point
 * Commerce-OS genuinely does not know whether the provider applied the
 * change — assuming either answer would be a guess, and guessing wrong in
 * either direction is dangerous (assuming success skips a real fix;
 * assuming failure and blindly retrying risks a duplicate real-world
 * write, e.g. a second price cut or a second budget change). The three
 * honest outcomes this function can reach:
 *
 *   'succeeded' — a fresh, read-only verify call confirms the provider's
 *     own state now matches the intended target. Safe to reconcile and
 *     mark succeeded, exactly as a normal SUBMIT -> VERIFY would have.
 *   'failed' — a fresh verify confirms the provider's state still matches
 *     the pre-change value, and the pre-change value is actually known
 *     (not every proposal path stores it — see `originalStateMatches`).
 *     Reasonably strong evidence the write never applied. Never triggers
 *     an automatic retry — only records the honest outcome; a human
 *     re-proposing the action goes back through the full pipeline again.
 *   'unknown' — the connector cannot verify at all, the verify call itself
 *     failed, or the provider's current state matches neither the
 *     original nor the intended value (some other, unaccounted-for
 *     change). This is the state that must never be silently upgraded to
 *     either of the above, and must never trigger a retry.
 */

export type RecoveryOutcome = 'succeeded' | 'failed' | 'unknown'

export interface RecoveryClassification {
  outcome: RecoveryOutcome
  reason: string
}

export interface RecoveryVerificationInput {
  /** Does this connector even support reading a write back? If not, nothing below can ever be checked. */
  connectorSupportsVerification: boolean
  /** Did the read-only verify call itself succeed (network/auth aside from the write in question)? */
  verifyCallSucceeded: boolean
  /** Does the provider's current, freshly-read state match the change this action was trying to make? Only meaningful when `verifyCallSucceeded`. */
  currentStateMatchesTarget: boolean
  /**
   * Does the provider's current state still match the value from *before*
   * this action ran? `null` when the original value was never captured on
   * this action's `input_facts` in the first place (e.g. the chat-driven
   * price path only ever stores the target price, not the price it was
   * changing from) — a genuinely unknown comparison, not a `false` one.
   */
  currentStateMatchesOriginal: boolean | null
}

export function classifyStuckExecution(input: RecoveryVerificationInput): RecoveryClassification {
  if (!input.connectorSupportsVerification) {
    return { outcome: 'unknown', reason: 'This connector does not support reading a write back — the provider\'s real state cannot be safely confirmed, so the outcome of this action is unknown.' }
  }
  if (!input.verifyCallSucceeded) {
    return { outcome: 'unknown', reason: 'The verification read itself failed — the provider\'s current state could not be confirmed.' }
  }
  if (input.currentStateMatchesTarget) {
    return { outcome: 'succeeded', reason: 'Verified: the provider\'s current state matches the intended change. Recovered and reconciled.' }
  }
  if (input.currentStateMatchesOriginal === true) {
    return { outcome: 'failed', reason: 'Verified: the provider\'s current state still matches the value from before this action — the write most likely never applied.' }
  }
  return { outcome: 'unknown', reason: 'Verified, but the provider\'s current state matches neither the original nor the intended value — cannot be safely classified without human review.' }
}

/**
 * Phase 3 — a stuck action is only ever a *candidate* for recovery once it
 * has been `executing` for longer than a genuinely generous threshold, so
 * an action that is merely slow (a real, still-in-flight provider call)
 * is never mistaken for one whose process crashed. 30 minutes is deliberately
 * far longer than any real connector call in this codebase ever takes.
 */
export const EXECUTION_RECOVERY_THRESHOLD_MINUTES = 30

export function isRecoveryCandidate(createdAtIso: string, nowIso: string, thresholdMinutes = EXECUTION_RECOVERY_THRESHOLD_MINUTES): boolean {
  const ageMinutes = (new Date(nowIso).getTime() - new Date(createdAtIso).getTime()) / 60_000
  return ageMinutes >= thresholdMinutes
}
