import { Badge, type Tone } from '@/components/ui'
import type { Metric, PeriodMetric } from '@/lib/analytics/types'

/**
 * A fact-first figure (Milestone 10/11): the value when known, and an
 * honest status badge — UNKNOWN/STALE/UNAVAILABLE — instead of a number,
 * when it is not. Never renders `null` as if it were zero. Shared between
 * `/automation` and the CEO Command Centre (`/`) so both render the exact
 * same `Metric<T>`/`PeriodMetric<T>` shape identically, rather than two
 * copies that could drift.
 */
const FACT_STATUS_TONE: Record<string, Tone> = {
  fact: 'positive', calculated: 'positive', derived: 'accent', estimate: 'caution',
  unknown: 'neutral', stale: 'caution', unavailable: 'negative',
}

export function MetricStat({ label, metric, format = String, sublabel }: { label: string; metric: Metric<unknown> | PeriodMetric<unknown>; format?: (v: never) => string; sublabel?: string }) {
  const isKnownStatus = metric.status === 'fact' || metric.status === 'calculated' || metric.status === 'derived' || metric.status === 'estimate'
  const comparison = 'comparison' in metric ? metric.comparison : null
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{label}</p>
      {isKnownStatus ? (
        <>
          <p className="mt-1 text-sm font-medium">{format(metric.value as never)}</p>
          {comparison && comparison.percentChange !== null ? (
            <p className={`tabular mt-0.5 text-xs font-medium ${comparison.direction === 'up' ? 'text-positive' : comparison.direction === 'down' ? 'text-negative' : 'text-ink-subtle'}`}>
              {comparison.percentChange > 0 ? '+' : ''}{comparison.percentChange}%
            </p>
          ) : null}
          {sublabel ? <p className="mt-0.5 text-xs text-ink-subtle">{sublabel}</p> : null}
        </>
      ) : (
        <>
          <Badge tone={FACT_STATUS_TONE[metric.status] ?? 'neutral'} className="mt-1.5">{metric.status.toUpperCase()}</Badge>
          <p className="mt-1 truncate text-xs text-ink-subtle" title={metric.source}>{metric.source}</p>
        </>
      )}
    </div>
  )
}
