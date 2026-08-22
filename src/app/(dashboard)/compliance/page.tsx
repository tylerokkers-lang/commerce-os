import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { formatDate } from '@/lib/utils'
import { getComplianceIssues } from '@/lib/compliance/repository'

export const dynamic = 'force-dynamic'

export default async function CompliancePage() {
  const issues = await getComplianceIssues()

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Every product is assessed per channel against that channel's requirements. A failure blocks the listing and cannot be overridden by automation."
      />

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">How to read this</p>
          <p className="mt-1 text-sm text-ink">
            The system reports pass, fail or review required with the evidence behind each verdict.
            It never states that a product is guaranteed compliant. Marketplace policies change, and
            responsibility for the final decision stays with you.
          </p>
        </div>
      </Card>

      {issues.length === 0 ? (
        <Card>
          <EmptyState title="No open compliance issues" description="No product is currently blocked or waiting on a review." />
        </Card>
      ) : (
        <div className="grid gap-4">
          {issues.map((issue) => (
            <Card key={`${issue.productId}-${issue.channel}`}>
              <CardHeader
                title={`${issue.sku} — ${issue.title}`}
                description={`${issue.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'} · assessed ${formatDate(issue.assessedAt)}`}
                action={
                  <Badge tone={issue.verdict === 'fail' ? 'negative' : 'caution'}>
                    {issue.verdict === 'fail' ? 'Listing blocked' : 'Review required'}
                  </Badge>
                }
              />
              <ul className="divide-y divide-border">
                {issue.blockingReasons.map((reason) => (
                  <li key={reason} className="flex gap-3 px-5 py-3 text-sm">
                    <span aria-hidden className={issue.verdict === 'fail' ? 'text-negative' : 'text-caution'}>
                      {issue.verdict === 'fail' ? '✕' : '!'}
                    </span>
                    <span className="text-ink-muted">{reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
