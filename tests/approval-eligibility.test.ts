import { describe, expect, it } from 'vitest'
import { evaluateApprovalEligibility } from '@/lib/automation/approvalEligibility'

/**
 * Phase 4/6 — the approval lifecycle guard `approveDecision` evaluates
 * before ever dispatching an execution attempt, split into its own pure
 * module (`approvalEligibility.ts`) specifically so this is directly
 * testable without a database. "Approved = successfully executed" is
 * never true; this only proves the earlier, narrower claim: which
 * `decision_status` values are even eligible to start that journey.
 */

const NOW = new Date('2026-08-25T12:00:00.000Z')

describe('evaluateApprovalEligibility: only a genuinely pending decision may proceed', () => {
  it('awaiting_approval, not expired -> eligible', () => {
    expect(evaluateApprovalEligibility('awaiting_approval', '2026-08-26T00:00:00.000Z', NOW)).toEqual({ eligible: true })
  })

  it('awaiting_approval with no expiry set -> eligible', () => {
    expect(evaluateApprovalEligibility('awaiting_approval', null, NOW)).toEqual({ eligible: true })
  })

  it.each(['recommended', 'approved', 'rejected', 'executed', 'failed', 'expired', 'superseded'])(
    '%s is never re-approvable, regardless of expiry',
    (status) => {
      const result = evaluateApprovalEligibility(status, null, NOW)
      expect(result.eligible).toBe(false)
    },
  )

  it('an already-approved decision is blocked, never silently re-approved — this is the double-click/two-tab guard', () => {
    const result = evaluateApprovalEligibility('approved', null, NOW)
    expect(result).toEqual({ eligible: false, reason: 'Decision is "approved", not awaiting approval.', expire: false })
  })

  it('an already-executed decision is blocked, never re-executed', () => {
    const result = evaluateApprovalEligibility('executed', null, NOW)
    expect(result.eligible).toBe(false)
    if (!result.eligible) expect(result.expire).toBe(false)
  })

  it('a rejected decision is blocked — rejection is final, never overridable by a later approval attempt', () => {
    const result = evaluateApprovalEligibility('rejected', null, NOW)
    expect(result.eligible).toBe(false)
  })

  it('awaiting_approval but past its expiry -> not eligible, and flagged so the caller expires it', () => {
    const result = evaluateApprovalEligibility('awaiting_approval', '2026-08-24T00:00:00.000Z', NOW)
    expect(result).toEqual({ eligible: false, reason: 'This approval request has expired.', expire: true })
  })

  it('an expiry exactly at "now" is not yet expired — only strictly in the past blocks it', () => {
    const result = evaluateApprovalEligibility('awaiting_approval', NOW.toISOString(), NOW)
    expect(result.eligible).toBe(true)
  })

  it('a decision already in the "expired" state is blocked on status alone, and never asks the caller to expire it again', () => {
    const result = evaluateApprovalEligibility('expired', '2026-08-24T00:00:00.000Z', NOW)
    expect(result).toEqual({ eligible: false, reason: 'Decision is "expired", not awaiting approval.', expire: false })
  })
})
