/**
 * The approval execution dispatcher's routing table (Milestone 16).
 *
 * Pure and side-effect-free on purpose, so "does this decision type route
 * to the right domain" is directly unit-testable without a database — the
 * actual domain handlers (`priceExecution.ts`'s `submitPriceChangeAction`,
 * `advertisingExecution.ts`'s `submitCampaignAction`) are wired in by
 * `approvalWorkflow.ts`, which is where the server-only, connector-touching
 * work happens.
 *
 * Three concerns, kept deliberately distinct rather than folded into one
 * boolean:
 *   - `domain`: which subsystem, if any, owns this decision type.
 *   - `requiresExecution`: does approving this decision mean something
 *     external must still happen (`false` for a pure escalation like
 *     `request_approval`/`review_campaign` — raising it for the owner's
 *     attention *is* the entire action; there is nothing left to execute,
 *     and reporting "no live executor configured" for one of these would
 *     be actively misleading, not merely incomplete).
 *   - a decision type that is `requiresExecution: true` with `domain:
 *     'unknown'` has no registered handler at all — reported as a
 *     distinct, honest failure ("no handler registered"), never silently
 *     treated as either success or a pure escalation.
 */

export type ExecutionDomain = 'pricing' | 'advertising' | 'escalation' | 'unknown'

export interface DecisionClassification {
  domain: ExecutionDomain
  requiresExecution: boolean
}

const PRICING_DECISION_TYPES = new Set(['update_price'])
const ADVERTISING_DECISION_TYPES = new Set(['pause_campaign', 'increase_ad_budget', 'decrease_ad_budget'])
/** Pure escalations across every domain this codebase has — nothing external ever executes for these; approval itself is the terminal state. */
const ESCALATION_DECISION_TYPES = new Set(['request_approval', 'review_campaign'])

export function classifyDecisionType(decisionType: string): DecisionClassification {
  if (PRICING_DECISION_TYPES.has(decisionType)) return { domain: 'pricing', requiresExecution: true }
  if (ADVERTISING_DECISION_TYPES.has(decisionType)) return { domain: 'advertising', requiresExecution: true }
  if (ESCALATION_DECISION_TYPES.has(decisionType)) return { domain: 'escalation', requiresExecution: false }
  return { domain: 'unknown', requiresExecution: true }
}

/**
 * The structured outcome every domain execution handler returns — the
 * shape `approvalWorkflow.ts` maps onto `ai_decisions.status` and
 * `automation_actions`, regardless of which domain produced it.
 */
export type DecisionExecutionOutcome =
  | { kind: 'no_execution_needed' }
  | { kind: 'executed'; automationActionId: string; succeeded: boolean; error: string | null }
  | { kind: 'revalidation_blocked'; automationActionId: string; reason: string }
  | { kind: 'no_handler'; reason: string }
  | { kind: 'already_in_progress'; automationActionId: string }
