import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, CardHeader, PageHeader, TableWrap } from '@/components/ui'
import { formatMoney } from '@/lib/core/money'
import { formatPct } from '@/lib/utils'
import { canWrite, requireSession } from '@/lib/security/session'
import { getSupplierDetail } from '@/lib/suppliers/repository'
import { SupplierForm } from '../SupplierForm'
import type { ApprovalStatus } from '@/lib/core/domain'

export const dynamic = 'force-dynamic'

const STATUS_TONES: Record<ApprovalStatus, 'positive' | 'negative' | 'caution' | 'neutral'> = {
  approved: 'positive',
  blocked: 'negative',
  review_required: 'caution',
  not_assessed: 'neutral',
}

export default async function SupplierDetailPage(props: PageProps<'/suppliers/[id]'>) {
  const { id } = await props.params
  const [supplier, session] = await Promise.all([getSupplierDetail(id), requireSession()])
  if (!supplier) notFound()

  return (
    <>
      <div>
        <Link href="/suppliers" className="text-sm text-accent hover:underline">← All suppliers</Link>
      </div>

      <PageHeader
        title={supplier.name}
        description={supplier.notes ?? undefined}
        action={
          <div className="text-right">
            <p className="tabular text-3xl font-semibold">{supplier.score.total}</p>
            <Badge tone={supplier.score.total >= 80 ? 'positive' : supplier.score.total >= 60 ? 'caution' : 'negative'}>
              {supplier.score.bandLabel}
            </Badge>
            <p className="mt-1 text-xs text-ink-subtle">
              {Math.round(supplier.score.confidence * 100)}% confidence
            </p>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {(
          [
            ['Shopify', supplier.shopify],
            ['Amazon UK', supplier.amazon],
          ] as const
        ).map(([label, capability]) => (
          <Card key={label}>
            <CardHeader
              title={`${label} eligibility`}
              action={<Badge tone={STATUS_TONES[capability.status]}>{capability.status.replace(/_/g, ' ')}</Badge>}
            />
            <ul className="divide-y divide-border">
              {capability.reasons.map((reason) => (
                <li key={reason} className="px-5 py-2.5 text-sm text-ink-muted">
                  {reason}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Score breakdown"
          description={`Weighted across cost, delivery, reliability, quality, returns, tracking and compliance capability. Weights version ${supplier.score.weightsVersion}.`}
        />
        <ul className="divide-y divide-border">
          {supplier.score.components.map((component) => (
            <li key={component.key} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{component.label}</span>
                <span className="tabular shrink-0 text-sm">
                  {component.score === null ? (
                    <span className="text-ink-subtle">not scored</span>
                  ) : (
                    Math.round(component.score)
                  )}
                  <span className="ml-2 text-xs text-ink-subtle">weight {component.weight}</span>
                </span>
              </div>
              {component.score !== null ? (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={
                      component.score >= 70
                        ? 'h-full bg-positive'
                        : component.score >= 45
                          ? 'h-full bg-caution'
                          : 'h-full bg-negative'
                    }
                    style={{ width: `${component.score}%` }}
                  />
                </div>
              ) : null}
              <p className="mt-1.5 text-xs text-ink-muted">{component.basis}</p>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Observed performance" description="What has actually happened, not what was promised." />
          <dl className="divide-y divide-border text-sm">
            {[
              ['Orders placed', String(supplier.ordersPlaced)],
              ['Delivered on time', formatPct(supplier.onTimeRatePct)],
              ['Orders late', String(supplier.ordersLate)],
              ['Orders defective', String(supplier.ordersDefective)],
              ['Quality rating', supplier.qualityRating ? `${supplier.qualityRating} / 5` : 'Not rated'],
              ['Communication', supplier.communicationRating ? `${supplier.communicationRating} / 5` : 'Not rated'],
              [
                'Delivery quoted',
                supplier.deliveryDaysMin !== null
                  ? `${supplier.deliveryDaysMin} to ${supplier.deliveryDaysMax} days`
                  : 'Unknown',
              ],
              ['Compliance documents', String(supplier.documentCount)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between px-5 py-2.5">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="tabular">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Products quoted" description="Where this supplier is cheapest, and where it is chosen." />
          {supplier.quotes.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-muted">No quotes on file.</p>
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-subtle">
                    <th className="px-5 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 text-right font-medium">Landed</th>
                    <th className="px-5 py-2.5 font-medium">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.quotes.map((quote) => (
                    <tr key={quote.candidateRef} className="border-b border-border last:border-0">
                      <td className="px-5 py-2.5">{quote.productTitle}</td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {formatMoney({
                          minor: quote.unitCost.minor + quote.shippingCost.minor,
                          currency: quote.unitCost.currency,
                        })}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {quote.isCheapest ? <Badge tone="neutral">Cheapest</Badge> : null}
                          <Badge tone={quote.isRecommended ? 'positive' : 'neutral'}>
                            {quote.isRecommended ? 'Chosen' : 'Not chosen'}
                          </Badge>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
            Cheapest and chosen are separate columns on purpose. Ranking sorts on the composite
            score, so the lowest price is selected only when it also delivers, tracks and handles
            returns well enough to earn it.
          </p>
        </Card>
      </div>

      {supplier.redundancyPreview ? (
        <Card className={supplier.redundancyPreview.outcome === 'switch_automatically' ? 'border-positive/30' : 'border-caution/30'}>
          <CardHeader
            title="If this supplier becomes unavailable"
            description={supplier.redundancyPreview.reason}
            action={
              <Badge
                tone={
                  supplier.redundancyPreview.outcome === 'switch_automatically'
                    ? 'positive'
                    : supplier.redundancyPreview.outcome === 'no_alternative_available'
                      ? 'negative'
                      : 'caution'
                }
              >
                {supplier.redundancyPreview.outcome.replace(/_/g, ' ')}
              </Badge>
            }
          />
          {supplier.redundancyPreview.assessed.length > 0 ? (
            <TableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-ink-subtle">
                    <th className="px-5 py-2.5 font-medium">Alternative</th>
                    <th className="px-3 py-2.5 text-right font-medium">Score</th>
                    <th className="px-3 py-2.5 font-medium">Shopify</th>
                    <th className="px-3 py-2.5 font-medium">Amazon UK</th>
                    <th className="px-5 py-2.5 font-medium">Preserves approval</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.redundancyPreview.assessed.map((assessment) => (
                    <tr key={assessment.candidate.id} className="border-b border-border last:border-0">
                      <td className="px-5 py-2.5">
                        <Link href={`/suppliers/${assessment.candidate.id}`} className="font-medium text-accent hover:underline">
                          {assessment.candidate.name}
                        </Link>
                        {supplier.redundancyPreview?.recommended?.candidate.id === assessment.candidate.id ? (
                          <Badge tone="accent" className="ml-2">Recommended</Badge>
                        ) : null}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{assessment.score.total}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={assessment.capability.shopify?.status === 'approved' ? 'positive' : assessment.capability.shopify?.status === 'blocked' ? 'negative' : 'caution'}>
                          {assessment.capability.shopify?.status.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={assessment.capability.amazon_uk?.status === 'approved' ? 'positive' : assessment.capability.amazon_uk?.status === 'blocked' ? 'negative' : 'caution'}>
                          {assessment.capability.amazon_uk?.status.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge tone={assessment.preservesApprovedChannels && assessment.meetsProfitabilityBar ? 'positive' : 'negative'}>
                          {assessment.preservesApprovedChannels && assessment.meetsProfitabilityBar ? 'Yes' : 'No'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
          <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
            This is a decision, not an action. No supplier has been switched, and nothing has been
            listed or ordered. The current automation level (&ldquo;assisted&rdquo;) means switching supplier
            always needs your approval, regardless of how good the alternative is.
          </p>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Edit supplier" description="Channel status is recomputed from the capability flags on save." />
      </Card>

      <SupplierForm
        supplier={{
          id: supplier.id,
          name: supplier.name,
          company_name: supplier.companyName,
          website: supplier.website,
          contact_email: supplier.contactEmail,
          country: supplier.country,
          platform: supplier.platform,
          notes: supplier.notes,
          returns_policy: supplier.returnsPolicy,
          typical_delivery_days_min: supplier.deliveryDaysMin,
          typical_delivery_days_max: supplier.deliveryDaysMax,
          returns_window_days: supplier.returnsWindowDays,
          supports_blind_shipping: supplier.supportsBlindShipping,
          supports_custom_packaging: supplier.supportsCustomPackaging,
          supports_custom_invoice: supplier.supportsCustomInvoice,
          supports_own_branding: supplier.supportsOwnBranding,
          provides_tracking: supplier.providesTracking,
          handles_returns: supplier.handlesReturns,
          accepts_faulty_returns: supplier.acceptsFaultyReturns,
          orders_placed: supplier.ordersPlaced,
          orders_late: supplier.ordersLate,
          orders_defective: supplier.ordersDefective,
          quality_rating: supplier.qualityRating,
          communication_rating: supplier.communicationRating,
        }}
        canEdit={canWrite(session) && !session.isDemo}
      />
    </>
  )
}
