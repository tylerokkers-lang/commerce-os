import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, CardHeader, EmptyState, PageHeader, TableWrap } from '@/components/ui'
import { RecommendationPanel } from '@/components/dashboard/RecommendationPanel'
import { ScoreBreakdown, ScoreDial } from '@/components/dashboard/ScoreBreakdown'
import { formatMoney } from '@/lib/core/money'
import { formatPct } from '@/lib/utils'
import { getOpportunityDetail } from '@/lib/products/opportunities'
import { getMarketExpansionDemo } from '@/lib/markets/opportunityMarketsRepository'
import type { ComplianceCheck } from '@/lib/compliance/rules'
import type { ChannelKey } from '@/lib/core/domain'
import type { ExpansionRecommendation } from '@/lib/markets/expansion'

export const dynamic = 'force-dynamic'

const OUTCOME_TONES: Record<ComplianceCheck['outcome'], 'positive' | 'negative' | 'caution' | 'neutral'> = {
  pass: 'positive',
  fail: 'negative',
  unknown: 'caution',
  not_applicable: 'neutral',
}

const OUTCOME_LABELS: Record<ComplianceCheck['outcome'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  unknown: 'Unknown',
  not_applicable: 'Not applicable',
}

const CHANNEL_LABELS: Record<ChannelKey, string> = { shopify: 'Shopify', amazon_uk: 'Amazon UK', ebay: 'eBay' }

const RECOMMENDATION_TONES: Record<ExpansionRecommendation, 'positive' | 'negative' | 'caution' | 'neutral'> = {
  ready: 'positive',
  promising: 'positive',
  requires_review: 'caution',
  blocked: 'negative',
  insufficient_facts: 'neutral',
}
const RECOMMENDATION_LABELS: Record<ExpansionRecommendation, string> = {
  ready: 'Ready', promising: 'Promising', requires_review: 'Requires review', blocked: 'Blocked', insufficient_facts: 'Insufficient facts',
}
const COMPLIANCE_VERDICT_LABELS: Record<string, string> = { pass: 'Pass', fail: 'Fail', review_required: 'Review required', not_assessed: 'Unknown' }

export default async function OpportunityDetailPage(props: PageProps<'/opportunities/[id]'>) {
  const { id } = await props.params
  const [evaluated, marketScenarios] = await Promise.all([getOpportunityDetail(id), getMarketExpansionDemo()])
  if (!evaluated) notFound()

  const { candidate, score, recommendation, supplier, channels, compliance, complaints } = evaluated

  return (
    <>
      <div>
        <Link href="/opportunities" className="text-sm text-accent hover:underline">
          ← All opportunities
        </Link>
      </div>

      <PageHeader
        title={candidate.title}
        description={candidate.description ?? undefined}
        action={
          <ScoreDial
            score={score.total}
            band={score.bandLabel}
            confidence={score.confidence}
            confidenceLabel={score.confidenceLabel}
          />
        }
      />

      <RecommendationPanel recommendation={recommendation} score={score.total} />

      {/* --- Profitability, per channel, from the one engine ----------------- */}
      <Card>
        <CardHeader
          title="Profitability by channel"
          description={channels.summary}
        />
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-subtle">
                <th className="px-5 py-2.5 font-medium">Line</th>
                {channels.projections.map((projection) => (
                  <th key={projection.channel} className="px-3 py-2.5 text-right font-medium">
                    {projection.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {channels.projections[0].profitability.breakdown.map((line, index) => (
                <tr key={line.label} className="border-b border-border last:border-0">
                  <td className="px-5 py-2">
                    <span className={index === 2 ? 'font-medium' : ''}>{line.label}</span>
                    <p className="text-xs text-ink-subtle">{line.basis}</p>
                  </td>
                  {channels.projections.map((projection) => (
                    <td key={projection.channel} className="tabular px-3 py-2 text-right">
                      {formatMoney(projection.profitability.breakdown[index].amount)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t-2 border-border-strong bg-surface-muted">
                <td className="px-5 py-2.5 font-semibold">Net profit per unit</td>
                {channels.projections.map((projection) => (
                  <td
                    key={projection.channel}
                    className={`tabular px-3 py-2.5 text-right font-semibold ${projection.profitability.netProfit.minor < 0 ? 'text-negative' : 'text-positive'}`}
                  >
                    {formatMoney(projection.profitability.netProfit)}
                  </td>
                ))}
              </tr>
              <tr className="bg-surface-muted">
                <td className="px-5 py-2 text-ink-muted">Net margin</td>
                {channels.projections.map((projection) => (
                  <td key={projection.channel} className="tabular px-3 py-2 text-right">
                    {formatPct(projection.profitability.netMarginPct)}
                  </td>
                ))}
              </tr>
              <tr className="bg-surface-muted">
                <td className="px-5 py-2 text-ink-muted">Break-even price</td>
                {channels.projections.map((projection) => (
                  <td key={projection.channel} className="tabular px-3 py-2 text-right">
                    {formatMoney(projection.profitability.breakEvenPrice)}
                  </td>
                ))}
              </tr>
              <tr className="bg-surface-muted">
                <td className="px-5 py-2 text-ink-muted">Profitability gate</td>
                {channels.projections.map((projection) => (
                  <td key={projection.channel} className="px-3 py-2 text-right">
                    <Badge tone={projection.gate.passes ? 'positive' : 'negative'}>
                      {projection.gate.passes ? 'Passes' : 'Fails'}
                    </Badge>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </TableWrap>

        <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2">
          {channels.projections.map((projection) => (
            <div key={projection.channel} className="bg-surface px-5 py-3">
              <p className="text-xs font-medium text-ink">{projection.label} assumptions</p>
              <ul className="mt-1.5 space-y-1">
                {projection.profile.notes.map((note) => (
                  <li key={note} className="text-xs text-ink-muted">
                    {note}
                  </li>
                ))}
              </ul>
              {projection.gate.failures.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {projection.gate.failures.map((failure) => (
                    <li key={failure} className="text-xs text-negative">
                      {failure}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      {/* --- Compliance, per channel ---------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {(Object.keys(CHANNEL_LABELS) as ChannelKey[]).map((channel) => {
          const assessment = compliance[channel]
          return (
            <Card key={channel}>
              <CardHeader
                title={`${CHANNEL_LABELS[channel]} compliance`}
                description={assessment.summary}
                action={
                  <Badge
                    tone={
                      assessment.verdict === 'pass'
                        ? 'positive'
                        : assessment.verdict === 'fail'
                          ? 'negative'
                          : 'caution'
                    }
                  >
                    {assessment.verdict.replace(/_/g, ' ')}
                  </Badge>
                }
              />
              <ul className="divide-y divide-border">
                {assessment.checks.map((check) => (
                  <li key={check.key} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium">{check.label}</span>
                      <Badge tone={OUTCOME_TONES[check.outcome]}>{OUTCOME_LABELS[check.outcome]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">{check.evidence}</p>
                    {check.remedy ? (
                      <p className="mt-1 text-xs text-accent">{check.remedy}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
                {assessment.disclaimer}
              </p>
            </Card>
          )
        })}
      </div>

      {/* --- Supplier -------------------------------------------------------- */}
      <Card>
        <CardHeader title="Supplier" description={supplier.rationale} />
        {supplier.ranked.length === 0 ? (
          <EmptyState
            title="No supplier identified"
            description="Cost, delivery and channel eligibility cannot be established until one is found."
          />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">Supplier</th>
                  <th className="px-3 py-2.5 text-right font-medium">Score</th>
                  <th className="px-3 py-2.5 text-right font-medium">Landed cost</th>
                  <th className="px-3 py-2.5 font-medium">Delivery</th>
                  <th className="px-5 py-2.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {supplier.ranked.map((ranked, index) => (
                  <tr key={ranked.supplier.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-5 py-3">
                      <Link href={`/suppliers/${ranked.supplier.id}`} className="font-medium text-accent hover:underline">
                        {ranked.supplier.name}
                      </Link>
                      {index === 0 ? (
                        <Badge tone="positive" className="ml-2">Chosen</Badge>
                      ) : null}
                    </td>
                    <td className="tabular px-3 py-3 text-right font-medium">{ranked.score.total}</td>
                    <td className="tabular px-3 py-3 text-right">
                      {formatMoney({
                        minor:
                          ranked.supplier.signals.unitCost.minor +
                          ranked.supplier.signals.shippingCost.minor,
                        currency: 'GBP',
                      })}
                    </td>
                    <td className="tabular px-3 py-3">
                      {ranked.supplier.signals.deliveryDaysMin} to{' '}
                      {ranked.supplier.signals.deliveryDaysMax} days
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-muted">
                      {ranked.cheaperButNotRecommended ? (
                        <span className="text-caution">
                          Cheapest available, but not recommended.{' '}
                        </span>
                      ) : null}
                      {ranked.score.weaknesses[0] ?? ranked.score.strengths[0] ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {/* --- Complaints and differentiation ---------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="What customers complain about" description={complaints.summary} />
          {complaints.findings.length === 0 ? (
            <EmptyState title="No recurring themes" description="No review sample was available, or nothing recurred." />
          ) : (
            <ul className="divide-y divide-border">
              {complaints.findings.map((finding) => (
                <li key={finding.theme} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">{finding.label}</span>
                    <span className="tabular text-xs text-ink-subtle">
                      {finding.mentions} of {complaints.sampleSize} · {finding.averageRating}★
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted italic">
                    &ldquo;{finding.examples[0]}&rdquo;
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="How to do it better"
            description="Each suggestion answers an observed complaint. All original: no competitor text, images or branding is reused."
          />
          <ul className="divide-y divide-border">
            {evaluated.differentiation.map((suggestion, index) => {
              const committed = evaluated.committedDifferentiation.includes(suggestion)
              return (
                <li key={`${suggestion.kind}-${index}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{suggestion.kind}</Badge>
                    <Badge
                      tone={
                        suggestion.evidenceStrength === 'strong'
                          ? 'positive'
                          : suggestion.evidenceStrength === 'moderate'
                            ? 'caution'
                            : 'neutral'
                      }
                    >
                      {suggestion.evidenceStrength} evidence
                    </Badge>
                    {committed ? <Badge tone="positive">Costed in</Badge> : null}
                    {suggestion.estimatedCost ? (
                      <span className="tabular ml-auto text-xs text-ink-subtle">
                        +{formatMoney(suggestion.estimatedCost)}/unit
                      </span>
                    ) : (
                      <span className="ml-auto text-xs text-ink-subtle">No unit cost</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-ink-muted">{suggestion.suggestion}</p>
                  <p className="mt-1 text-xs text-ink-subtle">{suggestion.rationale}</p>
                </li>
              )
            })}
          </ul>
          <p className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
            {formatMoney(evaluated.differentiationCost)} per unit of differentiation is already
            included in the profitability figures above, covering the
            {' '}{evaluated.committedDifferentiation.length} best-evidenced change
            {evaluated.committedDifferentiation.length === 1 ? '' : 's'}.
          </p>
        </Card>
      </div>

      {/* --- Score breakdown -------------------------------------------------- */}
      <Card>
        <CardHeader
          title="How this score was calculated"
          description={`Nineteen components, weighted and renormalised across what is actually known. Weights version ${score.weightsVersion}.`}
        />
        <ScoreBreakdown components={score.components} />
        {score.cap ? (
          <div className="border-t border-negative/25 bg-negative-soft px-5 py-3">
            <p className="text-sm text-ink">{score.cap.reason}</p>
          </div>
        ) : null}
      </Card>

      {/* --- Global expansion matrix (Milestone 9) --------------------------- */}
      {marketScenarios ? (
        <Card>
          <CardHeader
            title="Global expansion matrix"
            description="Every market, evaluated separately, from the real compliance/profitability/supplier-capability engines — never a single global status. Demo scenarios illustrating the architecture; see docs/MILESTONES.md."
          />
          {marketScenarios.map((scenario) => (
            <div key={scenario.key} className="border-t border-border">
              <div className="px-5 py-3">
                <p className="text-sm font-medium">{scenario.label}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{scenario.description}</p>
              </div>
              <TableWrap>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-ink-subtle">
                      <th className="px-5 py-2 font-medium">Market</th>
                      <th className="px-3 py-2 font-medium">Compliance</th>
                      <th className="px-3 py-2 font-medium">Profitability</th>
                      <th className="px-3 py-2 font-medium">Supplier</th>
                      <th className="px-3 py-2 font-medium">Marketplace</th>
                      <th className="px-3 py-2 text-right font-medium">Score</th>
                      <th className="px-3 py-2 text-right font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario.results.map((result, index) => (
                      <tr key={`${scenario.key}:${result.marketKey}:${index}`} className="border-b border-border last:border-0">
                        <td className="px-5 py-2.5">
                          <span className="font-medium">{result.countryCode}</span>
                          <span className="ml-1.5 text-xs text-ink-subtle">{result.marketKey}</span>
                          {scenario.results.filter((r) => r.marketKey === result.marketKey).length > 1 ? (
                            <span className="ml-1.5 text-xs text-ink-subtle">({index === 0 ? 'before' : 'after'})</span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 text-xs">{COMPLIANCE_VERDICT_LABELS[result.compliance.verdict] ?? result.compliance.verdict}</td>
                        <td className="px-3 py-2.5 text-xs">
                          {result.profitability ? (result.profitability.gate.passes ? `Pass (${result.profitability.native.netMarginPct}%)` : 'Fail') : 'Unknown'}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          {result.supplierCapability.canShip.value === true ? 'Ready' : result.supplierCapability.canShip.value === false ? 'Cannot ship' : 'Unknown'}
                        </td>
                        <td className="px-3 py-2.5 text-xs capitalize">{result.marketplaceStatus.replace(/_/g, ' ')}</td>
                        <td className="tabular px-3 py-2.5 text-right text-xs">{result.score}/100</td>
                        <td className="px-3 py-2.5 text-right">
                          <Badge tone={RECOMMENDATION_TONES[result.recommendation]}>{RECOMMENDATION_LABELS[result.recommendation]}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <ul className="space-y-1 border-t border-border px-5 py-3">
                {scenario.narrative.map((line, i) => (
                  <li key={i} className="text-xs text-ink-muted">{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </Card>
      ) : null}
    </>
  )
}
