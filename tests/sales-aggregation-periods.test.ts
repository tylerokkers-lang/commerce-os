import { describe, expect, it } from 'vitest'
import { previousEquivalentPeriod, resolvePeriod } from '@/lib/orders/salesAggregation'

// A fixed "now" for deterministic tests: 24 August 2026, 09:00 UTC.
const NOW = new Date('2026-08-24T09:00:00.000Z')

describe('resolvePeriod', () => {
  it('today starts at the UTC day boundary and ends at now', () => {
    const period = resolvePeriod('today', NOW)
    expect(period.start).toBe('2026-08-24T00:00:00.000Z')
    expect(period.end).toBe(NOW.toISOString())
  })

  it('yesterday is the full previous UTC day', () => {
    const period = resolvePeriod('yesterday', NOW)
    expect(period.start).toBe('2026-08-23T00:00:00.000Z')
    expect(period.end).toBe('2026-08-24T00:00:00.000Z')
  })

  it('last_7_days is a rolling 7*24h window ending now, not a calendar week', () => {
    const period = resolvePeriod('last_7_days', NOW)
    expect(period.start).toBe('2026-08-17T09:00:00.000Z')
    expect(period.end).toBe(NOW.toISOString())
  })

  it('month_to_date starts on the 1st of the current month', () => {
    const period = resolvePeriod('month_to_date', NOW)
    expect(period.start).toBe('2026-08-01T00:00:00.000Z')
    expect(period.end).toBe(NOW.toISOString())
  })

  it('previous_month is the whole of the prior calendar month, start to start', () => {
    const period = resolvePeriod('previous_month', NOW)
    expect(period.start).toBe('2026-07-01T00:00:00.000Z')
    expect(period.end).toBe('2026-08-01T00:00:00.000Z')
  })

  it('previous_month correctly rolls back across a year boundary', () => {
    const period = resolvePeriod('previous_month', new Date('2026-01-15T00:00:00.000Z'))
    expect(period.start).toBe('2025-12-01T00:00:00.000Z')
    expect(period.end).toBe('2026-01-01T00:00:00.000Z')
  })

  it('quarter_to_date starts at the beginning of the current calendar quarter', () => {
    const period = resolvePeriod('quarter_to_date', NOW) // August is Q3 -> starts 1 July.
    expect(period.start).toBe('2026-07-01T00:00:00.000Z')
  })

  it('year_to_date starts on 1 January', () => {
    const period = resolvePeriod('year_to_date', NOW)
    expect(period.start).toBe('2026-01-01T00:00:00.000Z')
  })

  it('custom requires explicit bounds and throws without them', () => {
    expect(() => resolvePeriod('custom', NOW)).toThrow()
    const period = resolvePeriod('custom', NOW, { start: new Date('2026-01-01T00:00:00Z'), end: new Date('2026-01-15T00:00:00Z') })
    expect(period.start).toBe('2026-01-01T00:00:00.000Z')
    expect(period.end).toBe('2026-01-15T00:00:00.000Z')
  })
})

describe('previousEquivalentPeriod', () => {
  it('a fixed-length period (last_30_days) compares against an equal-length window immediately before it', () => {
    const period = resolvePeriod('last_30_days', NOW)
    const previous = previousEquivalentPeriod(period)
    expect(previous.end).toBe(period.start)
    const currentMs = new Date(period.end).getTime() - new Date(period.start).getTime()
    const previousMs = new Date(previous.end).getTime() - new Date(previous.start).getTime()
    expect(previousMs).toBe(currentMs)
  })

  it('month-to-date compares against the SAME NUMBER OF DAYS into the previous month, not the whole previous month', () => {
    // 24 August's month-to-date (1-24 Aug) must compare against 1-24 July,
    // never the complete 1-31 July — otherwise a partial month always
    // looks like a decline against a full one, every month, until the 30th/31st.
    const period = resolvePeriod('month_to_date', NOW)
    const previous = previousEquivalentPeriod(period)
    expect(previous.start).toBe('2026-07-01T00:00:00.000Z')
    expect(previous.end).toBe('2026-07-24T09:00:00.000Z') // Same day-of-month and time-of-day as `NOW`.
  })

  it('previous_month compares against the month before that', () => {
    const period = resolvePeriod('previous_month', NOW) // July 2026.
    const previous = previousEquivalentPeriod(period)
    expect(previous.start).toBe('2026-06-01T00:00:00.000Z')
    expect(previous.end).toBe('2026-07-01T00:00:00.000Z')
  })

  it('quarter-to-date compares against the same elapsed duration into the previous quarter', () => {
    const period = resolvePeriod('quarter_to_date', NOW) // Q3 starts 1 July; ~54 days elapsed to 24 Aug.
    const previous = previousEquivalentPeriod(period)
    expect(previous.start).toBe('2026-04-01T00:00:00.000Z') // Q2 starts 1 April.
    const elapsedIntoCurrent = new Date(period.end).getTime() - new Date(period.start).getTime()
    const elapsedIntoPrevious = new Date(previous.end).getTime() - new Date(previous.start).getTime()
    expect(elapsedIntoPrevious).toBe(elapsedIntoCurrent)
  })

  it('year-to-date compares against the same date last year', () => {
    const period = resolvePeriod('year_to_date', NOW)
    const previous = previousEquivalentPeriod(period)
    expect(previous.start).toBe('2025-01-01T00:00:00.000Z')
    expect(previous.end).toBe('2025-08-24T09:00:00.000Z')
  })

  it('a custom period compares against an equal-length window immediately before it', () => {
    const period = resolvePeriod('custom', NOW, { start: new Date('2026-08-10T00:00:00Z'), end: new Date('2026-08-20T00:00:00Z') })
    const previous = previousEquivalentPeriod(period)
    expect(previous.start).toBe('2026-07-31T00:00:00.000Z')
    expect(previous.end).toBe('2026-08-10T00:00:00.000Z')
  })
})
