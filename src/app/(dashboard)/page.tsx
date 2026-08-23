import Link from 'next/link'
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatTile, TableWrap } from '@/components/ui'
import { ChannelStatus } from '@/components/dashboard/ChannelStatus'
import { formatMoney, formatMoneyCompact } from '@/lib/core/money'
import { formatPct, formatRelative } from '@/lib/utils'
import { getBusinessSummary, getCashflow, getChannelSummaries } from '@/lib/analytics/repository'
import { getProducts, getStockAlerts } from '@/lib/products/repository'
import {
  getIntelligenceSummary,
  getOpportunities,
  getTrendingOpportunities,
} from '@/lib/products/opportunities'
import { ACTION_LABELS, ACTION_TONES } from '@/components/dashboard/RecommendationPanel'
import { getComplianceIssues } from '@/lib/compliance/repository'
import { getPendingApprovals } from '@/lib/automation/approvals'
import { getFinanceSummary } from '@/lib/tax/repository'
import { getSuppliers } from '@/lib/suppliers/repository'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [
    business, channels, products, stockAlerts, compliance, approvals, finance, cashflow,
    intelligence, opportunities, trending, suppliers,
  ] = await Promise.all([
    getBusinessSummary(),
    getChannelSummaries(),
    getProducts(),
    getStockAlerts(),
    getComplianceIssues(),
    getPendingApprovals(),
    getFinanceSummary(),
    getCashflow(),
    getIntelligenceSummary(),
    getOpportunities(),
    getTrendingOpportunities(),
    getSuppliers(),
  ])

  const topOpportunities = [...opportunities]
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 4)
  const needsReview = opportunities.filter((o) => o.recommendedAction === 'review')
  const rejected = opportunities.filter((o) => o.recommendedAction === 'reject')

  const ranked = [...products].sort((a, b) => b.contribution.minor - a.contribution.minor)
  const winners = ranked.filter((p) => p.contribution.minor > 0).slice(0, 3)
  const losers = ranked.filter((p) => p.contribution.minor <= 0 && p.unitsSold > 0).slice(-3).reverse()

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${business.periodLabel}. Contribution, not revenue, is the headline figure: it is what the business actually keeps after every cost of making the sale.`}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Revenue"
          value={formatMoney(business.revenue)}
          sublabel={`${business.orders} orders`}
          change={business.revenueChangePct}
        />
        <StatTile
          label="Contribution"
          value={formatMoney(business.contribution)}
          sublabel={formatPct(business.contributionMarginPct) + ' margin'}
          change={business.contributionChangePct}
          tone={business.contribution.minor < 0 ? 'negative' : 'positive'}
        />
        <StatTile
          label="Estimated net profit"
          value={formatMoney(business.estimatedNetProfit)}
          sublabel="After fixed operating costs"
          tone={business.estimatedNetProfit.minor < 0 ? 'negative' : 'neutral'}
        />
        <StatTile
          label="Cash available"
          value={formatMoney(business.cashAvailable)}
          sublabel={`Low point ${formatMoney(cashflow.projectedLowPoint)}`}
          tone={cashflow.warning ? 'caution' : 'neutral'}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Average order value" value={formatMoney(business.averageOrderValue)} sublabel={`${business.units} units`} />
        <StatTile label="Advertising" value={formatMoney(business.adSpend)} sublabel={business.roas === null ? 'No spend' : `${business.roas.toFixed(2)}x ROAS`} />
        <StatTile label="Return rate" value={formatPct(business.returnRatePct)} sublabel={`${formatPct(business.refundRatePct)} refunds`} />
        <StatTile label="Awaiting your approval" value={String(approvals.length)} sublabel="Level 3 decisions" tone={approvals.length > 0 ? 'caution' : 'neutral'} />
      </section>

      {cashflow.warning ? (
        <Card className="border-caution/40 bg-caution-soft">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-caution">Cashflow warning</p>
            <p className="mt-1 text-sm text-ink">{cashflow.warning}</p>
            <p className="mt-2 text-xs text-ink-muted">
              Revenue growing while payouts lag behind supplier payments is the most common way a
              profitable ecommerce business runs out of money.
            </p>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Channels" description="Shopify and Amazon are tracked as separate businesses." />
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2 font-medium">Channel</th>
                  <th className="px-3 py-2 text-right font-medium">Revenue</th>
                  <th className="px-3 py-2 text-right font-medium">Contribution</th>
                  <th className="px-5 py-2 text-right font-medium">Listings</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((channel) => (
                  <tr key={channel.channel} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <div className="font-medium">{channel.label}</div>
                      <Badge tone={channel.connectionMode === 'demo' ? 'demo' : channel.isConnected ? 'positive' : 'neutral'} className="mt-1">
                        {channel.connectionMode === 'demo' ? 'Simulated' : channel.isConnected ? 'Connected' : 'Not connected'}
                      </Badge>
                    </td>
                    <td className="tabular px-3 py-3 text-right">{formatMoney(channel.revenue)}</td>
                    <td className="tabular px-3 py-3 text-right">{formatMoney(channel.contribution)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="tabular">{channel.liveListings} live</div>
                      {channel.blockedListings > 0 ? (
                        <div className="tabular text-xs text-negative">{channel.blockedListings} blocked</div>
                      ) : null}
                      {channel.reviewRequiredListings > 0 ? (
                        <div className="tabular text-xs text-caution">{channel.reviewRequiredListings} to review</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card>
          <CardHeader
            title="Needs your decision"
            description="Nothing here has been actioned. Each item is a recommendation waiting on you."
            action={<Link href="/approvals" className="text-sm text-accent hover:underline">View all</Link>}
          />
          {approvals.length === 0 ? (
            <EmptyState title="Nothing waiting" description="Every automated action so far has stayed inside its configured limits." />
          ) : (
            <ul className="divide-y divide-border">
              {approvals.map((item) => (
                <li key={item.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.estimatedImpact ? (
                      <span className="tabular shrink-0 text-sm font-medium">{formatMoney(item.estimatedImpact)}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">{item.detail}</p>
                  <p className="mt-1.5 text-xs text-ink-subtle">
                    Raised {formatRelative(item.createdAt)}
                    {item.confidence !== null ? ` · ${Math.round(item.confidence * 100)}% confidence` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Best performers" description="Ranked by contribution, not by units sold." />
          {winners.length === 0 ? (
            <EmptyState title="No trading history yet" description="Product performance appears once orders start flowing through a connected channel." />
          ) : (
            <ul className="divide-y divide-border">
              {winners.map((product) => (
                <li key={product.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{product.title}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">{product.sku}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-medium text-positive">{formatMoney(product.contribution)}</p>
                      <p className="tabular text-xs text-ink-subtle">{formatPct(product.contributionMarginPct)}</p>
                    </div>
                  </div>
                  <div className="mt-2"><ChannelStatus status={product.channelStatus} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Losing money" description="Products failing the configured contribution rules." />
          {losers.length === 0 ? (
            <EmptyState title="Nothing losing money" description="Every trading product is currently contributing above its cost base." />
          ) : (
            <ul className="divide-y divide-border">
              {losers.map((product) => (
                <li key={product.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{product.title}</p>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {product.sku} · {product.unitsSold} units · {formatPct(product.returnRatePct)} returns
                      </p>
                    </div>
                    <p className="tabular shrink-0 text-sm font-medium text-negative">
                      {formatMoney(product.contribution)}
                    </p>
                  </div>
                  <div className="mt-2"><ChannelStatus status={product.channelStatus} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* --- Product intelligence ---------------------------------------- */}
      <section className="grid gap-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight text-ink">Product intelligence</h2>
          <Link href="/opportunities" className="text-sm text-accent hover:underline">
            All opportunities
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatTile
            label="New opportunities"
            value={String(intelligence.total)}
            sublabel={intelligence.topScore === null ? 'None evaluated' : `Top score ${intelligence.topScore}`}
          />
          <StatTile
            label="Recommended for testing"
            value={String(intelligence.recommendedForTesting)}
            sublabel="Awaiting your approval"
            tone={intelligence.recommendedForTesting > 0 ? 'positive' : 'neutral'}
          />
          <StatTile
            label="Requiring review"
            value={String(intelligence.needsReview)}
            sublabel="Held pending a person"
            tone={intelligence.needsReview > 0 ? 'caution' : 'neutral'}
          />
          <StatTile
            label="Rejected"
            value={String(intelligence.rejected)}
            sublabel={intelligence.highIpRisk > 0 ? `${intelligence.highIpRisk} for IP risk` : 'On economics'}
          />
          <StatTile
            label="One channel only"
            value={String(intelligence.channelDivergent)}
            sublabel="Viable on one, blocked on the other"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Top opportunities"
              description="Ranked by score. Every one has been through profitability and compliance."
            />
            {topOpportunities.length === 0 ? (
              <EmptyState
                title="Nothing evaluated yet"
                description="Connect a research provider to start finding candidates."
              />
            ) : (
              <ul className="divide-y divide-border">
                {topOpportunities.map((opportunity) => (
                  <li key={opportunity.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        href={`/opportunities/${opportunity.id}`}
                        className="min-w-0 text-sm font-medium text-accent hover:underline"
                      >
                        {opportunity.title}
                      </Link>
                      <span className="tabular shrink-0 text-sm font-medium">
                        {opportunity.opportunityScore}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={ACTION_TONES[opportunity.recommendedAction]}>
                        {ACTION_LABELS[opportunity.recommendedAction]}
                      </Badge>
                      <Badge tone={opportunity.shopifyProfitable ? 'positive' : 'negative'}>
                        Shopify {opportunity.shopifyProfitable ? 'viable' : 'not viable'}
                      </Badge>
                      <Badge tone={opportunity.amazonProfitable ? 'positive' : 'negative'}>
                        Amazon {opportunity.amazonProfitable ? 'viable' : 'not viable'}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-xs text-ink-subtle">
                      {opportunity.supplierName
                        ? `${opportunity.supplierName} · supplier score ${opportunity.supplierScore}`
                        : 'No supplier identified'}
                      {' · '}
                      {opportunity.confidenceLabel.toLowerCase()} confidence
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Trending"
              description="Fastest rising demand, whatever the recommendation."
            />
            {trending.length === 0 ? (
              <EmptyState title="No trend data" description="Trend signals arrive with a research provider." />
            ) : (
              <ul className="divide-y divide-border">
                {trending.map((opportunity) => (
                  <li key={opportunity.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <Link
                        href={`/opportunities/${opportunity.id}`}
                        className="text-sm font-medium text-accent hover:underline"
                      >
                        {opportunity.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-subtle">{opportunity.category}</p>
                    </div>
                    <Badge tone={ACTION_TONES[opportunity.recommendedAction]}>
                      {ACTION_LABELS[opportunity.recommendedAction]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Supplier quality"
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
                      <Link href={`/suppliers/${supplier.id}`} className="font-medium text-accent hover:underline">
                        {supplier.name}
                      </Link>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{supplier.score}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={supplier.shopifyStatus === 'approved' ? 'positive' : supplier.shopifyStatus === 'blocked' ? 'negative' : 'caution'}>
                        {supplier.shopifyStatus.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge tone={supplier.amazonStatus === 'approved' ? 'positive' : supplier.amazonStatus === 'blocked' ? 'negative' : 'caution'}>
                        {supplier.amazonStatus.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="tabular px-5 py-2.5 text-right">{formatPct(supplier.onTimeRatePct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        {needsReview.length > 0 || rejected.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Requiring review"
                description="Viable on the numbers, held until something is obtained or decided."
              />
              <ul className="divide-y divide-border">
                {needsReview.map((opportunity) => (
                  <li key={opportunity.id} className="px-5 py-3">
                    <Link
                      href={`/opportunities/${opportunity.id}`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      {opportunity.title}
                    </Link>
                    <p className="mt-1 text-xs text-ink-muted">{opportunity.headline}</p>
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <CardHeader title="Rejected" description="Kept so the same candidate is not researched twice." />
              <ul className="divide-y divide-border">
                {rejected.map((opportunity) => (
                  <li key={opportunity.id} className="px-5 py-3">
                    <Link
                      href={`/opportunities/${opportunity.id}`}
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      {opportunity.title}
                    </Link>
                    <p className="mt-1 text-xs text-ink-muted">{opportunity.headline}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Stock" action={<Link href="/products" className="text-sm text-accent hover:underline">Products</Link>} />
          {stockAlerts.length === 0 ? (
            <EmptyState title="No stock alerts" description="Nothing is close to running out." />
          ) : (
            <ul className="divide-y divide-border">
              {stockAlerts.map((alert) => (
                <li key={alert.productId} className="px-5 py-3.5">
                  <p className="text-sm font-medium">{alert.sku}</p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {alert.daysRemaining} days remaining
                    {alert.isSupplierStocked ? ', held by the supplier' : ''}
                  </p>
                  {alert.recommendedOrderQty > 0 ? (
                    <p className="mt-1 text-xs text-ink-subtle">
                      Recommended order: {alert.recommendedOrderQty} units,{' '}
                      {formatMoney(alert.recommendedOrderCost)}
                      {alert.requiresApproval ? ' (needs approval)' : ''}
                    </p>
                  ) : null}
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
                    <Badge tone={issue.verdict === 'fail' ? 'negative' : 'caution'}>
                      {issue.verdict === 'fail' ? 'Blocked' : 'Review required'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {issue.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'} ·{' '}
                    {issue.blockingReasons.length} requirement
                    {issue.blockingReasons.length === 1 ? '' : 's'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Finance" action={<Link href="/finance" className="text-sm text-accent hover:underline">Finance</Link>} />
          <dl className="divide-y divide-border text-sm">
            <div className="flex items-center justify-between px-5 py-2.5">
              <dt className="text-ink-muted">Invoices sent</dt>
              <dd className="tabular">{finance.invoicesSent} of {finance.invoicesGenerated}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5">
              <dt className="text-ink-muted">VAT registered</dt>
              <dd>{finance.vatRegistered ? 'Yes' : 'No'}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5">
              <dt className="text-ink-muted">Estimated VAT due</dt>
              <dd className="tabular">{finance.vatRegistered ? formatMoneyCompact(finance.estimatedVatDue) : 'n/a'}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-2.5">
              <dt className="text-ink-muted">Accounting sync</dt>
              <dd>
                <Badge tone={finance.accountingSyncStatus === 'connected' ? 'positive' : 'neutral'}>
                  {finance.accountingSyncStatus === 'connected' ? 'Connected' : 'Not connected'}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  )
}
