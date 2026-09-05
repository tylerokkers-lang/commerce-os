import { describe, expect, it } from 'vitest'
import { evaluatePublicationAutomation } from '@/lib/automation/publicationAutomation'
import { CONFIGURED_AUTOMATION_SETTINGS as DEMO_AUTOMATION_SETTINGS } from './helpers/automationSettings'
import { assessCompliance, type ComplianceContext } from '@/lib/compliance/rules'
import type { PublicationGateInput } from '@/lib/marketplaces/publicationGate'

const PASSING_CONTEXT: ComplianceContext = {
  title: 'Bamboo drawer dividers',
  category: 'kitchen',
  identifiers: [{ idType: 'gtin', value: '5012345678900', source: 'gs1', validation: 'valid' }],
  supplierCapability: 'approved',
  supplierCapabilityReasons: [],
  documents: [],
  blockedCategories: [],
  ipInput: { brand: null, ownBrands: [], restrictedBrands: [], title: 'Bamboo drawer dividers', description: null },
}

const FAILING_CONTEXT: ComplianceContext = { ...PASSING_CONTEXT, identifiers: [] } // No GTIN: fails Amazon, irrelevant for Shopify.

function gateInput(overrides: Partial<PublicationGateInput> = {}): PublicationGateInput {
  return {
    channel: 'shopify',
    productStage: 'approved',
    productDecision: 'add',
    channelDecision: 'add',
    supplierCapability: { status: 'approved', reasons: ['Everything checks out.'] },
    profitabilityGatePasses: true,
    profitabilityFailureReason: null,
    compliance: assessCompliance('shopify', PASSING_CONTEXT),
    automationLevel: 'autonomous',
    ...overrides,
  }
}

describe('publication automation', () => {
  it('publishes automatically only at autonomous, once every requirement passes', () => {
    const autonomous = evaluatePublicationAutomation(gateInput(), DEMO_AUTOMATION_SETTINGS)
    expect(autonomous.policy.outcome).toBe('allow_automatic')

    const supervised = evaluatePublicationAutomation(gateInput({ automationLevel: 'supervised' }), DEMO_AUTOMATION_SETTINGS)
    expect(supervised.policy.outcome).toBe('require_approval')
  })

  it('blocks outright when compliance fails, regardless of automation level', () => {
    const result = evaluatePublicationAutomation(
      gateInput({ channel: 'amazon_uk', compliance: assessCompliance('amazon_uk', FAILING_CONTEXT) }),
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(result.policy.outcome).toBe('block')
  })

  it('the "publishing" category pause blocks an otherwise fully-permitted publication', () => {
    const paused = { ...DEMO_AUTOMATION_SETTINGS, automationPausedCategories: ['publishing' as const] }
    const result = evaluatePublicationAutomation(gateInput(), paused)
    expect(result.policy.outcome).toBe('block')
  })

  it('Amazon and Shopify are decided completely independently for the same product', () => {
    const shopify = evaluatePublicationAutomation(gateInput({ compliance: assessCompliance('shopify', FAILING_CONTEXT) }), DEMO_AUTOMATION_SETTINGS)
    const amazon = evaluatePublicationAutomation(
      gateInput({ channel: 'amazon_uk', compliance: assessCompliance('amazon_uk', FAILING_CONTEXT) }),
      DEMO_AUTOMATION_SETTINGS,
    )
    expect(shopify.policy.outcome).toBe('allow_automatic')
    expect(amazon.policy.outcome).toBe('block')
  })
})
