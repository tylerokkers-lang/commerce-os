import { Badge, Card, CardHeader, type Tone } from '@/components/ui'
import { formatDateTime } from '@/lib/utils'
import type { Recommendation } from '@/lib/research/pipeline'

/**
 * Every recommendation, rendered the same way (§14).
 *
 * Score, confidence, reasons, risks, data sources and when it was calculated
 * always appear together. A recommendation without its reasoning is not
 * something the owner should be asked to act on.
 */

export const ACTION_LABELS: Record<Recommendation['action'], string> = {
  test: 'Recommended for testing',
  watch: 'Watch',
  review: 'Needs review',
  reject: 'Reject',
  source_supplier: 'Find a supplier',
}

export const ACTION_TONES: Record<Recommendation['action'], Tone> = {
  test: 'positive',
  watch: 'neutral',
  review: 'caution',
  reject: 'negative',
  source_supplier: 'accent',
}

export function RecommendationPanel({
  recommendation,
  score,
}: {
  recommendation: Recommendation
  score: number
}) {
  return (
    <Card>
      <CardHeader
        title="Recommendation"
        description={recommendation.headline}
        action={<Badge tone={ACTION_TONES[recommendation.action]}>{ACTION_LABELS[recommendation.action]}</Badge>}
      />

      <div className="grid gap-px bg-border sm:grid-cols-2">
        <div className="bg-surface px-5 py-4">
          <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Reasons</p>
          {recommendation.reasons.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No supporting reasons were found.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {recommendation.reasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-sm text-ink-muted">
                  <span aria-hidden className="text-positive">+</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-surface px-5 py-4">
          <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Risks</p>
          {recommendation.risks.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No risks were identified by these checks.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {recommendation.risks.map((risk) => (
                <li key={risk} className="flex gap-2 text-sm text-ink-muted">
                  <span aria-hidden className="text-caution">!</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {recommendation.outstandingRequirements.length > 0 ? (
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
            What would unblock this
          </p>
          <ul className="mt-2 space-y-2">
            {recommendation.outstandingRequirements.map((requirement) => (
              <li key={requirement.label} className="text-sm">
                <span className="font-medium">{requirement.label}</span>
                <span className="text-ink-muted"> — {requirement.remedy}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-4">
        <div className="bg-surface px-5 py-3">
          <dt className="text-xs text-ink-subtle">Score</dt>
          <dd className="tabular mt-0.5 text-sm font-medium">{score}/100</dd>
        </div>
        <div className="bg-surface px-5 py-3">
          <dt className="text-xs text-ink-subtle">Confidence</dt>
          <dd className="mt-0.5 text-sm font-medium">
            {recommendation.confidenceLabel} ({Math.round(recommendation.confidence * 100)}%)
          </dd>
        </div>
        <div className="bg-surface px-5 py-3">
          <dt className="text-xs text-ink-subtle">Data sources</dt>
          <dd className="mt-0.5 text-sm font-medium">
            {recommendation.dataSources.map((s) => s.replace(/_/g, ' ')).join(', ') || 'none'}
          </dd>
        </div>
        <div className="bg-surface px-5 py-3">
          <dt className="text-xs text-ink-subtle">Last updated</dt>
          <dd className="mt-0.5 text-sm font-medium">{formatDateTime(recommendation.lastUpdated)}</dd>
        </div>
      </dl>

      {recommendation.requiresOwnerApproval ? (
        <div className="border-t border-accent/25 bg-accent-soft px-5 py-3">
          <p className="text-sm text-ink">
            <span className="font-medium text-accent">Needs your approval.</span> Nothing has been
            listed, ordered or spent. This is a recommendation and a queue position, not an action.
          </p>
        </div>
      ) : null}
    </Card>
  )
}
