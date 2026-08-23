import Link from 'next/link'
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatTile } from '@/components/ui'
import { ACTION_LABELS, ACTION_TONES } from '@/components/dashboard/RecommendationPanel'
import { formatMoney } from '@/lib/core/money'
import { formatPct } from '@/lib/utils'
import { getIntelligenceSummary, getOpportunities } from '@/lib/products/opportunities'
import type { ComplianceVerdict, OpportunitySummary } from '@/lib/core/domain'

export const dynamic = 'force-dynamic'

const VERDICT_LABELS: Record<ComplianceVerdict, string> = {
  pass: 'Pass',
  fail: 'Blocked',
  review_required: 'Review',
  not_assessed: 'Not assessed',
}

const VERDICT_TONES: Record<ComplianceVerdict, 'positive' | 'negative' | 'caution' | 'neutral'> = {
  pass: 'positive',
  fail: 'negative',
  review_required: 'caution',
  not_assessed: 'neutral',
}

function ChannelVerdict({
  label,
  verdict,
  profitable,
  netProfit,
}: {
  label: string
  verdict: ComplianceVerdict
  profitable: boolean
  netProfit: OpportunitySummary['shopifyNetProfit']
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs font-medium text-ink-subtle">{label}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={VERDICT_TONES[verdict]}>{VERDICT_LABELS[verdict]}</Badge>
        <Badge tone={profitable ? 'positive' : 'negative'}>
          {profitable ? 'Profitable' : 'Unprofitable'}
        </Badge>
      </div>
      <p className="tabular mt-1.5 text-sm font-medium">
        {formatMoney(netProfit)}
        <span className="ml-1 text-xs font-normal text-ink-subtle">per unit</span>
      </p>
    </div>
  )
}

export default async function OpportunitiesPage() {
  const [opportunities, summary] = await Promise.all([
    getOpportunities(),
    getIntelligenceSummary(),
  ])

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="Candidates that have been through the full pipeline: complaint analysis, supplier selection, per-channel profitability, compliance, then scoring. A high score is a reason to look closer, never a reason to launch."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Recommended for testing"
          value={String(summary.recommendedForTesting)}
          sublabel={`of ${summary.total} evaluated`}
          tone={summary.recommendedForTesting > 0 ? 'positive' : 'neutral'}
        />
        <StatTile
          label="Need review"
          value={String(summary.needsReview)}
          sublabel="Held pending a person"
          tone={summary.needsReview > 0 ? 'caution' : 'neutral'}
        />
        <StatTile
          label="Viable on one channel only"
          value={String(summary.channelDivergent)}
          sublabel="Blocked on the other"
        />
        <StatTile
          label="Rejected"
          value={String(summary.rejected)}
          sublabel={summary.highIpRisk > 0 ? `${summary.highIpRisk} for IP risk` : 'On economics or compliance'}
        />
      </section>

      {opportunities.length === 0 ? (
        <Card>
          <EmptyState
            title="No candidates yet"
            description="Opportunities appear once a research provider has run. Providers only use official APIs, licensed datasets and permitted sources, so each one needs to be configured before it can contribute."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {opportunities.map((opportunity) => (
            <Card key={opportunity.id}>
              <CardHeader
                title={opportunity.title}
                description={opportunity.headline}
                action={
                  <div className="text-right">
                    <p className="tabular text-2xl font-semibold">{opportunity.opportunityScore}</p>
                    <Badge tone={ACTION_TONES[opportunity.recommendedAction]}>
                      {ACTION_LABELS[opportunity.recommendedAction]}
                    </Badge>
                  </div>
                }
              />

              <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
                <ChannelVerdict
                  label="Shopify"
                  verdict={opportunity.shopifyCompliance}
                  profitable={opportunity.shopifyProfitable}
                  netProfit={opportunity.shopifyNetProfit}
                />
                <ChannelVerdict
                  label="Amazon UK"
                  verdict={opportunity.amazonCompliance}
                  profitable={opportunity.amazonProfitable}
                  netProfit={opportunity.amazonNetProfit}
                />
              </div>

              <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Estimated price</dt>
                  <dd className="tabular mt-0.5 text-sm font-medium">
                    {formatMoney(opportunity.estimatedSellingPrice)}
                  </dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Unit cost</dt>
                  <dd className="tabular mt-0.5 text-sm font-medium">
                    {formatMoney(opportunity.estimatedUnitCost)}
                  </dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Best margin</dt>
                  <dd className="tabular mt-0.5 text-sm font-medium">
                    {formatPct(opportunity.estimatedContributionMarginPct)}
                  </dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Supplier</dt>
                  <dd className="mt-0.5 text-sm font-medium">
                    {opportunity.supplierName ?? 'Not identified'}
                    {opportunity.supplierScore !== null ? (
                      <span className="ml-1 text-xs font-normal text-ink-subtle">
                        {opportunity.supplierScore}/100
                      </span>
                    ) : null}
                  </dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">IP risk</dt>
                  <dd className="mt-0.5">
                    <Badge
                      tone={
                        opportunity.ipRisk === 'high'
                          ? 'negative'
                          : opportunity.ipRisk === 'medium'
                            ? 'caution'
                            : 'positive'
                      }
                    >
                      {opportunity.ipRisk}
                    </Badge>
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-3">
                <span className="text-xs text-ink-subtle">
                  {opportunity.confidenceLabel} confidence ({Math.round(opportunity.confidence * 100)}%)
                  {' · '}
                  {opportunity.sourceLabel}
                </span>
                <Link
                  href={`/opportunities/${opportunity.id}`}
                  className="ml-auto text-sm text-accent hover:underline"
                >
                  Full analysis
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
