import Link from 'next/link'
import { Badge, Card, CardHeader, PageHeader, StatTile, type Tone } from '@/components/ui'
import { formatMoney, money } from '@/lib/core/money'
import { getAutomationStatus } from '@/lib/automation/repository'
import { getMonitoringStatus } from '@/lib/monitoring/repository'
import { AUTOMATION_CATEGORIES, type PolicyResult } from '@/lib/automation/types'
import { getSession } from '@/lib/security/session'
import type { AnyDemoScenario } from '@/lib/demo/automation'
import type { MonitoringDemoScenario } from '@/lib/demo/monitoring'
import { pauseAll, resumeAll, toggleCategory } from './actions'

export const dynamic = 'force-dynamic'

const CATEGORY_LABELS: Record<string, string> = {
  publishing: 'Product publishing',
  pricing: 'Price automation',
  supplier_switching: 'Supplier switching',
  supplier_ordering: 'Supplier ordering',
  refunds: 'Refunds',
  fulfilment: 'Fulfilment',
}

const POLICY_TONE: Record<PolicyResult['outcome'], Tone> = {
  allow_automatic: 'positive',
  require_approval: 'caution',
  block: 'negative',
}

const POLICY_LABEL: Record<PolicyResult['outcome'], string> = {
  allow_automatic: 'Executed automatically',
  require_approval: 'Approval required',
  block: 'Blocked',
}

function PolicyRequirements({ policy }: { policy: PolicyResult }) {
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-muted">{policy.reason}</p>
        <Badge tone={POLICY_TONE[policy.outcome]}>{POLICY_LABEL[policy.outcome]}</Badge>
      </div>
      <ul className="mt-3 space-y-1.5">
        {policy.requirements.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-xs">
            <span aria-hidden className={r.satisfied ? 'text-positive' : 'text-negative'}>{r.satisfied ? '✓' : '✕'}</span>
            <span><span className="font-medium">{r.label}:</span> <span className="text-ink-muted">{r.detail}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-subtle">Risk level: {policy.riskLevel}</p>
    </div>
  )
}

function DemoScenarioCard({ scenario }: { scenario: AnyDemoScenario }) {
  return (
    <Card>
      <CardHeader title={scenario.label} description={scenario.description} />
      {scenario.kind === 'supplier_switch' ? <PolicyRequirements policy={scenario.result.policy} /> : null}
      {scenario.kind === 'order' ? <PolicyRequirements policy={scenario.result.policy} /> : null}
      {scenario.kind === 'monitoring' ? (
        <div className="border-t border-border px-5 py-4">
          <p className="text-sm text-ink-muted">{scenario.result.summary}</p>
          <p className="mt-2 text-xs text-ink-subtle">
            Net margin: {(scenario.result.profitability.netMarginPct ?? 0).toFixed(1)}% · Recommendation: {scenario.result.recommendation.replace(/_/g, ' ')}
          </p>
        </div>
      ) : null}
      {scenario.kind === 'publication' ? (
        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
          <div className="bg-surface px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Shopify</p>
            <Badge tone={POLICY_TONE[scenario.shopify.policy.outcome]} className="mt-1.5">{POLICY_LABEL[scenario.shopify.policy.outcome]}</Badge>
            <p className="mt-2 text-xs text-ink-muted">{scenario.shopify.policy.reason}</p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Amazon UK</p>
            <Badge tone={POLICY_TONE[scenario.amazon.policy.outcome]} className="mt-1.5">{POLICY_LABEL[scenario.amazon.policy.outcome]}</Badge>
            <p className="mt-2 text-xs text-ink-muted">{scenario.amazon.policy.reason}</p>
          </div>
        </div>
      ) : null}
      {scenario.kind === 'connector_failure' ? (
        <div className="border-t border-border px-5 py-4">
          <ul className="space-y-1 text-xs text-ink-muted">
            {scenario.attempts.map((a) => (
              <li key={a.attempt}>Attempt {a.attempt}: backoff {a.backoffSeconds}s — {a.outcome}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-medium text-negative">{scenario.finalState}</p>
        </div>
      ) : null}
    </Card>
  )
}

function MonitoringDemoScenarioCard({ scenario }: { scenario: MonitoringDemoScenario }) {
  return (
    <Card>
      <CardHeader title={scenario.label} description={scenario.description} />
      <div className="border-t border-border px-5 py-4">
        <ul className="space-y-1 text-xs text-ink-muted">
          {scenario.narrative.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {scenario.events.map((e) => (
            <Badge key={e.id} tone={e.severity === 'critical' ? 'negative' : e.severity === 'warning' ? 'caution' : 'neutral'}>
              {e.eventType}
            </Badge>
          ))}
          {scenario.events.length === 0 ? <span className="text-xs text-ink-subtle">No event created.</span> : null}
        </div>
        {scenario.jobsEnqueued.length > 0 ? (
          <p className="mt-2 text-xs text-ink-subtle">Jobs enqueued: {scenario.jobsEnqueued.map((j) => j.jobType).join(', ')}</p>
        ) : null}
      </div>
    </Card>
  )
}

export default async function AutomationPage() {
  const [status, monitoring, session] = await Promise.all([getAutomationStatus(), getMonitoringStatus(), getSession()])
  const isOwner = session?.role === 'owner'

  return (
    <>
      <PageHeader
        title="Automation"
        description="The control centre for everything the system does without you: what ran today, what it's waiting on you for, and the switch that stops all of it."
      />

      <Card className={status.settings.automationPaused ? 'border-negative/30 bg-negative-soft' : 'border-positive/30 bg-positive-soft'}>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className={status.settings.automationPaused ? 'text-sm font-medium text-negative' : 'text-sm font-medium text-positive'}>
              {status.settings.automationPaused ? 'All automation is paused' : 'Automation is running'}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              Automation level: <span className="font-medium">{status.settings.automationLevel}</span>
              {status.settings.automationPaused && status.settings.automationPausedReason ? ` — ${status.settings.automationPausedReason}` : ''}
            </p>
          </div>
          {isOwner && !status.isDemo ? (
            status.settings.automationPaused ? (
              <form action={resumeAll}>
                <button type="submit" className="rounded-md bg-positive px-4 py-2 text-sm font-medium text-white hover:opacity-90">Resume automation</button>
              </form>
            ) : (
              <form action={pauseAll} className="flex items-center gap-2">
                <input type="hidden" name="reason" value="Emergency stop from the Automation page" />
                <button type="submit" className="rounded-md bg-negative px-4 py-2 text-sm font-medium text-white hover:opacity-90">Pause all automation</button>
              </form>
            )
          ) : (
            <span className="text-xs text-ink-subtle">
              {status.isDemo ? 'Demo mode has no database to pause.' : `Your role (${session?.role}) cannot change this.`}
            </span>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Category controls" description="Pause one kind of automation without stopping everything else." />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
          {AUTOMATION_CATEGORIES.map((category) => {
            const paused = status.settings.automationPausedCategories.includes(category)
            return (
              <div key={category} className="flex items-center justify-between gap-2 bg-surface px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{CATEGORY_LABELS[category]}</p>
                  <Badge tone={paused ? 'negative' : 'positive'} className="mt-1">{paused ? 'Paused' : 'Running'}</Badge>
                </div>
                {isOwner && !status.isDemo ? (
                  <form action={toggleCategory}>
                    <input type="hidden" name="category" value={category} />
                    <input type="hidden" name="paused" value={(!paused).toString()} />
                    <button type="submit" className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-surface-muted">
                      {paused ? 'Resume' : 'Pause'}
                    </button>
                  </form>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Production readiness" description="What it would actually take for this to run 24/7 without anyone watching — never inferred, always read from real configuration and job state." />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Scheduler</p>
            <Badge tone={status.productionReadiness.schedulerConfigured ? 'positive' : 'caution'} className="mt-1.5">
              {status.productionReadiness.schedulerConfigured ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
          {['pending', 'running', 'dead_letter'].map((s) => (
            <div key={s} className="bg-surface px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Jobs {s.replace('_', ' ')}</p>
              <p className="mt-1 text-sm font-medium">{status.productionReadiness.jobsByStatus[s] ?? 0}</p>
            </div>
          ))}
          {status.productionReadiness.connectors.map((c) => (
            <div key={c.key} className="bg-surface px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{c.label}</p>
              <Badge tone={c.status === 'connected' ? 'positive' : c.status === 'demo' ? 'demo' : c.status === 'degraded' ? 'caution' : 'negative'} className="mt-1.5">
                {c.status.replace('_', ' ')}
              </Badge>
            </div>
          ))}
        </div>
        {!status.productionReadiness.schedulerConfigured ? (
          <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
            No external scheduler is calling <code>POST /api/automation/run</code> yet — jobs will queue but nothing will claim them until one does. See HANDOVER.md for what to point at that route.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Business intelligence & live operations" description="What the monitors have actually noticed — never inferred, always read from real monitor_runs and domain_events rows (or, in demo mode, from the same monitors run live against simulated data below)." />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-5">
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Monitors registered</p>
            <p className="mt-1 text-sm font-medium">{monitoring.systemHealth.monitorsRegistered}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Ran (24h)</p>
            <p className="mt-1 text-sm font-medium">{monitoring.systemHealth.monitorsRunLast24h}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Failed (24h)</p>
            <p className={`mt-1 text-sm font-medium ${monitoring.systemHealth.monitorsFailedLast24h > 0 ? 'text-negative' : ''}`}>{monitoring.systemHealth.monitorsFailedLast24h}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Critical events open</p>
            <p className={`mt-1 text-sm font-medium ${monitoring.businessAlerts.openCriticalEvents > 0 ? 'text-negative' : ''}`}>{monitoring.businessAlerts.openCriticalEvents}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Never run</p>
            <p className="mt-1 text-sm font-medium">{monitoring.systemHealth.monitorsNeverRun.length}</p>
          </div>
        </div>
        {monitoring.systemHealth.monitorsNeverRun.length > 0 ? (
          <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
            Never run yet: {monitoring.systemHealth.monitorsNeverRun.join(', ')}. Nothing calls <code>POST /api/monitoring/run</code> for these until an external scheduler is configured — see HANDOVER.md.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-5">
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Warning events open</p>
            <p className="mt-1 text-sm font-medium">{monitoring.businessAlerts.openWarningEvents}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Suppliers unavailable</p>
            <p className="mt-1 text-sm font-medium">{monitoring.businessAlerts.unavailableSuppliers}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Reconciliation problems</p>
            <p className="mt-1 text-sm font-medium">{monitoring.businessAlerts.reconciliationProblems}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Compliance rechecks required</p>
            <p className="mt-1 text-sm font-medium">{monitoring.businessAlerts.complianceRechecksRequired}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Scheduler</p>
            <Badge tone={monitoring.schedulerConfigured ? 'positive' : 'caution'} className="mt-1.5">{monitoring.schedulerConfigured ? 'Configured' : 'Not configured'}</Badge>
          </div>
        </div>
        {!monitoring.isDemo && monitoring.recentEvents.length > 0 ? (
          <ul className="divide-y divide-border border-t border-border">
            {monitoring.recentEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.event_type.replace(/_/g, ' ')} — {e.subject_type} {e.subject_id ?? ''}</p>
                  <p className="truncate text-xs text-ink-muted">{new Date(e.detected_at).toLocaleString('en-GB')} · source: {e.source}</p>
                </div>
                <Badge tone={e.severity === 'critical' ? 'negative' : e.severity === 'warning' ? 'caution' : 'neutral'}>{e.status}</Badge>
              </li>
            ))}
          </ul>
        ) : !monitoring.isDemo ? (
          <div className="border-t border-border px-5 py-8 text-center text-sm text-ink-muted">No monitoring events recorded yet.</div>
        ) : null}
      </Card>

      {monitoring.isDemo ? (
        <div className="grid gap-4">
          {monitoring.demoScenarios.map((scenario) => (
            <MonitoringDemoScenarioCard key={scenario.key} scenario={scenario} />
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Actions today" value={String(status.today.actionsTotal)} sublabel={`${status.today.succeeded} succeeded`} />
        <StatTile label="Approvals requested" value={String(status.today.approvalsRequested)} sublabel={`${status.today.approvalsCompleted} completed`} />
        <StatTile label="Spent automatically" value={formatMoney(money(status.today.spentAutomaticallyMinor, 'GBP'))} sublabel="Supplier orders" />
        <StatTile label="Refunds processed" value={formatMoney(money(status.today.refundsProcessedMinor, 'GBP'))} />
        <StatTile label="Failed actions" value={String(status.risk.failedActions)} tone={status.risk.failedActions > 0 ? 'negative' : 'neutral'} />
        <StatTile label="Blocked actions" value={String(status.risk.blockedActions)} tone={status.risk.blockedActions > 0 ? 'negative' : 'neutral'} />
        <StatTile label="Dead-lettered jobs" value={String(status.risk.deadLetterJobs)} tone={status.risk.deadLetterJobs > 0 ? 'negative' : 'neutral'} />
        <StatTile label="Suppliers switched" value={String(status.today.suppliersSwitched)} sublabel={`${status.today.productsPaused} products paused`} />
      </div>

      {status.isDemo ? (
        <>
          <Card className="border-demo/30 bg-demo-soft">
            <div className="px-5 py-4">
              <p className="text-sm text-demo">
                Demo mode has no database, so the stats above are all zero and nothing below actually executes. Every
                scenario underneath runs the real policy engine, supplier redundancy evaluator, publication gate,
                order pipeline and job backoff calculation against simulated data.
              </p>
            </div>
          </Card>
          <div className="grid gap-4">
            {status.demoScenarios.map((scenario) => (
              <DemoScenarioCard key={scenario.key} scenario={scenario} />
            ))}
          </div>
        </>
      ) : (
        <>
          <Card>
            <CardHeader title="Recent automation activity" description="Most recent actions the engine has decided on, across every category." />
            {status.recentActions.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-ink-muted">No automation actions recorded yet.</div>
            ) : (
              <ul className="divide-y divide-border">
                {status.recentActions.map((action) => (
                  <li key={action.id}>
                    <Link href={`/automation/${action.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-muted">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{action.action_type.replace(/_/g, ' ')} — {action.entity_type} {action.entity_id ?? ''}</p>
                        <p className="truncate text-xs text-ink-muted">{action.reason}</p>
                      </div>
                      <Badge tone={action.status === 'succeeded' ? 'positive' : action.status === 'failed' || action.status === 'blocked' ? 'negative' : 'caution'}>
                        {action.status.replace(/_/g, ' ')}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Pending jobs" description="Scheduled or currently-running automation jobs." />
            {status.pendingJobs.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-ink-muted">No jobs pending.</div>
            ) : (
              <ul className="divide-y divide-border">
                {status.pendingJobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>{job.job_type}</span>
                    <span className="text-xs text-ink-subtle">attempt {job.attempts}/{job.max_attempts} · due {new Date(job.run_at).toLocaleString('en-GB')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  )
}
