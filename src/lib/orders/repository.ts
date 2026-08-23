import 'server-only'

import { demoOrderScenarios } from '@/lib/demo/orders'
import { requireSession } from '@/lib/security/session'

/**
 * Order orchestration reads.
 *
 * Live mode has no order data source yet — no order has ever actually been
 * ingested from a real marketplace, since no live connector exists (§11 of
 * `docs/MILESTONES.md`'s Milestone 4 section). Returning an empty list in
 * live mode is the honest answer, matching the pattern every prior
 * milestone's repository follows.
 */
export async function getOrderScenarios() {
  const session = await requireSession()
  if (!session.isDemo) return []
  return demoOrderScenarios()
}
