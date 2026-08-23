import { describe, expect, it } from 'vitest'
import { factsHaveMaterializedChanged } from '@/lib/automation/factsComparison'

describe('approval fact-staleness invalidation', () => {
  it('detects a changed value for a key present in both snapshots', () => {
    expect(factsHaveMaterializedChanged({ stockOnHand: 12 }, { stockOnHand: 3 })).toBe(true)
  })

  it('does not flag a key that has not changed', () => {
    expect(factsHaveMaterializedChanged({ stockOnHand: 12, supplierId: 'sup-1' }, { stockOnHand: 12, supplierId: 'sup-1' })).toBe(false)
  })

  it('ignores a key that is not present in the current facts (nothing to compare)', () => {
    expect(factsHaveMaterializedChanged({ stockOnHand: 12, note: 'irrelevant' }, { stockOnHand: 12 })).toBe(false)
  })

  it('compares nested/object values structurally, not by reference', () => {
    expect(factsHaveMaterializedChanged({ supplier: { id: 'sup-1' } }, { supplier: { id: 'sup-1' } })).toBe(false)
    expect(factsHaveMaterializedChanged({ supplier: { id: 'sup-1' } }, { supplier: { id: 'sup-2' } })).toBe(true)
  })

  it('an empty proposed-facts snapshot never invalidates anything', () => {
    expect(factsHaveMaterializedChanged({}, { anything: 'goes' })).toBe(false)
  })
})
