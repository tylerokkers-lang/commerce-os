import { err, ok, type Result } from '@/lib/core/result'
import type { ProductStage } from '@/lib/core/domain'

/**
 * The product lifecycle (§28).
 *
 * A product does not drift between states. Every move is an explicit,
 * permitted transition with a reason attached, recorded in
 * `product_stage_transitions`, which is append-only at the database level.
 *
 * The graph is deliberately restrictive. A candidate cannot jump from
 * `discovered` straight to `scaling`, because doing so would skip the supplier,
 * compliance and profitability gates that exist precisely to be unskippable.
 */

/** Which stages may follow which. Anything not listed here is refused. */
const ALLOWED: Record<ProductStage, readonly ProductStage[]> = {
  // Freshly surfaced by a research provider.
  discovered: ['researching', 'rejected'],

  // Signals gathered, scored, complaints analysed.
  researching: ['supplier_review', 'rejected', 'paused'],

  // A supplier has to be found and approved before compliance can be assessed,
  // because most Amazon compliance answers depend on what the supplier can do.
  supplier_review: ['compliance_review', 'researching', 'rejected', 'paused'],

  // The hard gate. Only a pass on at least one channel moves forward.
  compliance_review: ['approved', 'supplier_review', 'rejected', 'paused'],

  // Cleared every gate. Not yet listed.
  approved: ['testing', 'compliance_review', 'rejected', 'paused'],

  // Live on at least one channel, on a limited budget.
  testing: ['proven', 'declining', 'paused', 'rejected'],

  // Met the contribution and quality criteria over a sustained period.
  proven: ['scaling', 'mature', 'declining', 'paused'],

  scaling: ['mature', 'proven', 'declining', 'paused'],

  mature: ['scaling', 'declining', 'paused'],

  declining: ['paused', 'proven', 'removed'],

  // A pause is always reversible; it stops spend without destroying history.
  paused: ['testing', 'proven', 'compliance_review', 'removed', 'rejected'],

  // Terminal. A candidate that never traded.
  rejected: [],

  // Terminal. A product that traded and has been withdrawn.
  removed: [],
}

/** Stages from which nothing further follows. */
export const TERMINAL_STAGES: readonly ProductStage[] = ['rejected', 'removed']

/** Stages before a product has ever been listed on a channel. */
export const PRE_LAUNCH_STAGES: readonly ProductStage[] = [
  'discovered', 'researching', 'supplier_review', 'compliance_review', 'approved',
]

/** Stages in which a product is, or has been, trading. */
export const TRADING_STAGES: readonly ProductStage[] = [
  'testing', 'proven', 'scaling', 'mature', 'declining',
]

/**
 * Paused is its own classification, not a subset of the others.
 *
 * A product can be paused before it ever launched or after it traded for a
 * year, so it is neither pre-launch nor trading, and it is certainly not
 * terminal: the whole point of pausing is that it can be undone.
 */
export const isPaused = (stage: ProductStage): boolean => stage === 'paused'

export const isTerminal = (stage: ProductStage): boolean => TERMINAL_STAGES.includes(stage)
export const isPreLaunch = (stage: ProductStage): boolean => PRE_LAUNCH_STAGES.includes(stage)
export const isTrading = (stage: ProductStage): boolean => TRADING_STAGES.includes(stage)

export const nextStages = (from: ProductStage): readonly ProductStage[] => ALLOWED[from]

export interface TransitionRequest {
  from: ProductStage
  to: ProductStage
  /** Required. A stage change with no stated reason is not auditable. */
  reason: string
}

export interface Transition {
  from: ProductStage
  to: ProductStage
  reason: string
}

/**
 * Validates a stage change.
 *
 * Returns a `Result` rather than throwing: a refused transition is an ordinary
 * business outcome that the caller must handle and surface, not a fault.
 */
export function planTransition(request: TransitionRequest): Result<Transition, string> {
  const { from, to, reason } = request

  if (from === to) {
    return err(`The product is already at "${to}".`)
  }
  if (isTerminal(from)) {
    return err(
      `"${from}" is a terminal stage. Create a new candidate rather than reviving this one, so the original decision stays intact in the record.`,
    )
  }
  if (!reason || reason.trim().length < 8) {
    return err('A stage change needs a reason of at least 8 characters for the audit trail.')
  }
  if (!ALLOWED[from].includes(to)) {
    const permitted = ALLOWED[from]
    return err(
      permitted.length === 0
        ? `Nothing may follow "${from}".`
        : `"${from}" cannot move to "${to}". Permitted next stages: ${permitted.join(', ')}.`,
    )
  }

  return ok({ from, to, reason: reason.trim() })
}

/**
 * The gates a product must have cleared to reach a given stage.
 *
 * Used to explain a refusal in terms of what is missing rather than simply
 * naming the rule that fired.
 */
export interface GateState {
  hasScore: boolean
  meetsMinimumScore: boolean
  hasApprovedSupplier: boolean
  complianceAssessed: boolean
  compliancePassesAnyChannel: boolean
  profitablePassesAnyChannel: boolean
}

export interface GateResult {
  satisfied: boolean
  missing: readonly string[]
}

/**
 * Checks the prerequisites for entering a stage.
 *
 * `approved` is the one that matters: it is the last point before a product can
 * be listed anywhere, so every gate has to be satisfied to reach it.
 */
export function checkGates(target: ProductStage, state: GateState): GateResult {
  const missing: string[] = []

  if (target === 'supplier_review' || target === 'compliance_review' || target === 'approved' || target === 'testing') {
    if (!state.hasScore) missing.push('No opportunity score has been calculated.')
    if (!state.meetsMinimumScore) missing.push('Opportunity score is below the configured minimum.')
  }

  if (target === 'compliance_review' || target === 'approved' || target === 'testing') {
    if (!state.hasApprovedSupplier) {
      missing.push('No supplier is approved for any channel.')
    }
  }

  if (target === 'approved' || target === 'testing') {
    if (!state.complianceAssessed) {
      missing.push('Compliance has not been assessed.')
    } else if (!state.compliancePassesAnyChannel) {
      missing.push('Compliance does not pass on any channel.')
    }
    if (!state.profitablePassesAnyChannel) {
      missing.push('The profitability gate does not pass on any channel.')
    }
  }

  return { satisfied: missing.length === 0, missing }
}
