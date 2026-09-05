import { Badge, Card, EmptyState, PageHeader, type Tone } from '@/components/ui'
import { formatRelative } from '@/lib/utils'
import { getNotifications, countUnread } from '@/lib/notifications/repository'
import type { NotificationItem, NotificationSeverity } from '@/lib/core/domain'
import { markOneReadAction, markAllReadAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Milestone: execution reliability & unified write path. The `/notifications`
 * page the audit found missing — `notifications` has had a real write path
 * (`create.ts`) and a real read path (`repository.ts`) since Milestone 15,
 * but no mark-as-read path and no page to view them anywhere, ever, until
 * now. Every automated action already tells this table what it did and
 * why (`automation/priceExecution.ts`, `handlers/productHandlers.ts`, etc.)
 * — this page is the first place an operator can actually read that trail.
 */

const SEVERITY_TONE: Record<NotificationSeverity, Tone> = {
  info: 'neutral',
  success: 'positive',
  warning: 'caution',
  critical: 'negative',
  approval_required: 'accent',
}

const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  info: 'Info',
  success: 'Succeeded',
  warning: 'Needs attention',
  critical: 'Failed / blocked',
  approval_required: 'Approval required',
}

function NotificationRow({ notification }: { notification: NotificationItem }) {
  const isUnread = notification.readAt === null
  return (
    <li className={`px-5 py-3.5 ${isUnread ? 'bg-accent-soft/30' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[notification.severity]}>{SEVERITY_LABEL[notification.severity]}</Badge>
            <span className="text-[0.6875rem] font-medium tracking-wide text-ink-subtle uppercase">{notification.category}</span>
            {isUnread ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Unread" /> : null}
          </div>
          <p className="mt-1 text-sm font-medium">{notification.title}</p>
          {notification.body ? <p className="mt-0.5 text-xs text-ink-subtle">{notification.body}</p> : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-subtle">
            <span>{formatRelative(notification.createdAt)}</span>
            {notification.actionUrl ? (
              <>
                <span aria-hidden>·</span>
                <a href={notification.actionUrl} className="text-accent hover:underline">View</a>
              </>
            ) : null}
            {notification.entityType && notification.entityId ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  {notification.entityType}: {notification.entityId}
                </span>
              </>
            ) : null}
          </div>
        </div>
        {isUnread ? (
          <form action={markOneReadAction}>
            <input type="hidden" name="notificationId" value={notification.id} />
            <button type="submit" className="shrink-0 text-xs font-medium text-accent hover:underline">
              Mark read
            </button>
          </form>
        ) : null}
      </div>
    </li>
  )
}

export default async function NotificationsPage() {
  const notifications = await getNotifications(100)
  const unread = countUnread(notifications)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Every automated action tells you what it did and why — action required, approval required, succeeded, failed, blocked, or a connector/supplier/marketplace/profitability issue found along the way."
      />

      <Card>
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <p className="text-sm text-ink-subtle">
            {unread === 0 ? 'Everything is read.' : `${unread} unread notification${unread === 1 ? '' : 's'}.`}
          </p>
          {unread > 0 ? (
            <form action={markAllReadAction}>
              <button type="submit" className="text-sm font-medium text-accent hover:underline">
                Mark all read
              </button>
            </form>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <EmptyState title="No notifications yet" description="Automated actions, approvals, and blocked/failed writes will show up here as they happen." />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
