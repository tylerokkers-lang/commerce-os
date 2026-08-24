import Link from 'next/link'
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatTile, TableWrap, type Tone } from '@/components/ui'
import { MetricStat } from '@/components/dashboard/MetricStat'
import { formatMoney } from '@/lib/core/money'
import { formatPct, formatRelative } from '@/lib/utils'
import { getCEOCommandCentre } from '@/lib/ceo/repository'
import { getStockAlerts } from '@/lib/products/repository'
import { getIntelligenceSummary, getOpportunities, getTrendingOpportunities } from '@/lib/products/opportunities'
import { ACTION_LABELS, ACTION_TONES } from '@/components/dashboard/RecommendationPanel'
import { getComplianceIssues } from '@/lib/compliance/repository'
import { getSuppliers } from '@/lib/suppliers/repository'
import type { HealthStatus, Priority, PriorityCategory, CEODemoScenario } from '@/lib/ceo/types'

export const dynamic = 'force-dynamic'

/**
 * The CEO Command Centre (Milestone 11) — the dashboard the owner reads
 * every day. This page is a presentation layer only: `getCEOCommandCentre()`
 * (composing Milestone 10's `getAnalyticsDashboard()`, Milestone 8's
 * `getMonitoringStatus()`, Milestone 6's `getAutomationStatus()`, and the
 * existing approvals queue) does every calculation; nothing here
 * recomputes a metric. `getStockAlerts`/`getComplianceIssues`/
 * `getIntelligenceSummary`/`getOpportunities`/`getTrendingOpportunities`/
 * `getSuppliers` are the pre-existing (Milestone 1/2) repositories this
 * page already used before Milestone 11 — kept because they cover real
 * facts Milestone 10's analytics layer does not (candidate-opportunity
 * scoring, live stock levels, per-listing compliance detail), not
 * duplicated with anything new here.
 */

const HEALTH_TONE: Record<HealthStatus, Tone> = { healthy: 'positive', watch: 'accent', at_risk: 'caution', critical: 'negative', unknown: 'neutral' }
const HEALTH_LABEL: Record<HealthStatus, string> = { healthy: 'Healthy', watch: 'Watch', at_risk: 'At risk', critical: 'Critical', unknown: 'Unknown' }
const PRIORITY_TONE: Record<Priority['severity'], Tone> = { critical: 'negative', high: 'caution', medium: 'accent', low: 'neutral' }
const CATEGORY_LABEL: Record<PriorityCategory, string> = {
  financial_risk: 'Financial', compliance_risk: 'Compliance', customer_risk: 'Customer', supplier_failure: 'Supplier',
  automation_failure: 'Automation', pending_approval: 'Approval', data_quality: 'Data quality', opportunity: 'Opportunity',
}

function PriorityRow({ priority }: { priority: Priority }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{priority.title}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">{CATEGORY_LABEL[priority.category]} · {formatRelative(priority.occurredAt)} · {priority.source}</p>
        </div>
        <Badge tone={PRIORITY_TONE[priority.severity]} className="shrink-0">{priority.severity.toUpperCase()}</Badge>
      </div>
      {priority.detail && priority.detail !== priority.title ? <p className="mt-1.5 text-sm text-ink-muted">{priority.detail}</p> : null}
      <p className="mt-1.5 text-xs text-ink-subtle">{priority.recommendedNextStep}</p>
    </>
  )
  return (
    <li className="px-5 py-3.5">
      {priority.actionHref ? <Link href={priority.actionHref} className="block hover:opacity-80">{content}</Link> : content}
    </li>
  )
}

function HealthAreaTile({ area }: { area: { key: string; label: string; status: HealthStatus; reasons: readonly string[]; detailHref: string | null } }) {
  const body = (
    <div className="bg-surface px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{area.label}</p>
      <Badge tone={HEALTH_TONE[area.status]} className="mt-1.5">{HEALTH_LABEL[area.status]}</Badge>
      {area.reasons.length > 0 ? <p className="mt-1.5 truncate text-xs text-ink-subtle" title={area.reasons.join(' ')}>{area.reasons[0]}</p> : null}
    </div>
  )
  return area.detailHref && area.status !== 'healthy' && area.status !== 'unknown' ? <Link href={area.detailHref} className="hover:opacity-80">{body}</Link> : body
}

function DemoScenarioCard({ scenario }: { scenario: CEODemoScenario }) {
  return (
    <Card>
      <CardHeader title={scenario.label} description={scenario.description} />
      <ul className="space-y-1 border-t border-border px-5 py-4 text-xs text-ink-muted">
        {scenario.narrative.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </Card>
  )
}

export default async function DashboardPage() {
  const [ceo, stockAlerts, compliance, intelligence, opportunities, trending, suppliers] = await Promise.all([
    getCEOCommandCentre(),
    getStockAlerts(),
    getComplianceIssues(),
    getIntelligenceSummary(),
    getOpportunities(),
    getTrendingOpportunities(),
    getSuppliers(),
  ])

  const topOpportunities = [...opportunities].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 4)
  const channelDivergentOpportunities = opportunities.filter((o) => o.shopifyProfitable !== o.amazonProfitable)

  const automationPausedAll = ceo.automationHealth.settings.automationPaused

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="The command centre: how the business is performing right now, what needs your attention, and how much you can trust the numbers behind it."
      />

      {automationPausedAll ? (
        <Card className="border-negative/40 bg-negative-soft">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-negative">EMERGENCY STOP ACTIVE — all automation is paused</p>
            <p className="mt-1 text-sm text-ink">{ceo.automationHealth.settings.automationPausedReason ?? 'No reason was recorded.'}</p>
            <Link href="/automation" className="mt-2 inline-block text-sm text-accent hover:underline">Review and resume on /automation</Link>
          </div>
        </Card>
      ) : null}

      {ceo.dataSourceFailures.length > 0 ? (
        <Card className="border-caution/40 bg-caution-soft">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-caution">Some data could not be loaded</p>
            <p className="mt-1 text-sm text-ink">
              {ceo.dataSourceFailures.join(', ')} data source(s) failed to load this time — the sections below fall back to a safe empty state rather than showing possibly-wrong figures. Reload the page to try again.
            </p>
          </div>
        </Card>
      ) : null}

      {/* --- 1. What needs my attention -------------------------------- */}
      <Card>
        <CardHeader
          title="What needs your attention"
          description="Every genuinely open problem, ranked critical first — the same list whether you call it your priority queue or today's priorities. Nothing here is invented: each item traces back to a real alert, event, approval or classification."
        />
        {ceo.priorities.length === 0 ? (
          <EmptyState
            title={ceo.isDemo ? 'Demo mode' : 'Nothing needs you right now'}
            description={ceo.isDemo ? 'Demo mode has no live data to raise real priorities from — see the scenarios below for what this section looks like with genuine problems.' : 'No open alerts, failed automation, pending approvals, or data-quality gaps.'}
          />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {ceo.priorities.map((p) => <PriorityRow key={p.id} priority={p} />)}
          </ul>
        )}
      </Card>

      {/* --- 2. Executive financial summary ----------------------------- */}
      <Card>
        <CardHeader
          title="Executive summary"
          description={`${ceo.executiveSummary.periodLabel}, compared against the previous equivalent period. ${ceo.executiveSummary.profitDataComplete ? '' : 'Net margin below is based on incomplete cost/price data — see Data quality.'}`}
        />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <MetricStat label="Revenue" metric={ceo.executiveSummary.revenue} format={formatMoney as never} />
          <MetricStat label="Net revenue" metric={ceo.executiveSummary.netRevenue} format={formatMoney as never} />
          <MetricStat label="Orders" metric={ceo.executiveSummary.orders} format={String as never} />
          <MetricStat label="Average order value" metric={ceo.executiveSummary.averageOrderValue} format={formatMoney as never} />
          <MetricStat label="Refunds" metric={ceo.executiveSummary.refundsValue} format={formatMoney as never} />
          <MetricStat label="Refund rate" metric={ceo.executiveSummary.refundRatePct} format={((v: number) => `${v}%`) as never} />
          <MetricStat label="Return rate" metric={ceo.executiveSummary.returnRatePct} format={((v: number) => `${v}%`) as never} />
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Known net margin</p>
            {ceo.executiveSummary.knownNetMarginPct === null ? (
              <Badge tone="neutral" className="mt-1.5">UNKNOWN</Badge>
            ) : (
              <>
                <p className="mt-1 text-sm font-medium">{ceo.executiveSummary.knownNetMarginPct}%{ceo.executiveSummary.profitDataComplete ? '' : '*'}</p>
                {!ceo.executiveSummary.profitDataComplete ? <p className="mt-0.5 text-xs text-caution">*Data incomplete</p> : null}
              </>
            )}
          </div>
        </div>
      </Card>

      {/* --- 3. Business health scorecard -------------------------------- */}
      <Card>
        <CardHeader
          title="Business health"
          description="Deterministic classifications from real facts — never an invented score. Click through on anything that is not healthy to understand why."
          action={<Badge tone={HEALTH_TONE[ceo.businessHealth.overall]}>{HEALTH_LABEL[ceo.businessHealth.overall]} overall</Badge>}
        />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          {ceo.businessHealth.areas.map((area) => <HealthAreaTile key={area.key} area={area} />)}
        </div>
      </Card>

      {/* --- 4. Revenue and profit / channel performance ------------------ */}
      <Card>
        <CardHeader
          title="Channel performance"
          description="Never one blended figure — each channel's own realised sales and known projected profit."
          action={<Link href="/marketplaces" className="text-sm text-accent hover:underline">Marketplaces</Link>}
        />
        {ceo.financialPerformance.channels.length === 0 ? (
          <EmptyState title={ceo.isDemo ? 'Demo mode' : 'No channel data yet'} description={ceo.isDemo ? 'See the demo scenarios below.' : 'Channel figures appear once orders start flowing through a connected channel.'} />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Orders</th>
                  <th className="px-3 py-2 text-right font-medium">Known net profit</th>
                  <th className="px-5 py-2 text-right font-medium">Avg. margin</th>
                </tr>
              </thead>
              <tbody>
                {ceo.financialPerformance.channels.map((c) => (
                  <tr key={c.channel} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-medium">{c.label}</td>
                    <td className="tabular px-3 py-3 text-right">{c.sales.revenue.value ? formatMoney(c.sales.revenue.value) : '—'}</td>
                    <td className="tabular px-3 py-3 text-right">{c.sales.orders.value ?? '—'}</td>
                    <td className="tabular px-3 py-3 text-right">
                      {c.profit.knownNetProfit.status === 'calculated' && c.profit.knownNetProfit.value ? formatMoney(c.profit.knownNetProfit.value) : <Badge tone="neutral">{c.profit.knownNetProfit.status.toUpperCase()}</Badge>}
                    </td>
                    <td className="tabular px-5 py-3 text-right">{c.profit.averageNetMarginPct.status === 'calculated' ? `${c.profit.averageNetMarginPct.value}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* --- 5. Products: top performers / problem products --------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top performers" description="Ranked by realised revenue, among products with a known price and cost." />
          {ceo.financialPerformance.topRevenueProducts.length === 0 ? (
            <EmptyState title={ceo.isDemo ? 'Demo mode' : 'No trading history yet'} description={ceo.isDemo ? 'See the demo scenarios below.' : 'Product performance appears once orders start flowing.'} />
          ) : (
            <ul className="divide-y divide-border">
              {ceo.financialPerformance.topRevenueProducts.map((p) => (
                <li key={`${p.productId}:${p.channel}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.productId}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">{p.channel}</p>
                  </div>
                  <p className="tabular shrink-0 text-sm font-medium text-positive">{p.netMarginPct !== null ? `${p.netMarginPct}%` : '—'}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Problem products" description="Loss-making right now, kept channel-specific — a product can be loss-making on one channel and profitable on another." />
          {ceo.financialPerformance.lossMakingProducts.length === 0 ? (
            <EmptyState title={ceo.isDemo ? 'Demo mode' : 'Nothing losing money'} description={ceo.isDemo ? 'See the demo scenarios below.' : 'Every product with a known projection currently clears its cost base.'} />
          ) : (
            <ul className="divide-y divide-border">
              {ceo.financialPerformance.lossMakingProducts.map((p) => (
                <li key={`${p.productId}:${p.channel}`} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.productId}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">{p.channel}</p>
                  </div>
                  <p className="tabular shrink-0 text-sm font-medium text-negative">{p.netProfitMinor !== null ? formatMoney({ minor: p.netProfitMinor, currency: 'GBP' }) : '—'}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --- 6. Supplier command centre ------------------------------------ */}
      <Card>
        <CardHeader
          title="Supplier health"
          description="A deterministic classification from real dispatch, cancellation and fulfilment-success facts, always with a stated reason."
          action={<Link href="/suppliers" className="text-sm text-accent hover:underline">All suppliers</Link>}
        />
        {ceo.supplierHealth.length === 0 ? (
          <EmptyState title={ceo.isDemo ? 'Demo mode' : 'No live supplier data yet'} description={ceo.isDemo ? 'See the demo scenarios below.' : ''} />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {ceo.supplierHealth.map((s) => (
              <li key={s.supplierId} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/suppliers/${s.supplierId}`} className="text-sm font-medium text-accent hover:underline">{s.supplierId}</Link>
                  <Badge tone={s.status === 'healthy' ? 'positive' : s.status === 'watch' ? 'accent' : s.status === 'at_risk' ? 'caution' : s.status === 'unavailable' ? 'negative' : 'neutral'}>{s.status.replace('_', ' ')}</Badge>
                </div>
                {s.reasons.length > 0 ? <p className="mt-1 text-xs text-ink-subtle">{s.reasons.join(' ')}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Supplier approval status"
          description="Approval is per channel. Amazon's requirements are stricter, so a supplier can be fine for one and unusable for the other."
          action={<Link href="/suppliers" className="text-sm text-accent hover:underline">All suppliers</Link>}
        />
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-subtle">
                <th className="px-5 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 text-right font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Shopify</th>
                <th className="px-3 py-2 font-medium">Amazon UK</th>
                <th className="px-5 py-2 text-right font-medium">On time</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-2.5">
                    <Link href={`/suppliers/${supplier.id}`} className="font-medium text-accent hover:underline">{supplier.name}</Link>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{supplier.score}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={supplier.shopifyStatus === 'approved' ? 'positive' : supplier.shopifyStatus === 'blocked' ? 'negative' : 'caution'}>{supplier.shopifyStatus.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={supplier.amazonStatus === 'approved' ? 'positive' : supplier.amazonStatus === 'blocked' ? 'negative' : 'caution'}>{supplier.amazonStatus.replace(/_/g, ' ')}</Badge>
                  </td>
                  <td className="tabular px-5 py-2.5 text-right">{formatPct(supplier.onTimeRatePct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      {/* --- 7. Fulfilment command centre ----------------------------------- */}
      <Card>
        <CardHeader
          title="Fulfilment health"
          description="From real fulfilments/shipments rows — a shipment with no delivery confirmation and no tracking is UNKNOWN, never assumed delivered."
          action={<Link href="/orders" className="text-sm text-accent hover:underline">Orders</Link>}
        />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <MetricStat label="Awaiting fulfilment" metric={ceo.fulfilmentHealth.awaitingFulfilment} format={String as never} />
          <MetricStat label="Delivered" metric={ceo.fulfilmentHealth.delivered} format={String as never} />
          <MetricStat label="Missing tracking" metric={ceo.fulfilmentHealth.missingTracking} format={String as never} />
          <MetricStat label="Late deliveries" metric={ceo.fulfilmentHealth.lateDeliveries} format={String as never} />
          <MetricStat label="Cancellation rate" metric={ceo.fulfilmentHealth.cancellationRatePct} format={((v: number) => `${v}%`) as never} />
          <MetricStat label="On-time delivery" metric={ceo.fulfilmentHealth.onTimeDeliveryRatePct} format={((v: number) => `${v}%`) as never} />
          <MetricStat label="Avg. dispatch time" metric={ceo.fulfilmentHealth.averageDispatchDays} format={((v: number) => `${v} day(s)`) as never} />
          <MetricStat label="Unknown outcome" metric={ceo.fulfilmentHealth.unknownDeliveryOutcome} format={String as never} />
        </div>
      </Card>

      {/* --- 8. International markets ---------------------------------------- */}
      <Card>
        <CardHeader
          title="International markets"
          description="Every market in the catalog, and its real connector status — never LIVE unless a connector genuinely reports it."
        />
        {ceo.marketReadiness.length === 0 ? (
          <EmptyState title="No market catalog data" description="" />
        ) : (
          <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
            {ceo.marketReadiness.map((m) => (
              <div key={m.marketKey} className="bg-surface px-4 py-3">
                <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{m.label}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">{m.countryLabel}</p>
                <Badge tone={m.status === 'connected' || m.status === 'demo' ? 'positive' : m.status === 'error' ? 'negative' : m.status === 'degraded' ? 'caution' : 'neutral'} className="mt-1.5">
                  {m.status.replace(/_/g, ' ')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* --- 9. Automation command centre ------------------------------------ */}
      <Card>
        <CardHeader
          title="Automation health"
          description="What the autonomous system is doing, read directly from the job queue and policy engine — never recalculated here."
          action={<Link href="/automation" className="text-sm text-accent hover:underline">Automation</Link>}
        />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Status</p>
            <Badge tone={ceo.automationHealth.settings.automationPaused ? 'negative' : 'positive'} className="mt-1.5">
              {ceo.automationHealth.settings.automationPaused ? 'Paused' : 'Running'}
            </Badge>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Actions today</p>
            <p className="mt-1 text-sm font-medium">{ceo.automationHealth.today.actionsTotal}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Failed actions</p>
            <p className={`mt-1 text-sm font-medium ${ceo.automationHealth.risk.failedActions > 0 ? 'text-negative' : ''}`}>{ceo.automationHealth.risk.failedActions}</p>
          </div>
          <div className="bg-surface px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Dead-lettered jobs</p>
            <p className={`mt-1 text-sm font-medium ${ceo.automationHealth.risk.deadLetterJobs > 0 ? 'text-negative' : ''}`}>{ceo.automationHealth.risk.deadLetterJobs}</p>
          </div>
        </div>
        {ceo.automationHealth.settings.automationPausedCategories.length > 0 ? (
          <p className="border-t border-border px-5 py-3 text-xs text-caution">
            Paused categories: {ceo.automationHealth.settings.automationPausedCategories.join(', ')}.
          </p>
        ) : null}
      </Card>

      {/* --- 10. Approvals ----------------------------------------------------- */}
      <Card>
        <CardHeader
          title="Approvals awaiting you"
          description="Nothing here has been actioned. Each item is a recommendation waiting on the owner."
          action={<Link href="/approvals" className="text-sm text-accent hover:underline">View all</Link>}
        />
        {ceo.approvals.length === 0 ? (
          <EmptyState title="Nothing waiting" description="Every automated action so far has stayed inside its configured limits." />
        ) : (
          <ul className="divide-y divide-border">
            {ceo.approvals.slice(0, 5).map((item) => (
              <li key={item.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{item.title}</p>
                  {item.estimatedImpact ? <span className="tabular shrink-0 text-sm font-medium">{formatMoney(item.estimatedImpact)}</span> : null}
                </div>
                <p className="mt-1 text-sm text-ink-muted">{item.detail}</p>
                <p className="mt-1.5 text-xs text-ink-subtle">
                  Raised {formatRelative(item.createdAt)}
                  {item.expiresAt ? ` · expires ${formatRelative(item.expiresAt).replace(' ago', ' from now')}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* --- 11. Opportunities -------------------------------------------------- */}
      <section className="grid gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight text-ink">Opportunities</h2>
          <Link href="/opportunities" className="text-sm text-accent hover:underline">All opportunities</Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="New opportunities" value={String(intelligence.total)} sublabel={intelligence.topScore === null ? 'None evaluated' : `Top score ${intelligence.topScore}`} />
          <StatTile label="Recommended for testing" value={String(intelligence.recommendedForTesting)} tone={intelligence.recommendedForTesting > 0 ? 'positive' : 'neutral'} />
          <StatTile label="One channel only" value={String(channelDivergentOpportunities.length)} sublabel="Viable on one, blocked on the other" />
          <StatTile label="Requiring review" value={String(intelligence.needsReview)} tone={intelligence.needsReview > 0 ? 'caution' : 'neutral'} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Top candidates" description="Ranked by score. Every one has been through profitability and compliance." />
            {topOpportunities.length === 0 ? (
              <EmptyState title="Nothing evaluated yet" description="Connect a research provider to start finding candidates." />
            ) : (
              <ul className="divide-y divide-border">
                {topOpportunities.map((o) => (
                  <li key={o.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/opportunities/${o.id}`} className="min-w-0 text-sm font-medium text-accent hover:underline">{o.title}</Link>
                      <span className="tabular shrink-0 text-sm font-medium">{o.opportunityScore}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={ACTION_TONES[o.recommendedAction]}>{ACTION_LABELS[o.recommendedAction]}</Badge>
                      <Badge tone={o.shopifyProfitable ? 'positive' : 'negative'}>Shopify {o.shopifyProfitable ? 'viable' : 'not viable'}</Badge>
                      <Badge tone={o.amazonProfitable ? 'positive' : 'negative'}>Amazon {o.amazonProfitable ? 'viable' : 'not viable'}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Trending" description="Fastest rising demand, whatever the recommendation." />
            {trending.length === 0 ? (
              <EmptyState title="No trend data" description="Trend signals arrive with a research provider." />
            ) : (
              <ul className="divide-y divide-border">
                {trending.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <Link href={`/opportunities/${o.id}`} className="text-sm font-medium text-accent hover:underline">{o.title}</Link>
                      <p className="mt-0.5 text-xs text-ink-subtle">{o.category}</p>
                    </div>
                    <Badge tone={ACTION_TONES[o.recommendedAction]}>{ACTION_LABELS[o.recommendedAction]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      {/* --- 12. Data quality and trust ---------------------------------------- */}
      <Card>
        <CardHeader title="Can I trust these numbers?" description="Every place a figure above is genuinely incomplete — so no metric is mistaken for whole when it isn't." />
        {ceo.dataQuality.overallStatus === 'unknown' ? (
          <div className="px-5 py-8 text-center text-sm text-ink-muted">Demo mode has no live data to check — data quality is genuinely unknown here, not &quot;complete&quot;.</div>
        ) : ceo.dataQuality.issues.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-positive">Every check passed — no known data-quality gaps right now.</div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {ceo.dataQuality.issues.map((issue) => (
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

      {/* --- 13. Stock and compliance detail ------------------------------------ */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Stock" action={<Link href="/products" className="text-sm text-accent hover:underline">Products</Link>} />
          {stockAlerts.length === 0 ? (
            <EmptyState title="No stock alerts" description="Nothing is close to running out." />
          ) : (
            <ul className="divide-y divide-border">
              {stockAlerts.map((alert) => (
                <li key={alert.productId} className="px-5 py-3.5">
                  <p className="text-sm font-medium">{alert.sku}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">{alert.daysRemaining} days remaining{alert.isSupplierStocked ? ', held by the supplier' : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Compliance" action={<Link href="/compliance" className="text-sm text-accent hover:underline">Details</Link>} />
          {compliance.length === 0 ? (
            <EmptyState title="No open issues" description="No product is currently blocked or awaiting review." />
          ) : (
            <ul className="divide-y divide-border">
              {compliance.map((issue) => (
                <li key={`${issue.productId}-${issue.channel}`} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{issue.sku}</p>
                    <Badge tone={issue.verdict === 'fail' ? 'negative' : 'caution'}>{issue.verdict === 'fail' ? 'Blocked' : 'Review required'}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {issue.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'} · {issue.blockingReasons.length} requirement{issue.blockingReasons.length === 1 ? '' : 's'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --- 14. Recent activity ------------------------------------------------- */}
      <Card>
        <CardHeader title="Recent business activity" description="Combines real monitoring events and automation actions — never a second audit log." action={<Link href="/audit" className="text-sm text-accent hover:underline">Full audit log</Link>} />
        {ceo.recentActivity.length === 0 ? (
          <EmptyState title={ceo.isDemo ? 'Demo mode' : 'No recent activity'} description={ceo.isDemo ? 'See the demo scenarios below.' : ''} />
        ) : (
          <ul className="divide-y divide-border">
            {ceo.recentActivity.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.title}</p>
                  <p className="truncate text-xs text-ink-muted">{item.detail}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone="neutral">{item.category}</Badge>
                  <p className="mt-1 text-xs text-ink-subtle">{formatRelative(item.occurredAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {ceo.isDemo ? (
        <>
          <Card className="border-demo/30 bg-demo-soft">
            <div className="px-5 py-4">
              <p className="text-sm text-demo">
                Demo mode has no database, so every KPI above is a real, honest zero or UNKNOWN. Every scenario below
                runs the real priority-ranking and business-health composition against deliberately chosen facts.
              </p>
            </div>
          </Card>
          <div className="grid gap-4">
            {ceo.demoScenarios.map((scenario) => <DemoScenarioCard key={scenario.key} scenario={scenario} />)}
          </div>
        </>
      ) : null}
    </>
  )
}
