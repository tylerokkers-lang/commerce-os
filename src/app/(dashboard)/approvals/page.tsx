import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { formatMoney } from '@/lib/core/money'
import { formatRelative } from '@/lib/utils'
import { getPendingApprovals } from '@/lib/automation/approvals'
import { getSession } from '@/lib/security/session'

export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const [approvals, session] = await Promise.all([getPendingApprovals(), getSession()])
  const canApprove = session?.role === 'owner'

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Decisions that exceed the configured automatic limits. Each one shows the reasoning and the data behind it, so you are approving a case rather than a button."
      />

      {approvals.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing waiting on you"
            description="Everything the system has done recently stayed inside its configured spending, pricing and compliance limits."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {approvals.map((item) => (
            <Card key={item.id}>
              <CardHeader
                title={item.title}
                description={item.detail}
                action={
                  item.estimatedImpact ? (
                    <div className="text-right">
                      <p className="tabular text-lg font-semibold">{formatMoney(item.estimatedImpact)}</p>
                      <p className="text-xs text-ink-subtle">Estimated impact</p>
                    </div>
                  ) : null
                }
              />
              <div className="px-5 py-4">
                <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Why</p>
                <p className="mt-1.5 max-w-3xl text-sm text-ink-muted">{item.reasoning}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
                <Badge tone="caution">Awaiting approval</Badge>
                {item.confidence !== null ? (
                  <span className="text-xs text-ink-subtle">{Math.round(item.confidence * 100)}% confidence</span>
                ) : null}
                <span className="text-xs text-ink-subtle">Raised {formatRelative(item.createdAt)}</span>
                {item.expiresAt ? (
                  <span className="text-xs text-ink-subtle">Expires {formatRelative(item.expiresAt).replace(' ago', ' from now')}</span>
                ) : null}
                <span className="ml-auto text-xs text-ink-subtle">
                  {canApprove
                    ? 'Approve and reject actions arrive with the automation engine in Milestone 5.'
                    : `Your role (${session?.role}) cannot approve decisions.`}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
