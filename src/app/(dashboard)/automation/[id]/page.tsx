import { notFound } from 'next/navigation'
import { Badge, Card, CardHeader, PageHeader, type Tone } from '@/components/ui'
import { requireSession } from '@/lib/security/session'
import { getAutomationActionDetail } from '@/lib/automation/repository'
import type { PolicyResult } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, Tone> = {
  succeeded: 'positive',
  executing: 'accent',
  requires_approval: 'caution',
  retry_pending: 'caution',
  pending: 'neutral',
  failed: 'negative',
  blocked: 'negative',
  stale_facts: 'negative',
  cancelled: 'neutral',
}

/**
 * The automation action detail view (brief §14/§21).
 *
 * Every field here is read directly from the `automation_actions` row —
 * nothing is inferred or generated. If a field genuinely was not recorded
 * (no live executor exists yet, for instance), the page says exactly that
 * rather than inventing an explanation, per `docs/PRINCIPLES.md` §1.
 */
export default async function AutomationActionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await requireSession()

  if (session.isDemo) {
    return (
      <>
        <PageHeader title="Automation action" description="Demo mode has no database, so there is no individual action record to show — see the scenarios on the Automation page instead." />
      </>
    )
  }

  const action = await getAutomationActionDetail(session, id)
  if (!action) notFound()

  const policy = action.policy_result as unknown as PolicyResult
  const decision = (action.decision ?? {}) as Record<string, unknown>
  const inputFacts = (action.input_facts ?? {}) as Record<string, unknown>

  return (
    <>
      <PageHeader
        title={`${action.action_type.replace(/_/g, ' ')} — ${action.entity_type}${action.entity_id ? ` ${action.entity_id}` : ''}`}
        description={action.reason}
      />

      <Card>
        <CardHeader
          title="What happened"
          action={<Badge tone={STATUS_TONE[action.status] ?? 'neutral'}>{action.status.replace(/_/g, ' ')}</Badge>}
        />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          {[
            ['Automation level', action.automation_level],
            ['Risk level', action.risk_level],
            ['Actor', action.actor_type],
            ['Created', new Date(action.created_at).toLocaleString('en-GB')],
          ].map(([label, value]) => (
            <div key={label} className="bg-surface px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{label}</p>
              <p className="mt-1 text-sm">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Why" description="The policy engine's own verdict — every requirement it checked, satisfied or not." />
        <div className="px-5 py-4">
          <p className="text-sm text-ink-muted">{policy?.reason ?? action.reason}</p>
          {policy?.requirements ? (
            <ul className="mt-3 space-y-1.5">
              {policy.requirements.map((r) => (
                <li key={r.key} className="flex items-start gap-2 text-xs">
                  <span aria-hidden className={r.satisfied ? 'text-positive' : 'text-negative'}>{r.satisfied ? '✓' : '✕'}</span>
                  <span><span className="font-medium">{r.label}:</span> <span className="text-ink-muted">{r.detail}</span></span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader title="Facts used" description="Exactly what was recorded as input to this decision — nothing added since." />
        <pre className="overflow-x-auto px-5 py-4 text-xs text-ink-muted">{JSON.stringify(inputFacts, null, 2)}</pre>
      </Card>

      <Card>
        <CardHeader title="Decision" description="What the domain engine (redundancy, publication, order pipeline, price, or refund) concluded." />
        <pre className="overflow-x-auto px-5 py-4 text-xs text-ink-muted">{JSON.stringify(decision, null, 2)}</pre>
      </Card>

      <Card>
        <CardHeader title="Result" />
        <div className="px-5 py-4">
          {action.completed_at ? (
            <p className="text-sm">
              Completed {new Date(action.completed_at).toLocaleString('en-GB')}.{' '}
              {action.status === 'succeeded' ? 'Succeeded.' : action.error ? action.error : 'Did not succeed.'}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">Not yet completed.</p>
          )}
        </div>
      </Card>
    </>
  )
}
