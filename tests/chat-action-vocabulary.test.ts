import { describe, expect, it } from 'vitest'
import { EXECUTABLE_ACTION_TYPES, PROPOSED_ACTION_TYPES, type ProposedActionType } from '@/lib/ai/actions/types'

/**
 * "Do NOT allow the AI to invent arbitrary action types" is enforced at
 * the type level (`ProposedActionType` is a closed string-literal union;
 * nothing anywhere in `ai/actions/` can produce a value outside it and
 * still compile) — these tests assert the runtime constant mirrors that
 * closed set exactly, and that the "real approval path" subset never
 * silently grows without every consuming module being updated too.
 */

const EXPECTED: readonly ProposedActionType[] = [
  'UPDATE_PRICE', 'CREATE_LISTING', 'PAUSE_LISTING', 'REVIEW_SUPPLIER',
  'REVIEW_PRODUCT', 'ADJUST_INVENTORY_THRESHOLD', 'REVIEW_ADVERTISING', 'REQUEST_APPROVAL',
]

describe('ProposedActionType vocabulary is closed and exact', () => {
  it('PROPOSED_ACTION_TYPES contains exactly the documented 8 types, no more, no fewer', () => {
    expect([...PROPOSED_ACTION_TYPES].sort()).toEqual([...EXPECTED].sort())
  })

  it('EXECUTABLE_ACTION_TYPES is a strict subset of PROPOSED_ACTION_TYPES', () => {
    for (const t of EXECUTABLE_ACTION_TYPES) expect(PROPOSED_ACTION_TYPES).toContain(t)
  })

  it('exactly UPDATE_PRICE and REQUEST_APPROVAL are executable today — every other type is review-only, deliberately, not by omission', () => {
    expect([...EXECUTABLE_ACTION_TYPES].sort()).toEqual(['REQUEST_APPROVAL', 'UPDATE_PRICE'])
  })
})
