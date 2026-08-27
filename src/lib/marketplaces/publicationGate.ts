import { isPreLaunch, isTerminal } from '@/lib/products/lifecycle'
import { decisionBlocksExecution, decisionBlockReason } from '@/lib/products/decisionGate'
import type { ChannelCapability } from '@/lib/suppliers/scoring'
import type { ComplianceAssessment } from '@/lib/compliance/rules'
import type { ChannelKey, ProductDecision, ProductStage } from '@/lib/core/domain'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * The publication gate (Milestone 4).
 *
 * "Do not allow a successful API connection to automatically publish
 * products" is the rule this file exists to enforce in code, not just in
 * prose. A marketplace connector reporting `connected` proves nothing about
 * whether a specific product may be listed through it — that is decided
 * entirely here, by composing the engines that already exist:
 *
 *   - operator product decision    -> `src/lib/products/decisionGate.ts`
 *   - product lifecycle rules      -> `src/lib/products/lifecycle.ts`
 *   - supplier status/capability   -> `src/lib/suppliers/scoring.ts`
 *   - profitability gate           -> `src/lib/profitability` (via the caller)
 *   - channel-specific compliance  -> `src/lib/compliance/rules.ts`
 *   - identifier requirements      -> folded into the Amazon compliance check
 *   - automation permission        -> business settings' automation level
 *
 * Nothing here recalculates any of those. It only asks each one for its
 * verdict and refuses to proceed unless every one of them says yes.
 */

export type AutomationLevel = Enums<'automation_level'>

export interface PublicationRequirement {
  key: string
  label: string
  satisfied: boolean
  detail: string
}

export type PublicationOutcome = 'blocked' | 'pending_approval' | 'auto_publish_permitted'

export interface PublicationDecision {
  channel: ChannelKey
  outcome: PublicationOutcome
  requirements: readonly PublicationRequirement[]
  reason: string
  requiresOwnerApproval: boolean
}

export interface PublicationGateInput {
  channel: ChannelKey
  productStage: ProductStage
  /** The operator's Commerce-OS decision for this product — checked first, ahead of every other requirement (`products/decisionGate.ts`). */
  productDecision: ProductDecision
  supplierCapability: ChannelCapability | null
  profitabilityGatePasses: boolean
  profitabilityFailureReason: string | null
  compliance: ComplianceAssessment | null
  automationLevel: AutomationLevel
}

/**
 * Stages from which a listing is even eligible to be considered. Anything
 * before `approved`, or a stage the product should never be listed from at
 * all (paused, declining, rejected, removed), blocks immediately — no amount
 * of supplier or compliance success overrides where the product itself is in
 * its own lifecycle.
 */
function lifecycleAllowsListing(stage: ProductStage): { satisfied: boolean; detail: string } {
  if (isPreLaunch(stage) && stage !== 'approved') {
    return { satisfied: false, detail: `Product is still at lifecycle stage "${stage}", before "approved".` }
  }
  if (isTerminal(stage)) {
    return { satisfied: false, detail: `Product lifecycle stage "${stage}" is terminal.` }
  }
  if (stage === 'paused' || stage === 'declining') {
    return { satisfied: false, detail: `Product lifecycle stage is "${stage}", which is not eligible to list or relist without a deliberate resume.` }
  }
  return { satisfied: true, detail: `Product lifecycle stage "${stage}" is eligible to be listed.` }
}

/**
 * Whether the automation level permits *this specific channel's* publication
 * to proceed without asking. Publishing a new product is approval-required by
 * default at every level except `autonomous` — this mirrors the redundancy
 * evaluator's policy shape (`src/lib/suppliers/redundancy.ts`) exactly:
 * automation widens which decisions are made without asking, never which
 * gates apply.
 */
function automationPermitsAutoPublish(level: AutomationLevel): boolean {
  return level === 'autonomous'
}

/**
 * Assesses whether a product may be published to one channel.
 *
 * Every requirement is reported individually, satisfied or not, so a refusal
 * is never a bare "no" — it names exactly which of the six requirements
 * failed and why.
 */
export function assessPublicationReadiness(input: PublicationGateInput): PublicationDecision {
  const lifecycle = lifecycleAllowsListing(input.productStage)
  const decisionBlocked = decisionBlocksExecution(input.productDecision)

  const requirements: PublicationRequirement[] = [
    {
      // Checked first, ahead of every other requirement — the operator's
      // own decision is the outermost gate (PRODUCT DECISION -> channel
      // eligibility -> compliance -> supplier -> profitability ->
      // budget/cashflow -> approval -> execution), never something the
      // other five requirements can override.
      key: 'product_decision',
      label: 'Commerce-OS product decision',
      satisfied: !decisionBlocked,
      detail: decisionBlocked
        ? decisionBlockReason(input.productDecision)
        : `Product decision "${input.productDecision}" permits proceeding to the remaining requirements.`,
    },
    {
      key: 'lifecycle',
      label: 'Product lifecycle rules',
      satisfied: lifecycle.satisfied,
      detail: lifecycle.detail,
    },
    {
      key: 'supplier_status',
      label: 'Supplier status',
      satisfied: input.supplierCapability !== null,
      detail:
        input.supplierCapability === null
          ? 'No supplier has been assessed for this channel.'
          : `Supplier status: ${input.supplierCapability.status.replace(/_/g, ' ')}.`,
    },
    {
      key: 'supplier_fulfilment_capability',
      label: 'Supplier fulfilment capability',
      satisfied: input.supplierCapability?.status === 'approved',
      detail:
        input.supplierCapability === null
          ? 'Not assessed.'
          : input.supplierCapability.reasons.join(' '),
    },
    {
      key: 'profitability',
      label: 'Profitability gate',
      satisfied: input.profitabilityGatePasses,
      detail: input.profitabilityGatePasses
        ? 'Passes the configured margin thresholds on this channel.'
        : (input.profitabilityFailureReason ?? 'Fails the configured margin thresholds on this channel.'),
    },
    {
      key: 'compliance',
      label: 'Channel-specific compliance',
      satisfied: input.compliance?.verdict === 'pass',
      detail: input.compliance === null ? 'Not assessed.' : input.compliance.summary,
    },
    {
      key: 'identifiers',
      // Folded into the compliance assessment's own GTIN/exemption check
      // (`amazon_gtin` for Amazon; not applicable for Shopify), so this is a
      // read of that result, not a second check invented here.
      label: 'Identifier requirements',
      satisfied:
        input.compliance === null
          ? false
          : !input.compliance.checks.some(
              (check) => check.key.includes('gtin') && check.outcome !== 'pass' && check.outcome !== 'not_applicable',
            ),
      detail:
        input.compliance?.checks.find((c) => c.key.includes('gtin'))?.evidence ??
        'No identifier requirement applies on this channel.',
    },
  ]

  const failed = requirements.filter((r) => !r.satisfied)

  if (failed.length > 0) {
    return {
      channel: input.channel,
      outcome: 'blocked',
      requirements,
      reason: `Blocked: ${failed.map((r) => r.label).join(', ')} not satisfied.`,
      requiresOwnerApproval: true,
    }
  }

  const autoPermitted = automationPermitsAutoPublish(input.automationLevel)

  const automationRequirement: PublicationRequirement = {
    key: 'automation_permission',
    label: 'Automation permission',
    satisfied: true, // Every prior requirement passed; this only decides *how* it proceeds.
    detail: autoPermitted
      ? `Automation level "${input.automationLevel}" permits publishing without approval.`
      : `Automation level "${input.automationLevel}" requires your approval before publishing.`,
  }

  return {
    channel: input.channel,
    outcome: autoPermitted ? 'auto_publish_permitted' : 'pending_approval',
    requirements: [...requirements, automationRequirement],
    reason: autoPermitted
      ? `Every requirement passed and "${input.automationLevel}" permits automatic publication.`
      : `Every requirement passed. Publishing needs your approval at the "${input.automationLevel}" automation level.`,
    requiresOwnerApproval: !autoPermitted,
  }
}
