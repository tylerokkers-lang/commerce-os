import Link from 'next/link'
import { Badge, Card, CardHeader, PageHeader, StatTile, TableWrap, type Tone } from '@/components/ui'
import { MetricStat } from '@/components/dashboard/MetricStat'
import { formatMoney, money, type Money } from '@/lib/core/money'
import { getAutomationStatus } from '@/lib/automation/repository'
import { getMonitoringStatus } from '@/lib/monitoring/repository'
import { getAnalyticsDashboard } from '@/lib/analytics/repository'
import { AUTOMATION_CATEGORIES, type PolicyResult } from '@/lib/automation/types'
import { getSession } from '@/lib/security/session'
import type { AnyDemoScenario } from '@/lib/demo/automation'
import type { MonitoringDemoScenario } from '@/lib/demo/monitoring'
import type { AnalyticsDemoScenario } from '@/lib/demo/analytics'
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

function AnalyticsDemoScenarioCard({ scenario }: { scenario: AnalyticsDemoScenario }) {
  return (
    <Card>
      <CardHeader title={scenario.label} description={scenario.description} />
      <ul className="space-y-1 border-t border-border px-5 py-4 text-xs text-ink-muted">
        {scenario.narrative.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </Card>
  )
}

/** Every figure a drill-down list of real open-event subject ids — never a number with nothing behind it. */
function IntelligenceCard({ title, groups }: { title: string; groups: readonly { label: string; ids: readonly string[]; tone?: Tone }[] }) {
  return (
    <Card>
      <CardHeader title={title} description="Backed by open domain events only." />
      <div className="divide-y divide-border border-t border-border">
        {groups.map((group) => (
          <div key={group.label} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">{group.label}</p>
              <Badge tone={group.ids.length === 0 ? 'neutral' : (group.tone ?? 'caution')}>{group.ids.length}</Badge>
            </div>
            {group.ids.length > 0 ? <p className="mt-1 truncate text-xs text-ink-subtle">{group.ids.join(', ')}</p> : null}
          </div>
        ))}
      </div>
    </Card>
  )
}

export default async function AutomationPage() {
  const [status, monitoring, analytics, session] = await Promise.all([getAutomationStatus(), getMonitoringStatus(), getAnalyticsDashboard(), getSession()])
  const isOwner = session?.role === 'owner'
  const asMoney = (m: Money) => formatMoney(m)
  // `AdvertisingAnalytics`'s money fields (Milestone 10's shape) are bare minor-unit
  // numbers with no attached currency — this codebase's existing convention for that
  // shape (see `status.today.spentAutomaticallyMinor`/`refundsProcessedMinor` below)
  // is to assume the org's GBP base currency, unchanged here.
  const asAdSpendMoney = (v: number) => formatMoney(money(v, 'GBP'))
  const asPct = (v: number) => `${v}%`
  const asDays = (v: number) => `${v} day(s)`

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
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-5">
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Degraded (24h)</p>
            <p className={`mt-1 text-sm font-medium ${monitoring.systemHealth.monitorsDegraded > 0 ? 'text-caution' : ''}`}>{monitoring.systemHealth.monitorsDegraded}</p>
          </div>
          <div className="bg-surface px-4 py-3 sm:col-span-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Overdue</p>
            <p className="mt-1 text-sm font-medium">
              {monitoring.systemHealth.monitorsOverdue.length === 0 ? 'None' : monitoring.systemHealth.monitorsOverdue.join(', ')}
            </p>
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

      {!monitoring.isDemo ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <IntelligenceCard
            title="Supplier intelligence"
            groups={[
              { label: 'Dispatch delays', ids: monitoring.supplierIntelligence.suppliersWithDispatchDelays },
              { label: 'Cancellation rate rising', ids: monitoring.supplierIntelligence.suppliersWithCancellationIncrease },
              { label: 'Price increases', ids: monitoring.supplierIntelligence.suppliersWithPriceIncreases },
              { label: 'Feed problems', ids: monitoring.supplierIntelligence.suppliersWithFeedProblems },
            ]}
          />
          <IntelligenceCard
            title="Product intelligence"
            groups={[
              { label: 'Newly profitable', ids: monitoring.productIntelligence.newlyProfitable, tone: 'positive' },
              { label: 'Losing profitability', ids: monitoring.productIntelligence.losingProfitability },
              { label: 'Rising sales', ids: monitoring.productIntelligence.risingSales, tone: 'positive' },
              { label: 'Declining sales', ids: monitoring.productIntelligence.decliningSales },
              { label: 'Requiring review', ids: monitoring.productIntelligence.requiringReview },
            ]}
          />
          <IntelligenceCard
            title="Marketplace intelligence"
            groups={[
              { label: 'Listings out of sync', ids: monitoring.marketplaceIntelligence.listingsOutOfSync },
              { label: 'Failed external actions', ids: monitoring.marketplaceIntelligence.failedExternalActions },
            ]}
          />
          <IntelligenceCard
            title="Global expansion intelligence"
            groups={[
              { label: 'FX rates stale/unavailable', ids: monitoring.expansionIntelligence.fxRatesStale },
              { label: 'Significant FX movements', ids: monitoring.expansionIntelligence.fxSignificantMovements },
              { label: 'Market profitability deteriorating', ids: monitoring.expansionIntelligence.marketsWithProfitabilityDeterioration },
              { label: 'Market compliance recheck required', ids: monitoring.expansionIntelligence.marketsRequiringComplianceRecheck },
              { label: 'Supplier capability changed', ids: monitoring.expansionIntelligence.marketsWithSupplierCapabilityChanges },
              { label: 'Markets became viable', ids: monitoring.expansionIntelligence.marketsBecameViable, tone: 'positive' },
            ]}
          />
        </div>
      ) : null}

      <Card>
        <CardHeader title="Market readiness" description="Every market in the catalog, and its real connector status — never LIVE or DEMO unless a connector genuinely reports it." />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
          {monitoring.marketReadiness.map((market) => (
            <div key={market.marketKey} className="bg-surface px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{market.label}</p>
              <p className="mt-0.5 text-xs text-ink-subtle">{market.countryLabel}</p>
              <Badge
                tone={market.status === 'connected' || market.status === 'demo' ? 'positive' : market.status === 'error' ? 'negative' : market.status === 'degraded' ? 'caution' : 'neutral'}
                className="mt-1.5"
              >
                {market.status.replace(/_/g, ' ')}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {monitoring.isDemo ? (
        <div className="grid gap-4">
          {monitoring.demoScenarios.map((scenario) => (
            <MonitoringDemoScenarioCard key={scenario.key} scenario={scenario} />
          ))}
        </div>
      ) : null}

      <PageHeader
        title="Business analytics"
        description={`How the business is actually performing, ${analytics.period.label.toLowerCase()} (${new Date(analytics.period.start).toLocaleDateString('en-GB')} – ${new Date(analytics.period.end).toLocaleDateString('en-GB')}), compared against the equivalent previous period. Every figure below is FACT or CALCULATED unless labelled otherwise — UNKNOWN/STALE/UNAVAILABLE are shown honestly, never as zero.`}
      />

      <Card>
        <CardHeader title="Revenue & profit" description="Realised sales facts from orders/order_items/refunds — the same aggregateSalesWindow every monitor uses — compared against the previous equivalent period." />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <MetricStat label="Revenue" metric={analytics.sales.revenue} format={asMoney as never} />
          <MetricStat label="Net revenue" metric={analytics.sales.netRevenue} format={asMoney as never} />
          <MetricStat label="Orders" metric={analytics.sales.orders} format={String as never} />
          <MetricStat label="Units sold" metric={analytics.sales.units} format={String as never} />
          <MetricStat label="Average order value" metric={analytics.sales.averageOrderValue} format={asMoney as never} />
          <MetricStat label="Refunds" metric={analytics.sales.refundsValue} format={asMoney as never} />
          <MetricStat label="Return rate" metric={analytics.sales.returnRatePct} format={asPct as never} />
          <MetricStat label="Refund rate" metric={analytics.sales.refundRatePct} format={asPct as never} />
        </div>
      </Card>

      {analytics.channels.length > 0 ? (
        <Card>
          <CardHeader title="Channel performance" description="Never one blended figure — each channel's own realised sales and known projected profit, from real orders.channel and channel_products data." />
          <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
            {analytics.channels.map((c) => (
              <div key={c.channel} className="bg-surface px-5 py-4">
                <p className="text-sm font-semibold">{c.label}</p>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-ink-subtle">Revenue</p>
                    <p className="font-medium">{formatMoney(c.sales.revenue.value ?? money(0, c.sales.currency))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-subtle">Orders</p>
                    <p className="font-medium">{c.sales.orders.value ?? '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-subtle">Known net profit</p>
                    {c.profit.knownNetProfit.status === 'calculated' ? (
                      <p className="font-medium">{formatMoney(c.profit.knownNetProfit.value as Money)}</p>
                    ) : (
                      <Badge tone="neutral">{c.profit.knownNetProfit.status.toUpperCase()}</Badge>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-ink-subtle">Avg. net margin</p>
                    <p className="font-medium">{c.profit.averageNetMarginPct.status === 'calculated' ? `${c.profit.averageNetMarginPct.value}%` : '—'}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-ink-subtle">{c.profit.productsWithKnownProfit} product(s) with known profit, {c.profit.productsWithUnknownProfit} unknown.</p>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {analytics.topRevenueProducts.length > 0 || analytics.lossMakingProducts.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader title="Top products" description="Ranked by realised revenue, only among products with a known price and cost." />
            <TableWrap>
              <table className="w-full text-sm">
                <thead className="border-t border-border text-left text-xs text-ink-subtle uppercase">
                  <tr><th className="px-5 py-2">Product</th><th className="px-5 py-2">Channel</th><th className="px-5 py-2">Net margin</th><th className="px-5 py-2">Tags</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {analytics.topRevenueProducts.map((p) => (
                    <tr key={`${p.productId}:${p.channel}`}>
                      <td className="px-5 py-2 font-medium">{p.productId}</td>
                      <td className="px-5 py-2 text-ink-muted">{p.channel}</td>
                      <td className="px-5 py-2">{p.netMarginPct !== null ? `${p.netMarginPct}%` : '—'}</td>
                      <td className="px-5 py-2"><div className="flex flex-wrap gap-1">{p.tags.map((t) => <Badge key={t} tone="accent">{t.replace(/_/g, ' ')}</Badge>)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <Card>
            <CardHeader title="Worst-performing products" description="Every product whose known projection is loss-making right now — never a guess where cost is unavailable." />
            {analytics.lossMakingProducts.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-ink-muted">No product with a known projection is currently loss-making.</div>
            ) : (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead className="border-t border-border text-left text-xs text-ink-subtle uppercase">
                    <tr><th className="px-5 py-2">Product</th><th className="px-5 py-2">Channel</th><th className="px-5 py-2">Net profit</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analytics.lossMakingProducts.map((p) => (
                      <tr key={`${p.productId}:${p.channel}`}>
                        <td className="px-5 py-2 font-medium">{p.productId}</td>
                        <td className="px-5 py-2 text-ink-muted">{p.channel}</td>
                        <td className="px-5 py-2 text-negative">{p.netProfitMinor !== null ? formatMoney(money(p.netProfitMinor, 'GBP')) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Supplier health" description="A deterministic classification — HEALTHY/WATCH/AT RISK/UNAVAILABLE/UNKNOWN — from real dispatch, cancellation and fulfilment-success facts, always with a stated reason." />
          {analytics.supplierHealth.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-ink-muted">No supplier data yet.</div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {analytics.supplierHealth.map((s) => (
                <li key={s.supplierId} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{s.supplierId}</p>
                    <Badge tone={s.status === 'healthy' ? 'positive' : s.status === 'watch' ? 'accent' : s.status === 'at_risk' ? 'caution' : s.status === 'unavailable' ? 'negative' : 'neutral'}>
                      {s.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  {s.reasons.length > 0 ? <p className="mt-1 text-xs text-ink-subtle">{s.reasons.join(' ')}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Fulfilment health" description="From real fulfilments/shipments rows — a shipment with no delivery confirmation and no tracking is UNKNOWN, never assumed delivered." />
          <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
            <MetricStat label="Awaiting fulfilment" metric={analytics.fulfilment.awaitingFulfilment} format={String as never} />
            <MetricStat label="Delivered" metric={analytics.fulfilment.delivered} format={String as never} />
            <MetricStat label="Cancellation rate" metric={analytics.fulfilment.cancellationRatePct} format={asPct as never} />
            <MetricStat label="Missing tracking" metric={analytics.fulfilment.missingTracking} format={String as never} />
            <MetricStat label="Avg. dispatch time" metric={analytics.fulfilment.averageDispatchDays} format={asDays as never} />
            <MetricStat label="On-time delivery" metric={analytics.fulfilment.onTimeDeliveryRatePct} format={asPct as never} />
            <MetricStat label="Late deliveries" metric={analytics.fulfilment.lateDeliveries} format={String as never} />
            <MetricStat label="Unknown outcome" metric={analytics.fulfilment.unknownDeliveryOutcome} format={String as never} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="Open business alerts" description="Deterministic facts, not narration — each alert traces back to the real comparison or classification that produced it." />
          {analytics.alerts.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-ink-muted">No open alerts.</div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {analytics.alerts.map((a) => (
                <li key={`${a.key}:${a.affectedEntityId ?? ''}`} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm">{a.message}</p>
                    <Badge tone={a.severity === 'critical' ? 'negative' : a.severity === 'warning' ? 'caution' : 'neutral'}>{a.severity}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">Source: {a.source}{a.actionable ? '' : ' · informational only'}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Data-quality warnings" description="Every place a figure elsewhere on this page is genuinely incomplete — so no metric can be mistaken for whole when it isn't." />
          {analytics.dataQuality.overallStatus === 'unknown' ? (
            <div className="px-5 py-8 text-center text-sm text-ink-muted">Demo mode has no live data to check — data quality is genuinely unknown here, not &quot;complete&quot;.</div>
          ) : analytics.dataQuality.issues.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-positive">Every check passed — no known data-quality gaps right now.</div>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {analytics.dataQuality.issues.map((issue) => (
                <li key={issue.key} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm">{issue.message}</p>
                    <Badge tone={issue.severity === 'critical' ? 'negative' : issue.severity === 'warning' ? 'caution' : 'neutral'}>{issue.affectedCount}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Advertising"
          description="No advertising platform connector exists in this codebase yet (Amazon Ads, Meta, Google, TikTok) — but real spend/revenue rows in the advertising table are read and classified deterministically. A figure below is real when known; otherwise it is honestly unavailable, never a fabricated £0. Full per-campaign detail lives on /advertising."
        />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <MetricStat label="Spend" metric={analytics.advertising.spend} format={asAdSpendMoney as never} />
          <MetricStat label="ROAS" metric={analytics.advertising.roas} format={((v: number) => v.toFixed(2)) as never} />
          <MetricStat label="ACOS" metric={analytics.advertising.acosPct} format={asPct as never} />
          <MetricStat label="Profit impact" metric={analytics.advertising.profitImpact} format={asAdSpendMoney as never} />
        </div>
      </Card>

      {analytics.isDemo ? (
        <div className="grid gap-4">
          {analytics.demoScenarios.map((scenario) => (
            <AnalyticsDemoScenarioCard key={scenario.key} scenario={scenario} />
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
