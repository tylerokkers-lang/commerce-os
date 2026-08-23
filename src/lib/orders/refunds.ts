import { subtract, type Money } from '@/lib/core/money'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * Refund planning (Milestone 5).
 *
 * A refund is money leaving the business, and it is append-only at the
 * database level (`refunds` has no update path — corrections are further
 * refund rows, never edits, per Milestone 1's principle). This module is the
 * validation and automation-policy layer in front of that: it decides
 * whether a requested refund amount is even possible given what has already
 * been refunded, and whether it may proceed automatically.
 */

export type AutomationLevel = Enums<'automation_level'>

export interface RefundRequest {
  orderId: string
  orderTotal: Money
  alreadyRefunded: Money
  requestedAmount: Money
  reason: Enums<'refund_reason'>
}

export type RefundOutcome = 'blocked' | 'pending_approval' | 'approve_automatically'

export interface RefundDecision {
  outcome: RefundOutcome
  reason: string
  remainingRefundable: Money
  isFullRefund: boolean
  requiresOwnerApproval: boolean
}

/**
 * Assesses a refund request against the order's remaining refundable balance
 * and the configured automatic refund limit.
 *
 * `maxAutoRefundMinor` mirrors `max_auto_purchase_minor` deliberately: money
 * leaving the business automatically needs its own explicit ceiling, just as
 * money committed to a supplier does (`docs/PRINCIPLES.md` §5).
 */
export function planRefund(
  request: RefundRequest,
  maxAutoRefundMinor: number,
  automationLevel: AutomationLevel,
): RefundDecision {
  const remainingRefundable = subtract(request.orderTotal, request.alreadyRefunded)

  if (request.requestedAmount.minor <= 0) {
    return {
      outcome: 'blocked',
      reason: 'Refund amount must be greater than zero.',
      remainingRefundable,
      isFullRefund: false,
      requiresOwnerApproval: true,
    }
  }

  if (request.requestedAmount.minor > remainingRefundable.minor) {
    return {
      outcome: 'blocked',
      reason: `Order ${request.orderId}: requested refund exceeds the remaining refundable balance (${remainingRefundable.minor} minor units).`,
      remainingRefundable,
      isFullRefund: false,
      requiresOwnerApproval: true,
    }
  }

  const isFullRefund = request.requestedAmount.minor === request.orderTotal.minor

  // Manual and assisted always ask, matching the same default posture as
  // every other financially consequential action in this system.
  if (automationLevel === 'manual' || automationLevel === 'assisted') {
    return {
      outcome: 'pending_approval',
      reason: `Automation level "${automationLevel}" requires approval before any refund is issued.`,
      remainingRefundable,
      isFullRefund,
      requiresOwnerApproval: true,
    }
  }

  if (request.requestedAmount.minor > maxAutoRefundMinor) {
    return {
      outcome: 'pending_approval',
      reason: `Refund of ${request.requestedAmount.minor} minor units exceeds the automatic refund limit of ${maxAutoRefundMinor}.`,
      remainingRefundable,
      isFullRefund,
      requiresOwnerApproval: true,
    }
  }

  return {
    outcome: 'approve_automatically',
    reason: `Within the automatic refund limit at automation level "${automationLevel}".`,
    remainingRefundable,
    isFullRefund,
    requiresOwnerApproval: false,
  }
}
