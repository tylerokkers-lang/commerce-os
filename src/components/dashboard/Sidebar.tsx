'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { APP_NAME, NAV_SECTIONS } from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * Milestone: execution reliability & unified write path. `unreadCount` was
 * always the pending-*approvals* count, badged only on the `/approvals`
 * link — a real naming collision an audit flagged, since "unread" also
 * means something distinct and real on `notifications`. Renamed here to
 * `pendingApprovalsCount`, and a genuinely separate `unreadNotificationCount`
 * added for the new `/notifications` link's own badge.
 */
export function Sidebar({ orgName, pendingApprovalsCount, unreadNotificationCount }: { orgName: string; pendingApprovalsCount: number; unreadNotificationCount: number }) {
  const pathname = usePathname()

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Main">
      <div className="px-2">
        <p className="text-sm font-semibold tracking-tight text-ink">{APP_NAME}</p>
        <p className="mt-0.5 truncate text-xs text-ink-subtle">{orgName}</p>
      </div>

      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-2 text-[0.6875rem] font-semibold tracking-wider text-ink-subtle uppercase">
            {section.label}
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {section.items.map((item) => {
              const isActive = pathname === item.href
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors',
                      isActive
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                    )}
                  >
                    <span>{item.label}</span>
                    {item.href === '/approvals' && pendingApprovalsCount > 0 ? (
                      <span className="tabular rounded-full bg-caution px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
                        {pendingApprovalsCount}
                      </span>
                    ) : null}
                    {item.href === '/notifications' && unreadNotificationCount > 0 ? (
                      <span className="tabular rounded-full bg-caution px-1.5 py-0.5 text-[0.6875rem] font-semibold text-white">
                        {unreadNotificationCount}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
