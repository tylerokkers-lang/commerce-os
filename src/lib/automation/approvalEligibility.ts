/**
 * The pure lifecycle guard `approveDecision` (`approvalWorkflow.ts`, which
 * is `server-only`) evaluates before it ever creates an execution attempt —
 * split out so the exact rule "which decision states may proceed to
 * execution dispatch" is directly unit-testable, the same reason
 * `advertising/monitorPlan.ts` and `advertising/verificationCheck.ts` are
 * their own files.
 *
 * `decision_status` (migration 0008) is the only source of truth this
 * checks against — `recommended`/`awaiting_approval` is the only state
 * eligible to be approved; everything else (`approved` itself, `rejected`,
 * `executed`, `failed`, `expired`, `superseded`) is already a terminal or
 * in-flight state and must be rejected here rather than re-processed,
 * which is what makes a double-click, a second browser tab, or a retried
 * request after a timeout all land on the same safe "not eligible" answer
 * rather than a second execution attempt.
 */

export type DecisionStatus = 'recommended' | 'awaiting_approval' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired' | 'superseded'

export type ApprovalEligibility =
  | { eligible: true }
  | { eligible: false; reason: string; expire: boolean }

export function evaluateApprovalEligibility(status: string, expiresAt: string | null, now: Date): ApprovalEligibility {
  if (status !== 'awaiting_approval') {
    return { eligible: false, reason: `Decision is "${status}", not awaiting approval.`, expire: false }
  }
  if (expiresAt && new Date(expiresAt) < now) {
    return { eligible: false, reason: 'This approval request has expired.', expire: true }
  }
  return { eligible: true }
}
