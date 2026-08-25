import { Badge, Card, CardHeader, EmptyState, PageHeader, type Tone } from '@/components/ui'
import { formatMoney } from '@/lib/core/money'
import { formatRelative } from '@/lib/utils'
import { getPendingApprovals, getRecentDecisions, type RecentDecision } from '@/lib/automation/approvals'
import { getSession } from '@/lib/security/session'
import { approveApproval, rejectApproval } from './actions'

export const dynamic = 'force-dynamic'

/**
 * Phase 11 — outcome labels for the "Recent decisions" section below.
 * Deliberately distinct from "Awaiting approval" above: approving a
 * decision is not itself proof the provider action happened, so the badge
 * that appears here after approval is the actual execution result, not a
 * restatement of "approved".
 */
const OUTCOME_TONE: Record<string, Tone> = {
  executed: 'positive', failed: 'negative', blocked: 'caution', rejected: 'neutral', expired: 'neutral', superseded: 'neutral',
}
const OUTCOME_LABEL: Record<string, string> = {
  executed: 'Executed', failed: 'Failed', blocked: 'Blocked on revalidation', rejected: 'Rejected', expired: 'Expired', superseded: 'Superseded',
}

function outcomeKey(decision: RecentDecision): string {
  if (decision.isBlocked) return 'blocked'
  return decision.status
}

function RecentDecisionRow({ decision }: { decision: RecentDecision }) {
  const key = outcomeKey(decision)
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-medium">{decision.title}</p>
        <Badge tone={OUTCOME_TONE[key] ?? 'neutral'}>{OUTCOME_LABEL[key] ?? decision.status}</Badge>
      </div>
      {decision.executionError && !decision.isBlocked ? (
        <p className="mt-1 text-xs text-negative">{decision.executionError}</p>
      ) : decision.isBlocked ? (
        <p className="mt-1 text-xs text-caution">{decision.executionError?.replace('Blocked on revalidation: ', '')}</p>
      ) : null}
      {decision.resolvedAt ? <p className="mt-1 text-xs text-ink-subtle">{formatRelative(decision.resolvedAt)}</p> : null}
    </li>
  )
}

export default async function ApprovalsPage() {
  const [approvals, recentDecisions, session] = await Promise.all([getPendingApprovals(), getRecentDecisions(), getSession()])
  const canApprove = session?.role === 'owner'

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Decisions that exceed the configured automatic limits. Each one shows the reasoning and the data behind it, so you are approving a case rather than a button. Approving submits the action immediately, but approval is not proof it succeeded — every fact is re-checked at that moment, and a genuinely changed situation can still block it. The actual outcome appears under Recent decisions below."
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

                {session?.isDemo ? (
                  <span className="ml-auto text-xs text-ink-subtle">
                    Demo mode has no database to approve or reject against.
                  </span>
                ) : canApprove ? (
                  <div className="ml-auto flex gap-2">
                    <form action={rejectApproval}>
                      <input type="hidden" name="decisionId" value={item.id} />
                      <button type="submit" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted">
                        Reject
                      </button>
                    </form>
                    <form action={approveApproval}>
                      <input type="hidden" name="decisionId" value={item.id} />
                      <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                        Approve &amp; submit
                      </button>
                    </form>
                  </div>
                ) : (
                  <span className="ml-auto text-xs text-ink-subtle">Your role ({session?.role}) cannot approve decisions.</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="Recent decisions"
          description="What actually happened after approval or rejection — the real execution outcome, never inferred from the approval itself."
        />
        {recentDecisions.length === 0 ? (
          <EmptyState title="Nothing resolved yet" description="Approved, rejected and expired decisions appear here with their real outcome." />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {recentDecisions.map((decision) => <RecentDecisionRow key={decision.id} decision={decision} />)}
          </ul>
        )}
      </Card>
    </>
  )
}
