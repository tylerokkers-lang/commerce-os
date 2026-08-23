import { Badge } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { ComponentScore } from '@/lib/products/scoring'

/**
 * Renders every scoring component with its weight and basis.
 *
 * The point of showing all nineteen, including the ones with no data, is that
 * the reader can see what the score does not know as clearly as what it does.
 */
export function ScoreBreakdown({ components }: { components: readonly ComponentScore[] }) {
  const available = components.filter((c) => c.score !== null)
  const missing = components.filter((c) => c.score === null)

  return (
    <div>
      <ul className="divide-y divide-border">
        {[...available]
          .sort((a, b) => b.contribution - a.contribution)
          .map((component) => (
            <li key={component.key} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{component.label}</span>
                <span className="tabular shrink-0 text-sm">
                  {component.score}
                  <span className="ml-2 text-xs text-ink-subtle">weight {component.weight}</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={cn(
                    'h-full',
                    (component.score ?? 0) >= 70
                      ? 'bg-positive'
                      : (component.score ?? 0) >= 45
                        ? 'bg-caution'
                        : 'bg-negative',
                  )}
                  style={{ width: `${component.score ?? 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-ink-muted">{component.basis}</p>
              <p className="mt-0.5 text-xs text-ink-subtle">
                Source: {component.source.replace(/_/g, ' ')}
                {component.inverted ? ' · lower raw values score higher' : ''}
              </p>
            </li>
          ))}
      </ul>

      {missing.length > 0 ? (
        <div className="border-t border-border bg-surface-muted px-5 py-3">
          <p className="text-xs font-medium text-ink">
            {missing.length} component{missing.length === 1 ? '' : 's'} had no data
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {missing.map((c) => c.label).join(', ')}. These were excluded rather than scored as
            average, and the remaining weights were renormalised. Confidence is reduced accordingly.
          </p>
        </div>
      ) : null}
    </div>
  )
}

export function ScoreDial({
  score,
  band,
  confidence,
  confidenceLabel,
}: {
  score: number
  band: string
  confidence: number
  confidenceLabel: string
}) {
  const tone = score >= 80 ? 'positive' : score >= 70 ? 'accent' : score >= 60 ? 'caution' : 'negative'

  return (
    <div className="text-right">
      <p
        className={cn(
          'tabular text-3xl font-semibold',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          tone === 'caution' && 'text-caution',
        )}
      >
        {score}
        <span className="text-base font-normal text-ink-subtle">/100</span>
      </p>
      <Badge tone={tone}>{band}</Badge>
      <p className="mt-1.5 text-xs text-ink-subtle">
        {confidenceLabel} confidence ({Math.round(confidence * 100)}%)
      </p>
    </div>
  )
}
