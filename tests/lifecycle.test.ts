import { describe, expect, it } from 'vitest'
import {
  TERMINAL_STAGES,
  checkGates,
  isPaused,
  isPreLaunch,
  isTerminal,
  isTrading,
  nextStages,
  planTransition,
  type GateState,
} from '@/lib/products/lifecycle'
import { planStageChange } from '@/lib/products/transitions'
import type { ProductStage } from '@/lib/core/domain'

const ALL_STAGES: readonly ProductStage[] = [
  'discovered', 'researching', 'supplier_review', 'compliance_review', 'approved',
  'testing', 'proven', 'scaling', 'mature', 'declining', 'rejected', 'paused', 'removed',
]

describe('lifecycle transitions', () => {
  it('walks the whole happy path the brief describes', () => {
    const path: ProductStage[] = [
      'discovered', 'researching', 'supplier_review', 'compliance_review',
      'approved', 'testing', 'proven', 'scaling',
    ]
    for (let i = 0; i < path.length - 1; i += 1) {
      const result = planTransition({
        from: path[i],
        to: path[i + 1],
        reason: 'Met the criteria for the next stage',
      })
      expect(result.ok, `${path[i]} -> ${path[i + 1]}`).toBe(true)
    }
  })

  it('refuses to skip the supplier and compliance gates', () => {
    const result = planTransition({
      from: 'discovered',
      to: 'scaling',
      reason: 'Looks like a winner to me',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Permitted next stages/)
  })

  it('refuses a transition with no meaningful reason', () => {
    const result = planTransition({ from: 'discovered', to: 'researching', reason: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/reason of at least 8 characters/)
  })

  it('refuses a move to the same stage', () => {
    const result = planTransition({ from: 'testing', to: 'testing', reason: 'No change at all' })
    expect(result.ok).toBe(false)
  })

  it('treats rejected and removed as terminal', () => {
    for (const stage of TERMINAL_STAGES) {
      expect(isTerminal(stage)).toBe(true)
      expect(nextStages(stage)).toHaveLength(0)

      const result = planTransition({ from: stage, to: 'testing', reason: 'Changed my mind about it' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/terminal stage/)
    }
  })

  it('distinguishes rejecting a candidate from removing a traded product', () => {
    // A candidate is rejected; something that traded is removed. Both are
    // terminal, and conflating them would lose why the product ended.
    expect(nextStages('researching')).toContain('rejected')
    expect(nextStages('declining')).toContain('removed')
    expect(nextStages('researching')).not.toContain('removed')
  })

  it('allows a pause to be undone', () => {
    expect(planTransition({ from: 'paused', to: 'testing', reason: 'Resuming after the fix' }).ok).toBe(true)
    expect(planTransition({ from: 'paused', to: 'proven', reason: 'Resuming after the fix' }).ok).toBe(true)
  })

  it('every stage is classified exactly once', () => {
    // Paused is deliberately its own class: a product can be paused before
    // launch or after trading, so it belongs to neither.
    for (const stage of ALL_STAGES) {
      const classifications = [
        isPreLaunch(stage),
        isTrading(stage),
        isTerminal(stage),
        isPaused(stage),
      ].filter(Boolean)
      expect(classifications.length, stage).toBe(1)
    }
  })

  it('every declared next stage is itself a real stage', () => {
    for (const stage of ALL_STAGES) {
      for (const next of nextStages(stage)) {
        expect(ALL_STAGES, `${stage} -> ${next}`).toContain(next)
      }
    }
  })
})

describe('stage gates', () => {
  const satisfied: GateState = {
    hasScore: true,
    meetsMinimumScore: true,
    hasApprovedSupplier: true,
    complianceAssessed: true,
    compliancePassesAnyChannel: true,
    profitablePassesAnyChannel: true,
  }

  it('lets a fully qualified product reach approved', () => {
    expect(checkGates('approved', satisfied).satisfied).toBe(true)
  })

  it('blocks approval without a compliance pass anywhere', () => {
    const result = checkGates('approved', { ...satisfied, compliancePassesAnyChannel: false })
    expect(result.satisfied).toBe(false)
    expect(result.missing.join(' ')).toMatch(/does not pass on any channel/)
  })

  it('blocks approval when nothing is profitable', () => {
    const result = checkGates('approved', { ...satisfied, profitablePassesAnyChannel: false })
    expect(result.satisfied).toBe(false)
    expect(result.missing.join(' ')).toMatch(/profitability gate/)
  })

  it('blocks compliance review without an approved supplier', () => {
    const result = checkGates('compliance_review', { ...satisfied, hasApprovedSupplier: false })
    expect(result.satisfied).toBe(false)
  })

  it('names every missing gate, not just the first', () => {
    const result = checkGates('approved', {
      hasScore: false,
      meetsMinimumScore: false,
      hasApprovedSupplier: false,
      complianceAssessed: false,
      compliancePassesAnyChannel: false,
      profitablePassesAnyChannel: false,
    })
    expect(result.missing.length).toBeGreaterThanOrEqual(4)
  })
})

describe('stage changes are always audited', () => {
  const base = {
    orgId: 'org-1',
    productId: 'prod-1',
    reason: 'Cleared every gate for testing',
    actorType: 'ai' as const,
    actorLabel: 'Catalogue automation',
  }

  it('produces an audit entry alongside the history row', () => {
    const plan = planStageChange({ ...base, from: 'approved', to: 'testing', opportunityScore: 82 })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.value.auditEntry.action).toBe('PRODUCT_STAGE_CHANGED')
    expect(plan.value.auditEntry.entityId).toBe('prod-1')
    expect(plan.value.auditEntry.previousValue).toEqual({ stage: 'approved' })
    expect(plan.value.auditEntry.newValue).toEqual({ stage: 'testing' })
    expect(plan.value.auditEntry.reason).toBe('Cleared every gate for testing')
    expect(plan.value.transitionRow.opportunity_score).toBe(82)
  })

  it('carries the actor through to the audit entry', () => {
    const plan = planStageChange({ ...base, from: 'approved', to: 'testing' })
    if (!plan.ok) throw new Error('expected a plan')
    expect(plan.value.auditEntry.actorType).toBe('ai')
    expect(plan.value.auditEntry.actorLabel).toBe('Catalogue automation')
  })

  it('produces nothing at all when the transition is refused', () => {
    const plan = planStageChange({ ...base, from: 'discovered', to: 'scaling' })
    expect(plan.ok).toBe(false)
  })

  it('refuses when the gates are not met, and says which', () => {
    const plan = planStageChange({
      ...base,
      from: 'approved',
      to: 'testing',
      gates: {
        hasScore: true,
        meetsMinimumScore: true,
        hasApprovedSupplier: true,
        complianceAssessed: true,
        compliancePassesAnyChannel: false,
        profitablePassesAnyChannel: true,
      },
    })
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.error).toMatch(/does not pass on any channel/)
  })

  it('records a rejection under a distinct audit action', () => {
    const plan = planStageChange({
      ...base,
      from: 'researching',
      to: 'rejected',
      reason: 'Fails the profitability gate on every channel',
    })
    if (!plan.ok) throw new Error('expected a plan')
    expect(plan.value.auditEntry.action).toBe('PRODUCT_REMOVED')
  })

  it('keeps evidence JSON-safe so the write cannot fail on it', () => {
    const plan = planStageChange({
      ...base,
      from: 'approved',
      to: 'testing',
      evidence: { score: 82, note: undefined, fn: () => 1, nested: { ok: true } },
    })
    if (!plan.ok) throw new Error('expected a plan')
    expect(plan.value.transitionRow.evidence).toEqual({ score: 82, nested: { ok: true } })
  })
})
