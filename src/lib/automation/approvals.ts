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

/**
 * Phase 11 — what `/approvals` renders below the pending queue so
 * "Approved" is never the last thing a person sees for a decision that
 * went on to execute, fail, or be blocked. `execution_error` doubles as
 * the honest explanation text for a blocked/failed outcome; a value
 * prefixed "Blocked on revalidation:" is `approvalWorkflow.ts`'s only way
 * of telling a genuine failure apart from a safety-gate block, since
 * `decision_status` (migration 0008) has no separate 'blocked' value.
 */
export interface RecentDecision {
  id: string
  decisionType: string
  title: string
  status: string
  executionError: string | null
  isBlocked: boolean
  resolvedAt: string | null
}

export async function getRecentDecisions(limit = 10): Promise<readonly RecentDecision[]> {
  const session = await requireSession()
  if (session.isDemo) return []

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('ai_decisions')
    .select('id, decision_type, recommendation, status, execution_error, executed_at, created_at')
    .eq('org_id', session.orgId)
    .in('status', ['executed', 'failed', 'rejected', 'expired', 'superseded'])
    .order('executed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not load recent decisions: ${error.message}`)

  return (data ?? []).map((row) => {
    const recommendation = (row.recommendation ?? {}) as { title?: string }
    return {
      id: row.id,
      decisionType: row.decision_type,
      title: recommendation.title ?? row.decision_type,
      status: row.status,
      executionError: row.execution_error,
      isBlocked: row.status === 'failed' && (row.execution_error ?? '').startsWith('Blocked on revalidation:'),
      resolvedAt: row.executed_at ?? row.created_at,
    }
  })
}
