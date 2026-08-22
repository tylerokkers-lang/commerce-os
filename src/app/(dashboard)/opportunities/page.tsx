import { Badge, Card, EmptyState, PageHeader } from '@/components/ui'
import { formatMoney } from '@/lib/core/money'
import { formatPct } from '@/lib/utils'
import { getOpportunities } from '@/lib/products/repository'
import type { ComplianceVerdict } from '@/lib/core/domain'

export const dynamic = 'force-dynamic'

const VERDICT_LABELS: Record<ComplianceVerdict, string> = {
  pass: 'Pass',
  fail: 'Blocked',
  review_required: 'Review required',
  not_assessed: 'Not assessed',
}

const VERDICT_TONES: Record<ComplianceVerdict, 'positive' | 'negative' | 'caution' | 'neutral'> = {
  pass: 'positive',
  fail: 'negative',
  review_required: 'caution',
  not_assessed: 'neutral',
}

export default async function OpportunitiesPage() {
  const opportunities = await getOpportunities()

  return (
    <>
      <PageHeader
        title="Opportunities"
        description="Candidate products scored on demand, competition, margin, risk and compliance. A high score is a reason to investigate, never a reason to launch: every candidate still has to clear the profitability and compliance gates."
      />

      {opportunities.length === 0 ? (
        <Card>
          <EmptyState
            title="No candidates yet"
            description="The research engine populates this once a data source is connected. It only uses official APIs and licensed or permitted data."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {opportunities.map((opportunity) => (
            <Card key={opportunity.id}>
              <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{opportunity.title}</h2>
                    <Badge tone="neutral">{opportunity.category}</Badge>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm text-ink-muted">{opportunity.rationale}</p>
                  <p className="mt-2 text-xs text-ink-subtle">Source: {opportunity.sourceLabel}</p>
                </div>
                <div className="text-right">
                  <p className="tabular text-2xl font-semibold">{opportunity.opportunityScore}</p>
                  <p className="text-xs text-ink-subtle">{opportunity.band}</p>
                </div>
              </div>

              <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Estimated price</dt>
                  <dd className="tabular mt-0.5 text-sm font-medium">{formatMoney(opportunity.estimatedSellingPrice)}</dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Estimated unit cost</dt>
                  <dd className="tabular mt-0.5 text-sm font-medium">{formatMoney(opportunity.estimatedUnitCost)}</dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Estimated contribution margin</dt>
                  <dd className="tabular mt-0.5 text-sm font-medium">{formatPct(opportunity.estimatedContributionMarginPct)}</dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Supplier</dt>
                  <dd className="mt-0.5">
                    <Badge tone={opportunity.supplierIdentified ? 'positive' : 'caution'}>
                      {opportunity.supplierIdentified ? 'Identified' : 'Not yet found'}
                    </Badge>
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
                <Badge tone={VERDICT_TONES[opportunity.shopifyCompliance]}>
                  Shopify · {VERDICT_LABELS[opportunity.shopifyCompliance]}
                </Badge>
                <Badge tone={VERDICT_TONES[opportunity.amazonCompliance]}>
                  Amazon UK · {VERDICT_LABELS[opportunity.amazonCompliance]}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
