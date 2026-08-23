import { assessPublicationReadiness, type PublicationDecision, type PublicationGateInput } from '@/lib/marketplaces/publicationGate'
import { evaluateAutomationPolicy, type DomainOutcome } from './policyEngine'
import type { AutomationSettings } from './settingsTypes'
import type { PolicyResult } from './types'

/**
 * Product publication automation (brief §11).
 *
 * `assessPublicationReadiness` (Milestone 4) already composes product
 * lifecycle, supplier status/capability, profitability, compliance and
 * identifier requirements, and it is evaluated **per channel** — a Shopify
 * pass and an Amazon fail for the same product is the normal, expected shape
 * this returns, not a special case this module has to create. All this adds
 * is the kill switch and the "publishing" category pause.
 */

export interface PublicationAutomationResult {
  gate: PublicationDecision
  policy: PolicyResult
}

export function evaluatePublicationAutomation(
  input: PublicationGateInput,
  settings: AutomationSettings,
): PublicationAutomationResult {
  const gate = assessPublicationReadiness(input)

  const domainOutcome: DomainOutcome =
    gate.outcome === 'blocked' ? 'blocked' : gate.outcome === 'auto_publish_permitted' ? 'auto_permitted' : 'pending_approval'

  const policy = evaluateAutomationPolicy({
    actionType: 'publish_product',
    settings,
    domainOutcome,
    domainReason: gate.reason,
    domainRequirements: gate.requirements,
    riskLevel: 'medium',
  })

  return { gate, policy }
}
