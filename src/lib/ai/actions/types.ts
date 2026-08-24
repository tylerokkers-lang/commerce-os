import type { ChannelKey } from '@/lib/core/domain'

/**
 * Milestone 13 — Analyse, Recommend, Propose.
 *
 * The AI proposal is untrusted input (brief's own words). This codebase's
 * answer to that is structural, not just a validation pass: nothing in
 * this directory ever accepts an action type, entity id, price, or
 * approval status from anything the model (or the offline fallback)
 * writes as prose. `intentExtraction.ts` reads only the user's own typed
 * message — never the model's reply — and matches it against real,
 * already-known entities from the current turn's `FactBundle`; anything
 * it cannot match with confidence produces no proposal at all, not a
 * best-guess one. `validate.ts` then re-derives every number (current
 * price, cost, margin) from live Commerce-OS data itself, never from the
 * chat. The result is that a `ProposedAction` a user sees on screen is
 *100% code-computed from real data — the "AI" contributed nothing to it
 * beyond the free-text explanation alongside it (`ChatAnswer.content`,
 * unchanged from Milestone 12), which carries no authority of its own.
 */

/**
 * The finite, closed vocabulary. Two are backed by a real deterministic
 * domain engine and a real path into the existing approval system —
 * `UPDATE_PRICE` (`profitability/channels.ts` + `automation/priceAutomation.ts`'s
 * policy check) and `REQUEST_APPROVAL` (a pure escalation — the same
 * `request_approval` automation action type Milestone 9's expansion engine
 * already uses for "flag this for the owner, nothing to execute"). The
 * rest are recognised — so a real user intent is never silently dropped —
 * but this milestone does not yet assemble the full input a genuine
 * domain engine for them would need (lifecycle stage, resolved supplier
 * capability, a full `ComplianceAssessment`, an inventory-threshold
 * config path); they are always `executable: false`, routed to the real
 * page as a review pointer instead of a fake approval.
 */
export type ProposedActionType =
  | 'UPDATE_PRICE'
  | 'CREATE_LISTING'
  | 'PAUSE_LISTING'
  | 'REVIEW_SUPPLIER'
  | 'REVIEW_PRODUCT'
  | 'ADJUST_INVENTORY_THRESHOLD'
  | 'REVIEW_ADVERTISING'
  | 'REQUEST_APPROVAL'

export const PROPOSED_ACTION_TYPES: readonly ProposedActionType[] = [
  'UPDATE_PRICE', 'CREATE_LISTING', 'PAUSE_LISTING', 'REVIEW_SUPPLIER',
  'REVIEW_PRODUCT', 'ADJUST_INVENTORY_THRESHOLD', 'REVIEW_ADVERTISING', 'REQUEST_APPROVAL',
]

/** The only two types this milestone can actually route into the real approval system. See the module comment above for why the rest cannot yet. */
export const EXECUTABLE_ACTION_TYPES: readonly ProposedActionType[] = ['UPDATE_PRICE', 'REQUEST_APPROVAL']

export type FactCategory = 'fact' | 'calculated' | 'ai_interpretation' | 'recommendation' | 'assumption'

export interface LabelledFact {
  category: FactCategory
  label: string
  value: string
}

export type ComplianceStatusLabel = 'pass' | 'blocked' | 'review_required' | 'unknown'

/**
 * Phase 2 — a structured recommendation. Always deterministic: built by
 * `recommend.ts` directly from a `FactBundle`, never parsed out of model
 * output.
 */
export interface Recommendation {
  id: string
  type: ProposedActionType
  title: string
  explanation: string
  supportingFacts: readonly LabelledFact[]
  targetEntityType: 'product' | 'supplier' | 'channel' | null
  targetEntityId: string | null
  targetLabel: string | null
  channel: ChannelKey | null
  expectedBenefit: string
  risk: string
  confidence: 'low' | 'medium' | 'high'
  complianceStatus: ComplianceStatusLabel
  currencyContext: string | null
  assumptions: readonly string[]
  requiresApproval: boolean
  /** Whether this type currently has a real execution/approval path at all — see the module comment. */
  executable: boolean
  suggestedNextStep: string
  /** A real, existing route — never fabricated. */
  href: string | null
}

/** The user's own message, deterministically parsed — never the model's. Nothing here is trusted; `validate.ts` re-resolves every field against real data. */
export interface RawActionIntent {
  actionType: ProposedActionType
  matchedProductId: string
  matchedProductTitle: string
  channel: ChannelKey | null
  /** A percentage explicitly stated in the user's own message (e.g. "by 10%"), or null. */
  requestedPricePct: number | null
  /** An explicit target price in minor units stated in the user's own message, or null. */
  requestedPriceMinor: number | null
}

export type ProposalOutcome = 'blocked' | 'requires_approval' | 'not_executable' | 'invalid'

/**
 * Phase 3 — a proposed action, fully resolved and validated against real
 * Commerce-OS data. `outcome` is never `'auto_approved'` — no code path in
 * this module can produce one; every executable proposal that clears
 * validation still lands on `'requires_approval'`, because
 * `validate.ts` always evaluates AI-originated price changes at the
 * `assisted` automation level regardless of the org's real configured
 * level (see that module's comment).
 */
export interface ProposedAction {
  id: string
  actionType: ProposedActionType
  targetEntityType: 'product' | 'supplier' | 'channel'
  targetEntityId: string
  targetLabel: string
  channel: ChannelKey | null
  currentState: readonly LabelledFact[]
  proposedState: readonly LabelledFact[]
  reason: string
  supportingFacts: readonly LabelledFact[]
  risk: string
  complianceStatus: ComplianceStatusLabel
  confidence: 'low' | 'medium' | 'high'
  outcome: ProposalOutcome
  policyReasons: readonly string[]
  requiresApproval: boolean
  executable: boolean
  /** Present only once `proposeApproval()` has actually been called (a real `ai_decisions` row exists). */
  approvalId: string | null
}
