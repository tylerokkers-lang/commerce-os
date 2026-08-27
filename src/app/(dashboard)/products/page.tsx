import Link from 'next/link'
import { Badge, Card, EmptyState, PageHeader, TableWrap } from '@/components/ui'
import { ChannelStatus } from '@/components/dashboard/ChannelStatus'
import { DECISION_LABELS, DECISION_TONES, STAGE_LABELS, STAGE_TONES } from '@/lib/constants'
import { formatMoney } from '@/lib/core/money'
import { formatPct } from '@/lib/utils'
import { getProductDecisionSummary, getProducts } from '@/lib/products/repository'
import { PRODUCT_DECISIONS } from '@/lib/products/decision'

export const dynamic = 'force-dynamic'

function healthTone(score: number) {
  return score >= 70 ? 'positive' : score >= 45 ? 'caution' : 'negative'
}

export default async function ProductsPage() {
  const [products, decisionSummary] = await Promise.all([getProducts(), getProductDecisionSummary()])

  return (
    <>
      <PageHeader
        title="Products"
        description="The catalogue with its lifecycle stage, health score and independent status on each channel. Health, not revenue, drives catalogue decisions."
      />

      {/*
        Decision counts, not a duplicated calculation — every number here
        is a group-by count from `getProductDecisionSummary()`
        (`products/repository.ts`), the same query the rest of the app
        would use, never re-derived from `products` here.
      */}
      <div className="flex flex-wrap gap-2">
        {PRODUCT_DECISIONS.map((decision) => (
          <Badge key={decision} tone={DECISION_TONES[decision]}>
            {DECISION_LABELS[decision]}: {decisionSummary[decision]}
          </Badge>
        ))}
      </div>

      <Card>
        {products.length === 0 ? (
          <EmptyState
            title="No products yet"
            description="Products appear here once the research engine surfaces candidates or you add them directly."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Product</th>
                  <th className="px-3 py-2.5 font-medium">Decision</th>
                  <th className="px-3 py-2.5 font-medium">Stage</th>
                  <th className="px-3 py-2.5 font-medium">Channels</th>
                  <th className="px-3 py-2.5 text-right font-medium">Health</th>
                  <th className="px-3 py-2.5 text-right font-medium">Units</th>
                  <th className="px-3 py-2.5 text-right font-medium">Contribution</th>
                  <th className="px-3 py-2.5 text-right font-medium">Margin</th>
                  <th className="px-5 py-2.5 text-right font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-5 py-3">
                      <Link href={`/products/${product.id}`} className="font-medium text-ink hover:text-accent hover:underline">
                        {product.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        {product.sku}
                        {product.category ? ` · ${product.category}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={DECISION_TONES[product.decision]}>{DECISION_LABELS[product.decision]}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={STAGE_TONES[product.stage]}>{STAGE_LABELS[product.stage]}</Badge>
                    </td>
                    <td className="px-3 py-3"><ChannelStatus status={product.channelStatus} /></td>
                    <td className="px-3 py-3 text-right">
                      <Badge tone={healthTone(product.healthScore)}>{product.healthScore}</Badge>
                    </td>
                    <td className="tabular px-3 py-3 text-right">{product.unitsSold}</td>
                    <td className={`tabular px-3 py-3 text-right font-medium ${product.contribution.minor < 0 ? 'text-negative' : ''}`}>
                      {formatMoney(product.contribution)}
                    </td>
                    <td className="tabular px-3 py-3 text-right">{formatPct(product.contributionMarginPct)}</td>
                    <td className="tabular px-5 py-3 text-right">
                      <span className={product.trend === 'up' ? 'text-positive' : product.trend === 'down' ? 'text-negative' : 'text-ink-subtle'}>
                        {product.trendPct > 0 ? '+' : ''}{product.trendPct}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}
