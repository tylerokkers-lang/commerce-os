import 'server-only'

import { money } from '@/lib/core/money'
import type { ApprovalItem } from '@/lib/core/domain'
import { demoApprovals } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Decisions waiting on the owner (§47 level 3).
 *
 * Nothing in this list has been executed. The system's rule is
 * recommend, then request approval, then execute, and an item only leaves this
 * queue when a person with the owner role has answered it.
 */
export async function getPendingApprovals(): Promise<readonly ApprovalItem[]> {
  const session = await requireSession()
  if (session.isDemo) return demoApprovals()

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('ai_decisions')
    .select('id, decision_type, recommendation, reasoning, confidence, estimated_impact_minor, status, created_at, expires_at')
    .eq('org_id', session.orgId)
    .eq('status', 'awaiting_approval')
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Could not load pending approvals: ${error.message}`)

  return (data ?? []).map((row) => {
    const recommendation = (row.recommendation ?? {}) as { title?: string; detail?: string }
    return {
      id: row.id,
      decisionType: row.decision_type,
      title: recommendation.title ?? row.decision_type,
      detail: recommendation.detail ?? '',
      reasoning: row.reasoning,
      confidence: row.confidence,
      estimatedImpact: row.estimated_impact_minor === null ? null : money(row.estimated_impact_minor, 'GBP'),
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  })
}
