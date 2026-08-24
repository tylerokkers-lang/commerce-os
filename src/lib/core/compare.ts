/**
 * Generic period-over-period comparison (Milestone 10 §12).
 *
 * Deliberately currency- and domain-agnostic: it compares plain numbers
 * (order counts, percentages, unit counts, scores), not money — money
 * comparisons go through `money.ts`'s own `marginPct`/`compare`, which
 * enforce same-currency arithmetic. This is the one place the
 * "current vs previous, absolute diff, percentage diff, direction" shape is
 * computed, promoted out of `monitoring/monitors/performanceMonitor.ts`'s
 * previously-private `pctChange` helper so every caller (monitors,
 * analytics) shares one divide-by-zero rule rather than each reimplementing
 * it slightly differently.
 *
 * This is a historical comparison, never a prediction: it says what already
 * happened between two periods, with no claim about what happens next.
 */

export type ComparisonDirection = 'up' | 'down' | 'flat'

export interface PeriodComparison {
  current: number
  previous: number
  absoluteChange: number
  /**
   * Null when the previous value was zero and the current value is not —
   * "up from zero" has no finite percentage, so this reports null (an
   * honest "cannot be expressed as a percentage") rather than Infinity or a
   * fabricated number. Zero-to-zero is a real, flat 0%.
   */
  percentChange: number | null
  direction: ComparisonDirection
}

export function comparePeriods(current: number, previous: number): PeriodComparison {
  const absoluteChange = current - previous
  const percentChange = previous === 0
    ? (current === 0 ? 0 : null)
    : Math.round((absoluteChange / previous) * 10000) / 100
  const direction: ComparisonDirection = absoluteChange > 0 ? 'up' : absoluteChange < 0 ? 'down' : 'flat'
  return { current, previous, absoluteChange, percentChange, direction }
}
