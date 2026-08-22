import 'server-only'

import type { NotificationItem } from '@/lib/core/domain'
import { demoNotifications } from '@/lib/demo/dataset'
import { requireSession } from '@/lib/security/session'
import { createServerSupabase } from '@/lib/supabase/server'

export async function getNotifications(limit = 25): Promise<readonly NotificationItem[]> {
  const session = await requireSession()
  if (session.isDemo) return demoNotifications().slice(0, limit)

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, severity, category, title, body, created_at, read_at, action_url')
    .eq('org_id', session.orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Could not load notifications: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: row.id,
    severity: row.severity,
    category: row.category,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
    actionUrl: row.action_url,
  }))
}

export const countUnread = (items: readonly NotificationItem[]): number =>
  items.filter((n) => n.readAt === null).length
