import { describe, expect, it } from 'vitest'
import { decideComplianceRecheck, type ComplianceRecheckContext } from '@/lib/orders/complianceRecheck'

function context(over: Partial<ComplianceRecheckContext> = {}): ComplianceRecheckContext {
  return {
    approvedSupplierId: 'sup-1',
    fulfillingSupplierId: 'sup-1',
    daysSinceLastAssessment: 10,
    productDetailsChangedSinceApproval: false,
    ...over,
  }
}

describe('compliance re-check decision', () => {
  it('requires a re-check when no supplier is recorded', () => {
    const decision = decideComplianceRecheck(context({ fulfillingSupplierId: null }))
    expect(decision.required).toBe(true)
  })

  it('requires a re-check when the fulfilling supplier differs from the approved one', () => {
    const decision = decideComplianceRecheck(context({ fulfillingSupplierId: 'sup-2' }))
    expect(decision.required).toBe(true)
    expect(decision.reason).toMatch(/different supplier/)
  })

  it('requires a re-check when product details changed since approval', () => {
    const decision = decideComplianceRecheck(context({ productDetailsChangedSinceApproval: true }))
    expect(decision.required).toBe(true)
  })

  it('requires a re-check when the assessment is stale', () => {
    const decision = decideComplianceRecheck(context({ daysSinceLastAssessment: 200 }))
    expect(decision.required).toBe(true)
    expect(decision.reason).toMatch(/90-day/)
  })

  it('requires a re-check when no assessment exists at all', () => {
    const decision = decideComplianceRecheck(context({ daysSinceLastAssessment: null }))
    expect(decision.required).toBe(true)
  })

  it('does not require a re-check for the same supplier, unchanged product, fresh assessment', () => {
    const decision = decideComplianceRecheck(context())
    expect(decision.required).toBe(false)
  })
})
