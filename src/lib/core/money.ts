/**
 * Money is represented everywhere in this system as an integer number of minor
 * units (pence for GBP) paired with a currency code.
 *
 * Floating point is never used for money. `0.1 + 0.2 !== 0.3` is a rounding
 * curiosity in most software and a mis-stated VAT return here.
 */

export type CurrencyCode = 'GBP' | 'EUR' | 'USD' | 'CAD' | 'AUD'

export interface Money {
  readonly minor: number
  readonly currency: CurrencyCode
}

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`Cannot combine ${a} and ${b} without an explicit conversion`)
    this.name = 'CurrencyMismatchError'
  }
}

export function money(minor: number, currency: CurrencyCode = 'GBP'): Money {
  if (!Number.isInteger(minor)) {
    throw new TypeError(`Money must be whole minor units, received ${minor}`)
  }
  return { minor, currency }
}

export const zero = (currency: CurrencyCode = 'GBP'): Money => money(0, currency)

/** Parses a human figure ("12.34", 12.34) into minor units. */
export function fromMajor(major: number | string, currency: CurrencyCode = 'GBP'): Money {
  const value = typeof major === 'string' ? Number(major.replace(/[^0-9.-]/g, '')) : major
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot read "${major}" as an amount`)
  }
  return money(Math.round(value * 100), currency)
}

export const toMajor = (m: Money): number => m.minor / 100

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

export function add(...amounts: Money[]): Money {
  if (amounts.length === 0) return zero()
  const [first, ...rest] = amounts
  return rest.reduce((acc, next) => {
    assertSameCurrency(acc, next)
    return money(acc.minor + next.minor, acc.currency)
  }, first)
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minor - b.minor, a.currency)
}

export function multiply(a: Money, factor: number): Money {
  return money(Math.round(a.minor * factor), a.currency)
}

export function negate(a: Money): Money {
  return money(-a.minor, a.currency)
}

/**
 * Applies a percentage, rounding half away from zero.
 *
 * JavaScript's `Math.round` rounds half *up*, so -2.5 becomes -2. For a refund
 * or a credit note that asymmetry would quietly favour one direction, so the
 * magnitude is rounded and the sign reapplied.
 */
export function percentOf(a: Money, pct: number): Money {
  const raw = (a.minor * pct) / 100
  const rounded = Math.sign(raw) * Math.round(Math.abs(raw))
  return money(rounded, a.currency)
}

/** VAT contained within a gross (VAT-inclusive) amount at the given rate. */
export function vatFromGross(gross: Money, ratePct: number): Money {
  if (ratePct === 0) return zero(gross.currency)
  const raw = (gross.minor * ratePct) / (100 + ratePct)
  return money(Math.sign(raw) * Math.round(Math.abs(raw)), gross.currency)
}

/** VAT added on top of a net (VAT-exclusive) amount. */
export function vatFromNet(net: Money, ratePct: number): Money {
  return percentOf(net, ratePct)
}

export const isZero = (a: Money): boolean => a.minor === 0
export const isNegative = (a: Money): boolean => a.minor < 0

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b)
  return a.minor - b.minor
}

/**
 * Margin as a percentage of revenue, to two decimal places.
 * Returns null rather than Infinity or NaN when revenue is zero, so callers
 * are forced to handle "no sales yet" as its own case instead of rendering
 * a meaningless number.
 */
export function marginPct(profit: Money, revenue: Money): number | null {
  assertSameCurrency(profit, revenue)
  if (revenue.minor === 0) return null
  return Math.round((profit.minor / revenue.minor) * 10000) / 100
}

const formatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(m: Money, locale = 'en-GB'): string {
  const key = `${locale}:${m.currency}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency })
    formatters.set(key, formatter)
  }
  return formatter.format(toMajor(m))
}

/** Compact form for dashboard tiles: £1.8k, £24.3k. */
export function formatMoneyCompact(m: Money, locale = 'en-GB'): string {
  const major = toMajor(m)
  if (Math.abs(major) < 1000) return formatMoney(m, locale)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(major)
}
