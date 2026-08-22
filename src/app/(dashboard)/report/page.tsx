import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { formatMoney } from '@/lib/core/money'
import { formatDateTime, formatPct } from '@/lib/utils'
import { getDailyReport } from '@/lib/analytics/repository'

export const dynamic = 'force-dynamic'

/**
 * The daily briefing (§49, §78).
 *
 * Written to be readable in a few minutes. The rule it follows is that a
 * section only earns space when it needs a decision or explains a change.
 */
export default async function ReportPage() {
  const report = await getDailyReport()
  const { business, finance, cashflow } = report

  const actionCount =
    report.approvals.length +
    report.complianceIssues.length +
    report.stockAlerts.filter((a) => a.requiresApproval).length

  return (
    <>
      <PageHeader
        title="Daily report"
        description={`Generated ${formatDateTime(report.generatedAt)}. ${business.periodLabel}.`}
      />

      <Card>
        <CardHeader title="Business" />
        <dl className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Revenue', value: formatMoney(business.revenue) },
            { label: 'Contribution', value: formatMoney(business.contribution) },
            { label: 'Orders', value: String(business.orders) },
            { label: 'Margin', value: formatPct(business.contributionMarginPct) },
          ].map((item) => (
            <div key={item.label} className="bg-surface px-5 py-3.5">
              <dt className="text-xs text-ink-subtle">{item.label}</dt>
              <dd className="tabular mt-0.5 text-lg font-semibold">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Winners" description="Doing well enough to justify more exposure." />
          {report.winners.length === 0 ? (
            <EmptyState title="No trading history" description="Nothing has sold yet." />
          ) : (
            <ul className="divide-y divide-border">
              {report.winners.map((product) => (
                <li key={product.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{product.title}</p>
                    <p className="tabular shrink-0 text-sm font-medium text-positive">
                      {formatMoney(product.contribution)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    Demand {product.trendPct > 0 ? 'up' : 'down'} {Math.abs(product.trendPct)}% ·{' '}
                    {formatPct(product.contributionMarginPct)} margin · health {product.healthScore}
                  </p>
                  <p className="mt-1.5 text-sm text-ink-muted">
                    Recommendation: {product.trendPct > 15 ? 'increase exposure within the advertising limit.' : 'hold current exposure and keep monitoring.'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Losers" description="Failing the configured profitability rules." />
          {report.losers.length === 0 ? (
            <EmptyState title="Nothing losing money" description="Every trading product is contributing." />
          ) : (
            <ul className="divide-y divide-border">
              {report.losers.map((product) => (
                <li key={product.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{product.title}</p>
                    <p className="tabular shrink-0 text-sm font-medium text-negative">
                      {formatMoney(product.contribution)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {product.unitsSold} units · {formatPct(product.returnRatePct)} returns ·{' '}
                    {formatMoney(product.adSpend)} advertising
                  </p>
                  <p className="mt-1.5 text-sm text-ink-muted">Recommendation: pause and stop the advertising spend.</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Opportunities" description="Candidates worth investigating. None has been launched." />
        {report.opportunities.length === 0 ? (
          <EmptyState title="No candidates" description="Connect a research data source to populate this." />
        ) : (
          <ul className="divide-y divide-border">
            {report.opportunities.map((opportunity) => (
              <li key={opportunity.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{opportunity.title}</p>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      Score {opportunity.opportunityScore}/100 ·{' '}
                      {formatPct(opportunity.estimatedContributionMarginPct)} estimated contribution margin ·{' '}
                      {opportunity.supplierIdentified ? 'supplier identified' : 'no supplier yet'}
                    </p>
                  </div>
                  <Badge tone={opportunity.amazonCompliance === 'pass' ? 'positive' : opportunity.amazonCompliance === 'fail' ? 'negative' : 'caution'}>
                    Amazon · {opportunity.amazonCompliance.replace('_', ' ')}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Stock" />
          {report.stockAlerts.length === 0 ? (
            <EmptyState title="Nothing running low" description="No product is close to going out of stock." />
          ) : (
            <ul className="divide-y divide-border">
              {report.stockAlerts.map((alert) => (
                <li key={alert.productId} className="px-5 py-3.5 text-sm">
                  <p className="font-medium">{alert.title}</p>
                  <p className="mt-0.5 text-ink-muted">
                    {alert.daysRemaining} days remaining.
                    {alert.recommendedOrderQty > 0
                      ? ` Recommended order ${formatMoney(alert.recommendedOrderCost)}${alert.requiresApproval ? ', needs your approval' : ''}.`
                      : ' Held by the supplier, no purchase order needed.'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Finance" />
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-ink-muted">Invoices generated</dt>
              <dd className="tabular">{finance.invoicesGenerated}</dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-ink-muted">Invoices sent</dt>
              <dd className="tabular">
                {finance.invoicesSent}
                {finance.invoicesFailed > 0 ? (
                  <span className="ml-2 text-negative">{finance.invoicesFailed} failed</span>
                ) : null}
              </dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-ink-muted">Estimated VAT due</dt>
              <dd className="tabular">{finance.vatRegistered ? formatMoney(finance.estimatedVatDue) : 'Not registered'}</dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-ink-muted">Accounting sync</dt>
              <dd>{finance.accountingSyncStatus === 'connected' ? 'Up to date' : `Not connected · ${finance.accountingPending} pending`}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className={actionCount > 0 ? 'border-caution/40' : ''}>
        <CardHeader
          title="Action required"
          description={actionCount === 0 ? 'Nothing needs you today.' : `${actionCount} item${actionCount === 1 ? '' : 's'} need your attention.`}
        />
        {actionCount === 0 ? (
          <EmptyState title="All clear" description="Everything else is running inside its configured limits." />
        ) : (
          <ul className="divide-y divide-border text-sm">
            {report.approvals.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <span>{item.title}</span>
                <Badge tone="caution">Approval</Badge>
              </li>
            ))}
            {report.complianceIssues.map((issue) => (
              <li key={`${issue.productId}-${issue.channel}`} className="flex items-start justify-between gap-3 px-5 py-3">
                <span>
                  {issue.sku} on {issue.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'}
                </span>
                <Badge tone={issue.verdict === 'fail' ? 'negative' : 'caution'}>
                  {issue.verdict === 'fail' ? 'Blocked' : 'Review'}
                </Badge>
              </li>
            ))}
            {cashflow.warning ? (
              <li className="flex items-start justify-between gap-3 px-5 py-3">
                <span>{cashflow.warning}</span>
                <Badge tone="caution">Cashflow</Badge>
              </li>
            ) : null}
          </ul>
        )}
      </Card>

      <p className="text-xs text-ink-subtle">
        This report describes what the data shows. It is not a guarantee of future profit, and every
        financial and legal decision remains yours.
      </p>
    </>
  )
}
