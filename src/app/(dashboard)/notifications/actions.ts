'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/security/session'
import { markNotificationRead, markAllNotificationsRead } from '@/lib/notifications/create'

/**
 * Milestone: execution reliability & unified write path. The missing half
 * of the notification lifecycle — see `create.ts` for why nothing ever
 * wrote `read_at` before this.
 */
export async function markOneReadAction(formData: FormData): Promise<void> {
  const session = await requireSession()
  if (session.isDemo) return
  const notificationId = String(formData.get('notificationId') ?? '')
  if (!notificationId) return
  await markNotificationRead(session.orgId, notificationId)
  revalidatePath('/notifications')
}

export async function markAllReadAction(): Promise<void> {
  const session = await requireSession()
  if (session.isDemo) return
  await markAllNotificationsRead(session.orgId)
  revalidatePath('/notifications')
}
