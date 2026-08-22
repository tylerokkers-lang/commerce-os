import 'server-only'

import type { AuditEvent } from '@/lib/core/domain'
import { demoAuditEvents } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'

export async function getAuditEvents(limit = 100): Promise<readonly AuditEvent[]> {
  const session = await requireSession()
  if (session.isDemo) return demoAuditEvents().slice(0, limit)

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, occurred_at, actor_type, actor_label, action, entity_type, entity_id, reason, result')
    .eq('org_id', session.orgId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not load the audit log: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: String(row.id),
    occurredAt: row.occurred_at,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    result: row.result,
  }))
}
