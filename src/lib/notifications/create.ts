import 'server-only'

import { createServiceSupabase } from '@/lib/supabase/server'
import type { Enums } from '@/lib/supabase/database.types'

/**
 * Writes a notification (previously this module only had a read path —
 * `repository.ts` — since nothing yet generated notifications for real).
 * The automation engine is the first caller: every automatic execution,
 * every approval request, and every blocked action the owner should know
 * about creates one of these, per the brief's §19.
 *
 * `dedupeKey` reuses `notifications`'s existing `unique (org_id, dedupe_key)`
 * constraint (migration 0008) so retrying or re-running a job never creates
 * duplicate notifications for the same underlying event — a duplicate key
 * is treated as "already notified," not an error.
 */
export interface CreateNotificationInput {
  orgId: string
  severity: Enums<'notification_severity'>
  category: string
  title: string
  body?: string | null
  entityType?: string | null
  entityId?: string | null
  actionUrl?: string | null
  dedupeKey?: string | null
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const supabase = createServiceSupabase()

  const { error } = await supabase.from('notifications').insert({
    org_id: input.orgId,
    severity: input.severity,
    category: input.category,
    title: input.title,
    body: input.body ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    action_url: input.actionUrl ?? null,
    dedupe_key: input.dedupeKey ?? null,
  })

  if (error) {
    // A duplicate dedupe_key is the expected, safe outcome of a retried or
    // re-run job — not a failure worth surfacing.
    if (error.code === '23505') return
    console.error('[notifications] write failed', { title: input.title, error: error.message })
  }
}

/**
 * Milestone: execution reliability & unified write path. The missing half
 * of the notification lifecycle — `notifications.read_at` could be set by
 * a migration's column default alone, but nothing in this codebase ever
 * wrote to it, so the unread count was monotonically non-decreasing in
 * practice. Scoped to `orgId` (never a bare id lookup) so one org can never
 * mark another's notification read.
 */
export async function markNotificationRead(orgId: string, notificationId: string): Promise<void> {
  const supabase = createServiceSupabase()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('id', notificationId)
    .is('read_at', null)

  if (error) console.error('[notifications] mark-read failed', { notificationId, error: error.message })
}

export async function markAllNotificationsRead(orgId: string): Promise<void> {
  const supabase = createServiceSupabase()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .is('read_at', null)

  if (error) console.error('[notifications] mark-all-read failed', { orgId, error: error.message })
}
