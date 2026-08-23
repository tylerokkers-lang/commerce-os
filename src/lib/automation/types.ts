import type { Enums } from '@/lib/supabase/database.types'

/**
 * Shared vocabulary for the automation engine (Milestone 6).
 *
 * `docs/PRINCIPLES.md` §5 already defines the four automation levels; this
 * file is everything *new* Milestone 6 needs on top of that, kept in one
 * place so no module invents its own shape for "what category of action is
 * this" or "how risky is it."
 */

export type AutomationLevel = Enums<'automation_level'>
export type AutomationActionType = Enums<'automation_action_type'>
export type AutomationActionStatus = Enums<'automation_action_status'>
export type AutomationRiskLevel = Enums<'automation_risk_level'>
export type AutomationJobStatus = Enums<'automation_job_status'>

/** One of the six pausable categories from the brief's §14. */
export type AutomationCategory =
  | 'publishing'
  | 'pricing'
  | 'supplier_switching'
  | 'supplier_ordering'
  | 'refunds'
  | 'fulfilment'

export const AUTOMATION_CATEGORIES: readonly AutomationCategory[] = [
  'publishing', 'pricing', 'supplier_switching', 'supplier_ordering', 'refunds', 'fulfilment',
]

/** Which category an action type belongs to, for kill-switch enforcement. */
export const ACTION_CATEGORY: Record<AutomationActionType, AutomationCategory | null> = {
  update_inventory: null,
  update_price: 'pricing',
  pause_product: 'publishing',
  resume_product: 'publishing',
  publish_product: 'publishing',
  unpublish_product: 'publishing',
  switch_supplier: 'supplier_switching',
  submit_supplier_order: 'supplier_ordering',
  update_fulfilment: 'fulfilment',
  update_tracking: 'fulfilment',
  process_refund: 'refunds',
  cancel_order: 'fulfilment',
  request_approval: null,
  reconcile_marketplace: null,
  reconcile_supplier: null,
  alert_owner: null,
}

/**
 * The event model (brief §6). Events are not persisted as their own table —
 * they are the typed input every automation workflow function takes, and
 * every event that leads to a decision is already recorded by the
 * `automation_actions` row (or `ai_decisions` row) that decision produces.
 * A separate, unqueried "event log" table would be exactly the kind of
 * unused structure `docs/PRINCIPLES.md` warns against building ahead of need.
 */
export type AutomationEventType =
  | 'PRODUCT_DISCOVERED' | 'PRODUCT_PROFITABILITY_CHANGED' | 'PRODUCT_COMPLIANCE_CHANGED'
  | 'SUPPLIER_OUT_OF_STOCK' | 'SUPPLIER_PRICE_CHANGED' | 'SUPPLIER_DELIVERY_CHANGED' | 'SUPPLIER_DEGRADED'
  | 'MARKETPLACE_PRICE_CHANGED' | 'MARKETPLACE_STOCK_CHANGED' | 'MARKETPLACE_LISTING_CHANGED'
  | 'ORDER_RECEIVED' | 'ORDER_PAYMENT_CONFIRMED' | 'ORDER_FULFILMENT_FAILED'
  | 'TRACKING_MISSING' | 'DELIVERY_DELAYED' | 'REFUND_REQUESTED'
  | 'MARKETPLACE_DISCONNECTED' | 'RECONCILIATION_FAILED'

export interface AutomationEvent<T = Record<string, unknown>> {
  type: AutomationEventType
  entityType: string
  entityId: string
  occurredAt: string
  facts: T
}

/**
 * One requirement the policy engine checked, in the same
 * key/label/satisfied/detail shape every gate in this codebase already uses
 * (`publicationGate.ts`, `fulfilment/submission.ts`) — never a bare boolean.
 */
export interface PolicyRequirement {
  key: string
  label: string
  satisfied: boolean
  detail: string
}

export type PolicyOutcome = 'allow_automatic' | 'require_approval' | 'block'

export interface PolicyResult {
  outcome: PolicyOutcome
  requirements: readonly PolicyRequirement[]
  reason: string
  riskLevel: AutomationRiskLevel
}

/** A safe, named failure state — never "unknown becomes approved" (brief §22). */
export type SafeFailureState = 'blocked' | 'requires_approval' | 'retry_pending' | 'failed' | 'stale_facts'
