import 'server-only'

import { requireSession } from '@/lib/security/session'
import { demoMarketExpansionScenarios, type MarketExpansionDemoScenario } from '@/lib/demo/marketExpansion'

/**
 * The global expansion matrix's data (Milestone 9 §8). Demo-only for now,
 * exactly like `products/opportunities.ts`'s own `getOpportunityDetail` —
 * live mode has no persisted product/supplier facts rich enough yet to
 * assemble a real `ComplianceContext` (the same gap `liveSubjects.ts`
 * documents for `market_expansion` discovery), so this returns `null`
 * rather than a guessed or empty-looking result.
 */
export async function getMarketExpansionDemo(): Promise<readonly MarketExpansionDemoScenario[] | null> {
  const session = await requireSession()
  if (!session.isDemo) return null
  return demoMarketExpansionScenarios()
}
