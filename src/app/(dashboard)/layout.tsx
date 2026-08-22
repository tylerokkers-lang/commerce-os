import { redirect } from 'next/navigation'
import { DemoBanner } from '@/components/dashboard/DemoBanner'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { countUnread, getNotifications } from '@/lib/notifications/repository'
import { getPendingApprovals } from '@/lib/automation/approvals'
import { getSession } from '@/lib/security/session'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  const [notifications, approvals] = await Promise.all([getNotifications(), getPendingApprovals()])
  const unread = countUnread(notifications)

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r border-border bg-surface lg:block lg:h-screen lg:sticky lg:top-0">
        <Sidebar orgName={session.orgName} unreadCount={approvals.length} />
      </aside>

      <div className="flex min-w-0 flex-col">
        {session.isDemo ? <DemoBanner /> : null}

        <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3 lg:hidden">
          <span className="text-sm font-semibold">Commerce OS</span>
          <span className="text-xs text-ink-subtle">{session.orgName}</span>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            {children}
            <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-ink-subtle">
              <span>Signed in as {session.email}</span>
              <span aria-hidden>·</span>
              <span>Role: {session.role}</span>
              <span aria-hidden>·</span>
              <span>{unread} unread notification{unread === 1 ? '' : 's'}</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}
