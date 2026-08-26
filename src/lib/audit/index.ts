import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * Audit logging (§45).
 *
 * Every consequential action - especially every automated one - lands here.
 * The table is append-only at the database level, so a bug or a compromised
 * session cannot rewrite history.
 *
 * Writes go through the service role because a member with `viewer` role must
 * still generate audit entries for the actions they are allowed to take, while
 * being unable to write to the table directly.
 */

/**
 * The closed set of auditable actions. A union rather than a free string so a
 * typo produces a compile error instead of an entry nobody ever finds again.
 */
export type AuditAction =
  // Catalogue
  | 'PRODUCT_ADDED' | 'PRODUCT_UPDATED' | 'PRODUCT_STAGE_CHANGED' | 'PRODUCT_REMOVED'
  | 'PRODUCT_SCORED' | 'PRODUCT_CONTENT_GENERATED'
  // Channels
  | 'LISTING_CREATED' | 'LISTING_STATUS_CHANGED' | 'LISTING_PAUSED' | 'LISTING_REMOVED'
  | 'LISTING_PUBLISHED' | 'LISTING_BLOCKED' | 'LISTING_WORKFLOW_TRANSITIONED'
  | 'PRICE_CHANGED'
  // Marketplace connectors and reconciliation
  | 'CHANNEL_SYNC_STARTED' | 'CHANNEL_SYNC_FINISHED' | 'CHANNEL_SYNC_FAILED'
  | 'DISCREPANCY_DETECTED' | 'DISCREPANCY_RESOLVED'
  | 'WEBHOOK_RECEIVED' | 'WEBHOOK_DUPLICATE_IGNORED' | 'WEBHOOK_PROCESSING_FAILED'
  // Inventory
  | 'INVENTORY_CHANGED' | 'INVENTORY_SYNCED' | 'REORDER_RAISED'
  // Suppliers
  | 'SUPPLIER_ADDED' | 'SUPPLIER_UPDATED' | 'SUPPLIER_STATUS_CHANGED'
  | 'SUPPLIER_ORDER_CREATED' | 'SUPPLIER_ORDER_PLACED'
  // Orders
  | 'ORDER_CREATED' | 'ORDER_UPDATED' | 'ORDER_FULFILLED' | 'ORDER_CANCELLED'
  | 'ORDER_INGESTION_REJECTED' | 'ORDER_STATUS_CHANGE_BLOCKED'
  | 'FULFILMENT_SUBMITTED' | 'FULFILMENT_FAILED' | 'SHIPMENT_TRACKED'
  // Finance
  | 'INVOICE_CREATED' | 'INVOICE_SENT' | 'INVOICE_SEND_FAILED' | 'INVOICE_VOIDED'
  | 'CREDIT_NOTE_CREATED' | 'REFUND_CREATED' | 'EXPENSE_RECORDED'
  | 'VAT_UPDATED' | 'VAT_PERIOD_CLOSED' | 'ACCOUNTING_SYNCED' | 'ACCOUNTING_SYNC_FAILED'
  // Compliance
  | 'COMPLIANCE_ASSESSED' | 'COMPLIANCE_BLOCKED' | 'COMPLIANCE_APPROVED'
  | 'COMPLIANCE_REVIEW_REQUIRED'
  // Advertising
  | 'ADVERTISING_CHANGED' | 'ADVERTISING_PAUSED'
  | 'ADVERTISING_SYNC_STARTED' | 'ADVERTISING_SYNC_FINISHED' | 'ADVERTISING_SYNC_FAILED'
  | 'ADVERTISING_DRY_RUN_EXECUTED' | 'ADVERTISING_PROVIDER_VERIFIED' | 'ADVERTISING_WRITE_VERIFICATION_RUN'
  | 'ADVERTISING_EXECUTION_BLOCKED_CAPABILITY'
  // Automation and governance
  | 'AI_DECISION_CREATED' | 'AI_DECISION_APPROVED' | 'AI_DECISION_REJECTED'
  | 'AI_DECISION_EXECUTED' | 'AUTOMATION_RUN_STARTED' | 'AUTOMATION_RUN_FINISHED'
  | 'APPROVAL_REQUESTED' | 'APPROVAL_GRANTED' | 'APPROVAL_REJECTED' | 'APPROVAL_INVALIDATED' | 'APPROVAL_EXPIRED'
  | 'SPENDING_LIMIT_BLOCKED' | 'AUTOMATION_ACTION_CREATED' | 'AUTOMATION_ACTION_EXECUTED'
  | 'AUTOMATION_ACTION_BLOCKED' | 'AUTOMATION_ACTION_FAILED' | 'AUTOMATION_ACTION_ALREADY_IN_PROGRESS'
  | 'AUTOMATION_PAUSED' | 'AUTOMATION_RESUMED'
  | 'AUTOMATION_JOB_ENQUEUED' | 'AUTOMATION_JOB_DEAD_LETTERED' | 'AUTOMATION_JOB_CANCELLED'
  | 'CHANNEL_PRODUCT_RECONCILED' | 'EXTERNAL_WRITE_SUBMITTED' | 'EXTERNAL_WRITE_VERIFIED' | 'EXTERNAL_WRITE_UNCERTAIN'
  | 'EXECUTION_RECOVERY_ATTEMPTED' | 'EXECUTION_RESULT_UNKNOWN'
  // Configuration and access
  | 'SETTINGS_UPDATED' | 'AUTOMATION_LEVEL_CHANGED' | 'INTEGRATION_CONNECTED'
  | 'INTEGRATION_DISCONNECTED' | 'MEMBER_ADDED' | 'MEMBER_ROLE_CHANGED'
  | 'USER_SIGNED_IN' | 'DEMO_DATA_SEEDED' | 'DEMO_DATA_CLEARED'

export interface AuditEntry {
  orgId: string
  action: AuditAction
  entityType: string
  entityId?: string | null
  actorType: Enums<'actor_type'>
  actorUserId?: string | null
  actorLabel?: string | null
  previousValue?: unknown
  newValue?: unknown
  reason?: string | null
  ruleKey?: string | null
  aiDecisionId?: string | null
  result?: 'success' | 'failure' | 'blocked'
  error?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Records an audit entry.
 *
 * Deliberately never throws. An audit write failing must not roll back the
 * business action that succeeded, and must not be swallowed silently either,
 * so failures are surfaced on stderr for the observability layer to pick up.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    const supabase = createServiceSupabase()
    const { error } = await supabase.from('audit_logs').insert({
      org_id: entry.orgId,
      actor_type: entry.actorType,
      actor_user_id: entry.actorUserId ?? null,
      actor_label: entry.actorLabel ?? null,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      previous_value: (entry.previousValue ?? null) as never,
      new_value: (entry.newValue ?? null) as never,
      reason: entry.reason ?? null,
      rule_key: entry.ruleKey ?? null,
      ai_decision_id: entry.aiDecisionId ?? null,
      result: entry.result ?? 'success',
      error: entry.error ?? null,
      metadata: (entry.metadata ?? {}) as never,
    })
    if (error) {
      console.error('[audit] write failed', { action: entry.action, error: error.message })
    }
  } catch (error) {
    console.error('[audit] write threw', { action: entry.action, error })
  }
}

/**
 * Wraps an operation so that both success and failure are audited, and the
 * original error still propagates. Use for anything that changes money, stock,
 * listings or configuration.
 */
export async function withAudit<T>(
  entry: Omit<AuditEntry, 'result' | 'error'>,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const value = await operation()
    await recordAudit({ ...entry, result: 'success' })
    return value
  } catch (error) {
    await recordAudit({
      ...entry,
      result: 'failure',
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
