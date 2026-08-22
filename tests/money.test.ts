import { describe, expect, it } from 'vitest'
import {
  add,
  CurrencyMismatchError,
  formatMoney,
  fromMajor,
  marginPct,
  money,
  multiply,
  percentOf,
  subtract,
  vatFromGross,
  vatFromNet,
} from '@/lib/core/money'

describe('money', () => {
  it('refuses fractional minor units', () => {
    expect(() => money(10.5)).toThrow(TypeError)
  })

  it('parses major units without floating point drift', () => {
    // 19.99 * 100 is 1998.9999... in binary floating point.
    expect(fromMajor(19.99).minor).toBe(1999)
    expect(fromMajor('£1,234.56').minor).toBe(123456)
  })

  it('adds without accumulating error', () => {
    const total = add(fromMajor(0.1), fromMajor(0.2))
    expect(total.minor).toBe(30)
  })

  it('refuses to combine different currencies', () => {
    expect(() => add(money(100, 'GBP'), money(100, 'EUR'))).toThrow(CurrencyMismatchError)
  })

  it('rounds percentages symmetrically around zero', () => {
    // A naive Math.round would give -2 here, quietly favouring one direction
    // on refunds and credit notes.
    expect(percentOf(money(-5), 50).minor).toBe(-3)
    expect(percentOf(money(5), 50).minor).toBe(3)
  })

  it('extracts VAT from a VAT-inclusive price', () => {
    // £119.99 including 20% VAT contains £20.00 of VAT.
    expect(vatFromGross(fromMajor(119.99), 20).minor).toBe(2000)
  })

  it('adds VAT to a net price', () => {
    expect(vatFromNet(fromMajor(99.99), 20).minor).toBe(2000)
  })

  it('returns zero VAT at a zero rate rather than dividing', () => {
    expect(vatFromGross(fromMajor(50), 0).minor).toBe(0)
  })

  it('reports null margin on zero revenue instead of Infinity', () => {
    expect(marginPct(fromMajor(10), fromMajor(0))).toBeNull()
  })

  it('computes margin to two decimal places', () => {
    expect(marginPct(fromMajor(25), fromMajor(100))).toBe(25)
    expect(marginPct(fromMajor(1), fromMajor(3))).toBe(33.33)
  })

  it('formats in the org currency', () => {
    expect(formatMoney(fromMajor(1234.5))).toBe('£1,234.50')
  })

  it('subtracts and multiplies consistently', () => {
    expect(subtract(fromMajor(10), fromMajor(3.33)).minor).toBe(667)
    expect(multiply(fromMajor(1.5), 3).minor).toBe(450)
  })
})
